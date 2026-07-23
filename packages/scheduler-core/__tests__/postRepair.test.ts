import { describe, it, expect } from 'vitest';
import type { RawScheduleData } from '@edt-ts/scheduler-common';
import { Loader } from '../src/loader.js';
import { Scheduler } from '../src/scheduler.js';
import type { SchedulerSolution, NeutralizedUnitInfo } from '../src/scheduler.js';
import type { ISchedulingUnit } from '../src/schedulingUnit.js';

/**
 * Expose `_units` (protected) pour piloter précisément QUELLE unité est "neutralisée" dans
 * chaque scénario — construire cet état via le heuristique réel de `solveWithElimination()`
 * n'est pas praticable ici : quand une victime n'a qu'une seule combinaison bloquée par un
 * occupant flexible, `_computeConflictSet` blâme (à raison) l'occupant, pas la victime — c'est
 * justement CE blâme, correct pour l'élimination mais aveugle au swap, que `repairNeutralized`
 * corrige après coup. On construit donc directement l'état "post-solveWithElimination" que la
 * précondition de `repairNeutralized` documente (`_solution` = enforced uniquement), en excluant
 * la/les victime(s) avant `solve()` — même contrat d'entrée qu'un vrai résultat neutralisé.
 */
class InspectableScheduler extends Scheduler {
  public getUnits(): ISchedulingUnit[] { return this._units; }
  public excludeUnits(ids: Set<string>): ISchedulingUnit[] {
    const excluded = this._units.filter(u => ids.has(u.id));
    this._units = this._units.filter(u => !ids.has(u.id));
    return excluded;
  }
}

/** Construit un SchedulerSolution "post-solveWithElimination" avec `excludeIds` en neutralisées. */
function buildNeutralizedResult(scheduler: InspectableScheduler, excludeIds: string[]): SchedulerSolution {
  scheduler.initSolver();
  const excluded = scheduler.excludeUnits(new Set(excludeIds));
  const results = scheduler.solve();
  const base = results[0];
  if (!base) throw new Error('Scénario de test invalide : aucune solution de base trouvée.');

  const neutralizedUnits: NeutralizedUnitInfo[] = excludeIds.map(id => {
    const unit = excluded.find(u => u.id === id);
    if (!unit) throw new Error(`Unité "${id}" introuvable parmi les unités exclues.`);
    return { unit, eliminationRound: 1, failureCount: 1, reason: 'test' };
  });

  // isComplete: true — fidèle au contrat réel : les résultats de la stratégie elimination
  // portent TOUJOURS true (complétude relative à l'ensemble réduit) ; seul le résultat
  // dégénéré (solutions: [], aucun round abouti) porte false — et repairNeutralized le
  // refuse (no-op), voir le test dédié.
  return { solutions: base.solutions, isComplete: true, score: base.solutions.length, neutralizedUnits };
}

// ── Scénarios ────────────────────────────────────────────────────────────────

/**
 * Scénario de référence (§4 du plan) : O (salles alternatives {A, B}, prof TO libre 8h-9h
 * pile, durée 60 → 0 marge) ; U (salle A UNIQUEMENT, prof TU libre 8h-10h, durée 90). Résolu
 * seul, O prend A (premier combo par ordre de déclaration, à égalité de créneau). Une fois O
 * sur A, il ne reste que 9h-10h (60min) sur A pour U (90min requis) : U ne tient plus — mais
 * tiendrait si O était sur B (A resterait entièrement libre, 8h-10h ∩ teacher = 120min ≥ 90).
 */
function buildSwapScenario(): RawScheduleData {
  return {
    week: 10,
    resources: [
      { resourceType: 'teacher', resources: [{ id: 'TO' }, { id: 'TU' }] },
      { resourceType: 'room', resources: [{ id: 'A' }, { id: 'B' }] },
      { resourceType: 'group', resources: [{ id: 'GO' }, { id: 'GU' }] },
    ],
    courses: [
      {
        id: 'O', week: 10, semester: 1, level: 0, code: 'O', type: 'TD', name: 'Occupant',
        teacher: ['TO'], groups: ['GO'], rooms: [['A', 'B']], duration: 60,
      },
      {
        id: 'U', week: 10, semester: 1, level: 0, code: 'U', type: 'TD', name: 'Victime',
        teacher: ['TU'], groups: ['GU'], rooms: ['A'], duration: 90,
      },
    ],
    constraints: {
      TO: [{ days: 'lundi', from: '08:00', to: '09:00' }],
      TU: [{ days: 'lundi', from: '08:00', to: '10:00' }],
      A:  [{ days: 'lundi', from: '08:00', to: '19:30' }],
      B:  [{ days: 'lundi', from: '08:00', to: '19:30' }],
      GO: [{ days: 'lundi', from: '08:00', to: '19:30' }],
      GU: [{ days: 'lundi', from: '08:00', to: '19:30' }],
    },
  };
}

