import { describe, it, expect } from 'vitest';
import { Task, Resource, ResourceType, Availability } from '@edt-ts/scheduler-common';
import type { CourseTaskData } from '@edt-ts/scheduler-common';
import { TaskUnit } from '../src/taskUnit.js';
import { TaskGroupUnit } from '../src/taskGroupUnit.js';

/**
 * Construit une ressource avec des créneaux de disponibilité donnés (en minutes).
 */
function makeResource(id: string, type: ResourceType, slots: Array<[number, number]>, status?: string): Resource {
  const resource = new Resource(id, type, status);
  const availability = new Availability();
  for (const [start, end] of slots) availability.addAvailability(start, end);
  resource.availability = availability;
  return resource;
}

function makeCourseData(overrides: Partial<CourseTaskData> = {}): CourseTaskData {
  return {
    week: 1,
    semester: 1,
    level: 0,
    code: 'C1',
    type: 'TD',
    name: 'Test',
    teacher: [],
    groups: [],
    rooms: [],
    duration: 60,
    ...overrides,
  };
}

/**
 * Construit une Task avec des combinaisons de ressources explicites par type
 * (reproduit le pattern d'assemblage de schedulerData.ts:125-156 : construction
 * avec un tableau de ressources vide, puis assignation manuelle + addTask).
 */
function makeTask(
  id: string,
  combos: { teacher?: Resource[][]; room?: Resource[][]; group?: Resource[][] },
  courseDataOverrides: Partial<CourseTaskData> = {},
): Task {
  const task = new Task(id, makeCourseData(courseDataOverrides), []);
  task.resources[ResourceType.TEACHER] = combos.teacher ?? [];
  task.resources[ResourceType.ROOM] = combos.room ?? [];
  task.resources[ResourceType.GROUP] = combos.group ?? [];

  for (const list of Object.values(task.resources)) {
    for (const combo of list) {
      for (const resource of combo) resource.addTask(task);
    }
  }
  return task;
}

