import { describe, it, expect } from 'vitest';
import {
  detectResourceType,
  normalizeWeekKey,
  getWeekKeys,
  normalizeToRC,
  emptyDayMap,
  normalizeTimeForInput,
  slotsToDayMap,
  dayMapToSlots,
  filterResourceIds,
} from '../lib/constraintsUtils';
import type { ResourceConstraints, TimeSlot } from '@edt-ts/scheduler-common';

describe('detectResourceType', () => {
  it('retourne "other" pour "Default"', () => {
    expect(detectResourceType('Default')).toBe('other');
  });

  it('retourne "group" pour un pattern BUT1-G1', () => {
    expect(detectResourceType('BUT1-G1')).toBe('group');
    expect(detectResourceType('BUT2-G12')).toBe('group');
  });

  it('retourne "room" pour un code numérique type R101', () => {
    expect(detectResourceType('R101')).toBe('room');
    expect(detectResourceType('ADM01')).toBe('room');
    expect(detectResourceType('101')).toBe('room');
  });

  it('retourne "room" pour Amphi/Labo/Studio', () => {
    expect(detectResourceType('Amphi1')).toBe('room');
    expect(detectResourceType('Labo3')).toBe('room');
    expect(detectResourceType('Studio2')).toBe('room');
  });

  it('retourne "teacher" pour un nom en majuscule avec espace', () => {
    expect(detectResourceType('DUPONT Jean')).toBe('teacher');
    expect(detectResourceType('MARTIN Paul')).toBe('teacher');
  });

  it('retourne "other" pour un identifiant non reconnu', () => {
    expect(detectResourceType('XYZ')).toBe('other');
    expect(detectResourceType('unclassifiable')).toBe('other');
  });
});

describe('normalizeWeekKey', () => {
  it('convertit "36" en "S36"', () => {
    expect(normalizeWeekKey('36')).toBe('S36');
  });

  it('convertit "S36" en "S36" (déjà normalisé)', () => {
    expect(normalizeWeekKey('S36')).toBe('S36');
  });

  it('accepte "s36" (minuscule)', () => {
    expect(normalizeWeekKey('s36')).toBe('S36');
  });

  it('retourne la valeur brute si non reconnue', () => {
    expect(normalizeWeekKey('default')).toBe('default');
    expect(normalizeWeekKey('W36')).toBe('W36');
  });

  it('ignore les espaces autour', () => {
    expect(normalizeWeekKey('  47  ')).toBe('S47');
  });
});

describe('getWeekKeys', () => {
  it('retourne les clés de semaine sans "default"', () => {
    const rc: ResourceConstraints = { default: [], S36: [], S47: [] };
    const keys = getWeekKeys(rc);
    expect(keys).toEqual(expect.arrayContaining(['S36', 'S47']));
    expect(keys).not.toContain('default');
  });

  it('retourne [] si seul "default" est présent', () => {
    expect(getWeekKeys({ default: [] })).toEqual([]);
  });

  it('retourne [] pour un objet vide', () => {
    expect(getWeekKeys({})).toEqual([]);
  });
});

describe('normalizeToRC', () => {
  it('retourne null pour null', () => {
    expect(normalizeToRC(null)).toBeNull();
  });

  it('retourne null pour undefined', () => {
    expect(normalizeToRC(undefined)).toBeNull();
  });

  it('enveloppe un tableau TimeSlot[] dans { default: [...] }', () => {
    const slots: TimeSlot[] = [{ days: 'lundi', from: '8:00', to: '18:00' }];
    expect(normalizeToRC(slots)).toEqual({ default: slots });
  });

  it('retourne un ResourceConstraints tel quel (identité)', () => {
    const rc: ResourceConstraints = { default: [], S47: [] };
    expect(normalizeToRC(rc)).toBe(rc);
  });
});

describe('emptyDayMap', () => {
  it('retourne tous les six jours avec des tableaux vides', () => {
    const dm = emptyDayMap();
    for (const day of ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']) {
      expect(dm[day as keyof typeof dm]).toEqual([]);
    }
  });

  it('retourne un nouvel objet à chaque appel', () => {
    const a = emptyDayMap();
    const b = emptyDayMap();
    a.lundi.push({ from: '08:00', to: '18:00' });
    expect(b.lundi).toHaveLength(0);
  });
});

describe('normalizeTimeForInput', () => {
  it('complète l\'heure à 2 chiffres : "8:00" → "08:00"', () => {
    expect(normalizeTimeForInput('8:00')).toBe('08:00');
  });

  it('ne modifie pas "10:30" (déjà 2 chiffres)', () => {
    expect(normalizeTimeForInput('10:30')).toBe('10:30');
  });

  it('complète les minutes à 2 chiffres : "9:5" → "09:05"', () => {
    expect(normalizeTimeForInput('9:5')).toBe('09:05');
  });

  it('gère "0:00" → "00:00"', () => {
    expect(normalizeTimeForInput('0:00')).toBe('00:00');
  });
});

