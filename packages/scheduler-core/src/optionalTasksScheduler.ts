import { Scheduler, SLOT_STEP } from './scheduler.js';
import type { SchedulerSolution, NeutralizedUnitInfo } from './scheduler.js';
import type { ISchedulingUnit, SchedulingResult } from './schedulingUnit.js';
import type { SchedulerConfig, Task } from '@edt-ts/scheduler-common';
import { computeRootLowerBound, type RootLowerBoundResult } from './rootLowerBound.js';
import { Loader } from './loader.js';

/** Décision de saut : l'unité qui a réellement heurté l'impasse + sa cascade de dépendants non-enforced. */
interface SkipDecision {
    units: ISchedulingUnit[];   // units[0] = la racine (impasse réelle) ; units[1..] = cascade (§4.3)
    taskCount: number;          // somme des getMemberTasks().length sur l'ensemble — l'unité de coût
}

/**
 * Raison générique d'une sautée non-cascade (révision post-usage, docs/PlanOptionalTasksP2Explication.md
 * §R) : les explications MUS (deletion-MUS, `_explainSkip`, retirées) n'expliquaient que les
 * occupants du DERNIER créneau disputé d'une trajectoire donnée — une explication locale, pas
 * causale, jugée par Frédéric pas assez utile pour justifier le coût du rejeu de pile qu'elle
 * exigeait. Le diagnostic causal est désormais porté par l'analyse de charge côté client
 * (`packages/scheduler-client/lib/resourceLoadAnalysis.ts`), pas par le moteur.
 */
const GENERIC_UNPLACEABLE_REASON =
    'Ne peut pas tenir sous les contraintes actuelles — relâchement nécessaire pour atteindre 100%.';

/** Raison d'une sautée par cascade : sa dépendance est elle-même non plaçable (info structurelle, coût nul). */
function cascadeReason(dependencyId: string): string {
    return `Sautée par cascade : dépend de « ${dependencyId} », elle-même non plaçable — ` +
        `relâchement nécessaire pour atteindre 100%.`;
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
 * comme une solution finale mais comme le maximum atteignable sous les contraintes actuelles.
 * Chaque saut porte une raison générique uniforme (cascade exceptée, révision post-usage §R de
 * docs/PlanOptionalTasksP2Explication.md) — le diagnostic causal qui pilote la boucle de
 * réparation humaine vers le 100% est porté par l'analyse de charge côté client
 * (`packages/scheduler-client/lib/resourceLoadAnalysis.ts`), pas par une explication du moteur.
 *
 * Réimplémentation autonome du driver (principe « code séparé » du chantier backjumping) :
 * `Scheduler` n'est pas modifié dans son comportement (seules deux visibilités et une extraction
 * near-neutres ont été faites pour permettre cette sous-classe — voir PlanOptionalTasksP1.md §3).
 * Le blâme (`_failureCounts`) n'a ici aucun rôle décisionnel pendant la recherche — seulement
 * informatif (log, exploitable via `getTaskFailureCounts()`), conformément à conception §3.4.
 */
export class OptionalTasksScheduler extends Scheduler {
    private _skippedSet = new Set<string>();          // ids des unités sautées dans la branche courante
    private _skipStack: SkipDecision[] = [];           // pile des décisions de saut (pour défaire à la remontée)
    private _skippedTaskCount = 0;                     // coût courant, en TÂCHES (membres de groupes/cascade comptés)
    private _bestTaskCount = 0;                        // borne : coût du meilleur incumbent connu
    private _bestSolution: SchedulerSolution | null = null;
    private _provenOptimal = false;                    // true si l'arbre a été épuisé sans jamais heurter budget/timeout
    private _budgetExceeded = false;                   // true dès qu'un appel a été tronqué par _limitsReached()
    private _rootBound: RootLowerBoundResult = { lb: 0, certificates: [] }; // borne racine (P2-preuve), calculée une fois par solveWithElimination()

