import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * L'environnement de test expose un `localStorage` cassé (cf. legacyMigration.test.ts) —
 * on le remplace par une implémentation en mémoire pour la durée de ce fichier.
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

const STORAGE_KEY = 'edt-app-config';

const CORE_ONLY_KEYS = [
  'engine', 'maxSolutions', 'maxIterations', 'maxEliminations',
  'conflictOrderingSearch', 'conflictSetExact', 'comboBranching',
  'searchStrategy', 'postRepair',
];

describe('useAppConfigStore — migration v9 (moteur unique CP-SAT)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    // Module singleton (store créé à l'import) : on force un rechargement frais par test
    // pour éviter toute contamination d'état entre tests (chacun voit sa propre instance).
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retire les 9 clés core-only d\'un état v8 persisté', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      state: {
        schedulerConfig: {
          engine: 'core',
          maxSolutions: 6,
          timeoutSeconds: 180,
          maxIterations: 1_000_000,
          maxEliminations: 3,
          conflictOrderingSearch: true,
          conflictSetExact: false,
          comboBranching: false,
          searchStrategy: 'elimination',
          postRepair: true,
          lunchBreak: { type: 'fixed', from: '12:00', to: '13:30' },
          compactTeacherHalfDays: false,
          minimizeTeacherDays: false,
          balanceTeacherDailyLoad: false,
          crossNoonGap: false,
          minimizeTeacherRoomChanges: false,
        },
      },
      version: 8,
    }));
    const { useAppConfigStore } = await import('@/store/useAppConfigStore');
    await useAppConfigStore.persist.rehydrate();
    const cfg = useAppConfigStore.getState().schedulerConfig as Record<string, unknown>;
    for (const key of CORE_ONLY_KEYS) {
      expect(key in cfg).toBe(false);
    }
    expect(cfg.timeoutSeconds).toBe(180);
  });

  it('rabat une lunchBreak flottante persistée sur { type: \'none\' }', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      state: {
        schedulerConfig: {
          engine: 'core',
          timeoutSeconds: 180,
          lunchBreak: { type: 'floating', duration: 90, earliest: '11:30', latest: '14:00' },
        },
      },
      version: 8,
    }));
    const { useAppConfigStore } = await import('@/store/useAppConfigStore');
    await useAppConfigStore.persist.rehydrate();
    const cfg = useAppConfigStore.getState().schedulerConfig;
    expect(cfg.lunchBreak).toEqual({ type: 'none' });
  });

  it('laisse une lunchBreak fixe ou "none" intacte', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      state: {
        schedulerConfig: {
          engine: 'cpsat',
          timeoutSeconds: 180,
          lunchBreak: { type: 'fixed', from: '12:00', to: '13:30' },
        },
      },
      version: 8,
    }));
    const { useAppConfigStore } = await import('@/store/useAppConfigStore');
    await useAppConfigStore.persist.rehydrate();
    const cfg = useAppConfigStore.getState().schedulerConfig;
    expect(cfg.lunchBreak).toEqual({ type: 'fixed', from: '12:00', to: '13:30' });
  });

  it('préserve les cinq préférences douces au passage v9', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      state: {
        schedulerConfig: {
          engine: 'cpsat',
          timeoutSeconds: 180,
          compactTeacherHalfDays: true,
          minimizeTeacherDays: true,
          balanceTeacherDailyLoad: true,
          crossNoonGap: true,
          minimizeTeacherRoomChanges: true,
        },
      },
      version: 8,
    }));
    const { useAppConfigStore } = await import('@/store/useAppConfigStore');
    await useAppConfigStore.persist.rehydrate();
    const cfg = useAppConfigStore.getState().schedulerConfig;
    expect(cfg.compactTeacherHalfDays).toBe(true);
    expect(cfg.minimizeTeacherDays).toBe(true);
    expect(cfg.balanceTeacherDailyLoad).toBe(true);
    expect(cfg.crossNoonGap).toBe(true);
    expect(cfg.minimizeTeacherRoomChanges).toBe(true);
  });

  it('pas de config persistée du tout : les valeurs par défaut ne contiennent aucune clé core-only', async () => {
    const { useAppConfigStore } = await import('@/store/useAppConfigStore');
    await useAppConfigStore.persist.rehydrate();
    const cfg = useAppConfigStore.getState().schedulerConfig as Record<string, unknown>;
    for (const key of CORE_ONLY_KEYS) {
      expect(key in cfg).toBe(false);
    }
    expect(cfg.lunchBreak).toEqual({ type: 'none' });
  });

  it('config persistée v1 (avec maxSolutions et groupTeacherHalfDays) : les migrations cumulées s\'appliquent jusqu\'à v9', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      state: { schedulerConfig: { maxSolutions: 6, timeoutSeconds: 180, groupTeacherHalfDays: true } },
      version: 1,
    }));
    const { useAppConfigStore } = await import('@/store/useAppConfigStore');
    await useAppConfigStore.persist.rehydrate();
    const cfg = useAppConfigStore.getState().schedulerConfig as Record<string, unknown>;
    for (const key of CORE_ONLY_KEYS) {
      expect(key in cfg).toBe(false);
    }
    expect('groupTeacherHalfDays' in cfg).toBe(false);
    expect(cfg.compactTeacherHalfDays).toBe(false);
    expect(cfg.minimizeTeacherDays).toBe(false);
    expect(cfg.balanceTeacherDailyLoad).toBe(false);
    expect(cfg.crossNoonGap).toBe(false);
    expect(cfg.minimizeTeacherRoomChanges).toBe(false);
  });
});
