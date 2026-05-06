import { describe, it, expect } from 'vitest';
import {
  validateParallelGroup,
  buildTaskGroupData,
  getCourseGroupInfo,
  computeGroupEnforcements,
  type TaskGroupConfig,
} from '../lib/taskGroupUtils';
import type { CourseTaskData, EnforcedData } from '@edt-ts/scheduler-common';

function makeCourse(overrides: Partial<CourseTaskData> = {}): CourseTaskData {
  return {
    week: 47,
    semester: 1,
    level: 0,
    code: 'R101',
    name: 'Algo',
    type: 'CM',
    teacher: ['DUPONT Jean'],
    groups: ['G1'],
    rooms: ['A101'],
    duration: 120,
    ...overrides,
  };
}

// ─── validateParallelGroup ────────────────────────────────────────────────────

describe('validateParallelGroup', () => {
  it('retourne null si group.type !== "parallel"', () => {
    const group: TaskGroupConfig = { id: 'g1', type: 'sequential', courseKeys: ['0', '1'] };
    expect(validateParallelGroup(group, [makeCourse(), makeCourse()])).toBeNull();
  });

  it('retourne null si moins de 2 courseKeys', () => {
    const group: TaskGroupConfig = { id: 'g1', type: 'parallel', courseKeys: ['0'] };
    expect(validateParallelGroup(group, [makeCourse()])).toBeNull();
  });

  it('retourne null si le groupe est valide (pas de conflit, assez de salles)', () => {
    const courses = [
      makeCourse({ teacher: ['DUPONT Jean'], groups: ['G1'], rooms: ['A101'] }),
      makeCourse({ teacher: ['MARTIN Paul'], groups: ['G2'], rooms: ['B201'] }),
    ];
    const group: TaskGroupConfig = { id: 'g1', type: 'parallel', courseKeys: ['0', '1'] };
    expect(validateParallelGroup(group, courses)).toBeNull();
  });

  it('détecte un enseignant fixe en conflit (même enseignant dans 2 tâches)', () => {
    const courses = [
      makeCourse({ teacher: ['DUPONT Jean'], rooms: ['A101'] }),
      makeCourse({ teacher: ['DUPONT Jean'], rooms: ['B201'] }),
    ];
    const group: TaskGroupConfig = { id: 'g1', type: 'parallel', courseKeys: ['0', '1'] };
    const issue = validateParallelGroup(group, courses);
    expect(issue?.conflictingTeachers).toContain('DUPONT Jean');
  });

  it('ne signale pas de conflit pour un enseignant alternatif (tableau)', () => {
    const courses = [
      makeCourse({ teacher: [['DUPONT Jean', 'MARTIN Paul']], groups: ['G1'], rooms: ['A101'] }),
      makeCourse({ teacher: [['DUPONT Jean', 'LECLERC Marie']], groups: ['G2'], rooms: ['B201'] }),
    ];
    const group: TaskGroupConfig = { id: 'g1', type: 'parallel', courseKeys: ['0', '1'] };
    // Les tableaux d'alternatives ne sont pas comptés comme conflits
    expect(validateParallelGroup(group, courses)).toBeNull();
  });

  it('détecte un groupe étudiant fixe en conflit', () => {
    const courses = [
      makeCourse({ groups: ['G1'], rooms: ['A101'] }),
      makeCourse({ groups: ['G1'], rooms: ['B201'] }),
    ];
    const group: TaskGroupConfig = { id: 'g1', type: 'parallel', courseKeys: ['0', '1'] };
    const issue = validateParallelGroup(group, courses);
    expect(issue?.conflictingGroups).toContain('G1');
  });

  it('détecte un manque de salles (moins de salles uniques que de tâches)', () => {
    const courses = [
      makeCourse({ rooms: ['A101'] }),
      makeCourse({ rooms: ['A101'] }),
    ];
    const group: TaskGroupConfig = { id: 'g1', type: 'parallel', courseKeys: ['0', '1'] };
    const issue = validateParallelGroup(group, courses);
    expect(issue?.roomShortfall).toEqual({ available: 1, needed: 2 });
  });

  it('compte les alternatives de salles dans le pool disponible', () => {
    const courses = [
      makeCourse({ teacher: ['DUPONT Jean'], groups: ['G1'], rooms: [['A101', 'B201']] }),
      makeCourse({ teacher: ['MARTIN Paul'], groups: ['G2'], rooms: ['C301'] }),
    ];
    const group: TaskGroupConfig = { id: 'g1', type: 'parallel', courseKeys: ['0', '1'] };
    // 3 salles uniques pour 2 tâches → valide
    expect(validateParallelGroup(group, courses)).toBeNull();
  });
});

