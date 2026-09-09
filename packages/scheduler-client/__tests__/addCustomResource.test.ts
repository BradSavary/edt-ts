import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Ajout manuel d'une ressource depuis l'onglet Contraintes.
 *
 * Régression couverte : `addResource` ne créait qu'une clé de contraintes, jamais de
 * `ResourceData`. La ressource était alors invisible des listes de choix de cours, privée
 * de limite quotidienne éditable, et jamais transmise au moteur (qui ignore silencieusement
 * un id absent du catalogue, cf. SchedulerData.initTasks).
 */
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number { return this.store.size; }
  clear(): void { this.store.clear(); }
  getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
  key(index: number): string | null { return Array.from(this.store.keys())[index] ?? null; }
  removeItem(key: string): void { this.store.delete(key); }
  setItem(key: string, value: string): void { this.store.set(key, value); }
}

let useProjectStore: typeof import('../store/useProjectStore').useProjectStore;

beforeEach(async () => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  vi.resetModules();
  ({ useProjectStore } = await import('../store/useProjectStore'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function idsOfType(type: 'teacher' | 'room' | 'group'): string[] {
  return useProjectStore
    .getState()
    .resources.filter((g) => g.resourceType === type)
    .flatMap((g) => g.resources.map((r) => r.id));
}

describe('useProjectStore.addResource', () => {
  it('crée une ResourceData dans le groupe du type demandé, pas seulement une contrainte', () => {
    useProjectStore.getState().setResources([
      { resourceType: 'teacher', resources: [{ id: 'DUPONT' }] },
      { resourceType: 'room', resources: [{ id: 'A101' }] },
      { resourceType: 'group', resources: [{ id: 'G1' }] },
    ]);

    useProjectStore.getState().addResource('B12', 'room');

    expect(idsOfType('room')).toEqual(['A101', 'B12']);
    expect('B12' in useProjectStore.getState().constraints).toBe(true);
  });

  it("range la ressource selon le type choisi, même quand l'heuristique sur le nom dit autre chose", () => {
    useProjectStore.getState().setResources([
      { resourceType: 'teacher', resources: [] },
      { resourceType: 'room', resources: [] },
      { resourceType: 'group', resources: [] },
    ]);

    // `detectResourceType('R05')` répond 'room' : seul le choix explicite doit compter.
    useProjectStore.getState().addResource('R05', 'teacher');

    expect(idsOfType('teacher')).toEqual(['R05']);
    expect(idsOfType('room')).toEqual([]);
  });

  it('crée le groupe manquant quand le catalogue est vide', () => {
    expect(useProjectStore.getState().resources).toEqual([]);

    useProjectStore.getState().addResource('Amphi A', 'room');

    expect(useProjectStore.getState().resources).toEqual([
      { resourceType: 'room', resources: [{ id: 'Amphi A' }] },
    ]);
  });

  it('ne duplique pas ni ne reclasse un id déjà présent', () => {
    useProjectStore.getState().setResources([
      { resourceType: 'teacher', resources: [{ id: 'DUPONT' }] },
      { resourceType: 'room', resources: [] },
    ]);

    useProjectStore.getState().addResource('DUPONT', 'room');

    expect(idsOfType('teacher')).toEqual(['DUPONT']);
    expect(idsOfType('room')).toEqual([]);
  });

  it('préserve les limites quotidiennes déjà saisies sur les autres ressources', () => {
    useProjectStore.getState().setResources([
      { resourceType: 'teacher', resources: [{ id: 'DUPONT', maxDailyMinutes: 480 }] },
    ]);
    useProjectStore.getState().setConstraint('DUPONT', { default: [] });

    useProjectStore.getState().addResource('MARTIN', 'teacher');

    const teachers = useProjectStore.getState().resources.find((g) => g.resourceType === 'teacher')!;
    expect(teachers.resources).toEqual([
      { id: 'DUPONT', maxDailyMinutes: 480 },
      { id: 'MARTIN' },
    ]);
  });
});