describe('slotsToDayMap', () => {
  it('distribue un slot multi-jours sur chaque jour listé', () => {
    const slots: TimeSlot[] = [
      { days: 'lundi, mardi', from: '8:00', to: '18:00' },
    ];
    const dm = slotsToDayMap(slots);
    expect(dm.lundi).toHaveLength(1);
    expect(dm.mardi).toHaveLength(1);
    expect(dm.mercredi).toHaveLength(0);
  });

  it('normalise les heures pour les inputs', () => {
    const slots: TimeSlot[] = [{ days: 'lundi', from: '8:00', to: '18:00' }];
    const dm = slotsToDayMap(slots);
    expect(dm.lundi[0]).toEqual({ from: '08:00', to: '18:00' });
  });

  it('retourne un emptyDayMap pour un tableau vide', () => {
    const dm = slotsToDayMap([]);
    expect(Object.values(dm).every((arr) => arr.length === 0)).toBe(true);
  });

  it('ignore les jours non reconnus', () => {
    const slots: TimeSlot[] = [{ days: 'sunday, lundi', from: '8:00', to: '18:00' }];
    const dm = slotsToDayMap(slots);
    expect(dm.lundi).toHaveLength(1);
    const totalSlots = Object.values(dm).reduce((acc, arr) => acc + arr.length, 0);
    expect(totalSlots).toBe(1);
  });

  it('accumule plusieurs slots sur le même jour', () => {
    const slots: TimeSlot[] = [
      { days: 'lundi', from: '8:00', to: '12:00' },
      { days: 'lundi', from: '14:00', to: '18:00' },
    ];
    const dm = slotsToDayMap(slots);
    expect(dm.lundi).toHaveLength(2);
  });
});

describe('dayMapToSlots', () => {
  it('convertit un DayMap en TimeSlot[]', () => {
    const slots: TimeSlot[] = [{ days: 'lundi', from: '08:00', to: '18:00' }];
    const dm = slotsToDayMap(slots);
    const result = dayMapToSlots(dm);
    expect(result).toEqual([{ days: 'lundi', from: '08:00', to: '18:00' }]);
  });

  it('retourne [] pour un emptyDayMap', () => {
    expect(dayMapToSlots(emptyDayMap())).toEqual([]);
  });

  it('slotsToDayMap et dayMapToSlots sont inverses l\'un de l\'autre', () => {
    const original: TimeSlot[] = [
      { days: 'lundi', from: '08:00', to: '12:00' },
      { days: 'mardi', from: '09:00', to: '17:00' },
    ];
    expect(dayMapToSlots(slotsToDayMap(original))).toEqual(original);
  });
});

describe('filterResourceIds', () => {
  const resourceWeeks: Record<string, number[]> = {
    'DUPONT Jean': [36, 47],
    'MARTIN Paul': [36],
    'BUT1-G1': [],
  };
  const ids = ['DUPONT Jean', 'MARTIN Paul', 'BUT1-G1', 'Sans Semaine'];

  it('sans filtre (week: null, search: "") retourne la liste inchangée', () => {
    expect(filterResourceIds(ids, { search: '', week: null }, resourceWeeks)).toEqual(ids);
  });

  it('filtre semaine seul : ne garde que les ids dont resourceWeeks contient la semaine', () => {
    expect(filterResourceIds(ids, { search: '', week: 36 }, resourceWeeks)).toEqual([
      'DUPONT Jean',
      'MARTIN Paul',
    ]);
  });

  it('ressource absente de resourceWeeks : exclue si une semaine est demandée, incluse sinon', () => {
    expect(filterResourceIds(['Sans Semaine'], { search: '', week: 36 }, resourceWeeks)).toEqual(
      [],
    );
    expect(filterResourceIds(['Sans Semaine'], { search: '', week: null }, resourceWeeks)).toEqual(
      ['Sans Semaine'],
    );
  });

  it('combinaison texte + semaine : ET logique', () => {
    expect(filterResourceIds(ids, { search: 'martin', week: 36 }, resourceWeeks)).toEqual([
      'MARTIN Paul',
    ]);
    expect(filterResourceIds(ids, { search: 'dupont', week: 47 }, resourceWeeks)).toEqual([
      'DUPONT Jean',
    ]);
  });

  it('la casse du texte est ignorée', () => {
    expect(filterResourceIds(ids, { search: 'dup', week: null }, resourceWeeks)).toEqual([
      'DUPONT Jean',
    ]);
  });
});
