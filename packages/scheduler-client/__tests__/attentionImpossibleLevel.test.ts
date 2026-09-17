import { describe, it, expect } from 'vitest';
import { AvailabilityManager } from '@edt-ts/scheduler-common';
import type { CourseTaskDataWithId } from '@/lib/courseId';
import { analyzeConstraints } from '@/lib/taskConstraintAnalysis';
import { lunchFromConfig, type FeasibilityContext, type EnforcedOccupancy } from '@/lib/courseFeasibilityAnalysis';

// ---------------------------------------------------------------------------
// §4.1 de docs/PlanDiagnosticEchec.md — le niveau `impossible` de l'onglet « Attention ».
//
// Point central : `impossible` et `tight`/`critical` ne mesurent pas la même chose. Le second est
// un ratio de volume déclaratif, le premier un verdict exact sur les créneaux réels. Un cours peut
// donc être infaisable ET faiblement chargé — c'est le cas réel qui a motivé ce chantier (sur
// GEA 87 S40, le seul cours infaisable ressortait « tendu » au milieu de 79 autres).
// ---------------------------------------------------------------------------

const ALL_WEEK = [{ days: 'lundi, mardi, mercredi, jeudi, vendredi', from: '08:00', to: '18:00' }];

function course(id: string, over: Partial<CourseTaskDataWithId> = {}): CourseTaskDataWithId {
  return {
    id, source: 'csv', week: 40, semester: 1, level: 1, code: 'R1.01', name: 'Cours', type: 'CM',
    teacher: ['PROF'], groups: ['GRP'], rooms: ['SALLE'], duration: 120,
    ...over,
  } as CourseTaskDataWithId;
}

function context(
  constraints: Record<string, unknown>,
  occupancy: Map<string, EnforcedOccupancy[]>,
): FeasibilityContext {
  return {
    am: new AvailabilityManager(constraints as never),
    weekNumber: 40,
    groupIds: new Set(['GRP']),
    lunch: lunchFromConfig(undefined),
    occupancy,
    constrainedIds: new Set(Object.keys(constraints).filter((k) => k !== 'Default')),
  };
}

describe('analyzeConstraints — niveau impossible', () => {
  const constraints = { Default: ALL_WEEK };

  it('sans contexte de faisabilité, le comportement est celui d\'avant (aucun impossible)', () => {
    const courses = [course('c1')];
    const am = new AvailabilityManager(constraints as never);
    const result = analyzeConstraints(courses, am, 40);
    expect(result.taskInfos.every((t) => t.level !== 'impossible')).toBe(true);
    expect(result.hasImpossible).toBe(false);
  });

  it('un cours dont la salle est occupée partout ressort impossible', () => {
    // La salle est prise toute la semaine par un imposé : plus aucun créneau ne convient.
    const occupancy = new Map<string, EnforcedOccupancy[]>([
      ['SALLE', Array.from({ length: 5 }, (_, day) => ({
        resourceId: 'SALLE', start: day * 1440 + 8 * 60, end: day * 1440 + 18 * 60,
        code: 'BLOQ', type: 'CM',
      }))],
    ]);
    const courses = [course('c1')];
    const am = new AvailabilityManager(constraints as never);
    const result = analyzeConstraints(
      courses, am, 40, [], null, 0.5, 1.0, context(constraints, occupancy), new Set(),
    );

    expect(result.hasImpossible).toBe(true);
    const info = result.taskInfos.find((t) => t.courseKey === 'c1')!;
    expect(info.level).toBe('impossible');
    expect(info.slotDiagnosis?.feasible).toBe(false);
  });

  it('impossible prime sur le fillRatio, et le cours n\'apparaît qu\'une fois', () => {
    // Demande dérisoire (2h sur une semaine entière) ⇒ le ratio dirait « ok ».
    const occupancy = new Map<string, EnforcedOccupancy[]>([
      ['SALLE', Array.from({ length: 5 }, (_, day) => ({
        resourceId: 'SALLE', start: day * 1440 + 8 * 60, end: day * 1440 + 18 * 60,
        code: 'BLOQ', type: 'CM',
      }))],
    ]);
    const courses = [course('c1')];
    const am = new AvailabilityManager(constraints as never);

    const withoutFeasibility = analyzeConstraints(courses, am, 40, [], null, 0.5, 1.0);
    expect(withoutFeasibility.taskInfos[0].level).toBe('ok');   // le ratio seul ne voit rien

    const withFeasibility = analyzeConstraints(
      courses, am, 40, [], null, 0.5, 1.0, context(constraints, occupancy), new Set(),
    );
    const matches = withFeasibility.taskInfos.filter((t) => t.courseKey === 'c1');
    expect(matches).toHaveLength(1);
    expect(matches[0].level).toBe('impossible');
    // Les motifs de tension sont remplacés, pas empilés : une seule ligne, actionnable.
    expect(matches[0].reasons).toHaveLength(1);
    expect(matches[0].reasons[0]).toContain('Aucun créneau possible');
  });

  it('un cours imposé est exclu du verdict : il ignore les disponibilités par construction', () => {
    const occupancy = new Map<string, EnforcedOccupancy[]>([
      ['SALLE', Array.from({ length: 5 }, (_, day) => ({
        resourceId: 'SALLE', start: day * 1440 + 8 * 60, end: day * 1440 + 18 * 60,
        code: 'BLOQ', type: 'CM',
      }))],
    ]);
    const courses = [course('c1')];
    const am = new AvailabilityManager(constraints as never);
    const result = analyzeConstraints(
      courses, am, 40, [], null, 0.5, 1.0, context(constraints, occupancy), new Set(['c1']),
    );
    expect(result.taskInfos[0].level).not.toBe('impossible');
    expect(result.hasImpossible).toBe(false);
  });
});
