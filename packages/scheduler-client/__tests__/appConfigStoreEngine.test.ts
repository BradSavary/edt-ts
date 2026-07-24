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

describe('useAppConfigStore — migration engine (v2 → v3)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    // Module singleton (store créé à l'import) : on force un rechargement frais par test
    // pour éviter toute contamination d'état entre tests (chacun voit sa propre instance).
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("config persistée v2 sans champ engine : injecte engine='core' à la réhydratation", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      state: { schedulerConfig: { timeoutSeconds: 180, maxIterations: 1_000_000 } },
      version: 2,
    }));
    const { useAppConfigStore } = await import('@/store/useAppConfigStore');
    await useAppConfigStore.persist.rehydrate();
    expect(useAppConfigStore.getState().schedulerConfig.engine).toBe('core');
  });

  it('config persistée v1 (avec maxSolutions, sans engine) : les deux migrations cumulées s\'appliquent', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      state: { schedulerConfig: { maxSolutions: 6, timeoutSeconds: 180 } },
      version: 1,
    }));
    const { useAppConfigStore } = await import('@/store/useAppConfigStore');
    await useAppConfigStore.persist.rehydrate();
    const cfg = useAppConfigStore.getState().schedulerConfig;
    expect(cfg.engine).toBe('core');
    expect('maxSolutions' in cfg).toBe(false);
  });

  it("config déjà en v3 avec engine='cpsat' : pas de migration, valeur conservée", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      state: { schedulerConfig: { engine: 'cpsat', timeoutSeconds: 180 } },
      version: 3,
    }));
    const { useAppConfigStore } = await import('@/store/useAppConfigStore');
    await useAppConfigStore.persist.rehydrate();
    expect(useAppConfigStore.getState().schedulerConfig.engine).toBe('cpsat');
  });

  it("pas de config persistée du tout : la valeur par défaut du store est engine='core'", async () => {
    const { useAppConfigStore } = await import('@/store/useAppConfigStore');
    await useAppConfigStore.persist.rehydrate();
    expect(useAppConfigStore.getState().schedulerConfig.engine).toBe('core');
  });

  it("config persistée v3 sans groupTeacherHalfDays : injecte groupTeacherHalfDays=false à la réhydratation (migration v4)", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      state: { schedulerConfig: { engine: 'cpsat', timeoutSeconds: 180 } },
      version: 3,
    }));
    const { useAppConfigStore } = await import('@/store/useAppConfigStore');
    await useAppConfigStore.persist.rehydrate();
    expect(useAppConfigStore.getState().schedulerConfig.groupTeacherHalfDays).toBe(false);
  });
});
