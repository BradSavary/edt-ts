import type { RawScheduleData, TaskSolutionJSON } from '@edt-ts/scheduler-common';

// ── Éléments DOM ─────────────────────────────────────────────────────────────

const form       = document.getElementById('schedule-form')   as HTMLFormElement;
const weekInput  = document.getElementById('week')            as HTMLInputElement;
const resInput   = document.getElementById('resources-file')  as HTMLInputElement;
const coursInput = document.getElementById('courses-file')    as HTMLInputElement;
const consInput  = document.getElementById('constraints-file') as HTMLInputElement;
const submitBtn  = document.getElementById('submit-btn')      as HTMLButtonElement;
const statusEl   = document.getElementById('status')          as HTMLParagraphElement;

// ── Helpers ───────────────────────────────────────────────────────────────────

function setStatus(msg: string, kind: 'ok' | 'err' | 'inf'): void {
  statusEl.textContent = msg;
  statusEl.className = kind;
}

async function readJSON<T>(input: HTMLInputElement): Promise<T | null> {
  const file = input.files?.[0];
  if (!file) return null;
  const text = await file.text();
  return JSON.parse(text) as T;
}

// ── Soumission du formulaire ──────────────────────────────────────────────────

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  submitBtn.disabled = true;
  setStatus('Lecture des fichiers…', 'inf');

  try {
    // Lecture des fichiers
    const week = parseInt(weekInput.value, 10);
    if (isNaN(week) || week < 1 || week > 53) {
      throw new Error('"week" doit être un entier entre 1 et 53.');
    }

    const resources   = await readJSON<RawScheduleData['resources']>(resInput);
    const coursesFile = await readJSON<{ courses?: RawScheduleData['courses'] }>(coursInput);
    const courses     = coursesFile?.courses ?? null;
    const constraints = await readJSON<RawScheduleData['constraints']>(consInput);

    if (!resources || !Array.isArray(resources)) {
      throw new Error('Le fichier resources doit être un tableau JSON (ResourceGroupData[]).');
    }
    if (!courses || !Array.isArray(courses)) {
      throw new Error('Le fichier cours doit contenir une propriété "courses" (CourseTaskData[]).');
    }

    // Construction du payload
    const payload: RawScheduleData = {
      week,
      resources,
      courses,
      ...(constraints ? { constraints } : {}),
    };

    console.groupCollapsed('📤 Payload envoyé à POST /api/schedule');
    console.log(payload);
    console.groupEnd();

    setStatus('Requête envoyée, attente de la réponse…', 'inf');

    // Appel API
    const response = await fetch('/api/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const result = await response.json() as {
      isComplete: boolean;
      scheduledCount: number;
      conflictCount: number;
      solutions: TaskSolutionJSON[];
      error?: string;
    };

    console.groupCollapsed('📥 Réponse brute de /api/schedule');
    console.log(result);
    console.groupEnd();

    if (!response.ok) {
      setStatus(`❌ Erreur ${response.status} : ${result.error ?? 'Inconnue'}`, 'err');
      return;
    }

    const summary =
      `${result.isComplete ? '✅ Planification complète' : '⚠️ Planification incomplète'} — ` +
      `${result.scheduledCount} cours planifié(s), ${result.conflictCount} conflit(s)`;

    setStatus(summary, result.isComplete ? 'ok' : 'err');
    console.info(`ℹ️ ${summary}`);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('❌ Erreur client :', message);
    setStatus(`❌ ${message}`, 'err');
  } finally {
    submitBtn.disabled = false;
  }
});
