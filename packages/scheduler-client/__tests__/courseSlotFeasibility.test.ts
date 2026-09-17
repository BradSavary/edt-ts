import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AvailabilityManager } from '@edt-ts/scheduler-common';
import type { CourseTaskData } from '@edt-ts/scheduler-common';
import {
  diagnoseCourseSlots,
  explainNoSlot,
  buildEnforcedOccupancy,
  lunchFromConfig,
  type FeasibilityContext,
  type EnforcedOccupancy,
} from '@/lib/courseFeasibilityAnalysis';

// ---------------------------------------------------------------------------
// Verrou de la duplication TS/Python (§3.3 de docs/PlanDiagnosticEchec.md).
//
// Le même calcul existe en deux exemplaires : ici, et dans `_diagnose_slots`
// (cpsat_engine.py). Ce test et son jumeau `test_feasibility_fixture.py` consomment la MÊME
// fixture. S'ils divergent, l'un des deux casse — c'est tout l'intérêt.
// ---------------------------------------------------------------------------

interface FixtureCase {
  courseId: string;
  label: string;
  expected: {
    feasible: boolean;
    slotCount: number;
    levers: {
      kind: string; ids: string[]; inheritsDefault: boolean; slots: number[];
      blockedBy: { code: string; type: string; start: number; end: number }[];
    }[];
  };
}

const fixturePath = path.resolve(__dirname, '../../../docs/fixtures/feasibility-s40.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as {
  week: number;
  lunch: { from: string; to: string };
  groupIds: string[];
  constraints: Record<string, unknown>;
  courses: (CourseTaskData & { id: string; enforced?: { startTime: number; teacher: string[]; groups: string[]; rooms: string[] } })[];
  cases: FixtureCase[];
};

function buildContext(): FeasibilityContext {
  const occupancy = new Map<string, EnforcedOccupancy[]>();
  for (const c of fixture.courses) {
    if (!c.enforced) continue;
    const start = c.enforced.startTime;
    const end = start + c.duration;
    for (const id of [...c.enforced.teacher, ...c.enforced.groups, ...c.enforced.rooms]) {
      const list = occupancy.get(id) ?? [];
      list.push({ resourceId: id, start, end, code: c.code, type: c.type });
      occupancy.set(id, list);
    }
  }
  return {
    am: new AvailabilityManager(fixture.constraints as never),
    weekNumber: fixture.week,
    groupIds: new Set(fixture.groupIds),
    lunch: lunchFromConfig({ type: 'fixed', from: fixture.lunch.from, to: fixture.lunch.to }),
    occupancy,
    constrainedIds: new Set(Object.keys(fixture.constraints).filter((k) => k !== 'Default')),
  };
}

const courseById = new Map(fixture.courses.map((c) => [c.id, c]));

