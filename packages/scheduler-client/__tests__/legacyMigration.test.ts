import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { migrateLegacyProjectStorage, hasMigrationBanner, clearMigrationBanner } from '../lib/project/legacyMigration';

const LEGACY_KEY = 'edt-scheduler';
const PROJECT_KEY = 'edt-project';
const BANNER_KEY = 'edt-migration-banner';

/**
 * L'environnement de test (Node récent + jsdom) expose un `localStorage` global
 * cassé (`--localstorage-file` sans chemin valide — voir le warning au démarrage de
 * vitest). On remplace donc `localStorage`/`sessionStorage` par une implémentation
 * en mémoire pour la durée de ce fichier, plutôt que de dépendre du global ambiant.
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

function setLegacyBlob(state: Record<string, unknown>) {
  localStorage.setItem(LEGACY_KEY, JSON.stringify({ state, version: 0 }));
}

function readProjectFile(): Record<string, unknown> | null {
  const raw = localStorage.getItem(PROJECT_KEY);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

describe('migrateLegacyProjectStorage', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    vi.stubGlobal('sessionStorage', new MemoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ne fait rien s'il n'y a ni edt-project ni edt-scheduler", () => {
    migrateLegacyProjectStorage();
    expect(localStorage.getItem(PROJECT_KEY)).toBeNull();
  });

  it("ne fait rien si edt-project existe déjà (ne l'écrase pas)", () => {
    localStorage.setItem(PROJECT_KEY, JSON.stringify({ formatVersion: 1, name: 'déjà là' }));
    setLegacyBlob({ coursesFileName: 'x.csv' });
    migrateLegacyProjectStorage();
    const file = readProjectFile();
    expect(file?.name).toBe('déjà là');
  });

  it('migre un ancien blob avec schoolYearConfig : nom, année, cours repris, edt-scheduler supprimé', () => {
    setLegacyBlob({
      schoolYearConfig: { year: '2026-2027', zone: 'B', periods: [] },
      allCourses: [{ id: 'c1', code: 'R101' }],
      resources: [],
      coursesFileName: 'ventilation.csv',
      constraints: { Default: [] },
      weekSaves: { '2026-2027': { '44': { weekNumber: 44 } } },
      tightThreshold: 0.4,
      criticalThreshold: 0.9,
    });

    migrateLegacyProjectStorage();

    const file = readProjectFile();
    expect(file).not.toBeNull();
    expect(file?.formatVersion).toBe(1);
    expect(file?.name).toBe('Projet — ventilation');
    expect(file?.schoolYearConfig).toEqual({ year: '2026-2027', zone: 'B', periods: [] });
    expect(file?.allCourses).toEqual([{ id: 'c1', code: 'R101' }]);
    expect(file?.tightThreshold).toBe(0.4);
    expect(file?.criticalThreshold).toBe(0.9);
    // Ne migre que les weekSaves de l'année retenue, aplatis (plus de clé année)
    expect(file?.weekSaves).toEqual({ '44': { weekNumber: 44 } });

    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(hasMigrationBanner()).toBe(false);
  });

  it('sans schoolYearConfig : utilise une année par défaut et pose le bandeau de migration', () => {
    setLegacyBlob({ allCourses: [], resources: [], coursesFileName: null });

    migrateLegacyProjectStorage();

    const file = readProjectFile();
    expect(file?.name).toBe('Projet migré');
    expect(typeof (file?.schoolYearConfig as { year?: string })?.year).toBe('string');
    expect(hasMigrationBanner()).toBe(true);

    clearMigrationBanner();
    expect(hasMigrationBanner()).toBe(false);
    expect(sessionStorage.getItem(BANNER_KEY)).toBeNull();
  });

  it('ignore silencieusement un blob JSON illisible (pas de crash, pas de migration)', () => {
    localStorage.setItem(LEGACY_KEY, '{ not valid json');
    expect(() => migrateLegacyProjectStorage()).not.toThrow();
    expect(localStorage.getItem(PROJECT_KEY)).toBeNull();
  });
});
