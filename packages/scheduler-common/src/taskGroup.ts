import { Task } from './task.ts';
import type { ITaskGroup, TaskGroupType } from './types.ts';

/**
 * Modèle d'un groupe de tâches à planifier conjointement.
 *
 * Deux types :
 *  - 'parallel'   : toutes les tâches démarrent au même instant.
 *  - 'sequential' : les tâches s'enchaînent sans gap dans l'ordre d'ajout.
 *
 * Contraintes d'appartenance (enforced par addTask) :
 *  - Une tâche enforced ne peut pas appartenir à un groupe (option C).
 *  - Une tâche ne peut appartenir qu'à un seul groupe.
 *
 * La logique de planification (earlySchedule, book, unBook) est déléguée à
 * TaskGroupUnit dans scheduler-core — TaskGroup reste un modèle pur.
 */
export class TaskGroup implements ITaskGroup {
    readonly id: string;
    readonly groupType: TaskGroupType;
    readonly name: string;
    readonly code: string;
    private _tasks: Task[] = [];

    constructor(id: string, groupType: TaskGroupType, name: string, code: string) {
        this.id = id;
        this.groupType = groupType;
        this.name = name;
        this.code = code;
    }

    /**
     * Ajoute une tâche au groupe.
     * @throws si la tâche est enforced ou appartient déjà à un groupe.
     */
    addTask(task: Task): void {
        if (task.isEnforced) {
            throw new Error(
                `La tâche "${task.name}" (${task.id}) est enforced et ne peut pas appartenir à un groupe.`
            );
        }
        if (task.group !== null) {
            throw new Error(
                `La tâche "${task.name}" (${task.id}) appartient déjà au groupe "${task.group.id}".`
            );
        }
        this._tasks.push(task);
        task._setGroup(this);
    }

    /** Retourne les tâches membres dans leur ordre d'ajout (significatif pour sequential). */
    getTasks(): Task[] {
        return [...this._tasks];
    }

    get taskCount(): number {
        return this._tasks.length;
    }

    /**
     * Semaine de référence du groupe (celle de la première tâche membre).
     * Toutes les tâches d'un groupe doivent appartenir à la même semaine.
     */
    get week(): number {
        if (this._tasks.length === 0) throw new Error(`Le groupe "${this.id}" est vide.`);
        return this._tasks[0].week;
    }

    /**
     * Durée du groupe :
     *  - parallel   → max des durées individuelles
     *  - sequential → somme des durées individuelles
     */
    get duration(): number {
        if (this._tasks.length === 0) return 0;
        if (this.groupType === 'parallel') {
            return Math.max(...this._tasks.map(t => t.duration));
        }
        return this._tasks.reduce((sum, t) => sum + t.duration, 0);
    }
}
