import type { Resource, Task, FloatingLunchWindow } from '@edt-ts/scheduler-common';

/**
 * Résultat d'un earlySchedule : premier créneau disponible + combinaison de ressources choisie.
 */
export interface SchedulingResult {
    start: number;
    resources: Resource[];
}

/**
 * Solution atomique pour une unité planifiée (un créneau + ses ressources).
 * Un TaskGroup produit N UnitSolution (une par tâche membre).
 * `task` est renseigné par TaskGroupUnit pour désigner la tâche individuelle membre.
 */
export interface UnitSolution {
    unit: ISchedulingUnit;
    start: number;
    resources: Resource[];
    /** Tâche individuelle membre du groupe — présent uniquement si l'unité est un TaskGroupUnit. */
    task?: Task;
}

/**
 * Contrat de planification d'une unité dans le moteur Scheduler.
 *
 * Chaque unité sait :
 *  - trouver son premier créneau disponible à partir d'un instant donné (earlySchedule)
 *  - se réserver et se libérer (book / unBook)
 *  - se pré-réserver pour un créneau imposé (bookEnforced)
 *  - calculer sa priorité pour le tri MCV (getSchedulingPriority)
 *  - se sérialiser en UnitSolution[] après placement (toSolutions)
 *
 * Le moteur (Scheduler) ne connaît que cette interface.
 * Il ne distingue pas Task, TaskGroup ou tout autre type concret.
 */
export interface ISchedulingUnit {
    /** Identifiant unique */
    readonly id: string;

    /** Durée en minutes */
    readonly duration: number;

    /** Vrai si le placement est imposé (ne passe pas par earlySchedule) */
    readonly isEnforced: boolean;

    /**
     * Retourne le premier créneau disponible ≥ fromTime en choisissant en interne
     * la combinaison de ressources qui permet le placement le plus tôt.
     * Retourne null si aucun créneau n'existe avec aucune combinaison.
     * Opération en lecture seule : ne modifie pas l'état visible de l'unité.
     */
    earlySchedule(fromTime: number): SchedulingResult | null;

    /**
     * Réserve les ressources pour le créneau donné.
     * Sauvegarde l'état précédent pour permettre un unBook ultérieur.
     */
    book(result: SchedulingResult): void;

    /**
     * Libère les ressources réservées par le book correspondant.
     * Restaure l'état d'avant le book (LIFO).
     */
    unBook(result: SchedulingResult): void;

    /**
     * Réserve le créneau imposé. L'unité résout elle-même ses ressources
     * via Loader. Ne s'applique qu'aux unités enforced (TaskUnit).
     */
    bookEnforced(): void;

    /**
     * Retourne le SchedulingResult correspondant au créneau imposé,
     * après que bookEnforced() a été appelé.
     * Utilisé par le solveur pour pré-remplir _scheduled et _solution.
     * Ne s'applique qu'aux unités enforced (TaskUnit).
     */
    getEnforcedResult(): SchedulingResult;

    /**
     * Retourne un score de priorité pour le tri MCV.
     * Score élevé = unité très contrainte = à planifier en premier.
     * Doit refléter l'état courant des ressources (après les books précédents).
     */
    getSchedulingPriority(): number;

    /**
     * Configure la fenêtre de pause méridienne flottante utilisée pour le calcul du
     * score (getSchedulingPriority), si le moteur en a une (null sinon). Appelé une
     * fois par Scheduler.initSolver(), après _applyLunchBreak(). Voir §5.5 de
     * docs/HeuristiquePriorite-Conception.md.
     */
    setFloatingLunchBreak(window: FloatingLunchWindow | null): void;

    /**
     * Dernier instant de début valide pour cette unité, compte tenu de sa propre
     * disponibilité ET de l'échéance imposée par ses dépendants (récursif, §5.6 de
     * docs/HeuristiquePriorite-Conception.md). Retourne null si l'unité est infaisable
     * (aucun créneau valide — y compris par héritage d'un dépendant lui-même infaisable).
     * Utilisé par les ancêtres pour tronquer leur propre profil de disponibilité.
     */
    getEffectiveLatestStart(): number | null;

    // --- Dépendances séquentielles (ordre inter-unités) ---

    getDependsOn(): ISchedulingUnit | null;
    getDependentUnits(): ISchedulingUnit[];
    hasDependentUnits(): boolean;

    /**
     * Déclare que cette unité dépend de `unit` (doit être planifiée après).
     * Met à jour le lien inverse via _addDependentUnit.
     */
    setDependsOn(unit: ISchedulingUnit): void;

    /** @internal — maintient le lien inverse depuis setDependsOn */
    _addDependentUnit(unit: ISchedulingUnit): void;

    /** @internal — supprime le lien inverse */
    _removeDependentUnit(unit: ISchedulingUnit): void;

    /**
     * Sérialise le résultat du placement en UnitSolution(s).
     *  - Task atomique       → [1 solution]
     *  - TaskGroup parallel  → [N solutions, même start]
     *  - TaskGroup séquentiel → [N solutions, starts décalés]
     */
    toSolutions(result: SchedulingResult): UnitSolution[];

    /**
     * Retourne la liste aplatie des ressources candidates (toutes alternatives confondues).
     * Utilisée pour sérialiser une unité neutralisée (non placée).
     */
    getCandidateResources(): Resource[];

    /**
     * Retourne les tâches membres individuelles de l'unité.
     * Pour une TaskUnit : [this.task]. Pour un TaskGroupUnit : toutes les tâches du groupe.
     * Permet à la sérialisation d'éclater un groupe neutralisé en N entrées.
     */
    getMemberTasks(): Task[];
}