describe('diagnoseCourseSlots — fixture partagée avec le moteur Python', () => {
  const ctx = buildContext();

  for (const testCase of fixture.cases) {
    it(`${testCase.label} (${testCase.courseId})`, () => {
      const course = courseById.get(testCase.courseId)!;
      const diagnosis = diagnoseCourseSlots(course, ctx);

      expect(diagnosis.feasible).toBe(testCase.expected.feasible);
      expect(diagnosis.slotCount).toBe(testCase.expected.slotCount);
      expect(
        diagnosis.levers.map((l) => ({
          kind: l.entry.kind,
          ids: l.entry.ids,
          inheritsDefault: l.entry.inheritsDefault,
          slots: l.slots,
          blockedBy: l.blockedBy.map((b) => ({ code: b.code, type: b.type, start: b.start, end: b.end })),
        })),
      ).toEqual(testCase.expected.levers);
    });
  }

  // §3.2 — le cas où un message affirmatif mentirait.
  it("n'accuse personne quand aucune ressource ne suffit seule à débloquer le cours", () => {
    const course = courseById.get('synth-no-lever')!;
    const diagnosis = diagnoseCourseSlots(course, ctx);

    expect(diagnosis.feasible).toBe(false);
    expect(diagnosis.levers).toEqual([]);

    const message = explainNoSlot(diagnosis, course.duration);
    expect(message).toContain('aucune ressource ne suffit seule');
    // Aucune formulation du type « sans X, le cours tiendrait » : ce serait faux ici.
    expect(message).not.toContain('sans ');
  });

  // §3.3.1 — décision Frédéric : nommer l'héritage plutôt que laisser chercher une contrainte
  // qui n'existe pas (79 ressources dans ce cas sur la S40).
  it("signale qu'une ressource bloquante sans contrainte propre hérite du Défaut", () => {
    const course = courseById.get('19zf4jd')!;
    const diagnosis = diagnoseCourseSlots(course, ctx);

    expect(diagnosis.levers).toHaveLength(1);
    expect(diagnosis.levers[0].entry.ids).toEqual(['AMPHI B']);
    expect(diagnosis.levers[0].entry.inheritsDefault).toBe(true);
    // La ressource doit être NOMMÉE dans la mention : la parenthèse suit le cours imposé, donc
    // une formulation anonyme se rattache visuellement à lui (retour de test Frédéric).
    expect(explainNoSlot(diagnosis, course.duration))
      .toContain("AMPHI B n'a pas de contrainte spécifique, hérite des contraintes par Défaut");
  });

  it('ouvre la seconde phrase par une majuscule', () => {
    const course = courseById.get('19zf4jd')!;
    const message = explainNoSlot(diagnoseCourseSlots(course, ctx), course.duration);
    expect(message).toContain('calendrier. Sans ');
  });

  it('nomme le cours imposé qui occupe le dernier créneau', () => {
    const course = courseById.get('19zf4jd')!;
    const message = explainNoSlot(diagnoseCourseSlots(course, ctx), course.duration);
    expect(message).toContain('AMPHI B');
    expect(message).toContain('jeudi 08h30–12h30');
    expect(message).toContain('R3.GEMA.14 CM');
  });
});

describe('pause méridienne — groupes seulement (§3.1)', () => {
  // Divergence la plus probable avec le moteur, parce qu'elle est contre-intuitive :
  // `_make_availability` ne carve la pause que sous `if rid in group_ids`.
  const constraints = {
    Default: [{ days: 'lundi', from: '08:00', to: '18:00' }],
  };
  const course: CourseTaskData = {
    week: 40, semester: 1, level: 1, code: 'X', name: 'X', type: 'CM',
    teacher: ['PROF'], groups: [], rooms: [], duration: 240,
  } as CourseTaskData;

  function ctxWith(groupIds: string[]): FeasibilityContext {
    return {
      am: new AvailabilityManager(constraints as never),
      weekNumber: 40,
      groupIds: new Set(groupIds),
      lunch: { from: 12 * 60, to: 13 * 60 + 30 },
      occupancy: new Map(),
      constrainedIds: new Set(),
    };
  }

  it("ne réduit pas les fenêtres d'un enseignant", () => {
    // 08:00–18:00 sans coupure ⇒ un bloc de 4h tient largement, y compris à cheval sur midi.
    const diagnosis = diagnoseCourseSlots(course, ctxWith([]));
    expect(diagnosis.feasible).toBe(true);
    // Débuts de 08:00 à 14:00 inclus, pas de 30 min.
    expect(diagnosis.slotCount).toBe(13);
  });

  it('réduit les fenêtres du même id traité comme un groupe', () => {
    // Même ressource, même dispo : seul son classement en groupe change le verdict.
    const diagnosis = diagnoseCourseSlots(course, ctxWith(['PROF']));
    // Reste 08:00–12:00 (trop court pour 4h… tout juste) et 13:30–18:00.
    expect(diagnosis.slotCount).toBeLessThan(13);
  });
});