    /**
     * true si le résultat du dernier `solveWithElimination()` est prouvé optimal — arbre épuisé
     * sous les limites, garde de soundness incluse (§0, P3). Portée exacte de la preuve : « aucune
     * solution plaçant plus de tâches n'est atteignable PAR LE MOTEUR ». Relative au modèle de
     * placement : créneaux au-plus-tôt (borne glissante SLOT_STEP) dans tous les cas.
     *
     * Avec `comboBranching: false` (défaut) : restriction supplémentaire — la combinaison de
     * ressources choisie par `earlySchedule` (la plus tôt, jamais branchée) n'explore pas les
     * combos alternatifs au même créneau (cf. docs/AuditConformiteMCV.md « meilleur combo vs
     * union »). Avec `comboBranching: true` (docs/PlanComboBranchementBB.md) : cette restriction
     * saute — tous les combos de chaque `TaskUnit` sont branchés — et seules deux restrictions
     * subsistent : les `TaskGroupUnit` multi-combos ne sont pas branchés en interne (v1, §3),
     * et la discrétisation SLOT_STEP/semi-actif.
     *
     * Le gourmand vivant dans le même modèle que la passe qui l'amorce, la lecture métier reste
     * exacte dans les deux régimes : inutile de relancer ce moteur avec plus de budget, seul un
     * relâchement peut débloquer. Preuve absolue (au sens mathématique) uniquement si 0 sautée
     * ou si l'instance est sans alternatives.
     */
    get provenOptimal(): boolean { return this._provenOptimal; }

    /**
     * Borne inférieure racine (docs/PlanOptionalTasksP2Preuve.md) : certificats de bin-packing
     * exact calculés une fois par `solveWithElimination()`, APRÈS la passe gourmande (§3.1 calcul
     * paresseux, PlanLbCoutRacine.md) — sautée si celle-ci est déjà complète. Indépendante du
     * modèle de placement du B&B (elle ne place rien) — `lb` ne dépasse jamais l'optimum réel,
     * quel que soit le résultat de la recherche.
     */
    get rootBound(): RootLowerBoundResult { return this._rootBound; }

