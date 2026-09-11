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

  it('préserve les préférences douces non fusionnées pré-existantes au passage v9+', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      state: {
        schedulerConfig: {
          engine: 'cpsat',
          timeoutSeconds: 180,
          minimizeTeacherDays: true,
          minimizeTeacherRoomChanges: true,
        },
      },
      version: 8,
    }));
    const { useAppConfigStore } = await import('@/store/useAppConfigStore');
    await useAppConfigStore.persist.rehydrate();
    const cfg = useAppConfigStore.getState().schedulerConfig;
    expect(cfg.minimizeTeacherDays).toBe(true);
    expect(cfg.minimizeTeacherRoomChanges).toBe(true);
  });

  it('v12 : retire balanceTeacherDailyLoad (préférence supprimée, aucun avantage mesuré)', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      state: {
        schedulerConfig: {
          engine: 'cpsat',
          timeoutSeconds: 180,
          balanceTeacherDailyLoad: true,
        },
      },
      version: 11,
    }));
    const { useAppConfigStore } = await import('@/store/useAppConfigStore');
    await useAppConfigStore.persist.rehydrate();
    const cfg = useAppConfigStore.getState().schedulerConfig as Record<string, unknown>;
    expect('balanceTeacherDailyLoad' in cfg).toBe(false);
  });

  it('v11 : fusionne compactTeacherHalfDays OU crossNoonGap en compactTeacherDay=true', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      state: {
        schedulerConfig: {
          engine: 'cpsat',
          timeoutSeconds: 180,
          compactTeacherHalfDays: false,
          crossNoonGap: true,
        },
      },
      version: 10,
    }));
    const { useAppConfigStore } = await import('@/store/useAppConfigStore');
    await useAppConfigStore.persist.rehydrate();
    const cfg = useAppConfigStore.getState().schedulerConfig as Record<string, unknown>;
    expect(cfg.compactTeacherDay).toBe(true);
    expect('compactTeacherHalfDays' in cfg).toBe(false);
    expect('crossNoonGap' in cfg).toBe(false);
  });

  it('v11 : compactTeacherDay=false si ni compactTeacherHalfDays ni crossNoonGap n\'étaient actives', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      state: {
        schedulerConfig: {
          engine: 'cpsat',
          timeoutSeconds: 180,
          compactTeacherHalfDays: false,
          crossNoonGap: false,
        },
      },
      version: 10,
    }));
    const { useAppConfigStore } = await import('@/store/useAppConfigStore');
    await useAppConfigStore.persist.rehydrate();
    const cfg = useAppConfigStore.getState().schedulerConfig;
    expect(cfg.compactTeacherDay).toBe(false);
  });

  it('v10 : ajoute reduceTeacherHalfDays=false à un état v9 qui ne la connaît pas', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      state: {
        schedulerConfig: {
          engine: 'cpsat',
          timeoutSeconds: 180,
          compactTeacherHalfDays: true,
          minimizeTeacherDays: true,
          crossNoonGap: true,
          minimizeTeacherRoomChanges: true,
        },
      },
      version: 9,
    }));
    const { useAppConfigStore } = await import('@/store/useAppConfigStore');
    await useAppConfigStore.persist.rehydrate();
    const cfg = useAppConfigStore.getState().schedulerConfig;
    expect(cfg.reduceTeacherHalfDays).toBe(false);
    // Les préférences déjà cochées avant l'ajout de la case ne sont pas affectées.
    expect(cfg.minimizeTeacherDays).toBe(true);
  });

  it('v10 : préserve reduceTeacherHalfDays=true déjà persisté', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      state: {
        schedulerConfig: {
          engine: 'cpsat',
          timeoutSeconds: 180,
          reduceTeacherHalfDays: true,
        },
      },
      version: 9,
    }));
    const { useAppConfigStore } = await import('@/store/useAppConfigStore');
    await useAppConfigStore.persist.rehydrate();
    const cfg = useAppConfigStore.getState().schedulerConfig;
    expect(cfg.reduceTeacherHalfDays).toBe(true);
  });

  it('v13 : ajoute respectCmTdTpOrder=true à un état v12 qui ne la connaît pas', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      state: {
        schedulerConfig: {
          engine: 'cpsat',
          timeoutSeconds: 180,
        },
      },
      version: 12,
    }));
    const { useAppConfigStore } = await import('@/store/useAppConfigStore');
    await useAppConfigStore.persist.rehydrate();
    const cfg = useAppConfigStore.getState().schedulerConfig;
    expect(cfg.respectCmTdTpOrder).toBe(true);
  });

  it('v13 : préserve respectCmTdTpOrder=false déjà persisté', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      state: {
        schedulerConfig: {
          engine: 'cpsat',
          timeoutSeconds: 180,
          respectCmTdTpOrder: false,
        },
      },
      version: 12,
    }));
    const { useAppConfigStore } = await import('@/store/useAppConfigStore');
    await useAppConfigStore.persist.rehydrate();
    const cfg = useAppConfigStore.getState().schedulerConfig;
    expect(cfg.respectCmTdTpOrder).toBe(false);
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
    expect('compactTeacherHalfDays' in cfg).toBe(false);
    expect('crossNoonGap' in cfg).toBe(false);
    expect('balanceTeacherDailyLoad' in cfg).toBe(false);
    expect(cfg.minimizeTeacherDays).toBe(false);
    expect(cfg.reduceTeacherHalfDays).toBe(false);
    expect(cfg.compactTeacherDay).toBe(false);
    expect(cfg.minimizeTeacherRoomChanges).toBe(false);
    expect(cfg.respectCmTdTpOrder).toBe(true);
  });
});