/** Variante de buildSwapScenario() : B n'est libre qu'à partir de 8h30 (510), TO élargi à 8h-11h. */
function buildStartConstantScenario(): RawScheduleData {
  const base = buildSwapScenario();
  return {
    ...base,
    constraints: {
      ...base.constraints,
      TO: [{ days: 'lundi', from: '08:00', to: '11:00' }],
      B:  [{ days: 'lundi', from: '08:30', to: '19:30' }],
    },
  };
}

/** Variante de buildSwapScenario() : GU plafonné à 30min/jour — U (90min) ne peut jamais tenir. */
function buildDailyLimitScenario(): RawScheduleData {
  const base = buildSwapScenario();
  return {
    ...base,
    resources: base.resources.map(g =>
      g.resourceType === 'group'
        ? { ...g, resources: g.resources.map(r => (r.id === 'GU' ? { ...r, maxDailyMinutes: 30 } : r)) }
        : g,
    ),
  };
}

/** buildSwapScenario() + D (TP, même code+groupes que U → dépend de U automatiquement). */
function buildCascadeScenario(): RawScheduleData {
  const base = buildSwapScenario();
  return {
    ...base,
    resources: [
      ...base.resources.filter(g => g.resourceType !== 'teacher'),
      { resourceType: 'teacher', resources: [{ id: 'TO' }, { id: 'TU' }, { id: 'TD' }] },
      { resourceType: 'room', resources: [{ id: 'A' }, { id: 'B' }, { id: 'RD' }] },
    ],
    courses: [
      base.courses[0],
      { ...base.courses[1], code: 'UCODE' },
      {
        id: 'D', week: 10, semester: 1, level: 0, code: 'UCODE', type: 'TP', name: 'Dépendante',
        teacher: ['TD'], groups: ['GU'], rooms: ['RD'], duration: 30,
      },
    ],
    constraints: {
      ...base.constraints,
      TD: [{ days: 'lundi', from: '08:00', to: '19:30' }],
      RD: [{ days: 'lundi', from: '08:00', to: '19:30' }],
    },
  };
}

/**
 * Groupe parallel à 2 membres, ressources dédiées largement ouvertes — se place trivialement.
 * Chaque membre a son propre groupe d'étudiants (GGM1/GGM2, distincts) : un groupe "parallel"
 * place ses membres au même instant sur des ressources DIFFÉRENTES (deux sous-activités
 * simultanées), jamais sur la même ressource partagée (`_tryParallelAt` de TaskGroupUnit
 * l'exclut explicitement via son ensemble `claimed`).
 */
function buildGroupScenario(): RawScheduleData {
  return {
    week: 10,
    resources: [
      { resourceType: 'teacher', resources: [{ id: 'TGM1' }, { id: 'TGM2' }] },
      { resourceType: 'room', resources: [{ id: 'RGM1' }, { id: 'RGM2' }] },
      { resourceType: 'group', resources: [{ id: 'GGM1' }, { id: 'GGM2' }] },
    ],
    courses: [
      {
        id: 'GM1', week: 10, semester: 1, level: 0, code: 'GM1', type: 'TD', name: 'Membre 1',
        teacher: ['TGM1'], groups: ['GGM1'], rooms: ['RGM1'], duration: 60, taskGroupId: 'GRP1',
      },
      {
        id: 'GM2', week: 10, semester: 1, level: 0, code: 'GM2', type: 'TD', name: 'Membre 2',
        teacher: ['TGM2'], groups: ['GGM2'], rooms: ['RGM2'], duration: 60, taskGroupId: 'GRP1',
      },
    ],
    constraints: {
      TGM1: [{ days: 'lundi', from: '08:00', to: '19:30' }],
      TGM2: [{ days: 'lundi', from: '08:00', to: '19:30' }],
      RGM1: [{ days: 'lundi', from: '08:00', to: '19:30' }],
      RGM2: [{ days: 'lundi', from: '08:00', to: '19:30' }],
      GGM1: [{ days: 'lundi', from: '08:00', to: '19:30' }],
      GGM2: [{ days: 'lundi', from: '08:00', to: '19:30' }],
    },
    groups: [{ id: 'GRP1', type: 'parallel' }],
  };
}