    /**
     * Point d'entrée officiel de cette classe (le `solve()` hérité, tour-par-tour, n'est pas
     * utilisé ici). `maxSolutions` est ignoré : on garde le meilleur incumbent, pas N solutions.
     *
     * Deux passes (P1.5, warm start — heuristique primale standard du branch-and-bound : Land &
     * Doig 1960 ; Berthold, « Primal Heuristics for Mixed Integer Programs », 2013 ; « starting
     * point » de CP Optimizer, Laborie et al., Constraints 2018) :
     *  1. Le moteur gourmand hérité (`Scheduler.solveWithElimination`) amorce l'incumbent et la
     *     borne — sa solution devient le PLANCHER du résultat final, par construction (propriété
     *     « jamais pire que le moteur actuel » du STATUT P1.5, qui n'était pas garantie en P1 :
     *     sur la semaine 40, la première descente du B&B seul ne produisait AUCUN incumbent).
     *  2. Le B&B ne cherche alors que STRICTEMENT mieux que la passe 1. S'il n'améliore pas (ou
     *     que le budget est épuisé avant), le résultat rendu reste celui du gourmand, mais ses
     *     `reason` sont réécrites en raison générique uniforme (`_genericizeReasons`, révision
     *     post-usage §R de docs/PlanOptionalTasksP2Explication.md — les raisons gourmandes brutes
     *     « Unité la plus bloquante… » ne fuitent jamais telles quelles en mode maxPlacement ; le
     *     diagnostic causal est porté par l'analyse de charge côté client, pas par le moteur).
     * Si la passe 1 est déjà complète (0 sautée), elle est indépassable : pas de passe 2.
     */
    override solveWithElimination(): SchedulerSolution[] {
        console.log('📋 Passe 1/2 — moteur gourmand (amorce)');
        const greedyResults = super.solveWithElimination();
        const greedyRaw = greedyResults[0] ?? null;
        const greedyCost = greedyRaw
            ? (greedyRaw.neutralizedUnits ?? []).reduce((n, i) => n + i.unit.getMemberTasks().length, 0)
            : Infinity;

        // Borne racine (P2-preuve, §3.1 calcul paresseux) : calculée APRÈS la passe gourmande,
        // amorcée par son résultat (warm start §3.2), et sautée entièrement si le gourmand est
        // déjà complet — le court-circuit `greedyCost <= lb` est alors trivialement vrai (lb ≥ 0
        // toujours), la LB n'apporte rien dans ce cas. Déplacement vérifié sûr en session (STATUT
        // PlanLbCoutRacine.md §3.1) : le gourmand ne réduit pas le problème (`_units` du scheduler
        // seulement, pas `TasksManager`), et le double `bookEnforced()` que l'ancien commentaire
        // invoquait pour justifier la position AVANT le gourmand est sans effet sur le résultat
        // (`subtractIntervals` idempotent) — seul un log bruyant en dépendait.
        if (greedyCost === 0) {
            this._rootBound = { lb: 0, certificates: [] };
        } else {
            const allTasks = Loader.tasksManager.getAllUnits() as Task[];
            this._rootBound = computeRootLowerBound(allTasks, {
                lunchBreak: this._config.lunchBreak,
                ignoreDailyLimits: this._config.ignoreDailyLimits,
                skippedTaskIds: this._computeSkippedTaskIds(allTasks, greedyRaw),
            });
        }
        console.log(`🔒 Borne racine : lb=${this._rootBound.lb} (${this._rootBound.certificates.length} certificat(s))`);
        // Normalisation nécessaire : Scheduler.solveWithElimination() hérite la sémantique de
        // Scheduler.solve() pour `isComplete` — "complet" par rapport au sous-ensemble RÉDUIT
        // après élimination(s), pas par rapport à l'ensemble original. `isComplete` vaut donc
        // `true` même avec des unités neutralisées, ce qui contredit le cadrage métier de cette
        // classe (§1 conception : "complet" = 100%, aucune tâche sautée). Sans cette correction,
        // un résultat final hérité tel quel de la passe gourmande (aucune amélioration B&B)
        // rendrait un `isComplete` erroné dès qu'il y a ≥1 sautée (trouvé par test direct).
        const greedyBest: SchedulerSolution | null = greedyRaw
            ? { ...greedyRaw, isComplete: greedyCost === 0 }
            : null;
        console.log(`🎯 Passe gourmande : ${greedyBest?.neutralizedUnits?.length ?? 0} sautée(s) (coût ${greedyCost === Infinity ? '∞' : greedyCost})`);

        this._budgetExceeded = false;

        // Court-circuit par borne racine (P2-preuve) : coûtGourmand ≤ lb ⟹ optimum prouvé sans
        // lancer le B&B — `lb` est toujours ≥ 0, donc ce test généralise le cas historique
        // « gourmand complet » (greedyCost === 0, lb ≥ 0 toujours vrai) sans en changer le
        // comportement. Ne PAS appeler _resetBacktrackState() ici : _iterations doit rester celui
        // de la passe gourmande (aucune passe B&B n'a tourné — voir test « court-circuit
        // gourmand-complet »). Retourne [greedyBest], pas greedyResults tel quel : cette classe
        // garde toujours EXACTEMENT un incumbent (maxSolutions est ignoré, cf. docstring), jamais
        // jusqu'à maxSolutions comme le gourmand peut légitimement en renvoyer plusieurs.
        if (greedyBest && greedyCost <= this._rootBound.lb) {
            this._provenOptimal = true;
            console.log(`✅ Optimum prouvé par borne racine (coût gourmand ${greedyCost} ≤ lb ${this._rootBound.lb}) — passe B&B non nécessaire.`);
            // Uniformiser les raisons comme le fait le chemin B&B hérité (_genericizeReasons,
            // révision post-usage §R) : ce court-circuit contourne le B&B mais rend le même genre
            // de résultat « hérité du gourmand » — no-op quand neutralizedUnits est vide (cas
            // historique greedyCost === 0).
            return [this._genericizeReasons(greedyBest)];
        }

        // ── Passe 2 : B&B, amorcé par la passe gourmande, ne cherche que STRICTEMENT mieux ──
        console.log('📋 Passe 2/2 — branch-and-bound (amélioration)');
        this.initSolver(); // le gourmand a muté _units (retrait des unités éliminées) — reconstruire
        this._resetBacktrackState();
        this._skippedSet.clear();
        this._skipStack = [];
        this._skippedTaskCount = 0;
        this._bestSolution = greedyBest;                                                  // jamais pire que le gourmand, par construction
        this._bestTaskCount = Math.min(this._config.maxEliminations + 1, greedyCost);     // borne d'attaque : cap utilisateur, ou strictement sous le gourmand si plus bas
        this._provenOptimal = false;

        console.log(`⏰ Timeout: ${this._config.timeoutSeconds}s — budget: ${this._config.maxIterations} itérations`);

        const startMs = Date.now();
        this._bb(this._firstNonEnforcedIndex);
        const endMs = Date.now();
        const best = this._bestSolution as SchedulerSolution | null; // re-lu après _bb() : TS ne suit pas la mutation via _recordIncumbent()

        // Soundness (P3, revue Fable de P1.5) : quand greedyCost > maxEliminations + 1 (le
        // gourmand, qui compte en ROUNDS, a sauté une unité multi-tâches sous un cap serré), la
        // borne d'attaque vaut maxEliminations + 1 < greedyCost — épuiser l'arbre sous CETTE
        // borne prouve seulement « rien à coût ≤ maxEliminations », pas l'optimalité du résultat
        // gourmand rendu (un coût intermédiaire pourrait exister, jamais exploré). `!_budgetExceeded`
        // seul suffisait tant que ce cas ne se produisait pas (P1/P1.5, jamais rencontré en
        // pratique) mais est FAUX en général — voir STATUT docs/PlanOptionalTasksP3.md §0.
        const finalCost = best
            ? (best.neutralizedUnits ?? []).reduce((n, i) => n + i.unit.getMemberTasks().length, 0)
            : 0; // best === null : l'épuisement prouve l'infaisabilité sous le cap — revendication valide
        // Deux preuves d'optimalité INDÉPENDANTES (P2-preuve) : la garde historique (arbre épuisé
        // sous le cap maxEliminations) et la borne racine (finalCost == lb, cf. l'arrêt global
        // dans _bb ci-dessous). Ne jamais les fusionner — la LB peut prouver l'optimalité d'un
        // résultat que la garde seule laisserait non prouvé (coût > maxEliminements + 1, cf. STATUT
        // docs/PlanOptionalTasksP3.md §0), et réciproquement l'arbre peut être prouvé épuisé sans
        // qu'aucun certificat racine n'existe (lb = 0).
        this._provenOptimal = finalCost <= this._rootBound.lb || (!this._budgetExceeded && finalCost <= this._config.maxEliminations + 1);

        console.log(`\n⏱️  Passe B&B terminée en ${endMs - startMs}ms`);
        console.log(`🔄 Itérations B&B: ${this._iterations}`);

        // Chemin hérité : le B&B n'a pas amélioré la passe gourmande (best est TOUJOURS la même
        // référence que le greedyBest seedé, garanti par l'élagage P1.5 — voir _recordIncumbent)
        // — uniformiser ses raisons plutôt que de rendre les raisons gourmandes brutes. best ===
        // null (aucun incumbent nulle part) n'a rien à uniformiser.
        const finalResult = best && best === greedyBest ? this._genericizeReasons(best) : best;

        if (finalResult) {
            const nSkipped = finalResult.neutralizedUnits?.length ?? 0;
            console.log(`🎯 Meilleur incumbent final : ${finalResult.solutions.length} placées, ${nSkipped} sautée(s) — optimum ${this._provenOptimal ? 'PROUVÉ' : 'non prouvé (budget épuisé)'}`);
        } else {
            console.log('❌ Aucun incumbent (ni gourmand, ni B&B) — aucune solution ne tient sous la limite maxEliminations.');
        }

        return finalResult ? [finalResult] : [];
    }

