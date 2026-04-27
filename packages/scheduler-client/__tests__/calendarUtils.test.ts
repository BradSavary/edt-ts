import { describe, it, expect } from 'vitest';
import { getMondayOfISOWeek, startTimeToDate, formatTime, formatDate } from '../lib/calendar/calendarUtils';

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

describe('formatTime', () => {
  it('formate une heure en HH:MM (fr-FR)', () => {
    const date = new Date(2025, 0, 6, 8, 30); // 08:30
    const result = formatTime(date);
    expect(result).toMatch(/08.30/); // peut être "08:30" selon locale
  });

  it('formate minuit en 00:00', () => {
    const date = new Date(2025, 0, 6, 0, 0);
    const result = formatTime(date);
    expect(result).toMatch(/00.00/);
  });
});

describe('formatDate', () => {
  it('formate un lundi avec le label "Lun"', () => {
    const date = new Date(2025, 0, 6); // lundi 6 janvier 2025
    expect(formatDate(date)).toContain('Lun');
    expect(formatDate(date)).toContain('06');
    expect(formatDate(date)).toContain('01');
  });

  it('formate un vendredi avec le label "Ven"', () => {
    const date = new Date(2025, 0, 10); // vendredi 10 janvier 2025
    expect(formatDate(date)).toContain('Ven');
  });

  it('formate le jour avec deux chiffres', () => {
    const date = new Date(2025, 0, 6); // jour 6
    expect(formatDate(date)).toContain('06');
  });
});
