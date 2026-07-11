import { describe, it, expect } from 'vitest';
import { Task, Resource, ResourceType, Availability, encodePriorityMeasure, type FloatingLunchWindow } from '@edt-ts/scheduler-common';
import type { CourseTaskData } from '@edt-ts/scheduler-common';
import { TaskUnit } from '../src/taskUnit.js';
import { TaskGroupUnit } from '../src/taskGroupUnit.js';

/**
 * Construit une ressource avec des créneaux de disponibilité donnés (en minutes).
 * Plusieurs créneaux disjoints simulent un profil fragmenté.
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

    expect(unitTight.getSchedulingPriority()).toBeGreaterThan(unitWide.getSchedulingPriority());
  });

  it('fragmentation : un profil coupé en deux morceaux trop petits est jugé infaisable, distinct d\'une tâche largement disponible', () => {
    // 90min + 30min = 120min au total, mais la tâche dure 120min et aucun des deux
    // morceaux ne fait cette taille individuellement — doit scorer comme infaisable
    // (§5.4), pas comme "120min de marge disponible".
    const teacherFragmented = makeResource('fragmented', ResourceType.TEACHER, [[0, 90], [200, 230]]);
    const taskFragmented = makeTask('fragmented-task', { teacher: [[teacherFragmented]] }, { duration: 120 });

    const teacherWide = makeResource('wide', ResourceType.TEACHER, [[0, 1000]]);
    const taskWide = makeTask('wide-task-2', { teacher: [[teacherWide]] }, { duration: 120 });

    const unitFragmented = new TaskUnit(taskFragmented);
    const unitWide = new TaskUnit(taskWide);

    // Infaisable = score maximal (échoue au plus tôt, §5.4) — toujours au moins aussi
    // prioritaire qu'une tâche faisable, jamais moins.
    expect(unitFragmented.getSchedulingPriority()).toBeGreaterThanOrEqual(unitWide.getSchedulingPriority());
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

  it('§5.6 : troncature par échéance — cas chiffré CM/TD/TP du document de conception (marge attendue : 440)', () => {
    // Reproduit exactement l'exemple asymétrique de docs/HeuristiquePriorite-Conception.md §5.6 :
    // CM=[0,1000], TD=[500,600], TP=[560,620], durées 60 chacune → vérifié à la main
    // (passe arrière façon méthode du chemin critique) : LS(TP)=560, LS(TD)=500, LS(CM)=440.
    // Ni la somme (ancien moteur, aurait donné 600+40+0=... hors sujet ici) ni le `max`
    // remplacé en Phase 3 (équivalent à un min des marges indépendantes, aurait donné 0
    // pour CM — sous-estimation sévère) ne donnaient cette valeur.
    const cmTeacher = makeResource('cm-teacher', ResourceType.TEACHER, [[0, 1000]]);
    const cmTask = makeTask('CM', { teacher: [[cmTeacher]] }, { duration: 60 });
    const cmUnit = new TaskUnit(cmTask);

    const tdTeacher = makeResource('td-teacher', ResourceType.TEACHER, [[500, 600]]);
    const tdTask = makeTask('TD', { teacher: [[tdTeacher]] }, { duration: 60 });
    const tdUnit = new TaskUnit(tdTask);

    const tpTeacher = makeResource('tp-teacher', ResourceType.TEACHER, [[560, 620]]);
    const tpTask = makeTask('TP', { teacher: [[tpTeacher]] }, { duration: 60 });
    const tpUnit = new TaskUnit(tpTask);

    tdUnit.setDependsOn(cmUnit);
    tpUnit.setDependsOn(tdUnit);

    expect(tpUnit.getEffectiveLatestStart()).toBe(560); // feuille : pas de dépendant, égal à son propre LS
    expect(tdUnit.getEffectiveLatestStart()).toBe(500); // tronqué par LS(TP)=560, moins sa propre durée
    expect(cmUnit.getEffectiveLatestStart()).toBe(440); // tronqué par LS(TD)=500 — la valeur du document
  });

  it('§5.6 : un dépendant infaisable rend l\'ancêtre infaisable aussi (hérite via échéance=-Infinity)', () => {
    const ancestorTeacher = makeResource('ancestor-wide', ResourceType.TEACHER, [[0, 1000]]);
    const ancestorTask = makeTask('ancestor-2', { teacher: [[ancestorTeacher]] }, { duration: 60 });
    const ancestorUnit = new TaskUnit(ancestorTask);

    // Dépendant sans aucun créneau valide (profil trop petit pour sa propre durée).
    const infeasibleTeacher = makeResource('infeasible', ResourceType.TEACHER, [[0, 10]]);
    const infeasibleTask = makeTask('infeasible-dep', { teacher: [[infeasibleTeacher]] }, { duration: 60 });
    const infeasibleUnit = new TaskUnit(infeasibleTask);

    infeasibleUnit.setDependsOn(ancestorUnit);

    expect(infeasibleUnit.getEffectiveLatestStart()).toBeNull();
    expect(ancestorUnit.getEffectiveLatestStart()).toBeNull();
    // Infaisable = score maximal (§5.4) — même score que le dépendant infaisable lui-même.
    expect(ancestorUnit.getSchedulingPriority()).toBe(infeasibleUnit.getSchedulingPriority());
  });

  it('pause flottante (§5.5) : une tâche avec un profil GROUP large 8h-17h et une pause configurée score comme si son profil était déjà coupé en deux', () => {
    const LUNCH: FloatingLunchWindow = { earliestMin: 720, latestMin: 840, duration: 90 }; // 12h-14h, 90min

    const groupWide = makeResource('grp-wide', ResourceType.GROUP, [[480, 1020]]); // 8h-17h
    const taskWithLunch = makeTask('with-lunch', { group: [[groupWide]] }, { duration: 60 });
    const unitWithLunch = new TaskUnit(taskWithLunch);
    unitWithLunch.setFloatingLunchBreak(LUNCH);

    // Même tâche, mais profil déjà coupé en deux "à la main" (ce que la pause flottante
    // est censée produire), sans configurer de pause — même résultat attendu : confirme
    // le câblage TaskUnit → Task.getSchedulingMeasure → splitFloatingLunchBreak.
    const groupPreSplit = makeResource('grp-pre-split', ResourceType.GROUP, [[480, 735], [825, 1020]]);
    const taskPreSplit = makeTask('pre-split', { group: [[groupPreSplit]] }, { duration: 60 });
    const unitPreSplit = new TaskUnit(taskPreSplit);

    expect(unitWithLunch.getSchedulingPriority()).toBe(unitPreSplit.getSchedulingPriority());
  });

  it('pause flottante (§5.5) : ignorer la pause peut cacher une infaisabilité réelle', () => {
    // Une tâche de 5h ne tient dans NI l'une NI l'autre moitié d'une journée 8h-17h coupée
    // par 90min de pause (255min et 195min, toutes deux < 300min) — c'est le cas d'usage
    // qui motive §5.5 : sans en tenir compte, le score suggérerait à tort une large marge
    // (540min bruts, largement assez pour 300min), alors que c'est en réalité infaisable.
    const LUNCH: FloatingLunchWindow = { earliestMin: 720, latestMin: 840, duration: 90 };

    const groupWide = makeResource('grp-wide-2', ResourceType.GROUP, [[480, 1020]]);
    const taskLongWithLunch = makeTask('long-with-lunch', { group: [[groupWide]] }, { duration: 300 });
    const unitLongWithLunch = new TaskUnit(taskLongWithLunch);
    unitLongWithLunch.setFloatingLunchBreak(LUNCH);

    const groupWideNoLunch = makeResource('grp-wide-3', ResourceType.GROUP, [[480, 1020]]);
    const taskLongNoLunch = makeTask('long-no-lunch', { group: [[groupWideNoLunch]] }, { duration: 300 });
    const unitLongNoLunch = new TaskUnit(taskLongNoLunch);
    // Pas de setFloatingLunchBreak() ici — reproduit l'ancien comportement (pause ignorée).

    // Avec la pause prise en compte : infaisable (score maximal, §5.4). Sans : paraît largement faisable.
    expect(unitLongWithLunch.getSchedulingPriority()).toBeGreaterThan(unitLongNoLunch.getSchedulingPriority());
  });

  it('§5.5 + §5.6 combinés : le découpage de la pause flottante s\'applique AVANT la troncature par échéance du dépendant', () => {
    // CM : ressource GROUP large 8h-17h (480-1020), pause flottante 12h-14h/90min
    // → découpée en [480,735] et [825,1020] (§5.5). TD dépend de CM et impose une
    // échéance à 700 (LS(TD)=700, via sa propre fenêtre [640,760] réduite de 60min).
    // Si l'ordre de composition était inversé (troncature avant découpage), ou si le
    // découpage n'était pas appliqué du tout dans ce chemin, le résultat différerait.
    const LUNCH: FloatingLunchWindow = { earliestMin: 720, latestMin: 840, duration: 90 };

    const cmGroup = makeResource('cm-grp-combo', ResourceType.GROUP, [[480, 1020]]);
    const cmTask = makeTask('CM-combo', { group: [[cmGroup]] }, { duration: 60 });
    const cmUnit = new TaskUnit(cmTask);
    cmUnit.setFloatingLunchBreak(LUNCH);

    const tdTeacher = makeResource('td-teacher-combo', ResourceType.TEACHER, [[640, 760]]);
    const tdTask = makeTask('TD-combo', { teacher: [[tdTeacher]] }, { duration: 60 });
    const tdUnit = new TaskUnit(tdTask);
    tdUnit.setFloatingLunchBreak(LUNCH);
    tdUnit.setDependsOn(cmUnit);

    expect(tdUnit.getEffectiveLatestStart()).toBe(700);
    // [480,735] tronqué à 700 → [480,700] (le second morceau [825,1020] est entièrement
    // après 700, donc retiré) → LS(CM) = 700-60 = 640.
    expect(cmUnit.getEffectiveLatestStart()).toBe(640);
  });

  it('pause FIXE + §5.6 combinés : le profil déjà coupé (mutation réelle, pas setFloatingLunchBreak) se tronque correctement par l\'échéance du dépendant', () => {
    // Pause fixe : déjà retranchée de la ressource elle-même (comme le ferait
    // Scheduler._applyLunchBreak pour lunchBreak.type='fixed') — 8h-12h et 13h30-17h,
    // pas de setFloatingLunchBreak() car ce n'est pas un paramètre du moteur pour ce cas.
    const cmGroup = makeResource('cm-grp-fixed', ResourceType.GROUP, [[480, 720], [810, 1020]]);
    const cmTask = makeTask('CM-fixed', { group: [[cmGroup]] }, { duration: 60 });
    const cmUnit = new TaskUnit(cmTask);

    const tdTeacher = makeResource('td-teacher-fixed', ResourceType.TEACHER, [[640, 760]]);
    const tdTask = makeTask('TD-fixed', { teacher: [[tdTeacher]] }, { duration: 60 });
    const tdUnit = new TaskUnit(tdTask);
    tdUnit.setDependsOn(cmUnit);

    expect(tdUnit.getEffectiveLatestStart()).toBe(700);
    // [480,720] tronqué à 700 → [480,700] → LS(CM) = 700-60 = 640.
    expect(cmUnit.getEffectiveLatestStart()).toBe(640);
  });

  it('§5.6 : dépendants multiples (structure en éventail, k=2) — exemple chiffré vérifié à la main du document de conception', () => {
    // CM durée 90, profil [0,1000]. TD1 durée 60, profil [0,700] → LS(TD1)=640.
    // TD2 durée 200, profil [0,500] → LS(TD2)=300 (le plus pressé, m=TD2).
    // échéance(CM) = LS(TD2) - duration(TD1) = 300 - 60 = 240 → LS(CM) = 240-90 = 150.
    // L'ancien mécanisme (min seul) aurait donné échéance=300 → LS(CM)=210, une valeur
    // prouvée fausse à la main (viole LS(TD2)=300 dans le pire cas d'ordonnancement aval).
    const cmTeacher = makeResource('fanout-cm-teacher', ResourceType.TEACHER, [[0, 1000]]);
    const cmTask = makeTask('CM-fanout', { teacher: [[cmTeacher]] }, { duration: 90 });
    const cmUnit = new TaskUnit(cmTask);

    const td1Teacher = makeResource('fanout-td1-teacher', ResourceType.TEACHER, [[0, 700]]);
    const td1Task = makeTask('TD1-fanout', { teacher: [[td1Teacher]] }, { duration: 60 });
    const td1Unit = new TaskUnit(td1Task);

    const td2Teacher = makeResource('fanout-td2-teacher', ResourceType.TEACHER, [[0, 500]]);
    const td2Task = makeTask('TD2-fanout', { teacher: [[td2Teacher]] }, { duration: 200 });
    const td2Unit = new TaskUnit(td2Task);

    td1Unit.setDependsOn(cmUnit);
    td2Unit.setDependsOn(cmUnit);

    expect(td1Unit.getEffectiveLatestStart()).toBe(640);
    expect(td2Unit.getEffectiveLatestStart()).toBe(300);
    expect(cmUnit.getEffectiveLatestStart()).toBe(150);
    expect(cmUnit.getEffectiveLatestStart()).not.toBe(210); // l'ancien résultat (faux) avec min(LS) seul
  });

  it('§5.6 : dépendants multiples, k=1 dégénère exactement en l\'ancien comportement (non-régression)', () => {
    // Un seul dépendant : la somme des "autres" est vide, échéance(U) = LS(D1) — identique
    // à l'ancien min(LS(D1)) sur un seul élément. TD est ici une feuille (pas de dépendant
    // propre) : son LS effectif est son propre LS brut, 600-60=540.
    const cmTeacher = makeResource('k1-cm-teacher', ResourceType.TEACHER, [[0, 1000]]);
    const cmTask = makeTask('CM-k1', { teacher: [[cmTeacher]] }, { duration: 60 });
    const cmUnit = new TaskUnit(cmTask);

    const tdTeacher = makeResource('k1-td-teacher', ResourceType.TEACHER, [[500, 600]]);
    const tdTask = makeTask('TD-k1', { teacher: [[tdTeacher]] }, { duration: 60 });
    const tdUnit = new TaskUnit(tdTask);

    tdUnit.setDependsOn(cmUnit);

    expect(tdUnit.getEffectiveLatestStart()).toBe(540);
    // k=1 : échéance(CM) = LS(TD) - 0 = 540 → LS(CM) = 540-60 = 480.
    expect(cmUnit.getEffectiveLatestStart()).toBe(480);
  });

  it('§5.6 (correctif d\'ordre) : le meilleur combo doit être choisi APRÈS troncature par échéance, pas avant', () => {
    // Combo A : 1 fenêtre large [0,1000]. Combo B : 2 fenêtres étroites [0,100]∪[5000,5100].
    // Sur profils BRUTS (ancien comportement), B gagne (2 fenêtres > 1, critère primaire §5.1),
    // peu importe que A ait bien plus de marge réelle. Une fois les deux tronqués par
    // l'échéance du dépendant (200) : B tronqué ne garde que [0,100] (marge 2, l'autre
    // fenêtre étant entièrement au-delà de l'échéance) ; A tronqué garde [0,200] (marge 5).
    // A est réellement meilleur — sélectionner sur profils bruts puis tronquer le gagnant
    // (ancien code) aurait retenu B à tort (LS=40) ; tronquer chaque combo avant de
    // comparer (correctif) retient A (LS=140).
    const teacherA = makeResource('multi-a', ResourceType.TEACHER, [[0, 1000]]);
    const teacherB = makeResource('multi-b', ResourceType.TEACHER, [[0, 100], [5000, 5100]]);
    const multiComboTask = makeTask('multi-combo', { teacher: [[teacherA, teacherB]] }, { duration: 60 });
    const multiComboUnit = new TaskUnit(multiComboTask);

    const depTeacher = makeResource('multi-dep-teacher', ResourceType.TEACHER, [[200, 260]]);
    const depTask = makeTask('multi-dep', { teacher: [[depTeacher]] }, { duration: 60 });
    const depUnit = new TaskUnit(depTask);
    depUnit.setDependsOn(multiComboUnit);

    expect(depUnit.getEffectiveLatestStart()).toBe(200);
    expect(multiComboUnit.getEffectiveLatestStart()).toBe(140); // combo A retenu, pas B (aurait donné 40)
  });
});

describe('getSchedulingPriority — TaskGroupUnit (§5.6 : intersection réelle des profils, pas un min de mesures indépendantes)', () => {
  it('groupe parallel : contre-exemple §5.3 — intersection réelle vide alors qu\'un min de mesures indépendantes suggérerait de la marge', () => {
    // Membre 1 : trois créneaux de 90min PILE à sa durée (8h-9h30, 9h-10h30, 10h-11h30)
    //   → 3 fenêtres, 1 position chacune une fois réduit par la durée (8h, 9h, 10h).
    const teacher1 = makeResource('parallel-t1', ResourceType.TEACHER, [[480, 570], [600, 690], [720, 810]]);
    const member1 = makeTask('parallel-m1', { teacher: [[teacher1]] }, { duration: 90 });

    // Membre 2 : deux créneaux de 90min à 15h et 16h — aucun chevauchement avec les
    // positions du membre 1 (8h, 9h, 10h) une fois les deux réduits par leur durée.
    const teacher2 = makeResource('parallel-t2', ResourceType.TEACHER, [[900, 990], [960, 1050]]);
    const member2 = makeTask('parallel-m2', { teacher: [[teacher2]] }, { duration: 90 });

    const group = new TaskGroupUnit('group-parallel-empty', 'parallel', [member1, member2]);

    // Un `min` sur les mesures indépendantes (Phase 1) aurait pris le membre 2 (2 fenêtres,
    // moins que les 3 du membre 1) et suggéré de la marge — l'intersection réelle (Phase 3)
    // est vide : aucun instant commun aux deux membres. Le groupe est donc infaisable.
    expect(group.getEffectiveLatestStart()).toBeNull();
    expect(group.getSchedulingPriority()).toBe(encodePriorityMeasure({ usableWindowCount: 0, slackTotal: 0 }));
  });

  it('groupe sequential : l\'offset entre membres change le résultat — ne donne plus la même chose que parallel', () => {
    // Membre 1 (60min) libre 0h-2h ; membre 2 (60min) libre 1h-3h — même paire de
    // membres testée en parallel et en sequential, résultats désormais différents
    // (contrairement à Phase 1, où les deux types partageaient la même formule).
    const makeMembers = (): Task[] => [
      makeTask('seq-m1', { teacher: [[makeResource('seq-t1', ResourceType.TEACHER, [[0, 120]])]] }, { duration: 60 }),
      makeTask('seq-m2', { teacher: [[makeResource('seq-t2', ResourceType.TEACHER, [[60, 180]])]] }, { duration: 60 }),
    ];

    const groupParallel = new TaskGroupUnit('group-parallel-offset', 'parallel', makeMembers());
    const groupSequential = new TaskGroupUnit('group-sequential-offset', 'sequential', makeMembers());

    // Parallel : les deux membres doivent démarrer au MÊME instant → seul t=60 convient
    // aux deux (chevauchement de leurs fenêtres réduites [0,60] et [60,120]) → 1 position.
    expect(groupParallel.getEffectiveLatestStart()).toBe(60);

    // Sequential : membre 2 décalé de -60 (son offset) avant intersection → les deux
    // fenêtres réduites coïncident exactement sur [0,60] → 3 positions (0, 30, 60),
    // strictement plus de marge que parallel pour la même paire de membres.
    expect(groupSequential.getEffectiveLatestStart()).toBe(60);
    expect(groupSequential.getSchedulingPriority()).not.toBe(groupParallel.getSchedulingPriority());
    expect(groupSequential.getSchedulingPriority()).toBeLessThan(groupParallel.getSchedulingPriority()); // moins urgent (plus de marge)
  });

  it('propage aux dépendants par troncature (§5.6), comme TaskUnit : un groupe bloqueur hérite de l\'échéance de son dépendant', () => {
    const member = makeTask('blocker-member', { teacher: [[makeResource('blocker-t', ResourceType.TEACHER, [[0, 1000]])]] }, { duration: 60 });
    const groupUnit = new TaskGroupUnit('blocker-group', 'parallel', [member]);

    const dependentTeacher = makeResource('dep-tight', ResourceType.TEACHER, [[40, 160]]);
    const dependentTask = makeTask('dep-of-group', { teacher: [[dependentTeacher]] }, { duration: 60 });
    const dependentUnit = new TaskUnit(dependentTask);

    dependentUnit.setDependsOn(groupUnit);

    // Le groupe doit finir avant que le dépendant (LS=100) ne puisse commencer.
    // Piège vérifié ici : les anchors du groupe sont des DÉBUTS déjà réduits par durée,
    // donc l'échéance (qui borne une FIN) doit être ajustée de -duration avant troncature
    // (deadline=100, duration=60 → tronquer à 40, pas 100) — sinon le groupe paraîtrait
    // pouvoir démarrer jusqu'à 100 alors qu'il finirait à 160, après l'échéance du dépendant.
    expect(dependentUnit.getEffectiveLatestStart()).toBe(100);
    expect(groupUnit.getEffectiveLatestStart()).toBe(40);
  });

  it('un groupe qui ne peut matériellement pas finir à temps pour son dépendant devient infaisable', () => {
    // Groupe de 60min très disponible, mais le dépendant impose LS=5 : il faudrait que
    // le groupe démarre à -55 pour finir à temps — impossible.
    const member = makeTask('blocker-member-2', { teacher: [[makeResource('blocker-t-2', ResourceType.TEACHER, [[0, 1000]])]] }, { duration: 60 });
    const groupUnit = new TaskGroupUnit('blocker-group-infeasible', 'parallel', [member]);

    const dependentTeacher = makeResource('dep-tight-2', ResourceType.TEACHER, [[0, 65]]);
    const dependentTask = makeTask('dep-of-group-2', { teacher: [[dependentTeacher]] }, { duration: 60 });
    const dependentUnit = new TaskUnit(dependentTask);
    dependentUnit.setDependsOn(groupUnit);

    expect(dependentUnit.getEffectiveLatestStart()).toBe(5);
    expect(groupUnit.getEffectiveLatestStart()).toBeNull();
  });

  it('§5.5 + §5.6 combinés : un membre GROUP soumis à la pause flottante, dans un groupe avec dépendant', () => {
    // Membre unique, ressource GROUP 8h-17h + pause flottante → réduit (durée 60) en
    // anchors [480,675] et [825,960] (§5.5 puis §5.6). Le dépendant impose LS=700, donc
    // une échéance de fin à 700 → ajustée de -duration(60) = 640 avant troncature des
    // anchors (qui sont des DÉBUTS, pas des fins — voir le commentaire de
    // _computeEffectiveAnchors). [480,675] tronqué à 640 → [480,640] ; [825,960] retiré
    // (entièrement après 640) → LS(groupe) = 640.
    const LUNCH: FloatingLunchWindow = { earliestMin: 720, latestMin: 840, duration: 90 };

    const groupMember = makeResource('grp-member-combo', ResourceType.GROUP, [[480, 1020]]);
    const memberTask = makeTask('member-combo', { group: [[groupMember]] }, { duration: 60 });
    const groupUnit = new TaskGroupUnit('grp-combo', 'parallel', [memberTask]);
    groupUnit.setFloatingLunchBreak(LUNCH);

    const tdTeacher = makeResource('td-teacher-grp-combo', ResourceType.TEACHER, [[640, 760]]);
    const tdTask = makeTask('TD-grp-combo', { teacher: [[tdTeacher]] }, { duration: 60 });
    const tdUnit = new TaskUnit(tdTask);
    tdUnit.setFloatingLunchBreak(LUNCH);
    tdUnit.setDependsOn(groupUnit);

    expect(tdUnit.getEffectiveLatestStart()).toBe(700);
    expect(groupUnit.getEffectiveLatestStart()).toBe(640);
  });

  it('pause FIXE + §5.6 combinés : un membre au profil déjà coupé, dans un groupe avec dépendant', () => {
    // Même profil "déjà coupé" que le cas TaskUnit équivalent, mais porté par un membre
    // de groupe — vérifie que le correctif -this.duration (ci-dessus) s'applique bien
    // quelle que soit l'origine de la fragmentation du profil (pause fixe ou flottante).
    const groupMember = makeResource('grp-member-fixed', ResourceType.GROUP, [[480, 720], [810, 1020]]);
    const memberTask = makeTask('member-fixed', { group: [[groupMember]] }, { duration: 60 });
    const groupUnit = new TaskGroupUnit('grp-fixed', 'parallel', [memberTask]);

    const tdTeacher = makeResource('td-teacher-grp-fixed', ResourceType.TEACHER, [[640, 760]]);
    const tdTask = makeTask('TD-grp-fixed', { teacher: [[tdTeacher]] }, { duration: 60 });
    const tdUnit = new TaskUnit(tdTask);
    tdUnit.setDependsOn(groupUnit);

    expect(tdUnit.getEffectiveLatestStart()).toBe(700);
    expect(groupUnit.getEffectiveLatestStart()).toBe(640);
  });

  it('§5.6 : dépendants multiples (structure en éventail, k=2) — même exemple chiffré que TaskUnit, porté par un groupe', () => {
    // Groupe à un seul membre, durée 90, largement disponible [0,2000] (own anchors quasi
    // non contraignants) — le point testé ici est la propagation de l'échéance, pas
    // l'agrégation des membres (déjà couverte par les tests parallel/sequential ci-dessus).
    // Mêmes TD1/TD2 que le test TaskUnit équivalent : échéance(groupe) = 300-60 = 240
    // → LS(groupe) = 240-90 = 150 (le groupe applique en plus le -duration déjà en place
    // pour l'asymétrie début/fin des anchors — voir _computeEffectiveAnchors).
    const memberTeacher = makeResource('fanout-grp-member-teacher', ResourceType.TEACHER, [[0, 2000]]);
    const memberTask = makeTask('fanout-grp-member', { teacher: [[memberTeacher]] }, { duration: 90 });
    const groupUnit = new TaskGroupUnit('fanout-group', 'parallel', [memberTask]);

    const td1Teacher = makeResource('fanout-grp-td1-teacher', ResourceType.TEACHER, [[0, 700]]);
    const td1Task = makeTask('TD1-fanout-grp', { teacher: [[td1Teacher]] }, { duration: 60 });
    const td1Unit = new TaskUnit(td1Task);

    const td2Teacher = makeResource('fanout-grp-td2-teacher', ResourceType.TEACHER, [[0, 500]]);
    const td2Task = makeTask('TD2-fanout-grp', { teacher: [[td2Teacher]] }, { duration: 200 });
    const td2Unit = new TaskUnit(td2Task);

    td1Unit.setDependsOn(groupUnit);
    td2Unit.setDependsOn(groupUnit);

    expect(td1Unit.getEffectiveLatestStart()).toBe(640);
    expect(td2Unit.getEffectiveLatestStart()).toBe(300);
    expect(groupUnit.getEffectiveLatestStart()).toBe(150);
    expect(groupUnit.getEffectiveLatestStart()).not.toBe(210); // l'ancien résultat (faux) avec min(LS) seul
  });

  it('§5.6 (correctif d\'ordre), même contre-exemple que TaskUnit mais porté par un membre de groupe', () => {
    // Même configuration (combo A large vs combo B fragmenté, échéance=200) que le test
    // équivalent pour TaskUnit — un seul membre, parallel, pour isoler le point testé
    // (sélection de combo par membre) de l'agrégation entre membres, déjà couverte ailleurs.
    const teacherA = makeResource('grp-multi-a', ResourceType.TEACHER, [[0, 1000]]);
    const teacherB = makeResource('grp-multi-b', ResourceType.TEACHER, [[0, 100], [5000, 5100]]);
    const memberTask = makeTask('grp-multi-combo', { teacher: [[teacherA, teacherB]] }, { duration: 60 });
    const groupUnit = new TaskGroupUnit('grp-multi-combo-group', 'parallel', [memberTask]);

    const depTeacher = makeResource('grp-multi-dep-teacher', ResourceType.TEACHER, [[200, 260]]);
    const depTask = makeTask('grp-multi-dep', { teacher: [[depTeacher]] }, { duration: 60 });
    const depUnit = new TaskUnit(depTask);
    depUnit.setDependsOn(groupUnit);

    expect(depUnit.getEffectiveLatestStart()).toBe(200);
    expect(groupUnit.getEffectiveLatestStart()).toBe(140); // combo A retenu pour le membre, pas B (aurait donné 40)
  });
});
