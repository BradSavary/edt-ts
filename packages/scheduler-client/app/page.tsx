'use client';

import { useState } from 'react';
import type { RawScheduleData, TaskSolutionJSON } from '@edt-ts/scheduler-common';
import { parseCsvCourses } from '../lib/parseCsvCourses';
import ScheduleCalendar from './ScheduleCalendar';

export default function SchedulePage() {
  const [week, setWeek] = useState('1');
  const [resourcesFile, setResourcesFile] = useState<File | null>(null);
  const [coursesCsvFile, setCoursesCsvFile] = useState<File | null>(null);
  const [constraintsFile, setConstraintsFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<{ message: string; kind: 'ok' | 'err' | 'inf' } | null>(null);
  const [result, setResult] = useState<{ isComplete: boolean; scheduledCount: number; conflictCount: number; solutions: TaskSolutionJSON[]; week: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const calendarWeek = parseInt(week, 10) || 1;

  const filteredSolutions = (() => {
    const solutions = result?.solutions ?? [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return solutions;
    return solutions.filter((task) => {
      const teachers = task.resources.filter((r) => r.type === 'teacher').map((r) => r.id.toLowerCase());
      const rooms = task.resources.filter((r) => r.type === 'room').map((r) => r.id.toLowerCase());
      return (
        task.code.toLowerCase().includes(q) ||
        task.name.toLowerCase().includes(q) ||
        teachers.some((t) => t.includes(q)) ||
        rooms.some((r) => r.includes(q))
      );
    });
  })();

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

      const rawText = await response.text();
      let data: any;
      try {
        data = JSON.parse(rawText);
      } catch {
        throw new Error(`L'API a répondu avec une erreur ${response.status} : ${rawText.slice(0, 200)}`);
      }

      console.groupCollapsed('📥 Réponse /api/schedule');
      console.log(data);
      console.groupEnd();

      if (!response.ok) {
        throw new Error(data?.error ?? `Erreur ${response.status}`);
      }

      setResult({ ...data, week: weekNum });
      const summary = `${data.isComplete ? '✅ Planification complète' : '⚠️ Incomplète'} — ${data.scheduledCount} cours planifiés, ${data.conflictCount} conflit(s)`;
      setStatus({ message: summary, kind: data.isComplete ? 'ok' : 'err' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('❌ Erreur :', message);
      setStatus({ message: `❌ ${message}`, kind: 'err' });
    } finally {
      setIsLoading(false);
    }
  }

  const bannerClass = status
    ? status.kind === 'ok'
      ? 'bg-green-100 text-green-800 border-green-200'
      : status.kind === 'err'
      ? 'bg-red-100 text-red-800 border-red-200'
      : 'bg-blue-100 text-blue-800 border-blue-200'
    : '';

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gray-100 dark:bg-zinc-950">

      {/* Bannière de statut */}
      <div className={`shrink-0 px-6 py-2.5 text-sm font-medium border-b ${bannerClass || 'bg-gray-100 dark:bg-zinc-900 border-gray-200 dark:border-zinc-800'}`}>
        {status?.message ?? '\u00a0'}
      </div>

      {/* Contenu principal : sidebar + calendrier */}
      <div className="flex flex-1 overflow-hidden">

        {/* Sidebar */}
        <aside className="w-80 shrink-0 bg-white dark:bg-zinc-900 border-r border-gray-200 dark:border-zinc-800 p-6 overflow-y-auto">

          {/* Recherche */}
          <div className="mb-5">
            <label className="block text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-2">
              Rechercher
            </label>
            <input
              type="search"
              placeholder="Enseignant, salle, code, cours…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-zinc-800 text-black dark:text-white text-sm placeholder:text-gray-400"
            />
          </div>

          <div className="border-t border-gray-200 dark:border-zinc-700 mb-5" />

          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-5">
            Planification
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Semaine (1–53)
              </label>
              <input
                type="number"
                min="1"
                max="53"
                value={week}
                onChange={(e) => setWeek(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-zinc-800 text-black dark:text-white text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Resources <span className="text-gray-400 font-normal">(JSON)</span>
              </label>
              <input
                type="file"
                accept=".json"
                onChange={(e) => setResourcesFile(e.target.files?.[0] ?? null)}
                required
                className="w-full text-sm text-gray-600 dark:text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-gray-100 dark:file:bg-zinc-700 file:text-gray-700 dark:file:text-gray-200 hover:file:bg-gray-200 dark:hover:file:bg-zinc-600"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Cours <span className="text-gray-400 font-normal">(CSV)</span>
              </label>
              <input
                type="file"
                accept=".csv"
                onChange={(e) => setCoursesCsvFile(e.target.files?.[0] ?? null)}
                required
                className="w-full text-sm text-gray-600 dark:text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-gray-100 dark:file:bg-zinc-700 file:text-gray-700 dark:file:text-gray-200 hover:file:bg-gray-200 dark:hover:file:bg-zinc-600"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Contraintes <span className="text-gray-400 font-normal">(JSON, optionnel)</span>
              </label>
              <input
                type="file"
                accept=".json"
                onChange={(e) => setConstraintsFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-gray-600 dark:text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-gray-100 dark:file:bg-zinc-700 file:text-gray-700 dark:file:text-gray-200 hover:file:bg-gray-200 dark:hover:file:bg-zinc-600"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full px-4 py-2.5 bg-black dark:bg-white text-white dark:text-black text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 transition"
            >
              {isLoading ? 'Traitement…' : 'Planifier'}
            </button>
          </form>
        </aside>

        {/* Zone calendrier */}
        <main className="flex-1 overflow-hidden p-4 flex flex-col">
          <ScheduleCalendar
            solutions={filteredSolutions}
            week={calendarWeek}
          />
        </main>

      </div>
    </div>
  );
}
