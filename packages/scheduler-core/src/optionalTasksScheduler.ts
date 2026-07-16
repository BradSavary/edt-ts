import { Scheduler, SLOT_STEP } from './scheduler.js';
import type { SchedulerSolution, NeutralizedUnitInfo } from './scheduler.js';
import type { ISchedulingUnit } from './schedulingUnit.js';

/** Décision de saut : l'unité qui a réellement heurté l'impasse + sa cascade de dépendants non-enforced. */
interface SkipDecision {
    units: ISchedulingUnit[];   // units[0] = la racine (impasse réelle) ; units[1..] = cascade (§4.3)
    taskCount: number;          // somme des getMemberTasks().length sur l'ensemble — l'unité de coût
}

/**
 * Recherche à tâches optionnelles — branch-and-bound sur les sauts (docs/ConceptionTachesOptionnelles.md,
 * docs/PlanOptionalTasksP1.md).
 *
 * Remplace la stratégie gourmande solve()+solveWithElimination() par une seule recherche DFS
 * qui maximise le nombre de tâches placées : à l'épuisement des placements d'une unité, au lieu
 * de remonter (comme `Scheduler._backtrack`), une branche « sauter cette unité » est offerte en
 * dernier recours, bornée par le meilleur incumbent connu. Chaque feuille atteinte (toutes les
 * unités placées ou sautées) est un incumbent candidat ; la recherche continue jusqu'à budget
 * épuisé ou preuve d'optimalité (0 saut trouvé, ou arbre exploré/élagué entièrement).
 *
 * Conforme au cadrage métier du chantier (conception §1) : le résultat n'est jamais présenté
 * comme une solution finale mais comme le maximum atteignable sous les contraintes actuelles,
 * assorti d'un diagnostic (raison de chaque saut, §4.4) qui pilote la boucle de réparation
 * humaine vers le 100%.
 *
 * Réimplémentation autonome du driver (principe « code séparé » du chantier backjumping) :
 * `Scheduler` n'est pas modifié dans son comportement (seules deux visibilités et une extraction
 * near-neutres ont été faites pour permettre cette sous-classe — voir PlanOptionalTasksP1.md §3).
 * Le blâme (`_failureCounts`) n'a ici aucun rôle décisionnel pendant la recherche — seulement
 * informatif (log) — conformément à conception §3.4 : c'est `_computeExactConflictSet`, appelé
 * une seule fois par tâche sautée de l'incumbent FINAL, qui produit l'explication (§4.4).
 */
export class OptionalTasksScheduler extends Scheduler {
    private _skippedSet = new Set<string>();          // ids des unités sautées dans la branche courante
    private _skipStack: SkipDecision[] = [];           // pile des décisions de saut (pour défaire à la remontée)
    private _skippedTaskCount = 0;                     // coût courant, en TÂCHES (membres de groupes/cascade comptés)
    private _bestTaskCount = 0;                        // borne : coût du meilleur incumbent connu
    private _bestSolution: SchedulerSolution | null = null;
    private _provenOptimal = false;                    // true si l'arbre a été épuisé sans jamais heurter budget/timeout
    private _budgetExceeded = false;                   // true dès qu'un appel a été tronqué par _limitsReached()

    /**
     * Point d'entrée officiel de cette classe (le `solve()` hérité, tour-par-tour, n'est pas
     * utilisé ici). `maxSolutions` est ignoré : on garde le meilleur incumbent, pas N solutions.
     */
    override solveWithElimination(): SchedulerSolution[] {
        this.initSolver();
        this._resetBacktrackState();
        this._skippedSet.clear();
        this._skipStack = [];
        this._skippedTaskCount = 0;
        this._bestTaskCount = this._config.maxEliminations + 1; // borne initiale : au plus maxEliminations tâches sautées
        this._bestSolution = null;
        this._provenOptimal = false;
        this._budgetExceeded = false;

        console.log(`📋 ${this._units.length} unités à planifier (recherche à tâches optionnelles)`);
        console.log(`⏰ Timeout: ${this._config.timeoutSeconds}s — budget: ${this._config.maxIterations} itérations`);

        const startMs = Date.now();
        this._bb(this._firstNonEnforcedIndex);
        const endMs = Date.now();
        this._provenOptimal = !this._budgetExceeded;

        console.log(`\n⏱️  Résolution terminée en ${endMs - startMs}ms`);
        console.log(`🔄 Itérations: ${this._iterations}`);
        const best = this._bestSolution as SchedulerSolution | null; // re-lu après _bb() : TS ne suit pas la mutation via _recordIncumbent()
        if (best) {
            const nSkipped = best.neutralizedUnits?.length ?? 0;
            console.log(`🎯 Meilleur incumbent : ${best.solutions.length} placées, ${nSkipped} sautée(s) — optimum ${this._provenOptimal ? 'PROUVÉ' : 'non prouvé (budget épuisé)'}`);
        } else {
            console.log('❌ Aucun incumbent trouvé (aucune solution ne tient sous la limite maxEliminations).');
        }

        return best ? [best] : [];
    }

