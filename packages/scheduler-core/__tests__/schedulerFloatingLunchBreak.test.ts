import { describe, it, expect } from 'vitest';
import type { RawScheduleData } from '@edt-ts/scheduler-common';
import { Resource, ResourceType } from '@edt-ts/scheduler-common';
import { Loader } from '../src/loader.js';
import { Scheduler } from '../src/scheduler.js';
import type { ISchedulingUnit, SchedulingResult } from '../src/schedulingUnit.js';

/** Expose _units (protected) pour inspection directe dans les tests — même pattern que les diagnostics. */
class InspectableScheduler extends Scheduler {
  public getUnits(): ISchedulingUnit[] { return this._units; }
}

/**
 * Sonde pour tester `_floatingLBAllows` / `_resourceKeepsFloatingBreak` directement, sans
 * passer par Loader/initSolver/solve() : injecte la config de pause et les cours déjà
 * "placés" (`_solution`) à la main. `_floatingLB` est private → cast `as any` nécessaire
 * pour l'injection ; `_solution` et `_floatingLBAllows` sont protected, accessibles tels quels.
 */
class ProbeScheduler extends Scheduler {
  setFloatingLB(earliestMin: number, latestMin: number, duration: number): void {
    (this as any)._floatingLB = { earliestMin, latestMin, duration };
  }
  /** Simule un cours déjà placé sur `resource` pour [start, start+duration). */
  bookFake(resource: Resource, start: number, duration: number): void {
    const unit = { id: `fake-${this._solution.length}`, duration, isEnforced: false } as unknown as ISchedulingUnit;
    const result: SchedulingResult = { start, resources: [resource] };
    this._solution.push({ unit, result });
  }
  allows(resource: Resource, start: number, duration: number): boolean {
    return this._floatingLBAllows({ start, resources: [resource] }, duration);
  }
}

/**
 * Groupe G1 disponible 8h-17h le lundi (une seule fenêtre large, avant découpage) —
 * exactement le scénario qui motive §5.5 : sans pause flottante prise en compte au
 * calcul du score, cette fenêtre paraît uniformément disponible.
 */
function buildScenario(): RawScheduleData {
  return {
    week: 20,
    resources: [
      { resourceType: 'teacher', resources: [{ id: 'T1' }] },
      { resourceType: 'group', resources: [{ id: 'G1' }] },
      { resourceType: 'room', resources: [] },
    ],
    courses: [
      { week: 20, semester: 1, level: 0, code: 'Y1', type: 'TD', name: 'Test pause flottante', teacher: ['T1'], groups: ['G1'], rooms: [], duration: 120 },
    ],
    constraints: {
      T1: [{ days: 'lundi', from: '08:00', to: '19:30' }],
      G1: [{ days: 'lundi', from: '08:00', to: '17:00' }],
    },
  };
}

describe('Scheduler — pause méridienne flottante (§5.5)', () => {
  it('propage la config de pause flottante jusqu\'aux unités et planifie sans erreur', () => {
    Loader.loadFromRawData(buildScenario());
    const scheduler = new InspectableScheduler();
    scheduler.configure({ lunchBreak: { type: 'floating', earliest: '11:30', latest: '14:30', duration: 90 } });
    scheduler.initSolver();

    const units = scheduler.getUnits();
    expect(units).toHaveLength(1);
    // 120min tient dans chacune des deux moitiés issues du découpage (255min et 195min) —
    // score fini (pas infaisable), confirme que la config a bien été propagée et appliquée.
    expect(units[0].getSchedulingPriority()).toBeGreaterThan(-Infinity);

    const results = scheduler.solve();
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].isComplete).toBe(true);
    expect(results[0].solutions).toHaveLength(1);
  });

  it('sans pause flottante configurée (type "none"), le comportement reste inchangé', () => {
    Loader.loadFromRawData(buildScenario());
    const scheduler = new InspectableScheduler();
    scheduler.initSolver(); // config par défaut : lunchBreak: { type: 'none' }

    const units = scheduler.getUnits();
    const results = scheduler.solve();
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].solutions).toHaveLength(1);
    expect(units[0].getSchedulingPriority()).toBeGreaterThan(-Infinity);
  });

  it('une journée trop courte pour la fenêtre de pause reste utilisable (cas réel semaine 37 : jeudi 8h-12h30 vs pause 12h-14h)', () => {
    // Le groupe n'est disponible que 8h-12h30 (270min) le lundi ; la fenêtre de pause
    // flottante est 12h-14h (120min) — chevauchement réel de seulement 30min, bien
    // moins que les 90min de pause requises. Avant correctif, _resourceKeepsFloatingBreak
    // rejetait TOUT placement ce jour-là (aucun horaire ne peut jamais garder 90min
    // libres dans une fenêtre qui n'en offre que 30) — la journée entière disparaissait
    // silencieusement des solutions, quel que soit le cours testé.
    const scenario: RawScheduleData = {
      week: 21,
      resources: [
        { resourceType: 'teacher', resources: [{ id: 'T2' }] },
        { resourceType: 'group', resources: [{ id: 'G2' }] },
        { resourceType: 'room', resources: [] },
      ],
      courses: [
        { week: 21, semester: 1, level: 0, code: 'Y2', type: 'TD', name: 'Test journée courte', teacher: ['T2'], groups: ['G2'], rooms: [], duration: 60 },
      ],
      constraints: {
        T2: [{ days: 'lundi', from: '08:00', to: '19:30' }],
        G2: [{ days: 'lundi', from: '08:00', to: '12:30' }],
      },
    };

    Loader.loadFromRawData(scenario);
    const scheduler = new Scheduler();
    scheduler.configure({ lunchBreak: { type: 'floating', earliest: '12:00', latest: '14:00', duration: 90 } });
    scheduler.initSolver();

    const results = scheduler.solve();
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].isComplete).toBe(true);
    expect(results[0].solutions).toHaveLength(1);
    // Le placement doit tomber dans la fenêtre 8h-12h30 (480-750), pas ailleurs.
    expect(results[0].solutions[0].start).toBeGreaterThanOrEqual(480);
    expect(results[0].solutions[0].start).toBeLessThan(750);
  });
});

