import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { TaskSolutionJSON, EnforcedData } from '@edt-ts/scheduler-common';
import type { CourseTaskDataWithId } from '../lib/courseId';
import type { Placement } from '../store/types';
import {
  placementsFromSolution,
  placementsFromEnforcedMap,
  enforcedMapFromPlacements,
  toTaskSolutionJSON,
} from '../lib/calendar/placements';

describe('placementsFromSolution', () => {
  it('éclate resources en {teachers, groups, rooms}, placementId === taskId, origin auto', () => {
    const tasks: TaskSolutionJSON[] = [
      {
        taskId: 't1',
        code: 'R1.01',
        name: 'Réseaux',
        type: 'CM',
        week: 36,
        duration: 120,
        startTime: 480,
        resources: [
          { id: 'DUPONT', type: 'teacher' },
          { id: 'MARTIN', type: 'teacher' },
          { id: 'G1', type: 'group' },
          { id: 'A101', type: 'room' },
        ],
      },
    ];

    const placements = placementsFromSolution(tasks);
    expect(placements).toHaveLength(1);
    const p = placements[0];
    expect(p.placementId).toBe('t1');
    expect(p.taskId).toBe('t1');
    expect(p.origin).toBe('auto');
    expect(p.startTime).toBe(480);
    expect(p.duration).toBe(120);
    expect(p.resources).toEqual({ teachers: ['DUPONT', 'MARTIN'], groups: ['G1'], rooms: ['A101'] });
  });

  it('tableau vide → tableau vide', () => {
    expect(placementsFromSolution([])).toEqual([]);
  });
});

describe('placementsFromEnforcedMap / enforcedMapFromPlacements — aller-retour', () => {
  it('identité sur une map d\'impositions non propagées (pas de manualMap fourni)', () => {
    const map: Record<string, EnforcedData> = {
      c1: { startTime: 600, teacher: ['DUPONT'], groups: ['G1'], rooms: ['A101'] },
      c2: { startTime: 660, teacher: ['MARTIN'], groups: ['G2'], rooms: ['A102'] },
    };

    const placements = placementsFromEnforcedMap(map);
    expect(placements.every((p) => p.origin === 'pre-enforced')).toBe(true);
    expect(placements.every((p) => p.derived === undefined)).toBe(true);

    const roundTripped = enforcedMapFromPlacements(placements);
    expect(roundTripped).toEqual(map);
  });

  it('identité aussi avec manualMap identique à map (aucune entrée propagée)', () => {
    const map: Record<string, EnforcedData> = {
      c1: { startTime: 600, teacher: ['DUPONT'], groups: ['G1'], rooms: ['A101'] },
    };

    const placements = placementsFromEnforcedMap(map, map);
    expect(placements[0].derived).toBeUndefined();
    expect(enforcedMapFromPlacements(placements, { excludeDerived: true })).toEqual(map);
  });

  it('marque derived:true les entrées de map absentes de manualMap (propagation de groupe)', () => {
    const manualMap: Record<string, EnforcedData> = {
      c1: { startTime: 600, teacher: ['DUPONT'], groups: ['G1'], rooms: ['A101'] },
    };
    const augmented: Record<string, EnforcedData> = {
      ...manualMap,
      c2: { startTime: 660, teacher: ['MARTIN'], groups: ['G1'], rooms: ['A102'] }, // propagé
    };

    const placements = placementsFromEnforcedMap(augmented, manualMap);
    const p1 = placements.find((p) => p.taskId === 'c1')!;
    const p2 = placements.find((p) => p.taskId === 'c2')!;
    expect(p1.derived).toBeUndefined();
    expect(p2.derived).toBe(true);
  });
});

describe('enforcedMapFromPlacements', () => {
  const base: Placement[] = [
    { placementId: 'c1', taskId: 'c1', startTime: 600, resources: { teachers: ['DUPONT'], groups: ['G1'], rooms: ['A101'] }, origin: 'pre-enforced' },
    { placementId: 'c2', taskId: 'c2', startTime: 660, resources: { teachers: ['MARTIN'], groups: ['G2'], rooms: [] }, origin: 'pre-enforced', derived: true },
    { placementId: 'a1', taskId: 'a1', startTime: 480, duration: 90, resources: { teachers: ['LEROY'], groups: ['G1'], rooms: [] }, origin: 'auto' },
    { placementId: 'p1', taskId: 'p1', startTime: 540, duration: 60, resources: { teachers: [], groups: [], rooms: [] }, origin: 'post-enforced' },
  ];

  it('ignore toujours auto et post-enforced', () => {
    const result = enforcedMapFromPlacements(base);
    expect(Object.keys(result).sort()).toEqual(['c1', 'c2']);
  });

  it('sans option : inclut les pre-enforced propagés (payload moteur)', () => {
    const result = enforcedMapFromPlacements(base);
    expect(result.c2).toBeDefined();
  });

  it('excludeDerived:true : exclut les pre-enforced propagés (manualEnforcedMap persisté)', () => {
    const result = enforcedMapFromPlacements(base, { excludeDerived: true });
    expect(Object.keys(result)).toEqual(['c1']);
  });
});

