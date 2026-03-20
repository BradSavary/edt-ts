'use client';

import { useState } from 'react';
import type { RawScheduleData, TaskSolutionJSON } from '@edt-ts/scheduler-common';
import { parseCsvCourses } from '../lib/parseCsvCourses';

export default function SchedulePage() {
  const [week, setWeek] = useState('');
  const [resourcesFile, setResourcesFile] = useState<File | null>(null);
  const [coursesCsvFile, setCoursesCsvFile] = useState<File | null>(null);
  const [constraintsFile, setConstraintsFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<{ message: string; kind: 'ok' | 'err' | 'inf' } | null>(null);
  const [result, setResult] = useState<{ isComplete: boolean; scheduledCount: number; conflictCount: number; solutions: TaskSolutionJSON[] } | null>(null);

  async function readJSON<T>(file: File): Promise<T> {
    const text = await file.text();
    return JSON.parse(text) as T;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    setStatus({ message: 'Lecture des fichiers…', kind: 'inf' });

    try {
      const weekNum = parseInt(week, 10);
      if (isNaN(weekNum) || weekNum < 1 || weekNum > 53) {
        throw new Error('"week" doit être un entier entre 1 et 53.');
      }

      if (!resourcesFile) throw new Error('Fichier resources requis.');
      if (!coursesCsvFile) throw new Error('Fichier cours CSV requis.');

      const resources = await readJSON<RawScheduleData['resources']>(resourcesFile);
      const csvText = await coursesCsvFile.text();
      const courses = parseCsvCourses(csvText, weekNum);
      const constraints = constraintsFile ? await readJSON<RawScheduleData['constraints']>(constraintsFile) : null;

      if (!Array.isArray(resources)) {
        throw new Error('Le fichier resources doit être un tableau JSON.');
      }
      if (courses.length === 0) {
        throw new Error(`Aucun cours trouvé pour la semaine ${weekNum} dans le CSV.`);
      }

      const payload: RawScheduleData = { week: weekNum, resources, courses, ...(constraints ? { constraints } : {}) };

      console.groupCollapsed('📤 Payload envoyé à POST /api/schedule');
      console.log(payload);
      console.groupEnd();

      setStatus({ message: 'Requête envoyée…', kind: 'inf' });

      const response = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json() as any;

      console.groupCollapsed('📥 Réponse /api/schedule');
      console.log(data);
      console.groupEnd();

      if (!response.ok) {
        throw new Error(data.error ?? `Erreur ${response.status}`);
      }

      setResult(data);
      const summary = `${data.isComplete ? '✅ Planification complète' : '⚠️ Incomplète'} — ${data.scheduledCount} cours, ${data.conflictCount} conflit(s)`;
      setStatus({ message: summary, kind: data.isComplete ? 'ok' : 'err' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('❌ Erreur :', message);
      setStatus({ message: `❌ ${message}`, kind: 'err' });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black p-8">
      <main className="max-w-3xl mx-auto bg-white dark:bg-zinc-900 rounded-lg shadow p-8">
        <h1 className="text-3xl font-bold text-black dark:text-white mb-6">Planification</h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Semaine (1-53)
            </label>
            <input
              type="number"
              min="1"
              max="53"
              value={week}
              onChange={(e) => setWeek(e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-zinc-800 text-black dark:text-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Resources (JSON)
            </label>
            <input
              type="file"
              accept=".json"
              onChange={(e) => setResourcesFile(e.target.files?.[0] ?? null)}
              required
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Courses (CSV)
            </label>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => setCoursesCsvFile(e.target.files?.[0] ?? null)}
              required
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Constraints (JSON, optionnel)
            </label>
            <input
              type="file"
              accept=".json"
              onChange={(e) => setConstraintsFile(e.target.files?.[0] ?? null)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full px-6 py-3 bg-black dark:bg-white text-white dark:text-black font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 transition"
          >
            {isLoading ? 'Traitement…' : 'Envoyer'}
          </button>
        </form>

        {status && (
          <div className={`mt-6 p-4 rounded-lg ${status.kind === 'ok' ? 'bg-green-100 text-green-700' : status.kind === 'err' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
            {status.message}
          </div>
        )}

        {result && (
          <div className="mt-6 p-4 bg-gray-100 dark:bg-zinc-800 rounded-lg">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              ✅ {result.scheduledCount} cours planifiés | ⚠️ {result.conflictCount} conflit(s)
            </p>
            <pre className="mt-2 text-xs overflow-auto dark:text-gray-300">{JSON.stringify(result, null, 2)}</pre>
          </div>
        )}
      </main>
    </div>
  );
}
