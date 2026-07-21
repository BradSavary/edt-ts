import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { StorageValue } from 'zustand/middleware';
import type { PersistedProjectFields, ProjectFileV1 } from '@/lib/project/projectFile';
import type { PreparedWeekSnapshot } from '@/store/slices/weekSavesSlice';

/**
 * §6.2 du plan (docs/PlanSplitWeekStorage.md) : le moteur de stockage découpé par semaine.
 *
 * Ces cas couvrent une zone qui ne l'était pas du tout : `__tests__/projectFile.test.ts` ne teste
 * que les fonctions pures (`stateToProjectFile`, `parseProjectFile`, …) et n'exerce jamais
 * `createProjectStorage`. Le cas 1 remplace en particulier l'invariant perdu du §1.3 — « le
 * format persisté EST le format exporté » n'est plus vrai par construction, il doit être vérifié.
 *
 * `_lastWrittenWeeks`/`_lastWrittenProjectFields` sont des caches **module-level** : chaque test
 * réimporte le module après `vi.resetModules()` pour repartir d'un cache vide.
 */
class RecordingStorage implements Storage {
  private store = new Map<string, string>();
  /** Écritures observées depuis le dernier `resetWrites()` — clé + taille sérialisée. */
  writes: Array<{ key: string; bytes: number }> = [];
  removals: string[] = [];

  get length(): number { return this.store.size; }
  clear(): void { this.store.clear(); }
  getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
  key(index: number): string | null { return Array.from(this.store.keys())[index] ?? null; }
  removeItem(key: string): void { this.removals.push(key); this.store.delete(key); }
  setItem(key: string, value: string): void { this.writes.push({ key, bytes: value.length }); this.store.set(key, value); }

  resetWrites(): void { this.writes = []; this.removals = []; }
  /** Écriture directe sans journalisation — pour préparer un état de départ. */
  seed(key: string, value: string): void { this.store.set(key, value); }
  keys(): string[] { return Array.from(this.store.keys()); }
}

let storage: RecordingStorage;
let mod: typeof import('@/lib/project/projectFile');
let migration: typeof import('@/lib/project/legacyMigration');

const YEAR = { year: '2026-2027', zone: 'A' as const, periods: [] };

function week(n: number, note?: string): PreparedWeekSnapshot {
  return {
    weekNumber: n,
    schoolYear: YEAR.year,
    savedAt: 1_000_000 + n,
    taskGroups: [],
    manualBlockedZones: [],
    preNeutralizedKeys: [],
    manualEnforcedMap: {},
    manualCourses: [],
    ...(note !== undefined ? { note } : {}),
  };
}

function baseState(weekSaves: Record<string, PreparedWeekSnapshot> = {}): PersistedProjectFields {
  return {
    projectName: 'Projet test',
    schoolYearConfig: YEAR,
    allCourses: [],
    resources: [],
    coursesFileName: 'cours.csv',
    constraints: { Default: [] },
    weekSaves,
    yearColorConfig: {} as PersistedProjectFields['yearColorConfig'],
    tightThreshold: 0.5,
    criticalThreshold: 1.0,
  };
}

function save(state: PersistedProjectFields): void {
  mod.createProjectStorage<PersistedProjectFields>().setItem(mod.PROJECT_STORAGE_KEY, { state, version: 1 });
}

function load(): PersistedProjectFields | null {
  // `PersistStorage.getItem` est typé sync-ou-async ; notre implémentation est synchrone.
  const res = mod.createProjectStorage<PersistedProjectFields>().getItem(mod.PROJECT_STORAGE_KEY) as
    | StorageValue<PersistedProjectFields>
    | null;
  return res ? res.state : null;
}

beforeEach(async () => {
  storage = new RecordingStorage();
  vi.stubGlobal('localStorage', storage);
  vi.resetModules();
  mod = await import('@/lib/project/projectFile');
  migration = await import('@/lib/project/legacyMigration');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createProjectStorage — aller-retour', () => {
  it('1. un état complet écrit puis relu est identique, semaines comprises', () => {
    const state = baseState({ '38': week(38), '45': week(45, 'note S45') });
    save(state);

    // Cache vidé : la relecture doit passer par le localStorage, pas par la mémoire du module.
    vi.resetModules();

    expect(load()).toEqual(state);
  });

  it('2. le stockage se réassemble en un ProjectFileV1 valide (invariant §1.3)', () => {
    save(baseState({ '38': week(38) }));
    const reloaded = load()!;
    const file = mod.stateToProjectFile(reloaded);

    expect(mod.isProjectFileV1(file)).toBe(true);
    expect(file.weekSaves).toEqual({ '38': week(38) });
  });
});