    /**
     * Warm start (§3.2) : ensemble des tâches SAUTÉES par la passe gourmande, pour amorcer
     * `computeRootLowerBound` avec un packing réalisable connu. Construit exactement comme
     * spécifié dans PlanLbCoutRacine.md §3.2 — les tâches placées se LISENT dans `solutions`
     * (+ les enforced, placées de fait mais absentes de `solutions`), elles ne se déduisent
     * JAMAIS par complémentaire des neutralisées (destructeur silencieux de la borne, cf.
     * docstring de sûreté sur `maxPackMono`). Aucune garde `gourmandOK` nécessaire :
     * `bestInit = |S ∩ placed|` est réalisable par construction quel que soit l'état du
     * gourmand — si rien n'a été placé, `placedTaskIds` est vide et le warm start est neutre.
     */
    private _computeSkippedTaskIds(allTasks: Task[], greedyRaw: SchedulerSolution | null): ReadonlySet<string> {
        const placedTaskIds = new Set<string>();
        for (const us of greedyRaw?.solutions ?? []) {
            if (us.task) placedTaskIds.add(us.task.id);
            else for (const t of us.unit.getMemberTasks()) placedTaskIds.add(t.id);
        }
        for (const t of allTasks) {
            if (t.isEnforced && t.enforced) placedTaskIds.add(t.id);
        }
        const skippedTaskIds = new Set<string>();
        for (const t of allTasks) {
            if (!placedTaskIds.has(t.id)) skippedTaskIds.add(t.id);
        }
        return skippedTaskIds;
    }

