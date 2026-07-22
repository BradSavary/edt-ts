import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { CourseTaskDataWithId } from '../lib/courseId';

/**
 * Régression : après une planification automatique, un cours remis dans la pioche n'affichait
 * aucune icône « Analyse de charge ».
 *
 * Deux causes, corrigées ensemble :
 * 1. Le popover n'était monté que pour `origin === 'engine'` — report du test de préfixe
 *    historique (PlanUnifiedUnplaced §5), jamais une décision : un cours retiré à la main
 *    (`user-post`) pose exactement la même question (« où reste-t-il du mou ? »).
 * 2. La charge de référence venait de `scheduleResult.solution.tasks`, qui compte encore le
 *    créneau du cours qu'on vient de retirer — la table nierait le mou que le geste libère —
 *    et n'est pas persistée (table à zéro après rechargement).
 *
 * Même motif de stub localStorage + reset de modules que les autres tests de store.
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

let usePlanningStore: typeof import('../store/usePlanningStore').usePlanningStore;
let useProjectStore: typeof import('../store/useProjectStore').useProjectStore;
let SidebarAnalysis: typeof import('../components/planning/sidebar/SidebarAnalysis').SidebarAnalysis;

/** Lundi 08:00-12:00 et rien d'autre : 240 min de capacité, deux cours de 120 min la saturent. */
const MONDAY_MORNING = [{ days: 'lundi', from: '08:00', to: '12:00' }];

function course(id: string): CourseTaskDataWithId {
  return {
    id,
    source: 'csv',
    week: 1,
    semester: 1,
    level: 1,
    code: id.toUpperCase(),
    name: `Cours ${id}`,
    type: 'CM',
    teacher: ['DUPONT'],
    groups: ['G1'],
    rooms: ['A101'],
    duration: 120,
  };
}

function solved(taskId: string, startTime: number) {
  return {
    taskId,
    code: taskId.toUpperCase(),
    name: `Cours ${taskId}`,
    type: 'CM',
    week: 1,
    duration: 120,
    startTime,
    resources: [
      { id: 'DUPONT', type: 'teacher' },
      { id: 'G1', type: 'group' },
      { id: 'A101', type: 'room' },
    ],
  };
}

beforeEach(async () => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  vi.resetModules();
  ({ usePlanningStore } = await import('../store/usePlanningStore'));
  ({ useProjectStore } = await import('../store/useProjectStore'));
  ({ SidebarAnalysis } = await import('../components/planning/sidebar/SidebarAnalysis'));

  useProjectStore.setState({
    schoolYearConfig: null,
    weekSaves: {},
    allCourses: [course('c1'), course('c2')],
    resources: [],
    constraints: { Default: MONDAY_MORNING },
  } as never);

  // Planification : les deux cours saturent le lundi matin (480 = 08:00, 600 = 10:00).
  usePlanningStore.getState().setSelectedWeek(1);
  usePlanningStore.setState({
    pendingJobResult: {
      week: 1,
      result: {
        solution: { isComplete: true, tasks: [solved('c1', 480), solved('c2', 600)], neutralizedTasks: [] },
        week: 1,
      },
    },
  } as never);
  usePlanningStore.getState().applyPendingResult();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** La carte de pioche de `taskId`, popover d'analyse compris. */
function piocheCard(taskId: string): HTMLElement {
  const card = document.querySelector(`[data-task-id="${taskId}"]`);
  expect(card, `carte de pioche absente pour ${taskId}`).not.toBeNull();
  // Le conteneur `relative` porte la carte ET le popover d'analyse en surimpression.
  const wrapper = card!.closest('div.relative');
  expect(wrapper, `conteneur de carte introuvable pour ${taskId}`).not.toBeNull();
  return wrapper as HTMLElement;
}

describe('analyse de charge d\'un cours remis dans la pioche après planification', () => {
  it('l\'icône est présente, comme pour une tâche que le moteur n\'a pas placée', () => {
    usePlanningStore.getState().unplaceTask('c1', 'user-post');
    render(<SidebarAnalysis />);

    expect(
      within(piocheCard('c1')).getByRole('button', { name: 'Analyse de charge' }),
    ).toBeInTheDocument();
  });

  it('la table part des placements affichés : le créneau libéré redevient du mou', () => {
    usePlanningStore.getState().unplaceTask('c1', 'user-post');
    render(<SidebarAnalysis />);

    fireEvent.click(within(piocheCard('c1')).getByRole('button', { name: 'Analyse de charge' }));

    // Lundi : 240 de capacité, 120 encore placés (c2) → 2h de mou, la place de c1. Lu sur
    // `scheduleResult` (l'ancienne source), c1 compterait encore : 0h de mou et le bandeau
    // « aucun jour n'a assez de mou » alors que l'utilisateur vient justement de la libérer.
    const rows = screen.getAllByRole('row').filter((r) => r.textContent?.startsWith('mou'));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const cells = within(row).getAllByRole('cell');
      expect(cells[1]).toHaveTextContent('2h'); // lundi
    }
    expect(screen.queryByText(/Aucun jour n'a assez de mou/)).not.toBeInTheDocument();
  });

  it('une tâche non placée par le moteur garde son analyse (pas de régression)', () => {
    usePlanningStore.setState({ unplaced: [{ taskId: 'c1', origin: 'engine', diagnostics: { reason: 'x', failureCount: 1, eliminationRound: 0 } }] } as never);
    usePlanningStore.setState({ placements: usePlanningStore.getState().placements.filter((p) => p.taskId !== 'c1') });
    render(<SidebarAnalysis />);

    expect(
      within(piocheCard('c1')).getByRole('button', { name: 'Analyse de charge' }),
    ).toBeInTheDocument();
  });
});
