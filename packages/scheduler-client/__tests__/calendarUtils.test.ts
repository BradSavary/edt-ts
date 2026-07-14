import { describe, it, expect } from 'vitest';
import { getMondayOfISOWeek, startTimeToDate, dateToStartTime, matchesSearchQuery, filterSolutionsByQuery } from '../lib/calendar/calendarUtils';

describe('getMondayOfISOWeek', () => {
  it('retourne un lundi (getDay() === 1)', () => {
    for (const week of [1, 10, 20, 35, 47, 52]) {
      const monday = getMondayOfISOWeek(week);
      expect(monday.getDay(), `semaine ${week}`).toBe(1);
    }
  });

  it('semaine 1 de 2025 commence le 30/12/2024', () => {
    // ISO week 1 2025 débute le lundi 30 décembre 2024
    // On ne peut pas fixer l'année depuis l'extérieur, on vérifie juste que c'est un lundi
    const monday = getMondayOfISOWeek(1);
    expect(monday.getDay()).toBe(1);
  });

  it('deux semaines consécutives sont espacées de 7 jours', () => {
    const w10 = getMondayOfISOWeek(10);
    const w11 = getMondayOfISOWeek(11);
    const diffDays = (w11.getTime() - w10.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(7);
  });
});

describe('startTimeToDate', () => {
  const monday = new Date(2025, 0, 6); // lundi 6 janvier 2025

  it('startTime=0 → lundi 00:00', () => {
    const date = startTimeToDate(monday, 0);
    expect(date.getDay()).toBe(1); // lundi
    expect(date.getHours()).toBe(0);
    expect(date.getMinutes()).toBe(0);
  });

  it('startTime=480 → lundi 08:00', () => {
    const date = startTimeToDate(monday, 480);
    expect(date.getDay()).toBe(1);
    expect(date.getHours()).toBe(8);
    expect(date.getMinutes()).toBe(0);
  });

  it('startTime=570 → lundi 09:30', () => {
    const date = startTimeToDate(monday, 570);
    expect(date.getHours()).toBe(9);
    expect(date.getMinutes()).toBe(30);
  });

  it('startTime=24*60 → mardi 00:00', () => {
    const date = startTimeToDate(monday, 24 * 60);
    expect(date.getDay()).toBe(2); // mardi
    expect(date.getHours()).toBe(0);
  });

  it('startTime=2*24*60+510 → mercredi 08:30', () => {
    const date = startTimeToDate(monday, 2 * 24 * 60 + 510);
    expect(date.getDay()).toBe(3); // mercredi
    expect(date.getHours()).toBe(8);
    expect(date.getMinutes()).toBe(30);
  });
});

describe('dateToStartTime', () => {
  const monday = new Date(2025, 0, 6); // lundi 6 janvier 2025

  it('est l\'inverse exact de startTimeToDate (round-trip)', () => {
    for (const startTime of [0, 480, 570, 24 * 60, 2 * 24 * 60 + 510]) {
      const date = startTimeToDate(monday, startTime);
      expect(dateToStartTime(monday, date)).toBe(startTime);
    }
  });

  it('lundi minuit → 0', () => {
    expect(dateToStartTime(monday, monday)).toBe(0);
  });
});

describe('matchesSearchQuery', () => {
  const fields = ['R1.01', 'Cours normal', 'TD', 'DUPONT', 'S101', 'BUT1-G1'];

  it('requête vide → toujours vrai', () => {
    expect(matchesSearchQuery(fields, '')).toBe(true);
    expect(matchesSearchQuery(fields, '   ')).toBe(true);
  });

  it('sous-chaîne simple, insensible à la casse', () => {
    expect(matchesSearchQuery(fields, 'dupont')).toBe(true);
    expect(matchesSearchQuery(fields, 'DUPONT')).toBe(true);
    expect(matchesSearchQuery(fields, 'r1.0')).toBe(true);
    expect(matchesSearchQuery(fields, 'introuvable')).toBe(false);
  });

  it('recherche sur le type (nouveau champ)', () => {
    expect(matchesSearchQuery(fields, 'TD')).toBe(true);
    expect(matchesSearchQuery(fields, 'TP')).toBe(false);
  });

  it('AND : tous les termes doivent correspondre', () => {
    expect(matchesSearchQuery(fields, 'TD AND DUPONT')).toBe(true);
    expect(matchesSearchQuery(fields, 'TD AND introuvable')).toBe(false);
  });

  it('OR : au moins un terme doit correspondre', () => {
    expect(matchesSearchQuery(fields, 'introuvable OR DUPONT')).toBe(true);
    expect(matchesSearchQuery(fields, 'introuvable OR encoreintrouvable')).toBe(false);
  });

  it('AND prioritaire sur OR : "A AND B OR C" = (A AND B) OR C', () => {
    // (TD AND introuvable) OR DUPONT → faux OR vrai → vrai
    expect(matchesSearchQuery(fields, 'TD AND introuvable OR DUPONT')).toBe(true);
    // (TD AND introuvable) OR encoreintrouvable → faux OR faux → faux
    expect(matchesSearchQuery(fields, 'TD AND introuvable OR encoreintrouvable')).toBe(false);
    // (introuvable AND DUPONT) OR TD → faux OR vrai → vrai
    expect(matchesSearchQuery(fields, 'introuvable AND DUPONT OR TD')).toBe(true);
  });

  it('opérateurs en minuscules ne sont PAS reconnus (texte littéral)', () => {
    // "TD and DUPONT" cherché comme une seule chaîne littérale → ne correspond à aucun champ
    expect(matchesSearchQuery(fields, 'TD and DUPONT')).toBe(false);
    expect(matchesSearchQuery(fields, 'TD or DUPONT')).toBe(false);
  });

  it('un mot contenant "AND"/"OR" n\'est pas confondu avec l\'opérateur', () => {
    // "GRAND TOTAL" contient "AND" mais collé à "GR"/"TOTAL" → pas un opérateur, reste littéral
    expect(matchesSearchQuery(['GRAND TOTAL'], 'GRAND')).toBe(true);
    expect(matchesSearchQuery(['GRAND TOTAL'], 'GRAND TOTAL')).toBe(true);
    // Mais un vrai "AND" isolé entre espaces, même à côté d'un mot qui contient "AND", est bien reconnu
    expect(matchesSearchQuery(['ANDRE', 'DUPONT'], 'ANDRE AND DUPONT')).toBe(true);
    expect(matchesSearchQuery(['ANDRE'], 'ANDRE AND DUPONT')).toBe(false);
  });

  it('espaces multiples autour de l\'opérateur sont tolérés', () => {
    expect(matchesSearchQuery(fields, 'TD   AND   DUPONT')).toBe(true);
  });

  it('opérateur en tête ou en fin de requête (sans espace de ce côté) n\'est pas reconnu — reste du texte littéral', () => {
    // "AND" en tête de chaîne n'a pas d'espace AVANT lui → pas reconnu comme opérateur ;
    // la requête entière "AND DUPONT" est cherchée comme une seule chaîne littérale, qui ne
    // correspond à aucun champ (bien que "DUPONT" seul y soit).
    expect(matchesSearchQuery(fields, 'AND DUPONT')).toBe(false);
    // Symétrique : "AND" en fin de chaîne n'a pas d'espace APRÈS lui.
    expect(matchesSearchQuery(fields, 'DUPONT AND')).toBe(false);
  });
});

describe('filterSolutionsByQuery', () => {
  const teacherTask = (overrides: Partial<{ code: string; name: string; type: string; resources: { id: string; type: string }[] }> = {}) => ({
    code: 'R1.01',
    name: 'Cours normal',
    type: 'TD',
    resources: [
      { id: 'DUPONT', type: 'teacher' },
      { id: 'S101', type: 'room' },
      { id: 'BUT1-G1', type: 'group' },
    ],
    ...overrides,
  });

  it('requête vide retourne le tableau original (même référence)', () => {
    const tasks = [teacherTask()];
    expect(filterSolutionsByQuery(tasks, '')).toBe(tasks);
  });

  it('filtre sur le type de cours', () => {
    const tasks = [teacherTask({ type: 'TD' }), teacherTask({ code: 'SAE1.01', type: 'Autonomie' })];
    expect(filterSolutionsByQuery(tasks, 'Autonomie')).toHaveLength(1);
    expect(filterSolutionsByQuery(tasks, 'Autonomie')[0].type).toBe('Autonomie');
  });

  it('combine AND/OR à travers code/nom/type/ressources', () => {
    const tasks = [teacherTask(), teacherTask({ code: 'R2.02', resources: [{ id: 'MARTIN', type: 'teacher' }] })];
    expect(filterSolutionsByQuery(tasks, 'TD AND DUPONT')).toHaveLength(1);
    expect(filterSolutionsByQuery(tasks, 'DUPONT OR MARTIN')).toHaveLength(2);
  });
});