    /**
     * Récursion principale. Retourne `true` si l'exploration doit s'arrêter GLOBALEMENT —
     * soit parce que le budget/timeout a été atteint (`_budgetExceeded`), soit parce qu'un
     * incumbent à 0 saut a été trouvé (indépassable, la recherche est immédiatement terminée
     * et l'optimalité de CE résultat est acquise malgré l'arrêt anticipé — voir `_budgetExceeded`
     * qui, seul, détermine `_provenOptimal` au point d'entrée : un arrêt sur 0-saut n'est PAS
     * un abandon de budget).
     */
    private _bb(unitIndex: number): boolean {
        this._iterations++;
        if (this._limitsReached()) { this._budgetExceeded = true; return true; }

        // ── Feuille : toutes les unités sont placées ou sautées ──
        if (unitIndex >= this._units.length) {
            this._recordIncumbent(); // _skippedTaskCount < _bestTaskCount garanti par l'élagage à chaque décision de saut
            return this._bestTaskCount === 0; // 0 saut = indépassable : arrêt global
        }

        this._dynamicSort(unitIndex);
        const unit = this._units[unitIndex];

        // Unité déjà sautée par une cascade décidée en amont : traverser sans nouvelle décision.
        if (this._skippedSet.has(unit.id)) return this._bb(unitIndex + 1);

        // Garde de dépendance (miroir de _backtrack) : une dépendance non planifiée ET non sautée
        // signalerait une incohérence du graphe — ne devrait jamais se produire (si la dépendance
        // avait été sautée, unit aurait été cascadée avec elle et interceptée par le garde ci-dessus).
        const dep = unit.getDependsOn();
        if (dep && !this._scheduled.has(dep.id) && !this._skippedSet.has(dep.id)) {
            throw new Error(
                `OptionalTasksScheduler : unité '${unit.id}' atteinte avant sa dépendance '${dep.id}' — ` +
                `vérifiez que le graphe de dépendances est acyclique et cohérent avec le tri.`
            );
        }

        let fromTime = 0;
        if (dep && this._scheduled.has(dep.id)) {
            const depResult = this._scheduled.get(dep.id)!;
            fromTime = depResult.start + dep.duration;
        }

        // ── Branches de placement (copie fidèle de la boucle de _backtrack) ──
        while (true) {
            const result = unit.earlySchedule(fromTime);
            if (result === null) break; // épuisement des placements → branche de saut (ci-dessous)

            if (!this._floatingLBAllows(result, unit.duration)) { fromTime = result.start + SLOT_STEP; continue; }
            if (!this._dailyLimitAllows(result, unit.duration))  { fromTime = result.start + SLOT_STEP; continue; }

            this._solution.push({ unit, result });
            this._scheduled.set(unit.id, result);
            unit.book(result);
            this._addDailyUsage(result, unit.duration);

            const abort = this._bb(unitIndex + 1);

            unit.unBook(result);
            this._subtractDailyUsage(result, unit.duration);
            this._solution.pop();
            this._scheduled.delete(unit.id);

            if (abort) return true;
            fromTime = result.start + SLOT_STEP;
        }

        // ── Impasse de placement : blâme (informatif) + COS + branche de saut en dernier recours ──
        this._incrementFailureBlameInformative(unit, fromTime);
        this._stampConflict(unit);

        const cascade = [unit, ...this._collectDependents(unit)].filter(u => !this._skippedSet.has(u.id));
        const taskCount = cascade.reduce((n, u) => n + u.getMemberTasks().length, 0);
        if (this._skippedTaskCount + taskCount >= this._bestTaskCount) return false; // borne : élagage, pas d'abandon global

        for (const u of cascade) this._skippedSet.add(u.id);
        this._skipStack.push({ units: cascade, taskCount });
        this._skippedTaskCount += taskCount;

        const abort = this._bb(unitIndex + 1);

        this._skippedTaskCount -= taskCount;
        this._skipStack.pop();
        for (const u of cascade) this._skippedSet.delete(u.id);

        return abort;
    }