describe('createProjectStorage — écriture sélective', () => {
  it('3. modifier une seule semaine n\'écrit que sa clé', () => {
    const state = baseState({ '38': week(38), '45': week(45) });
    save(state);
    storage.resetWrites();

    save({ ...state, weekSaves: { ...state.weekSaves, '38': week(38, 'modifiée') } });

    expect(storage.writes.map((w) => w.key)).toEqual([mod.weekStorageKey(38)]);
  });

  it('4. modifier un champ projet n\'écrit que l\'entrée projet', () => {
    const state = baseState({ '38': week(38), '45': week(45) });
    save(state);
    storage.resetWrites();

    save({ ...state, tightThreshold: 0.9 });

    expect(storage.writes.map((w) => w.key)).toEqual([mod.PROJECT_STORAGE_KEY]);
  });

  it('4bis. réécrire un état inchangé n\'écrit rien du tout', () => {
    const state = baseState({ '38': week(38) });
    save(state);
    storage.resetWrites();

    save(state);

    expect(storage.writes).toEqual([]);
  });
});

describe('createProjectStorage — suppression et robustesse', () => {
  it('5. retirer une semaine supprime sa clé et la retire de `weeks`', () => {
    const state = baseState({ '38': week(38), '45': week(45) });
    save(state);
    storage.resetWrites();

    save({ ...state, weekSaves: { '45': week(45) } });

    expect(storage.removals).toContain(mod.weekStorageKey(38));
    const entry = JSON.parse(storage.getItem(mod.PROJECT_STORAGE_KEY)!);
    expect(entry.weeks).toEqual([45]);
    expect(load()!.weekSaves).toEqual({ '45': week(45) });
  });

  it('6. une clé de semaine orpheline (absente de `weeks`) est ignorée', () => {
    save(baseState({ '38': week(38) }));
    storage.seed(mod.weekStorageKey(99), JSON.stringify(week(99)));
    vi.resetModules();

    expect(Object.keys(load()!.weekSaves)).toEqual(['38']);
  });

  it('7. une semaine illisible est perdue, le reste du projet charge', () => {
    save(baseState({ '38': week(38), '45': week(45) }));
    storage.seed(mod.weekStorageKey(38), '{ ceci n\'est pas du JSON');
    vi.resetModules();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const loaded = load()!;
    expect(Object.keys(loaded.weekSaves)).toEqual(['45']);
    expect(loaded.projectName).toBe('Projet test');
  });

  it('10. projectName null supprime l\'entrée projet et toutes les clés de semaine', () => {
    save(baseState({ '38': week(38), '45': week(45) }));

    save({ ...baseState(), projectName: null });

    expect(storage.keys()).toEqual([]);
    expect(load()).toBeNull();
  });
});

describe('migrateProjectStorageToSplitKeys', () => {
  function monolith(weekSaves: Record<string, PreparedWeekSnapshot>): ProjectFileV1 {
    return {
      formatVersion: 1,
      exportedAt: '2026-07-21T00:00:00.000Z',
      name: 'Projet test',
      schoolYearConfig: YEAR,
      coursesFileName: 'cours.csv',
      allCourses: [],
      resources: [],
      constraints: { Default: [] },
      weekSaves,
      yearColorConfig: {} as ProjectFileV1['yearColorConfig'],
      tightThreshold: 0.5,
      criticalThreshold: 1.0,
    };
  }

  it('8. un monolithe est découpé : une clé par semaine, entrée projet sans weekSaves', () => {
    storage.seed(mod.PROJECT_STORAGE_KEY, JSON.stringify(monolith({ '38': week(38), '45': week(45) })));

    migration.migrateProjectStorageToSplitKeys();

    const entry = JSON.parse(storage.getItem(mod.PROJECT_STORAGE_KEY)!);
    expect(entry.storageVersion).toBe(mod.STORAGE_VERSION);
    expect(entry.weeks.sort()).toEqual([38, 45]);
    expect(entry.weekSaves).toBeUndefined();
    expect(JSON.parse(storage.getItem(mod.weekStorageKey(38))!)).toEqual(week(38));

    // L'état relu après migration est celui d'origine.
    vi.resetModules();
    expect(load()!.weekSaves).toEqual({ '38': week(38), '45': week(45) });
  });

  it('9. rejouée sur un stockage déjà découpé, la migration ne change rien', () => {
    storage.seed(mod.PROJECT_STORAGE_KEY, JSON.stringify(monolith({ '38': week(38) })));
    migration.migrateProjectStorageToSplitKeys();
    const afterFirst = storage.keys().map((k) => [k, storage.getItem(k)]);

    migration.migrateProjectStorageToSplitKeys();

    expect(storage.keys().map((k) => [k, storage.getItem(k)])).toEqual(afterFirst);
  });
});
