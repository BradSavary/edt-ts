import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AvailabilityManager } from '@edt-ts/scheduler-common';
import type { NeutralizedTaskInfoJSON } from '@edt-ts/scheduler-common';
import type { Placement } from '../store/types';

/**
 * `useProjectStore`/`usePlanningStore` lisent localStorage dès leur import : on stub un
 * stockage mémoire avant l'import dynamique, avec reset de la registry entre chaque test
 * (même motif que useProjectStore.test.ts).
 *
 * Vérifie le CÂBLAGE store de la répartition d'Autonomie après le chantier modèle unifié
 * (docs/PlanUnifiedPlacements.md) : les morceaux sont désormais des `Placement` `post-enforced`
 * de plein droit, avec `taskId` = cours Autonomie réel et `placementId` synthétique par morceau
 * (fragmentation placementId ≠ taskId, cas préexistant conservé — voir STATUT du plan, arbitrage
 * n°2). Le calcul lui-même (créneaux libres, midi, seuil 60min) est couvert par
 * autonomyDistribution.test.ts sur la fonction pure.
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

/** Cours Autonomie neutralisé requérant `groups`, `duration` minutes. */
function autonomyNeutralized(taskId: string, duration: number, groups: string[] = ['G1']): NeutralizedTaskInfoJSON {
  return {
    task: {
      taskId,
      code: 'R1.01',
      name: 'Autonomie',
      type: 'Autonomie',
      week: 1,
      duration,
      startTime: 0,
      resources: groups.map((id) => ({ id, type: 'group' })),
    },
    eliminationRound: 0,
    failureCount: 0,
    reason: 'test',
  };
}

function placedTask(placementId: string, overrides: Partial<Placement> = {}): Placement {
  return {
    placementId,
    taskId: placementId,
    startTime: 15 * 60,
    duration: 60,
    resources: { teachers: ['DUPONT'], groups: ['G1'], rooms: ['A101'] },
    origin: 'post-enforced',
    ...overrides,
  };
}

/** Semaine 1 : G1 disponible lundi 08:00-12:00 (240 min), rien d'autre. */
function seedPlanning(neutralized: NeutralizedTaskInfoJSON[], placed: Placement[] = []): void {
  const availabilityManager = new AvailabilityManager({
    Default: [],
    G1: [{ days: 'lundi', from: '08:00', to: '12:00' }],
    G2: [{ days: 'lundi', from: '08:00', to: '12:00' }],
  });
  useProjectStore.setState({ availabilityManager, schoolYearConfig: null });
  usePlanningStore.setState({
    selectedWeek: 1,
    placements: placed,
    manuallyNeutralizedTasks: [],
    activeNeutralizedTasks: neutralized,
    autonomyDistributions: {},
    blockedZones: [],
  });
}

beforeEach(async () => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  vi.resetModules();
  ({ usePlanningStore } = await import('../store/usePlanningStore'));
  ({ useProjectStore } = await import('../store/useProjectStore'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('distributeAutonomy (câblage store)', () => {
  it('crée des placements post-enforced référençant le cours Autonomie réel + une entrée de suivi', () => {
    seedPlanning([autonomyNeutralized('auto-1', 180)]);

    usePlanningStore.getState().distributeAutonomy('auto-1');

    const { placements, autonomyDistributions } = usePlanningStore.getState();
    expect(placements).toHaveLength(1);
    const piece = placements[0];
    expect(piece.placementId).toBe('auto-1-piece-0');
    expect(piece.taskId).toBe('auto-1');
    expect(piece.origin).toBe('post-enforced');
    expect(piece.startTime).toBe(8 * 60);
    expect(piece.duration).toBe(180);
    expect(piece.resources.groups).toEqual(['G1']);

    const dist = autonomyDistributions['auto-1'];
    expect(dist).toBeDefined();
    expect(dist.totalDuration).toBe(180);
    expect(dist.remainingDuration).toBe(0);
    expect(dist.pieceIds).toEqual(['auto-1-piece-0']);
  });

  it('durée > créneaux disponibles : morceau tronqué + reste reporté', () => {
    seedPlanning([autonomyNeutralized('auto-1', 400)]); // 240 dispo

    usePlanningStore.getState().distributeAutonomy('auto-1');

    const { placements, autonomyDistributions } = usePlanningStore.getState();
    const placed = placements.reduce((sum, p) => sum + (p.duration ?? 0), 0);
    expect(placed).toBe(240);
    expect(autonomyDistributions['auto-1'].remainingDuration).toBe(160);
    // Invariant : posé = total − reste
    expect(placed).toBe(400 - autonomyDistributions['auto-1'].remainingDuration);
  });

  it('préserve les placements déjà présents et n\'écrase pas une autre répartition', () => {
    seedPlanning([autonomyNeutralized('auto-1', 120)], [placedTask('manuel-1')]);

    usePlanningStore.getState().distributeAutonomy('auto-1');

    const { placements } = usePlanningStore.getState();
    expect(placements.some((p) => p.placementId === 'manuel-1')).toBe(true);
    expect(placements.some((p) => p.placementId === 'auto-1-piece-0')).toBe(true);
  });

  it('une seconde répartition voit les morceaux de la première comme occupation (pas de chevauchement)', () => {
    seedPlanning([autonomyNeutralized('auto-1', 120), autonomyNeutralized('auto-2', 120)]);

    const store = usePlanningStore.getState();
    store.distributeAutonomy('auto-1'); // 08:00-10:00
    store.distributeAutonomy('auto-2'); // doit tomber en 10:00-12:00

    const placements = usePlanningStore.getState().placements;
    const p1 = placements.find((p) => p.placementId === 'auto-1-piece-0')!;
    const p2 = placements.find((p) => p.placementId === 'auto-2-piece-0')!;
    expect(p1.startTime).toBe(8 * 60);
    expect(p2.startTime).toBe(10 * 60);
    // Aucun recouvrement
    expect(p2.startTime).toBeGreaterThanOrEqual(p1.startTime + (p1.duration ?? 0));
  });
});

describe('cancelAutonomyDistribution (câblage store)', () => {
  it('retire tous les morceaux de la répartition et supprime l\'entrée de suivi', () => {
    seedPlanning([autonomyNeutralized('auto-1', 180)], [placedTask('manuel-1')]);
    const store = usePlanningStore.getState();
    store.distributeAutonomy('auto-1');

    store.cancelAutonomyDistribution('auto-1');

    const { placements, autonomyDistributions } = usePlanningStore.getState();
    // Les morceaux ont disparu, le placement manuel reste
    expect(placements.some((p) => p.placementId === 'auto-1-piece-0')).toBe(false);
    expect(placements.some((p) => p.placementId === 'manuel-1')).toBe(true);
    expect(autonomyDistributions['auto-1']).toBeUndefined();
  });

  it('nettoie proprement même si un morceau a déjà été retiré à la main', () => {
    seedPlanning([autonomyNeutralized('auto-1', 400)]); // ≥ 1 morceau
    const store = usePlanningStore.getState();
    store.distributeAutonomy('auto-1');

    // Simule le retrait manuel d'un morceau (drag hors calendrier)
    const remaining = usePlanningStore.getState().placements.slice(1);
    usePlanningStore.setState({ placements: remaining });

    store.cancelAutonomyDistribution('auto-1');

    const { placements, autonomyDistributions } = usePlanningStore.getState();
    expect(placements.some((p) => p.taskId === 'auto-1')).toBe(false);
    expect(autonomyDistributions['auto-1']).toBeUndefined();
  });
});