    /**
     * Attribution du blâme à l'impasse — purement informative ici (aucun rôle décisionnel dans
     * cette classe, contrairement à `Scheduler.solveWithElimination`). Conservée pour que
     * `getTaskFailureCounts()` reste exploitable en diagnostic secondaire, mais l'explication
     * réellement livrée à l'utilisateur est celle de `_explainSkip` (§4.4), calculée une seule
     * fois par tâche sautée de l'incumbent final — pas accumulée à chaque impasse de la recherche.
     */
    private _incrementFailureBlameInformative(unit: ISchedulingUnit, fromTime: number): void {
        const occupants = this._config.conflictSetExact
            ? this._computeExactConflictSet(unit, fromTime)
            : this._computeConflictSet(unit, fromTime);
        this._blameConflictSet(unit, occupants);
    }

    /** Enregistre la feuille courante comme nouvel incumbent (strictement meilleur, garanti par l'élagage). */
    private _recordIncumbent(): void {
        this._bestTaskCount = this._skippedTaskCount;
        const solutions = this._solution.flatMap(e => e.unit.toSolutions(e.result));

        const neutralizedUnits: NeutralizedUnitInfo[] = [];
        for (const decision of this._skipStack) {
            const [root, ...cascadeDependents] = decision.units;
            neutralizedUnits.push({
                unit: root,
                eliminationRound: 0,
                failureCount: this._failureCounts.get(root.id) ?? 0,
                reason: this._explainSkip(root),
            });
            for (const dependent of cascadeDependents) {
                neutralizedUnits.push({
                    unit: dependent,
                    eliminationRound: 0,
                    failureCount: this._failureCounts.get(dependent.id) ?? 0,
                    reason: `Sautée par cascade : dépend de « ${root.id} », elle-même non plaçable — ` +
                        `relâchement nécessaire pour atteindre 100%.`,
                });
            }
        }

        this._bestSolution = {
            solutions,
            isComplete: this._skippedTaskCount === 0,
            score: this._computeScore(),
            neutralizedUnits,
        };
    }

    /**
     * Explication d'une tâche sautée (racine d'une décision de saut, jamais un membre de cascade —
     * voir `_recordIncumbent`) : ensemble minimal de conflit (`_computeExactConflictSet`, §5.7/blâme
     * exact) calculé DANS L'ÉTAT DE LA FEUILLE (tout l'incumbent déjà placé), avec le `fromTime`
     * dérivé de sa dépendance si elle est planifiée (elle ne peut pas être sautée à cet endroit —
     * voir le garde de dépendance dans `_bb`), sinon 0.
     *
     * Limitation connue et acceptée en P1 (héritée de docs/PlanBlameExact.md, test 5) : le MUS
     * partage la limitation « fenêtre rétrécie » pour les causes de type quota/pause — l'explication
     * reste correcte quand elle désigne des coupables ; le repli « structurellement insuffisantes »
     * couvre le reste sans induire en erreur.
     */
    private _explainSkip(unit: ISchedulingUnit): string {
        const dep = unit.getDependsOn();
        let fromTime = 0;
        if (dep && this._scheduled.has(dep.id)) {
            fromTime = this._scheduled.get(dep.id)!.start + dep.duration;
        }

        const mus = this._computeExactConflictSet(unit, fromTime);
        if (mus.size > 0) {
            const ids = [...mus].map(u => u.id).join(', ');
            return `Ne peut pas tenir sous les contraintes actuelles : créneaux nécessaires occupés par ${ids} — ` +
                `relâchement nécessaire pour atteindre 100%.`;
        }
        return `Ne peut pas tenir sous les contraintes actuelles (aucune tâche placée en cause : ` +
            `disponibilités structurellement insuffisantes) — relâchement nécessaire pour atteindre 100%.`;
    }
}