/**
 * Groupe parallel occupant la salle A (via son membre GX1) + U2, victime bloquée sur cette
 * même salle A. Membres du groupe sur des groupes d'étudiants distincts (GGX1/GGX2) — voir
 * le commentaire de buildGroupScenario().
 */
function buildGroupOccupantScenario(): RawScheduleData {
  return {
    week: 10,
    resources: [
      { resourceType: 'teacher', resources: [{ id: 'TGX1' }, { id: 'TGX2' }, { id: 'TU2' }] },
      { resourceType: 'room', resources: [{ id: 'A' }, { id: 'C' }] },
      { resourceType: 'group', resources: [{ id: 'GGX1' }, { id: 'GGX2' }, { id: 'GU2' }] },
    ],
    courses: [
      {
        id: 'GX1', week: 10, semester: 1, level: 0, code: 'GX1', type: 'TD', name: 'Membre A',
        teacher: ['TGX1'], groups: ['GGX1'], rooms: ['A'], duration: 60, taskGroupId: 'GRP2',
      },
      {
        id: 'GX2', week: 10, semester: 1, level: 0, code: 'GX2', type: 'TD', name: 'Membre C',
        teacher: ['TGX2'], groups: ['GGX2'], rooms: ['C'], duration: 60, taskGroupId: 'GRP2',
      },
      {
        id: 'U2', week: 10, semester: 1, level: 0, code: 'U2', type: 'TD', name: 'Victime',
        teacher: ['TU2'], groups: ['GU2'], rooms: ['A'], duration: 90,
      },
    ],
    constraints: {
      TGX1: [{ days: 'lundi', from: '08:00', to: '19:30' }],
      TGX2: [{ days: 'lundi', from: '08:00', to: '19:30' }],
      TU2:  [{ days: 'lundi', from: '08:00', to: '10:00' }],
      A:    [{ days: 'lundi', from: '08:00', to: '19:30' }],
      C:    [{ days: 'lundi', from: '08:00', to: '19:30' }],
      GGX1: [{ days: 'lundi', from: '08:00', to: '19:30' }],
      GGX2: [{ days: 'lundi', from: '08:00', to: '19:30' }],
      GU2:  [{ days: 'lundi', from: '08:00', to: '19:30' }],
    },
    groups: [{ id: 'GRP2', type: 'parallel' }],
  };
}

