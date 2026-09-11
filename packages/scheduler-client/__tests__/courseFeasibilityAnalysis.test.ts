import { describe, it, expect } from 'vitest';
import { AvailabilityManager } from '@edt-ts/scheduler-common';
import type { ConstraintsData, CourseTaskData } from '@edt-ts/scheduler-common';
import { getCourseUnschedulableReasons } from '../lib/courseFeasibilityAnalysis';

function makeManager(data: ConstraintsData): AvailabilityManager {
  return new AvailabilityManager(data);
}

function course(overrides: Partial<CourseTaskData> & { code: string; duration: number }): CourseTaskData {
  return {
    week: 30, semester: 1, level: 0, type: 'TD', name: overrides.code,
    teacher: [], groups: [], rooms: [],
    ...overrides,
  };
}

describe('getCourseUnschedulableReasons', () => {
  it('cours OK : toutes les ressources ont un créneau suffisant', () => {
    const am = makeManager({
      Default: [],
      T1: [{ days: 'lundi', from: '08:00', to: '12:00' }], // 240min
      S1: [{ days: 'lundi', from: '08:00', to: '12:00' }],
    });
    const c = course({ code: 'C1', duration: 60, teacher: ['T1'], rooms: ['S1'] });

    expect(getCourseUnschedulableReasons(c, am, 30)).toEqual([]);
  });

  it('cas A : une ressource sans aucune disponibilité déclarée bloque le cours', () => {
    const am = makeManager({
      Default: [],
      T1: [{ days: 'lundi', from: '08:00', to: '12:00' }],
      // S1 absent des contraintes ET Default vide → aucune disponibilité
    });
    const c = course({ code: 'C1', duration: 60, teacher: ['T1'], rooms: ['S1'] });

    const reasons = getCourseUnschedulableReasons(c, am, 30);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatchObject({ resourceKind: 'room', resourceIds: ['S1'], kind: 'no-availability' });
  });

  it('cas B : disponibilité présente mais toujours plus courte que la durée du cours', () => {
    const am = makeManager({
      Default: [],
      T1: [{ days: 'lundi', from: '08:00', to: '09:00' }], // 60min, cours de 4h
    });
    const c = course({ code: 'C1', duration: 240, teacher: ['T1'] });

    const reasons = getCourseUnschedulableReasons(c, am, 30);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatchObject({ resourceKind: 'teacher', resourceIds: ['T1'], kind: 'insufficient-duration' });
  });

  it('alternatives (A OU B) : une seule alternative disponible suffit à débloquer', () => {
    const am = makeManager({
      Default: [],
      T1: [], // aucune dispo
      T2: [{ days: 'lundi', from: '08:00', to: '12:00' }],
    });
    const c = course({ code: 'C1', duration: 60, teacher: [['T1', 'T2']] });

    expect(getCourseUnschedulableReasons(c, am, 30)).toEqual([]);
  });

  it('alternatives toutes bloquantes : le cours reste signalé', () => {
    const am = makeManager({
      Default: [],
      T1: [],
      T2: [{ days: 'lundi', from: '08:00', to: '09:00' }], // 60min, insuffisant pour 4h
    });
    const c = course({ code: 'C1', duration: 240, teacher: [['T1', 'T2']] });

    const reasons = getCourseUnschedulableReasons(c, am, 30);
    expect(reasons).toHaveLength(1);
    expect(reasons[0].kind).toBe('insufficient-duration');
  });

  it('override hebdomadaire : une semaine sans dispo bloque même si Default en a', () => {
    const am = makeManager({
      Default: [{ days: 'lundi', from: '08:00', to: '12:00' }],
      T1: { default: [{ days: 'lundi', from: '08:00', to: '12:00' }], S30: [] },
    });
    const c = course({ code: 'C1', duration: 60, teacher: ['T1'] });

    expect(getCourseUnschedulableReasons(c, am, 30)).toHaveLength(1);
    expect(getCourseUnschedulableReasons(c, am, 31)).toEqual([]);
  });

  it('une seule ressource bloquante sur plusieurs suffit à signaler le cours', () => {
    const am = makeManager({
      Default: [],
      T1: [{ days: 'lundi', from: '08:00', to: '12:00' }],
      G1: [{ days: 'lundi', from: '08:00', to: '12:00' }],
      // S1 absent
    });
    const c = course({ code: 'C1', duration: 60, teacher: ['T1'], groups: ['G1'], rooms: ['S1'] });

    const reasons = getCourseUnschedulableReasons(c, am, 30);
    expect(reasons).toHaveLength(1);
    expect(reasons[0].resourceKind).toBe('room');
  });
});
