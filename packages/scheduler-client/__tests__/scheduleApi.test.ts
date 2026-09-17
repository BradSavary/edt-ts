import { describe, it, expect, vi } from 'vitest';
import type { RawScheduleData } from '@edt-ts/scheduler-common';
import { buildScheduleStatus, submitJobAsync, type ScheduleResult, type NormalizedSolution } from '../lib/api/scheduleApi';
import type { ResourceGroupDataWithStatus } from '../lib/csvMerge';

function makeResult(solution: Partial<NormalizedSolution>, week = 44): ScheduleResult {
  return {
    week,
    solution: {
      isComplete: false,
      tasks: [],
      ...solution,
    },
  };
}

describe('buildScheduleStatus', () => {
  it('solution complète : message ok, pas de mention de nombre de solutions', () => {
    const status = buildScheduleStatus(makeResult({
      isComplete: true,
      tasks: [{ taskId: 't1', code: 'R101', name: 'Cours', type: 'CM', week: 44, duration: 60, startTime: 0, resources: [] }],
    }));
    expect(status.kind).toBe('ok');
    expect(status.message).toContain('Planification complète');
    expect(status.message).not.toMatch(/\d+ solution\(s\)/);
  });

  it('solution incomplète avec tâches neutralisées : message incomplet + décompte', () => {
    const status = buildScheduleStatus(makeResult({
      isComplete: false,
      tasks: [{ taskId: 't1', code: 'R101', name: 'Cours', type: 'CM', week: 44, duration: 60, startTime: 0, resources: [] }],
      neutralizedTasks: [
        { task: { taskId: 't2', code: 'R102', name: 'Cours 2', type: 'TD', week: 44, duration: 60, startTime: 0, resources: [] }, reason: 'conflit' },
      ],
    }));
    expect(status.kind).toBe('err');
    expect(status.message).toContain('Incomplète');
    expect(status.message).toContain('1 cours non placé(s)');
    expect(status.message).not.toMatch(/\d+ solution\(s\)/);
  });

  // §6.4 — un type exclu du moteur n'a jamais été soumis : il ne rend pas le résultat incomplet
  // et ne se compte pas. Les deux assertions vont ensemble : `isComplete` seul produirait la
  // phrase contradictoire « ✅ Planification complète — 1 cours non placé(s) ».
  it("type exclu du moteur : résultat complet ET compteur muet", () => {
    const status = buildScheduleStatus(makeResult({
      isComplete: true,
      tasks: [{ taskId: 't1', code: 'R101', name: 'Cours', type: 'CM', week: 44, duration: 60, startTime: 0, resources: [] }],
      neutralizedTasks: [
        {
          task: { taskId: 't2', code: 'A1', name: 'Autonomie', type: 'Autonomie', week: 44, duration: 60, startTime: -1, resources: [] },
          reason: 'Type « Autonomie » exclu du moteur CP-SAT (pré-neutralisé).',
          reasonSlug: 'excluded-type',
        },
      ],
    }));
    expect(status.kind).toBe('ok');
    expect(status.message).toContain('Planification complète');
    expect(status.message).not.toContain('cours non placé(s)');
  });

  it('un type exclu ne masque pas un vrai échec moteur présent à côté', () => {
    const status = buildScheduleStatus(makeResult({
      isComplete: false,
      tasks: [{ taskId: 't1', code: 'R101', name: 'Cours', type: 'CM', week: 44, duration: 60, startTime: 0, resources: [] }],
      neutralizedTasks: [
        {
          task: { taskId: 't2', code: 'A1', name: 'Autonomie', type: 'Autonomie', week: 44, duration: 60, startTime: -1, resources: [] },
          reason: 'exclu', reasonSlug: 'excluded-type',
        },
        {
          task: { taskId: 't3', code: 'R103', name: 'Cours 3', type: 'TD', week: 44, duration: 60, startTime: -1, resources: [] },
          reason: 'évincé', reasonSlug: 'contention',
        },
      ],
    }));
    expect(status.message).toContain('1 cours non placé(s)');
  });

  // §5.3 — deux situations opposées, longtemps confondues dans un même texte.
  it('INFEASIBLE : dit que les contraintes se contredisent, sans suggérer d\'attendre', () => {
    const status = buildScheduleStatus(makeResult({
      isComplete: false, tasks: [], noSolutionStatus: 'infeasible',
    }));
    expect(status.message).toContain('contradictoires');
    expect(status.message).not.toContain('délai plus long');
  });

  it("UNKNOWN : dit que le budget est épuisé et qu'un délai plus long peut suffire", () => {
    const status = buildScheduleStatus(makeResult({
      isComplete: false, tasks: [], noSolutionStatus: 'unknown',
    }));
    expect(status.message).toContain('délai plus long');
    expect(status.message).not.toContain('contradictoires');
  });

  it('tasks: [] → branche "Aucune solution trouvée"', () => {
    const status = buildScheduleStatus(makeResult({ isComplete: false, tasks: [] }));
    expect(status.kind).toBe('err');
    expect(status.message).toBe('❌ Aucune solution trouvée');
  });

  it('tasks: [] avec neutralisées → décompte dans le message d\'échec', () => {
    const status = buildScheduleStatus(makeResult({
      isComplete: false,
      tasks: [],
      neutralizedTasks: [
        { task: { taskId: 't2', code: 'R102', name: 'Cours 2', type: 'TD', week: 44, duration: 60, startTime: 0, resources: [] }, reason: 'conflit' },
      ],
    }));
    expect(status.message).toBe('❌ Aucune solution trouvée — 1 cours neutralisé(s)');
  });

  it('provenOptimal : message générique sans relâchement de contraintes', () => {
    const status = buildScheduleStatus(makeResult({
      isComplete: false,
      tasks: [{ taskId: 't1', code: 'R101', name: 'Cours', type: 'CM', week: 44, duration: 60, startTime: 0, resources: [] }],
      provenOptimal: true,
    }));
    expect(status.message).toContain('optimum prouvé : le moteur ne placera pas plus sans relâchement de contraintes');
  });
});