describe('Scheduler — _floatingLBAllows / _resourceKeepsFloatingBreak (§5.1, plan trou-sans-cours)', () => {
  // Fenêtre 12:00-14:00 (720-840 min), duration 90 — jour 0 (lundi), constants réutilisées
  // dans tous les cas ci-dessous. Le nouveau modèle ne lit plus resource.availability : les
  // disponibilités déclarées n'ont donc pas besoin d'être posées sur `resource` pour ces tests,
  // seul `_solution` (cours réellement placés) est consulté.
  const EARLIEST = 720, LATEST = 840, DURATION = 90;

  function makeGroup(): Resource {
    return new Resource('G1', ResourceType.GROUP);
  }

  it('1. dispo continue, aucun cours placé → autorisé', () => {
    const s = new ProbeScheduler();
    s.setFloatingLB(EARLIEST, LATEST, DURATION);
    const g = makeGroup();
    // Slot testé hors fenêtre (8h-9h) : rien n'est réservé nulle part.
    expect(s.allows(g, 480, 60)).toBe(true);
  });

  it("2. trou d'indisponibilité 12:30-13:30 dans la fenêtre, aucun cours réservé → autorisé (cas qui échouait avant correctif)", () => {
    const s = new ProbeScheduler();
    s.setFloatingLB(EARLIEST, LATEST, DURATION);
    const g = makeGroup();
    // L'indisponibilité déclarée n'est jamais représentée dans _solution : elle compte
    // naturellement comme pause. Aucun cours placé → fenêtre entière libre.
    expect(s.allows(g, 480, 60)).toBe(true);
  });

  it('3. cours placé à 15:00 (hors fenêtre), disponibilité par ailleurs scindée par un trou de 30min → autorisé (bug catastrophique corrigé)', () => {
    const s = new ProbeScheduler();
    s.setFloatingLB(EARLIEST, LATEST, DURATION);
    const g = makeGroup();
    // C'est ce placement précis (15:00-16:00, hors fenêtre) que l'ancien garde-fou
    // (totalOverlap sur dispo déclarée scindée) pouvait bloquer à tort un jour entier.
    expect(s.allows(g, 900, 60)).toBe(true);
  });

  it('4. cours 11:00-12:30 (empiète 30min sur la fenêtre) → autorisé, complément 12:30-14:00 = 90', () => {
    const s = new ProbeScheduler();
    s.setFloatingLB(EARLIEST, LATEST, DURATION);
    const g = makeGroup();
    // Le placement lui-même (660-750) ne consomme que sa portion intra-fenêtre (720-750) ;
    // le complément 750-840 (=90) reste ≥ duration.
    expect(s.allows(g, 660, 90)).toBe(true);
  });

  it('5. cours 13:30-15:00 (empiète 30min), matin fini à 12:00 → autorisé, complément 12:00-13:30 = 90', () => {
    const s = new ProbeScheduler();
    s.setFloatingLB(EARLIEST, LATEST, DURATION);
    const g = makeGroup();
    // Portion intra-fenêtre du placement : 810-840 ; complément 720-810 (=90) reste ≥ duration.
    expect(s.allows(g, 810, 90)).toBe(true);
  });

  it('6. fenêtre saturée par deux cours contigus (12:00-13:00 + 13:00-14:00) → refusé', () => {
    const s = new ProbeScheduler();
    s.setFloatingLB(EARLIEST, LATEST, DURATION);
    const g = makeGroup();
    s.bookFake(g, 720, 60); // 12:00-13:00 déjà placé
    // Le slot testé (13:00-14:00) intersecte la fenêtre : c'est ce placement précis qui
    // saturerait la fenêtre (plus aucun trou ≥ 90) → doit être refusé.
    expect(s.allows(g, 780, 60)).toBe(false);
  });

  it("7. jour court (groupe indisponible tout l'après-midi) → autorisé, pas de pause à protéger", () => {
    const s = new ProbeScheduler();
    s.setFloatingLB(EARLIEST, LATEST, DURATION);
    const g = makeGroup();
    // Aucun cours ne peut être placé l'après-midi (indisponibilité déclarée, non modélisée
    // dans _solution) → la fenêtre reste entièrement libre, comme les cas 1/2.
    expect(s.allows(g, 480, 60)).toBe(true);
  });
});
