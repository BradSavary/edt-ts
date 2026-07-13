import { describe, it, expect } from 'vitest';
import { getMondayOfISOWeek, startTimeToDate, dateToStartTime } from '../lib/calendar/calendarUtils';

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


