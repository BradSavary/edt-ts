import { describe, it, expect } from 'vitest';
import { resolveMaxDailyMinutes } from '../lib/maxDailyResolution';

describe('resolveMaxDailyMinutes', () => {
  it('override présent pour la semaine : il gagne sur le défaut', () => {
    const r = { id: 'T1', maxDailyMinutes: 240, weeklyMaxDailyMinutes: { S40: 120 } };
    expect(resolveMaxDailyMinutes(r, 40)).toBe(120);
  });

  it('override absent pour la semaine : repli sur le défaut de la ressource', () => {
    const r = { id: 'T1', maxDailyMinutes: 240, weeklyMaxDailyMinutes: { S40: 120 } };
    expect(resolveMaxDailyMinutes(r, 39)).toBe(240);
  });

  it('ni override ni défaut : undefined (illimité)', () => {
    expect(resolveMaxDailyMinutes({ id: 'T1' }, 40)).toBeUndefined();
    expect(resolveMaxDailyMinutes({ id: 'T1', weeklyMaxDailyMinutes: {} }, 40)).toBeUndefined();
  });

  it('override sans défaut : il s\'applique quand même', () => {
    expect(resolveMaxDailyMinutes({ id: 'T1', weeklyMaxDailyMinutes: { S40: 120 } }, 40)).toBe(120);
  });

  it('clé « S<n> » exacte : S4 et S40 ne se confondent pas', () => {
    const r = { id: 'T1', weeklyMaxDailyMinutes: { S4: 60 } };
    expect(resolveMaxDailyMinutes(r, 4)).toBe(60);
    expect(resolveMaxDailyMinutes(r, 40)).toBeUndefined();
  });
});
