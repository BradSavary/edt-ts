import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { RawScheduleData } from '@edt-ts/scheduler-common';

/**
 * Chaîne complète UI réelle → store réel → payload réellement sérialisé pour le moteur.
 *
 * Les autres suites testent chaque étage isolément (l'éditeur avec des callbacks mock, le
 * payload avec un état fabriqué à la main) : aucune ne voit ce que le moteur reçoit vraiment
 * au bout d'un parcours utilisateur. C'est ce montage qui a révélé que trois chemins
 * laissaient une limite hebdomadaire active sur une semaine décochée.
 *
 * Règle vérifiée : le moteur reçoit la limite du Défaut si la semaine n'est pas cochée,
 * celle de la semaine si elle l'est.
 */

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number { return this.store.size; }
  clear(): void { this.store.clear(); }
  getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
  key(index: number): string | null { return Array.from(this.store.keys())[index] ?? null; }
  removeItem(key: string): void { this.store.delete(key); }
  setItem(key: string, value: string): void { this.store.set(key, value); }
}

let useProjectStore: typeof import('../store/useProjectStore').useProjectStore;
let submitJobAsync: typeof import('../lib/api/scheduleApi').submitJobAsync;
let ConstraintsManager: typeof import('../components/constraints/ConstraintsManager').ConstraintsManager;

const slots = [{ days: 'lundi', from: '08:00', to: '18:00' }];

beforeEach(async () => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  vi.resetModules();
  ({ useProjectStore } = await import('../store/useProjectStore'));
  ({ submitJobAsync } = await import('../lib/api/scheduleApi'));
  ({ ConstraintsManager } = await import('../components/constraints/ConstraintsManager'));

  useProjectStore.setState({
    projectName: 'P',
    resources: [{ resourceType: 'teacher', resources: [{ id: 'T1', maxDailyMinutes: 240 }] }],
    allCourses: [
      { id: 'c39', source: 'csv', week: 39, semester: 1, level: 1, code: 'X', type: 'CM', teacher: ['T1'], groups: ['G1'], rooms: ['R1'], name: 'X', duration: 60 },
      { id: 'c40', source: 'csv', week: 40, semester: 1, level: 1, code: 'Y', type: 'CM', teacher: ['T1'], groups: ['G1'], rooms: ['R1'], name: 'Y', duration: 60 },
    ],
    constraints: { Default: slots, T1: { default: slots } },
    weekSaves: {},
  } as never);

  render(<ConstraintsManager />);
  fireEvent.click(screen.getByText('T1'));
});

afterEach(() => { vi.unstubAllGlobals(); });

async function payloadFor(week: number): Promise<RawScheduleData> {
  const original = globalThis.fetch;
  const bodies: string[] = [];
  globalThis.fetch = (async (_u: string, init: RequestInit) => {
    bodies.push(init.body as string);
    return new Response(JSON.stringify({ jobId: 'j1' }), { status: 200 });
  }) as typeof fetch;
  try {
    await submitJobAsync({
      week, courses: [], resources: useProjectStore.getState().resources,
      constraintsData: null, enforcedMap: {}, blockedZones: [],
    }, 'c1');
    return JSON.parse(bodies[0]) as RawScheduleData;
  } finally {
    globalThis.fetch = original;
  }
}

const limitFor = async (week: number) =>
  (await payloadFor(week)).resources[0].resources[0].maxDailyMinutes;
const weeklyState = () =>
  useProjectStore.getState().resources[0].resources[0].weeklyMaxDailyMinutes;

function cellInput(label: string): HTMLInputElement | null {
  const row = [...document.querySelectorAll('tbody tr')].find((tr) =>
    tr.querySelector('td')?.textContent?.includes(label),
  );
  if (!row) throw new Error(`ligne ${label} absente`);
  return row.querySelectorAll('td')[1].querySelector('input');
}
const toggleWeek = (wk: string) => fireEvent.click(screen.getByLabelText(`Activer la semaine ${wk}`));

async function setupOverride() {
  toggleWeek('S40');
  const input = cellInput('S40')!;
  fireEvent.change(input, { target: { value: '2' } });
  fireEvent.blur(input);
  expect(await limitFor(40)).toBe(120);
}

describe('bout en bout : limite quotidienne transmise au moteur', () => {
  it('non cochée ⇒ Défaut ; cochée+éditée ⇒ limite de la semaine ; décochée ⇒ Défaut', async () => {
    expect(await limitFor(40)).toBe(240);

    toggleWeek('S40');
    expect(weeklyState()).toEqual({ S40: 240 });
    expect(await limitFor(40)).toBe(240);

    const input = cellInput('S40')!;
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.blur(input);
    expect(await limitFor(40)).toBe(120);
    expect(await limitFor(39)).toBe(240);

    toggleWeek('S40');
    expect(weeklyState()).toBeUndefined();
    expect(await limitFor(40)).toBe(240);
  });

  it('supprimer toutes les contraintes de la ressource', async () => {
    await setupOverride();
    fireEvent.click(screen.getByText('Supprimer toutes les contraintes de cette ressource'));
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
    expect(weeklyState()).toBeUndefined();
    expect(await limitFor(40)).toBe(240);
  });

  it('deleteConstraint', async () => {
    await setupOverride();
    useProjectStore.getState().deleteConstraint('T1');
    expect(weeklyState()).toBeUndefined();
    expect(await limitFor(40)).toBe(240);
  });

  it('importConstraints sans la semaine', async () => {
    await setupOverride();
    useProjectStore.getState().importConstraints({ Default: slots, T1: { default: slots } } as never);
    expect(weeklyState()).toBeUndefined();
    expect(await limitFor(40)).toBe(240);
  });

  it('la limite par défaut reste réglable sur une ressource sans contraintes', async () => {
    fireEvent.click(screen.getByText('Supprimer toutes les contraintes de cette ressource'));
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
    expect(screen.getByText(/Aucune contrainte définie/)).toBeTruthy();

    const input = document.querySelector('input[type="number"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.blur(input);
    expect(await limitFor(40)).toBe(180);
  });
});
