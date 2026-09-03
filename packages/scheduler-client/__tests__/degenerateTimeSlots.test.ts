import { describe, it, expect } from 'vitest';
import { AvailabilityManager } from '@edt-ts/scheduler-common';
import type { TimeSlot } from '@edt-ts/scheduler-common';
import { dayMapToSlots, sanitizeConstraints, emptyDayMap } from '../lib/constraintsUtils';

/**
 * Non-régression : un créneau de durée nulle (`from === to`) ou inversée (`from > to`)
 * dans les contraintes faisait lever `TimeInterval` — donc plantait tout rendu d'une
 * semaine peuplée dès qu'une ressource sans contraintes propre (une salle, typiquement)
 * retombait sur les créneaux `Default`.
 */
describe('créneaux de durée nulle ou inversée', () => {
  const DEFAULT_WITH_DEGENERATE: TimeSlot[] = [
    { days: 'lundi', from: '08:30', to: '12:30' },
    { days: 'samedi', from: '08:00', to: '08:00' }, // durée nulle
    { days: 'samedi', from: '14:00', to: '14:00' }, // durée nulle
    { days: 'mardi', from: '17:00', to: '09:00' },  // inversé
  ];

  it('AvailabilityManager : le fallback Default ne lève plus sur une ressource inconnue', () => {
    const am = new AvailabilityManager({ Default: DEFAULT_WITH_DEGENERATE });

    expect(() => am.getAvailability('AMPHI B')).not.toThrow();
  });

  it('AvailabilityManager : les créneaux dégénérés sont ignorés, les valides conservés', () => {
    const am = new AvailabilityManager({ Default: DEFAULT_WITH_DEGENERATE });

    const av = am.getAvailability('AMPHI B')!;
    const intervals = av.getAvailableIntervals();

    // Seul le lundi 08:30-12:30 subsiste (lundi = jour 0)
    expect(intervals).toHaveLength(1);
    expect(intervals[0].start).toBe(8 * 60 + 30);
    expect(intervals[0].end).toBe(12 * 60 + 30);
  });

  it('AvailabilityManager : une ressource dont les contraintes sont dégénérées se construit sans lever', () => {
    expect(
      () =>
        new AvailabilityManager({
          Default: [{ days: 'lundi', from: '08:30', to: '12:30' }],
          'VILKAS Catherine': { default: [{ days: 'samedi', from: '08:00', to: '08:00' }] },
        }),
    ).not.toThrow();
  });

  it('dayMapToSlots : ne sérialise pas un créneau de durée nulle ou inversée', () => {
    const dayMap = emptyDayMap();
    dayMap.lundi.push({ from: '08:30', to: '12:30' });
    dayMap.samedi.push({ from: '08:00', to: '08:00' });
    dayMap.mardi.push({ from: '17:00', to: '09:00' });

    expect(dayMapToSlots(dayMap)).toEqual([{ days: 'lundi', from: '08:30', to: '12:30' }]);
  });

  it('sanitizeConstraints : nettoie Default, une ressource et une surcharge hebdomadaire', () => {
    const cleaned = sanitizeConstraints({
      Default: { default: DEFAULT_WITH_DEGENERATE },
      'GANDOIS Jean-Pierre': {
        default: [{ days: 'lundi', from: '08:30', to: '12:30' }],
        S39: [
          { days: 'jeudi', from: '13:30', to: '19:30' },
          { days: 'jeudi', from: '10:00', to: '10:00' },
        ],
      },
      'G1-TP1': [{ days: 'vendredi', from: '14:00', to: '14:00' }],
    });

    expect((cleaned.Default as { default: TimeSlot[] }).default).toEqual([
      { days: 'lundi', from: '08:30', to: '12:30' },
    ]);
    expect(cleaned['GANDOIS Jean-Pierre'].S39).toEqual([{ days: 'jeudi', from: '13:30', to: '19:30' }]);
    expect(cleaned['G1-TP1']).toEqual([]);
  });

  it('sanitizeConstraints : rend la MÊME référence si rien n\'est à nettoyer', () => {
    const constraints = {
      Default: { default: [{ days: 'lundi', from: '08:30', to: '12:30' }] },
      'G1-TP1': { default: [] },
      'VILKAS Catherine': null,
    };

    expect(sanitizeConstraints(constraints)).toBe(constraints);
  });
});
