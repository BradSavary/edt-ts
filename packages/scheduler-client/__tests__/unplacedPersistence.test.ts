import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Cas 5 de §6.2 du plan (docs/PlanUnifiedUnplaced.md) : les trois origines de `unplaced`
 * cohabitent en mémoire sans se marcher dessus, mais **seule** la sous-liste `user-pre`
 * traverse la sauvegarde de semaine (`weekSaves[w].preNeutralizedKeys`, format persisté
 * inchangé — §2 du plan). `engine`/`user-post` ne doivent jamais y atterrir, ni survivre à un
 * rechargement de la semaine (`setSelectedWeek`), puisqu'ils sont reconstruits depuis le
 * résultat moteur / les gestes de calendrier de la session en cours, pas depuis le disque.
 *
 * Même motif de stub localStorage + reset de modules que les autres tests de store
 * (voir autonomyDistributionStore.test.ts / useProjectStore.test.ts).
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

let usePlanningStore: typeof import('../store/usePlanningStore').usePlanningStore;
let useProjectStore: typeof import('../store/useProjectStore').useProjectStore;

beforeEach(async () => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  vi.resetModules();
  ({ usePlanningStore } = await import('../store/usePlanningStore'));
  ({ useProjectStore } = await import('../store/useProjectStore'));

  // Requis pour que `_saveCurrentWeekSnapshot` ne s'auto-annule pas (elle bail out sans
  // schoolYearConfig) — voir usePlanningStore.ts.
  useProjectStore.setState({ schoolYearConfig: { year: '2026-2027', zone: 'A', periods: [] }, weekSaves: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('unplaced : persistance des user-pre uniquement', () => {
  it('seule la sous-liste user-pre déclenche la sauvegarde et y est écrite', () => {
    usePlanningStore.getState().setSelectedWeek(1); // pas de snapshot -> unplaced: []

    usePlanningStore.setState({
      unplaced: [
        { taskId: 'exclu-avant', origin: 'user-pre' },
        { taskId: 'neutralise-moteur', origin: 'engine', diagnostics: { reason: 'test', failureCount: 1, eliminationRound: 0 } },
        { taskId: 'retire-apres-coup', origin: 'user-post' },
      ],
    });

    const snapshot = useProjectStore.getState().weekSaves['1'];
    expect(snapshot).toBeDefined();
    expect(snapshot.preNeutralizedKeys).toEqual(['exclu-avant']);
  });

  it("un aller-retour setSelectedWeek ne restaure que les user-pre : engine/user-post disparaissent", () => {
    usePlanningStore.getState().setSelectedWeek(1);
    usePlanningStore.setState({
      unplaced: [
        { taskId: 'exclu-avant', origin: 'user-pre' },
        { taskId: 'neutralise-moteur', origin: 'engine', diagnostics: { reason: 'test', failureCount: 1, eliminationRound: 0 } },
        { taskId: 'retire-apres-coup', origin: 'user-post' },
      ],
    });

    // Simule un rechargement de la semaine (changement puis retour, comme un vrai aller-retour
    // de navigation) : la reconstruction passe uniquement par `snapshot.preNeutralizedKeys`.
    usePlanningStore.getState().setSelectedWeek(2);
    usePlanningStore.getState().setSelectedWeek(1);

    expect(usePlanningStore.getState().unplaced).toEqual([{ taskId: 'exclu-avant', origin: 'user-pre' }]);
  });

  it('une modification qui ne touche pas les user-pre (engine seul) ne redéclenche pas la sauvegarde', () => {
    usePlanningStore.getState().setSelectedWeek(1);
    usePlanningStore.setState({ unplaced: [{ taskId: 'exclu-avant', origin: 'user-pre' }] });
    const afterFirstSave = useProjectStore.getState().weekSaves['1'].savedAt;

    // Avance l'horloge pour distinguer un éventuel nouveau savedAt d'un ancien.
    vi.useFakeTimers();
    vi.setSystemTime(afterFirstSave + 10_000);
    usePlanningStore.setState({
      unplaced: [
        { taskId: 'exclu-avant', origin: 'user-pre' },
        { taskId: 'neutralise-moteur', origin: 'engine', diagnostics: { reason: 'test', failureCount: 1, eliminationRound: 0 } },
      ],
    });
    vi.useRealTimers();

    expect(useProjectStore.getState().weekSaves['1'].savedAt).toBe(afterFirstSave);
  });
});