// ─── buildTaskGroupData ───────────────────────────────────────────────────────

describe('buildTaskGroupData', () => {
  it('injecte taskGroupId dans les cours membres du groupe', () => {
    const courses = [makeCourse(), makeCourse()];
    const groups: TaskGroupConfig[] = [{ id: 'grp1', type: 'parallel', courseKeys: ['0', '1'] }];
    const { coursesWithGroups } = buildTaskGroupData(courses, groups);
    expect(coursesWithGroups[0].taskGroupId).toBe('grp1');
    expect(coursesWithGroups[1].taskGroupId).toBe('grp1');
  });

  it('ne mute pas le tableau original', () => {
    const courses = [makeCourse(), makeCourse()];
    const groups: TaskGroupConfig[] = [{ id: 'g', type: 'parallel', courseKeys: ['0', '1'] }];
    buildTaskGroupData(courses, groups);
    expect(courses[0].taskGroupId).toBeUndefined();
    expect(courses[1].taskGroupId).toBeUndefined();
  });

  it('ne génère pas de declaration pour un groupe de moins de 2 membres', () => {
    const courses = [makeCourse()];
    const groups: TaskGroupConfig[] = [{ id: 'g', type: 'parallel', courseKeys: ['0'] }];
    const { declarations } = buildTaskGroupData(courses, groups);
    expect(declarations).toHaveLength(0);
  });

  it('génère les declarations pour chaque groupe valide', () => {
    const courses = [makeCourse(), makeCourse(), makeCourse()];
    const groups: TaskGroupConfig[] = [
      { id: 'g1', type: 'parallel', courseKeys: ['0', '1'] },
      { id: 'g2', type: 'sequential', courseKeys: ['1', '2'] },
    ];
    const { declarations } = buildTaskGroupData(courses, groups);
    expect(declarations).toHaveLength(2);
    expect(declarations[0]).toEqual({ id: 'g1', type: 'parallel' });
    expect(declarations[1]).toEqual({ id: 'g2', type: 'sequential' });
  });

  it('ne touche pas les cours hors groupe', () => {
    const courses = [makeCourse(), makeCourse(), makeCourse()];
    const groups: TaskGroupConfig[] = [{ id: 'g1', type: 'parallel', courseKeys: ['0', '1'] }];
    const { coursesWithGroups } = buildTaskGroupData(courses, groups);
    expect(coursesWithGroups[2].taskGroupId).toBeUndefined();
  });
});

// ─── getCourseGroupInfo ───────────────────────────────────────────────────────

describe('getCourseGroupInfo', () => {
  const groups: TaskGroupConfig[] = [
    { id: 'g1', type: 'parallel', courseKeys: ['0', '1'] },
    { id: 'g2', type: 'sequential', courseKeys: ['2', '3'] },
  ];

  it('retourne les infos si courseKey est dans un groupe', () => {
    const info = getCourseGroupInfo(groups, '1');
    expect(info).toEqual({ groupId: 'g1', type: 'parallel', indexInGroup: 1 });
  });

  it('retourne indexInGroup=0 pour le premier membre', () => {
    const info = getCourseGroupInfo(groups, '0');
    expect(info?.indexInGroup).toBe(0);
  });

  it('retourne le bon groupe quand plusieurs groupes existent', () => {
    const info = getCourseGroupInfo(groups, '2');
    expect(info?.groupId).toBe('g2');
    expect(info?.type).toBe('sequential');
  });

  it('retourne null si courseKey n\'appartient à aucun groupe', () => {
    expect(getCourseGroupInfo(groups, '99')).toBeNull();
  });
});