/** Tâche isolée, sans conflit — pour le cas no-op (aucune neutralisée). */
function buildTrivialScenario(): RawScheduleData {
  return {
    week: 10,
    resources: [
      { resourceType: 'teacher', resources: [{ id: 'T1' }] },
      { resourceType: 'room', resources: [] },
      { resourceType: 'group', resources: [{ id: 'G1' }] },
    ],
    courses: [
      {
        id: 'X', week: 10, semester: 1, level: 0, code: 'X', type: 'TD', name: 'Simple',
        teacher: ['T1'], groups: ['G1'], rooms: [], duration: 60,
      },
    ],
    constraints: {
      T1: [{ days: 'lundi', from: '08:00', to: '19:30' }],
      G1: [{ days: 'lundi', from: '08:00', to: '19:30' }],
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Scheduler.repairNeutralized() — réparation post-résolution (docs/PlanPostRepair.md §4)', () => {
  it('a. swap dirigé : O rebooké sur B au même start, U placée en A, neutralizedUnits vidé', () => {
    Loader.loadFromRawData(buildSwapScenario());
    const scheduler = new InspectableScheduler();
    const preResult = buildNeutralizedResult(scheduler, ['U']);

    expect(preResult.solutions).toHaveLength(1);
    expect(preResult.solutions[0].resources.map(r => r.id).sort()).toEqual(['A', 'GO', 'TO'].sort());

    const repaired = scheduler.repairNeutralized(preResult);

    expect(repaired.neutralizedUnits).toHaveLength(0);
    expect(repaired.solutions).toHaveLength(2);

    const oSol = repaired.solutions.find(s => s.unit.id === 'O')!;
    const uSol = repaired.solutions.find(s => s.unit.id === 'U')!;
    expect(oSol.start).toBe(480);
    expect(oSol.resources.map(r => r.id).sort()).toEqual(['B', 'GO', 'TO'].sort());
    expect(uSol.start).toBe(480);
    expect(uSol.resources.map(r => r.id).sort()).toEqual(['A', 'GU', 'TU'].sort());
  });

  it('b. start constant : swap refusé quand le combo alternatif ne peut démarrer au même instant', () => {
    Loader.loadFromRawData(buildStartConstantScenario());
    const scheduler = new InspectableScheduler();
    const preResult = buildNeutralizedResult(scheduler, ['U']);

    const repaired = scheduler.repairNeutralized(preResult);

    expect(repaired.neutralizedUnits).toHaveLength(1);
    expect(repaired.neutralizedUnits![0].unit.id).toBe('U');
    expect(repaired.solutions).toHaveLength(1);
    expect(repaired.solutions[0].resources.map(r => r.id).sort()).toEqual(['A', 'GO', 'TO'].sort()); // O inchangé
  });

  it('c. filtres : maxDailyMinutes empêche la réparation même quand un swap serait sinon possible', () => {
    Loader.loadFromRawData(buildDailyLimitScenario());
    const scheduler = new InspectableScheduler();
    const preResult = buildNeutralizedResult(scheduler, ['U']);

    const repaired = scheduler.repairNeutralized(preResult);

    expect(repaired.neutralizedUnits).toHaveLength(1);
    expect(repaired.solutions).toHaveLength(1);
    expect(repaired.solutions[0].resources.map(r => r.id).sort()).toEqual(['A', 'GO', 'TO'].sort()); // O inchangé
  });

  it('d. point fixe / cascade : D (dépend de U) est placée une fois U replacée, après la fin de U', () => {
    Loader.loadFromRawData(buildCascadeScenario());
    const scheduler = new InspectableScheduler();
    const preResult = buildNeutralizedResult(scheduler, ['U', 'D']);

    const repaired = scheduler.repairNeutralized(preResult);

    expect(repaired.neutralizedUnits).toHaveLength(0);
    const uSol = repaired.solutions.find(s => s.unit.id === 'U')!;
    const dSol = repaired.solutions.find(s => s.unit.id === 'D')!;
    expect(uSol.start).toBe(480);
    expect(dSol.start).toBe(uSol.start + 90);
  });

  it('e. groupe neutralisé : replacé par sondage direct, toSolutions génère une entrée par membre', () => {
    Loader.loadFromRawData(buildGroupScenario());
    const scheduler = new InspectableScheduler();
    const preResult = buildNeutralizedResult(scheduler, ['GRP1']);

    expect(preResult.solutions).toHaveLength(0);

    const repaired = scheduler.repairNeutralized(preResult);

    expect(repaired.neutralizedUnits).toHaveLength(0);
    expect(repaired.solutions).toHaveLength(2);
    const codes = repaired.solutions.map(s => s.task?.code).sort();
    expect(codes).toEqual(['GM1', 'GM2']);
    for (const sol of repaired.solutions) expect(sol.start).toBe(480);
  });

  it("f. occupant groupe exclu : aucun swap tenté (getComboCount() === 1), U reste neutralisée", () => {
    Loader.loadFromRawData(buildGroupOccupantScenario());
    const scheduler = new InspectableScheduler();
    const preResult = buildNeutralizedResult(scheduler, ['U2']);

    expect(preResult.solutions).toHaveLength(2); // les 2 membres du groupe

    const repaired = scheduler.repairNeutralized(preResult);

    expect(repaired.neutralizedUnits).toHaveLength(1);
    expect(repaired.neutralizedUnits![0].unit.id).toBe('U2');
    expect(repaired.solutions).toHaveLength(2); // inchangé, aucun swap tenté
  });

  it("g. restauration d'état : succès (swap) comme échec, l'instance revient à l'état exact pré-appel", () => {
    Loader.loadFromRawData(buildSwapScenario());
    const scheduler = new InspectableScheduler();
    const preResult = buildNeutralizedResult(scheduler, ['U']);

    const rm = Loader.resourcesManager;
    const witnessIds = ['TO', 'TU', 'A', 'B', 'GO', 'GU'];
    const before = witnessIds.map(id => rm.getResource(id)!.availability.getAvailableIntervals());

    scheduler.repairNeutralized(preResult); // succès : swap + placement de U

    const after = witnessIds.map(id => rm.getResource(id)!.availability.getAvailableIntervals());
    expect(after).toEqual(before);
  });

  it("g. restauration d'état : cas d'échec (aucune réparation possible) aussi restauré à l'identique", () => {
    Loader.loadFromRawData(buildGroupOccupantScenario());
    const scheduler = new InspectableScheduler();
    const preResult = buildNeutralizedResult(scheduler, ['U2']);

    const rm = Loader.resourcesManager;
    const witnessIds = ['TGX1', 'TGX2', 'TU2', 'A', 'C', 'GGX1', 'GGX2', 'GU2'];
    const before = witnessIds.map(id => rm.getResource(id)!.availability.getAvailableIntervals());

    scheduler.repairNeutralized(preResult); // échec : U2 reste neutralisée

    const after = witnessIds.map(id => rm.getResource(id)!.availability.getAvailableIntervals());
    expect(after).toEqual(before);
  });

  it('h. no-op : un résultat sans neutralisées est retourné tel quel (même référence)', () => {
    Loader.loadFromRawData(buildTrivialScenario());
    const scheduler = new InspectableScheduler();
    scheduler.initSolver();
    const results = scheduler.solve();
    const result = results[0];
    expect(result.neutralizedUnits ?? []).toHaveLength(0);

    const repaired = scheduler.repairNeutralized(result);

    expect(repaired).toBe(result);
  });

  it('h. dégénéré : un résultat sans aucun round abouti (isComplete: false, solutions vides) est refusé tel quel', () => {
    // Reproduit la forme EXACTE de la branche « solution partielle vide » de solveWithElimination
    // (scheduler.ts) : solutions: [], isComplete: false, neutralizedUnits = les seules éliminées
    // (sous-ensemble STRICT des non-placées). Sans la garde, repairNeutralized « placerait » les
    // éliminées sur un planning vide — pseudo-résultat trompeur (revue Fable, bug corrigé).
    Loader.loadFromRawData(buildSwapScenario());
    const scheduler = new InspectableScheduler();
    scheduler.initSolver();
    const excluded = scheduler.excludeUnits(new Set(['U']));
    const degenerate: SchedulerSolution = {
      solutions: [],
      isComplete: false,
      score: 0,
      neutralizedUnits: excluded.map(unit => ({ unit, eliminationRound: 1, failureCount: 1, reason: 'test' })),
    };

    const rm = Loader.resourcesManager;
    const before = ['A', 'B'].map(id => rm.getResource(id)!.availability.getAvailableIntervals());

    const repaired = scheduler.repairNeutralized(degenerate);

    expect(repaired).toBe(degenerate); // no-op strict — jamais de « réparation » sur planning vide
    const after = ['A', 'B'].map(id => rm.getResource(id)!.availability.getAvailableIntervals());
    expect(after).toEqual(before); // aucune mutation d'état
  });

  it("h. pureté : l'objet résultat d'entrée n'est jamais muté par repairNeutralized", () => {
    Loader.loadFromRawData(buildSwapScenario());
    const scheduler = new InspectableScheduler();
    const preResult = buildNeutralizedResult(scheduler, ['U']);

    const solutionsLengthBefore = preResult.solutions.length;
    const neutralizedLengthBefore = preResult.neutralizedUnits!.length;
    const oResourcesBefore = preResult.solutions[0].resources.map(r => r.id).sort();

    scheduler.repairNeutralized(preResult);

    expect(preResult.solutions).toHaveLength(solutionsLengthBefore);
    expect(preResult.neutralizedUnits).toHaveLength(neutralizedLengthBefore);
    // Toujours [A, GO, TO] — pas [B, GO, TO] : l'entrée originale n'a pas été réécrite en place.
    expect(preResult.solutions[0].resources.map(r => r.id).sort()).toEqual(oResourcesBefore);
  });

  it('h. déterminisme : deux appels sur les mêmes données produisent des résultats structurellement identiques', () => {
    Loader.loadFromRawData(buildSwapScenario());
    const scheduler = new InspectableScheduler();
    const preResult = buildNeutralizedResult(scheduler, ['U']);

    const extract = (r: SchedulerSolution) => ({
      neutralizedIds: (r.neutralizedUnits ?? []).map(n => n.unit.id).sort(),
      solutions: r.solutions
        .map(s => ({ id: s.unit.id, start: s.start, resources: s.resources.map(res => res.id).sort() }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    });

    const repaired1 = scheduler.repairNeutralized(preResult);
    const repaired2 = scheduler.repairNeutralized(preResult);

    expect(extract(repaired2)).toEqual(extract(repaired1));
  });
});