describe('getSchedulingPriority — TaskUnit', () => {
  it('une tâche à 1 combinaison peu disponible score plus haut qu\'une tâche à 3 combinaisons très disponibles', () => {
    const teacherTight = makeResource('tight', ResourceType.TEACHER, [[0, 100]]);
    const taskTight = makeTask('tight-task', { teacher: [[teacherTight]] });

    const teacherWide1 = makeResource('wide1', ResourceType.TEACHER, [[0, 1000]]);
    const teacherWide2 = makeResource('wide2', ResourceType.TEACHER, [[0, 1000]]);
    const teacherWide3 = makeResource('wide3', ResourceType.TEACHER, [[0, 1000]]);
    const taskWide = makeTask('wide-task', { teacher: [[teacherWide1], [teacherWide2], [teacherWide3]] });

    const unitTight = new TaskUnit(taskTight);
    const unitWide = new TaskUnit(taskWide);

    // Avant tout booking : sur le code actuel (bug), les deux scoreraient pareil (constante).
    expect(unitTight.getSchedulingPriority()).toBeGreaterThan(unitWide.getSchedulingPriority());
  });

  it('le bonus vacataire est supprimé : seule la disponibilité réelle compte', () => {
    const teacherVacataireWide = makeResource('vacataire', ResourceType.TEACHER, [[0, 1000]], 'VACATAIRE');
    const taskVacataireWide = makeTask('vacataire-task', { teacher: [[teacherVacataireWide]] });

    const teacherPermanentTight = makeResource('permanent', ResourceType.TEACHER, [[0, 50]]);
    const taskPermanentTight = makeTask('permanent-task', { teacher: [[teacherPermanentTight]] });

    const unitVacataire = new TaskUnit(taskVacataireWide);
    const unitPermanent = new TaskUnit(taskPermanentTight);

    // Avec l'ancien bonus fixe (+7200), le vacataire aurait dominé malgré sa large disponibilité.
    expect(unitPermanent.getSchedulingPriority()).toBeGreaterThan(unitVacataire.getSchedulingPriority());
  });

  it('le score se réévalue après un booking qui réduit la disponibilité d\'une ressource partagée', () => {
    const sharedTeacher = makeResource('shared', ResourceType.TEACHER, [[0, 120]]);
    const taskA = makeTask('task-a', { teacher: [[sharedTeacher]] }, { duration: 60 });
    const taskB = makeTask('task-b', { teacher: [[sharedTeacher]] }, { duration: 60 });

    const unitA = new TaskUnit(taskA);
    const unitB = new TaskUnit(taskB);

    const priorityBefore = unitB.getSchedulingPriority();
    expect(unitA.getSchedulingPriority()).toBe(priorityBefore); // même ressource, même disponibilité au départ

    unitA.book({ start: 0, resources: [sharedTeacher] });

    const priorityAfter = unitB.getSchedulingPriority();
    expect(priorityAfter).toBeGreaterThan(priorityBefore); // moins de disponibilité restante ⇒ plus prioritaire
  });

  it('propage aux dépendants par max, pas par somme : un bloqueur hérite du score de son dépendant le plus urgent, sans être pénalisé par sa propre disponibilité', () => {
    const teacherWide = makeResource('wide', ResourceType.TEACHER, [[0, 1000]]);
    const ancestorTask = makeTask('ancestor', { teacher: [[teacherWide]] });
    const ancestorUnit = new TaskUnit(ancestorTask);

    const teacherTight = makeResource('tight', ResourceType.TEACHER, [[0, 5]]);
    const dependentTask = makeTask('dependent', { teacher: [[teacherTight]] });
    const dependentUnit = new TaskUnit(dependentTask);

    dependentUnit.setDependsOn(ancestorUnit);

    // Avec une somme (bug corrigé), ancestorUnit aurait scoré PLUS BAS qu'une tâche
    // isolée aussi disponible que lui, à cause de l'addition du score (négatif) du
    // dépendant. Avec max, il hérite exactement du score du dépendant le plus urgent.
    expect(ancestorUnit.getSchedulingPriority()).toBe(dependentUnit.getSchedulingPriority());

    const unrelatedTask = makeTask('unrelated', { teacher: [[makeResource('unrelated-t', ResourceType.TEACHER, [[0, 1000]])]] });
    const unrelatedUnit = new TaskUnit(unrelatedTask);
    // Le bloqueur (ancestor) doit rester au moins aussi prioritaire qu'une tâche
    // isolée de disponibilité comparable — jamais pénalisé pour avoir un dépendant.
    expect(ancestorUnit.getSchedulingPriority()).toBeGreaterThanOrEqual(unrelatedUnit.getSchedulingPriority());
  });
});

describe('getSchedulingPriority — TaskGroupUnit (agrégation par min)', () => {
  function makeThreeMembers(): Task[] {
    const teacherTight = makeResource('t-tight', ResourceType.TEACHER, [[0, 5]]);
    const teacherWide1 = makeResource('t-wide1', ResourceType.TEACHER, [[0, 800]]);
    const teacherWide2 = makeResource('t-wide2', ResourceType.TEACHER, [[0, 800]]);
    return [
      makeTask('m1', { teacher: [[teacherTight]] }),
      makeTask('m2', { teacher: [[teacherWide1]] }),
      makeTask('m3', { teacher: [[teacherWide2]] }),
    ];
  }

  it('groupe parallel : le score reflète le membre le plus contraint (min), pas la somme', () => {
    const group = new TaskGroupUnit('group-parallel', 'parallel', makeThreeMembers());
    expect(group.getSchedulingPriority()).toBe(-5);
    expect(group.getSchedulingPriority()).not.toBe(-(5 + 800 + 800));
  });

  it('groupe sequential : même formule, même résultat que parallel', () => {
    const group = new TaskGroupUnit('group-sequential', 'sequential', makeThreeMembers());
    expect(group.getSchedulingPriority()).toBe(-5);
    expect(group.getSchedulingPriority()).not.toBe(-(5 + 800 + 800));
  });
});