// ─── computeGroupEnforcements ─────────────────────────────────────────────────

describe('computeGroupEnforcements', () => {
  describe('groupe parallel', () => {
    it('propage le même startTime à tous les autres membres', () => {
      const courses = [
        makeCourse({ duration: 120 }),
        makeCourse({ duration: 90 }),
        makeCourse({ duration: 60 }),
      ];
      const group: TaskGroupConfig = { id: 'g1', type: 'parallel', courseKeys: ['0', '1', '2'] };
      const enforced: EnforcedData = {
        startTime: 480,
        teacher: ['DUPONT Jean'],
        groups: ['G1'],
        rooms: ['A101'],
      };
      const result = computeGroupEnforcements('0', enforced, group, courses);
      expect(result['1']?.startTime).toBe(480);
      expect(result['2']?.startTime).toBe(480);
    });

    it('n\'inclut pas la tâche source dans le résultat', () => {
      const courses = [makeCourse(), makeCourse()];
      const group: TaskGroupConfig = { id: 'g1', type: 'parallel', courseKeys: ['0', '1'] };
      const enforced: EnforcedData = {
        startTime: 480,
        teacher: ['DUPONT Jean'],
        groups: ['G1'],
        rooms: ['A101'],
      };
      const result = computeGroupEnforcements('0', enforced, group, courses);
      expect(result['0']).toBeUndefined();
    });
  });

  describe('groupe sequential', () => {
    it('propage les horaires vers l\'avant en chaîne', () => {
      const courses = [
        makeCourse({ duration: 120 }),
        makeCourse({ duration: 90 }),
        makeCourse({ duration: 60 }),
      ];
      const group: TaskGroupConfig = {
        id: 'g1',
        type: 'sequential',
        courseKeys: ['0', '1', '2'],
      };
      const enforced: EnforcedData = {
        startTime: 480,
        teacher: ['DUPONT Jean'],
        groups: ['G1'],
        rooms: ['A101'],
      };
      const result = computeGroupEnforcements('0', enforced, group, courses);
      // Cours 1 : 480 + 120 = 600
      expect(result['1']?.startTime).toBe(600);
      // Cours 2 : 600 + 90 = 690
      expect(result['2']?.startTime).toBe(690);
    });

    it('propage les horaires vers l\'arrière', () => {
      const courses = [
        makeCourse({ duration: 120 }),
        makeCourse({ duration: 90 }),
        makeCourse({ duration: 60 }),
      ];
      const group: TaskGroupConfig = {
        id: 'g1',
        type: 'sequential',
        courseKeys: ['0', '1', '2'],
      };
      // On enforce le dernier cours (startTime=690)
      const enforced: EnforcedData = {
        startTime: 690,
        teacher: ['MARTIN Paul'],
        groups: ['G2'],
        rooms: ['B201'],
      };
      const result = computeGroupEnforcements('2', enforced, group, courses);
      // Cours 1 se termine à 690 → commence à 690 - 90 = 600
      expect(result['1']?.startTime).toBe(600);
      // Cours 0 se termine à 600 → commence à 600 - 120 = 480
      expect(result['0']?.startTime).toBe(480);
    });

    it('retourne {} si la clé enforcée n\'est pas dans le groupe', () => {
      const courses = [makeCourse(), makeCourse()];
      const group: TaskGroupConfig = { id: 'g1', type: 'sequential', courseKeys: ['0', '1'] };
      const enforced: EnforcedData = {
        startTime: 480,
        teacher: [],
        groups: [],
        rooms: [],
      };
      expect(computeGroupEnforcements('99', enforced, group, courses)).toEqual({});
    });
  });
});
