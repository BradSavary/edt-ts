import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Cas 5 de §6.2 du plan (docs/PlanUnifiedUnplaced.md) : les trois origines de `unplaced`
 * cohabitent en mémoire sans se marcher dessus. Seule la sous-liste `user-pre` traverse
 * `weekSaves[w].preNeutralizedKeys` (format inchangé — §2 du plan) ; depuis
 * docs/PlanPersistPlacements.md (§1.2/§4.2), `engine`/`user-post` traversent désormais le
 * **nouveau** champ `weekSaves[w].unplaced` — ils survivent donc eux aussi à un rechargement de
 * semaine, contrairement au comportement d'avant ce chantier que ce fichier testait à l'origine.
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
        { taskId: 'neutralise-moteur', origin: 'engine', diagnostics: { reason: 'test' } },
        { taskId: 'retire-apres-coup', origin: 'user-post' },
      ],
    });

    const snapshot = useProjectStore.getState().weekSaves['1'];
    expect(snapshot).toBeDefined();
    expect(snapshot.preNeutralizedKeys).toEqual(['exclu-avant']);
  });

  it('un aller-retour setSelectedWeek restaure les trois origines (§4.3 de PlanPersistPlacements)', () => {
    usePlanningStore.getState().setSelectedWeek(1);
    usePlanningStore.setState({
      unplaced: [
        { taskId: 'exclu-avant', origin: 'user-pre' },
        { taskId: 'neutralise-moteur', origin: 'engine', diagnostics: { reason: 'test' } },
        { taskId: 'retire-apres-coup', origin: 'user-post' },
      ],
    });

    // Simule un rechargement de la semaine (changement puis retour, comme un vrai aller-retour
    // de navigation) : `user-pre` se reconstruit depuis `preNeutralizedKeys`, `engine`/`user-post`
    // depuis le nouveau champ `unplaced` — les deux sources sont concaténées à la lecture.
    usePlanningStore.getState().setSelectedWeek(2);
    usePlanningStore.getState().setSelectedWeek(1);

    expect(usePlanningStore.getState().unplaced).toEqual([
      { taskId: 'exclu-avant', origin: 'user-pre' },
      { taskId: 'neutralise-moteur', origin: 'engine', diagnostics: { reason: 'test' } },
      { taskId: 'retire-apres-coup', origin: 'user-post' },
    ]);
  });

  it('une modification engine seul (sans toucher les user-pre) redéclenche désormais la sauvegarde', () => {
    // Avant PlanPersistPlacements, la garde d'auto-save ne comparait que les `user-pre` (seuls
    // persistés à l'époque) pour éviter de réécrire tout le projet à chaque neutralisation
    // moteur. Le découpage par semaine (cbc0caa) a rendu cette précaution inutile, et `engine`
    // est désormais un champ légitimement persisté (`unplaced`) : la garde simplifiée (§4.4)
    // sauve sur toute référence différente de `unplaced`, cette modification y compris.
    usePlanningStore.getState().setSelectedWeek(1);
    usePlanningStore.setState({ unplaced: [{ taskId: 'exclu-avant', origin: 'user-pre' }] });
    const afterFirstSave = useProjectStore.getState().weekSaves['1'].savedAt;

    vi.useFakeTimers();
    vi.setSystemTime(afterFirstSave + 10_000);
    usePlanningStore.setState({
      unplaced: [
        { taskId: 'exclu-avant', origin: 'user-pre' },
        { taskId: 'neutralise-moteur', origin: 'engine', diagnostics: { reason: 'test' } },
      ],
    });
    vi.useRealTimers();

    expect(useProjectStore.getState().weekSaves['1'].savedAt).toBe(afterFirstSave + 10_000);
  });

  it('addPreNeutralized ajoute en une passe, promeut une entrée non-user-pre existante, et persiste', () => {
    usePlanningStore.getState().setSelectedWeek(1);
    usePlanningStore.setState({
      unplaced: [
        { taskId: 'deja-engine', origin: 'engine', diagnostics: { reason: 'test' } },
        { taskId: 'intact', origin: 'user-post' },
      ],
    });

    usePlanningStore.getState().addPreNeutralized(['nouveau-a', 'deja-engine', 'nouveau-b']);

    // `deja-engine` est promu sur place (pas de doublon, position conservée) ; `intact` n'est pas
    // dans la demande et garde son origine.
    expect(usePlanningStore.getState().unplaced).toEqual([
      { taskId: 'deja-engine', origin: 'user-pre' },
      { taskId: 'intact', origin: 'user-post' },
      { taskId: 'nouveau-a', origin: 'user-pre' },
      { taskId: 'nouveau-b', origin: 'user-pre' },
    ]);

    const snapshot = useProjectStore.getState().weekSaves['1'];
    expect(snapshot.preNeutralizedKeys).toEqual(['deja-engine', 'nouveau-a', 'nouveau-b']);
  });

  it("addPreNeutralized ne touche pas à l'état quand tout est déjà user-pre", () => {
    usePlanningStore.getState().setSelectedWeek(1);
    usePlanningStore.setState({ unplaced: [{ taskId: 'deja', origin: 'user-pre' }] });
    const before = usePlanningStore.getState().unplaced;

    usePlanningStore.getState().addPreNeutralized(['deja']);

    // Référence identique : sans ça, l'auto-save se déclencherait pour rien.
    expect(usePlanningStore.getState().unplaced).toBe(before);
  });

  /**
   * Garde sur `handleEnforceChange`, pas sur `addPreNeutralized` : c'est parce qu'elle efface les
   * `engine`/`user-post` (et ne garde que les `user-pre`) que la copie de préparation ne peut pas
   * s'appuyer sur une entrée non-`user-pre` préexistante — d'où la promotion testée ci-dessus et
   * le filtre `user-pre` de `destPreNeutralizedIds` côté modale. Ce test rougit si cette
   * préservation des `user-pre` disparaît, scénario qui reperdrait la neutralisation copiée.
   */
  it('la neutralisation issue de la copie survit à l\'imposition appliquée dans la même passe', () => {
    usePlanningStore.getState().setSelectedWeek(1);
    usePlanningStore.setState({
      unplaced: [
        { taskId: 'X', origin: 'engine', diagnostics: { reason: 'test' } },
      ],
    });

    usePlanningStore.getState().handleEnforceChange({ Y: { startTime: 480, teacher: [], groups: [], rooms: [] } });
    usePlanningStore.getState().addPreNeutralized(['X']);

    expect(usePlanningStore.getState().unplaced).toEqual([{ taskId: 'X', origin: 'user-pre' }]);
    expect(useProjectStore.getState().weekSaves['1'].preNeutralizedKeys).toEqual(['X']);
  });
});
