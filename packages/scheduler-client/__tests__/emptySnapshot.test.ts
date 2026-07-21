import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Ouvrir un projet ne doit pas fabriquer un snapshot de semaine vide.
 *
 * `createNewProject`/`loadProjectFromFile` enchaînent `reset()` — qui remet déjà `selectedWeek`
 * à `DEFAULT_WEEK` — puis `setSelectedWeek(DEFAULT_WEEK)`. La semaine ne change donc pas entre
 * les deux, le garde-fou `state.selectedWeek !== prev.selectedWeek` du subscribe d'auto-save ne
 * s'applique pas, et les nouvelles références de `taskGroups`/`blockedZones` déclenchaient une
 * sauvegarde — créant un `weekSaves['35']` vide dès l'ouverture.
 *
 * Comportement constaté à l'identique sur master avant correctif (A/B) : le découpage du
 * stockage par semaine n'en est pas la cause, il l'a seulement rendu visible sous forme de clé.
 */
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number { return this.store.size; }
  clear(): void { this.store.clear(); }
  getItem(key: string): string | null { return this.store.get(key) ?? null; }
  key(index: number): string | null { return Array.from(this.store.keys())[index] ?? null; }
  removeItem(key: string): void { this.store.delete(key); }
  setItem(key: string, value: string): void { this.store.set(key, value); }
}

const YEAR = { year: '2026-2027', zone: 'A' as const, periods: [] };

let useProjectStore: typeof import('../store/useProjectStore').useProjectStore;
let usePlanningStore: typeof import('../store/usePlanningStore').usePlanningStore;
let lifecycle: typeof import('../lib/project/projectLifecycle');

beforeEach(async () => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  vi.resetModules();
  ({ useProjectStore } = await import('../store/useProjectStore'));
  ({ usePlanningStore } = await import('../store/usePlanningStore'));
  lifecycle = await import('../lib/project/projectLifecycle');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('snapshot de semaine vide', () => {
  it("créer un projet ne fabrique aucun snapshot de semaine", () => {
    lifecycle.createNewProject('Test', YEAR);

    expect(Object.keys(useProjectStore.getState().weekSaves)).toEqual([]);
  });

  it("changer de semaine sans rien préparer ne fabrique aucun snapshot", () => {
    lifecycle.createNewProject('Test', YEAR);
    usePlanningStore.getState().setSelectedWeek(40);
    usePlanningStore.getState().setSelectedWeek(41);

    expect(Object.keys(useProjectStore.getState().weekSaves)).toEqual([]);
  });

  it("une vraie préparation est bien sauvegardée", () => {
    lifecycle.createNewProject('Test', YEAR);
    usePlanningStore.getState().setSelectedWeek(40);
    usePlanningStore.getState().handleBlockedZoneAdd(
      new Date('2026-10-05T08:00:00Z'),
      new Date('2026-10-05T10:00:00Z'),
    );

    expect(Object.keys(useProjectStore.getState().weekSaves)).toEqual(['40']);
  });

  it("vider une préparation existante met bien le snapshot à jour au lieu de l'ignorer", () => {
    lifecycle.createNewProject('Test', YEAR);
    usePlanningStore.getState().setSelectedWeek(40);
    usePlanningStore.getState().handleBlockedZoneAdd(
      new Date('2026-10-05T08:00:00Z'),
      new Date('2026-10-05T10:00:00Z'),
    );
    const zoneId = usePlanningStore.getState().blockedZones.find((z) => !z.source)!.id;

    usePlanningStore.getState().handleBlockedZoneRemove(zoneId);

    // Le snapshot existe toujours, mais vidé — la garde ne doit pas figer l'ancien contenu.
    expect(useProjectStore.getState().weekSaves['40'].manualBlockedZones).toEqual([]);
  });
});