describe('toTaskSolutionJSON', () => {
  const course: CourseTaskDataWithId = {
    id: 'c1',
    week: 36,
    semester: 1,
    level: 1,
    code: 'R1.01',
    name: 'Réseaux',
    type: 'CM',
    teacher: ['DUPONT'],
    groups: ['G1'],
    rooms: ['A101'],
    duration: 120,
    source: 'csv',
  };

  it('utilise la durée du placement si présente', () => {
    const placement: Placement = {
      placementId: 'c1', taskId: 'c1', startTime: 480, duration: 90,
      resources: { teachers: ['DUPONT'], groups: ['G1'], rooms: ['A101'] }, origin: 'post-enforced',
    };
    const json = toTaskSolutionJSON(placement, course, 36);
    expect(json.duration).toBe(90);
    expect(json.code).toBe('R1.01');
    expect(json.name).toBe('Réseaux');
    expect(json.type).toBe('CM');
    expect(json.taskId).toBe('c1');
    expect(json.resources).toEqual([
      { id: 'DUPONT', type: 'teacher' },
      { id: 'G1', type: 'group' },
      { id: 'A101', type: 'room' },
    ]);
  });

  it('retombe sur la durée du cours si le placement n\'en porte pas', () => {
    const placement: Placement = {
      placementId: 'c1', taskId: 'c1', startTime: 600,
      resources: { teachers: ['DUPONT'], groups: ['G1'], rooms: ['A101'] }, origin: 'pre-enforced',
    };
    const json = toTaskSolutionJSON(placement, course, 36);
    expect(json.duration).toBe(120);
  });

  it('cours introuvable : code/name/type vides, duration 0, ne jette pas', () => {
    const placement: Placement = {
      placementId: 'x', taskId: 'x', startTime: 0,
      resources: { teachers: [], groups: [], rooms: [] }, origin: 'auto',
    };
    const json = toTaskSolutionJSON(placement, undefined, 36);
    expect(json.code).toBe('');
    expect(json.name).toBe('');
    expect(json.type).toBe('');
    expect(json.duration).toBe(0);
  });
});

// ── Règle de bascule d'origine (store) ─────────────────────────────────────
// `usePlanningStore` lit localStorage dès son import : stub mémoire avant l'import dynamique.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number { return this.store.size; }
  clear(): void { this.store.clear(); }
  getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
  key(index: number): string | null { return Array.from(this.store.keys())[index] ?? null; }
  removeItem(key: string): void { this.store.delete(key); }
  setItem(key: string, value: string): void { this.store.set(key, value); }
}

let usePlanningStore: typeof import('../store/usePlanningStore').usePlanningStore;

beforeEach(async () => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  vi.resetModules();
  ({ usePlanningStore } = await import('../store/usePlanningStore'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('updatePlacement — règle de bascule d\'origine', () => {
  it('auto + patch startTime → post-enforced', () => {
    usePlanningStore.setState({
      placements: [{ placementId: 't1', taskId: 't1', startTime: 480, resources: { teachers: [], groups: [], rooms: [] }, origin: 'auto' }],
    });
    usePlanningStore.getState().updatePlacement('t1', { startTime: 600 });
    const p = usePlanningStore.getState().placements[0];
    expect(p.origin).toBe('post-enforced');
    expect(p.startTime).toBe(600);
  });

  it('pre-enforced + même patch → reste pre-enforced', () => {
    usePlanningStore.setState({
      placements: [{ placementId: 't1', taskId: 't1', startTime: 480, resources: { teachers: [], groups: [], rooms: [] }, origin: 'pre-enforced' }],
    });
    usePlanningStore.getState().updatePlacement('t1', { startTime: 600 });
    const p = usePlanningStore.getState().placements[0];
    expect(p.origin).toBe('pre-enforced');
  });

  it('patch qui ne touche que constraintViolation → origine inchangée', () => {
    usePlanningStore.setState({
      placements: [{ placementId: 't1', taskId: 't1', startTime: 480, resources: { teachers: [], groups: [], rooms: [] }, origin: 'auto' }],
    });
    usePlanningStore.getState().updatePlacement('t1', { constraintViolation: 'red' });
    const p = usePlanningStore.getState().placements[0];
    expect(p.origin).toBe('auto');
    expect(p.constraintViolation).toBe('red');
  });

  it('post-enforced + patch resources → reste post-enforced', () => {
    usePlanningStore.setState({
      placements: [{ placementId: 't1', taskId: 't1', startTime: 480, resources: { teachers: [], groups: [], rooms: [] }, origin: 'post-enforced' }],
    });
    usePlanningStore.getState().updatePlacement('t1', { resources: { teachers: ['DUPONT'], groups: [], rooms: [] } });
    const p = usePlanningStore.getState().placements[0];
    expect(p.origin).toBe('post-enforced');
  });
});