describe('_buildPayload — résolution de maxDailyMinutes par semaine', () => {
  /** Capture le corps réellement envoyé par submitJobAsync (donc le payload construit). */
  async function payloadFor(week: number, resources: ResourceGroupDataWithStatus[]): Promise<RawScheduleData> {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ jobId: 'j1' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      await submitJobAsync({
        week,
        courses: [],
        resources,
        constraintsData: null,
        enforcedMap: {},
        blockedZones: [],
      }, 'client-1');
      return JSON.parse(fetchMock.mock.calls[0][1].body as string) as RawScheduleData;
    } finally {
      vi.unstubAllGlobals();
    }
  }

  const resources: ResourceGroupDataWithStatus[] = [
    {
      resourceType: 'teacher',
      resources: [{ id: 'T1', maxDailyMinutes: 240, weeklyMaxDailyMinutes: { S40: 120 } }],
    },
  ];

  it('semaine avec override : le moteur reçoit la limite de la semaine', async () => {
    const payload = await payloadFor(40, resources);
    expect(payload.resources[0].resources[0].maxDailyMinutes).toBe(120);
  });

  it('semaine sans override : le moteur reçoit le défaut de la ressource', async () => {
    const payload = await payloadFor(39, resources);
    expect(payload.resources[0].resources[0].maxDailyMinutes).toBe(240);
  });

  it('weeklyMaxDailyMinutes ne part JAMAIS dans le payload (champ purement client)', async () => {
    for (const week of [39, 40]) {
      const sent = await payloadFor(week, resources);
      expect('weeklyMaxDailyMinutes' in sent.resources[0].resources[0]).toBe(false);
    }
  });

  it('ni override ni défaut : la clé maxDailyMinutes est absente, pas présente à undefined', async () => {
    const payload = await payloadFor(40, [{ resourceType: 'teacher', resources: [{ id: 'T1' }] }]);
    expect(payload.resources[0].resources[0]).toEqual({ id: 'T1' });
    expect('maxDailyMinutes' in payload.resources[0].resources[0]).toBe(false);
  });

  it('les autres champs de la ressource sont préservés (unused part comme avant)', async () => {
    const payload = await payloadFor(40, [
      { resourceType: 'teacher', resources: [{ id: 'T1', info: 'vacataire', unused: true, weeklyMaxDailyMinutes: { S40: 90 } }] },
    ]);
    expect(payload.resources[0].resources[0]).toEqual({ id: 'T1', info: 'vacataire', unused: true, maxDailyMinutes: 90 });
  });
});