    /**
     * Uniformise les `reason` d'un résultat HÉRITÉ de la passe gourmande (le B&B n'a rien trouvé
     * de strictement meilleur) : remplace les raisons gourmandes brutes (« Unité la plus
     * bloquante… », « Dépend de… ») par la raison générique de la classe, cascade exceptée.
     * Fonction pure sur `neutralizedUnits` — aucune reconstruction d'état (contrairement à
     * l'ancienne approche par rejeu déterministe, retirée en révision post-usage, voir
     * docs/PlanOptionalTasksP2Explication.md §R : le coût du rejeu ne se justifiait plus une fois
     * l'explication MUS jugée pas assez utile par Frédéric).
     */
    private _genericizeReasons(greedyBest: SchedulerSolution): SchedulerSolution {
        const skippedUnits = new Set((greedyBest.neutralizedUnits ?? []).map(n => n.unit));
        const neutralizedUnits: NeutralizedUnitInfo[] = (greedyBest.neutralizedUnits ?? []).map(info => {
            const dep = info.unit.getDependsOn();
            const reason = dep && skippedUnits.has(dep) ? cascadeReason(dep.id) : GENERIC_UNPLACEABLE_REASON;
            return { ...info, reason };
        });
        return { ...greedyBest, neutralizedUnits };
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

        // Élagage B&B (P1.5) : un nœud dont le coût committé atteint déjà la borne ne peut
        // plus produire d'amélioration STRICTE — inutile d'explorer. Sans cette coupe à
        // l'entrée de nœud, la recherche énumère exhaustivement toutes les feuilles à coût
        // ÉGAL après chaque incumbent (mesuré en P1 : 4542 feuilles de coût 4 sur la semaine
        // 37, chacune recalculant inutilement les explications MUS de _recordIncumbent).
        if (this._skippedTaskCount >= this._bestTaskCount) return false;

        // ── Feuille : toutes les unités sont placées ou sautées ──
        if (unitIndex >= this._units.length) {
            // _skippedTaskCount < _bestTaskCount est maintenant un VRAI invariant (P1.5) :
            // l'élagage ci-dessus l'a déjà vérifié à l'entrée de CET appel, et _skippedTaskCount
            // ne change pas entre l'entrée et ce point (aucune décision n'est prise en feuille).
            this._recordIncumbent();
            // Arrêt global dès que l'incumbent atteint la borne racine (P2-preuve) : aucune
            // solution ne peut faire mieux que `lb`, prouvé indépendamment de cet arbre — inutile
            // de continuer à chercher. `lb = 0` est le cas particulier historique (0 saut).
            return this._bestTaskCount <= this._rootBound.lb;
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

        if (this._config.comboBranching) {
            // ── Branches de placement — fusion chronologique à curseurs par combo (docs/
            // PlanComboBranchementBB.md §3) : à chaque itération, le combo non épuisé offrant
            // le départ le plus tôt est branché ; son curseur seul avance ensuite. Tie-break :
            // index de combo croissant (déterminisme — `<` strict laisse gagner le premier
            // combo trouvé à égalité, puisque les combos sont parcourus dans l'ordre).
            const comboCount = unit.getComboCount();
            const cursors = new Array<number>(comboCount).fill(fromTime);
            const exhausted = new Array<boolean>(comboCount).fill(false);

            while (true) {
                let bestCombo = -1;
                let bestResult: SchedulingResult | null = null;
                for (let c = 0; c < comboCount; c++) {
                    if (exhausted[c]) continue;
                    const candidate = unit.earlyScheduleForCombo(c, cursors[c]);
                    if (candidate === null) { exhausted[c] = true; continue; }
                    if (bestResult === null || candidate.start < bestResult.start) {
                        bestResult = candidate;
                        bestCombo = c;
                    }
                }
                if (bestResult === null) break; // tous les combos épuisés → branche de saut (ci-dessous)

                if (!this._floatingLBAllows(bestResult, unit.duration)) { cursors[bestCombo] = bestResult.start + SLOT_STEP; continue; }
                if (!this._dailyLimitAllows(bestResult, unit.duration))  { cursors[bestCombo] = bestResult.start + SLOT_STEP; continue; }

                this._solution.push({ unit, result: bestResult });
                this._scheduled.set(unit.id, bestResult);
                unit.book(bestResult);
                this._addDailyUsage(bestResult, unit.duration);

                const abort = this._bb(unitIndex + 1);

                unit.unBook(bestResult);
                this._subtractDailyUsage(bestResult, unit.duration);
                this._solution.pop();
                this._scheduled.delete(unit.id);

                if (abort) return true;
                cursors[bestCombo] = bestResult.start + SLOT_STEP;
            }
        } else {
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
     * `getTaskFailureCounts()` reste exploitable en diagnostic secondaire (affiché en `failureCount`
     * au tooltip) — l'explication textuelle livrée à l'utilisateur est la raison générique
     * uniforme de la classe (révision post-usage §R), pas un calcul par impasse.
     */
    private _incrementFailureBlameInformative(unit: ISchedulingUnit, fromTime: number): void {
        const occupants = this._config.conflictSetExact
            ? this._computeExactConflictSet(unit, fromTime)
            : this._computeConflictSet(unit, fromTime);
        this._blameConflictSet(unit, occupants);
    }

    /**
     * Enregistre la feuille courante comme nouvel incumbent. « Strictement meilleur » est un
     * VRAI invariant depuis P1.5 (garanti par l'élagage à l'entrée de nœud de `_bb`) — en P1,
     * cette même affirmation était fausse en pratique : sans cette coupe, une feuille de coût
     * ÉGAL au meilleur connu pouvait être atteinte et réenregistrée (voir STATUT de
     * docs/PlanOptionalTasksP1.md).
     */
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
                reason: GENERIC_UNPLACEABLE_REASON,
            });
            for (const dependent of cascadeDependents) {
                neutralizedUnits.push({
                    unit: dependent,
                    eliminationRound: 0,
                    failureCount: this._failureCounts.get(dependent.id) ?? 0,
                    reason: cascadeReason(root.id),
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
}

/** Fabrique (P3) : sélectionne le moteur selon config.searchStrategy (défaut : Scheduler historique). */
export function createScheduler(config?: SchedulerConfig): Scheduler {
    return config?.searchStrategy === 'maxPlacement' ? new OptionalTasksScheduler() : new Scheduler();
}
