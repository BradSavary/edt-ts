'use client';

import { useState, useEffect, useRef } from 'react';
import { Draggable } from '@fullcalendar/interaction';
import type { RawScheduleData, TaskSolutionJSON, CourseTaskData, EnforcedData } from '@edt-ts/scheduler-common';
import { parseCsvCourses } from '../lib/parseCsvCourses';
import ScheduleCalendar from './ScheduleCalendar';
import CourseCard from './CourseCard';

export default function SchedulePage() {
  const [week, setWeek] = useState('1');
  const [resourcesFile, setResourcesFile] = useState<File | null>(null);
  const [coursesCsvFile, setCoursesCsvFile] = useState<File | null>(null);
  const [constraintsFile, setConstraintsFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<{ message: string; kind: 'ok' | 'err' | 'inf' } | null>(null);
  const [result, setResult] = useState<{ isComplete: boolean; scheduledCount: number; conflictCount: number; solutions: TaskSolutionJSON[]; week: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Cours parsés depuis le CSV pour la semaine sélectionnée
  const [parsedCourses, setParsedCourses] = useState<CourseTaskData[]>([]);
  // Map courseKey → EnforcedData pour les cours imposés (mise à jour via callback ScheduleCalendar)
  const [enforcedMap, setEnforcedMap] = useState<Record<string, EnforcedData>>({});

  const cardContainerRef = useRef<HTMLDivElement | null>(null);

  const calendarWeek = parseInt(week, 10) || 1;

  // Parse automatiquement le CSV quand le fichier ou la semaine change
  useEffect(() => {
    if (!coursesCsvFile) {
      setParsedCourses([]);
      setEnforcedMap({});
      return;
    }
    const weekNum = parseInt(week, 10);
    if (isNaN(weekNum) || weekNum < 1 || weekNum > 53) return;

    coursesCsvFile.text().then((text) => {
      try {
        const courses = parseCsvCourses(text, weekNum);
        setParsedCourses(courses);
        setEnforcedMap({});
        setResult(null);
      } catch {
        setParsedCourses([]);
      }
    });
  }, [coursesCsvFile, week]);

  // Initialise FullCalendar Draggable sur le conteneur de cards
  useEffect(() => {
    const container = cardContainerRef.current;
    if (!container || parsedCourses.length === 0) return;

    const draggable = new Draggable(container, {
      itemSelector: '[data-course-key]',
      eventData: (el) => ({
        title: el.getAttribute('data-title') ?? '',
        duration: { minutes: parseInt(el.getAttribute('data-duration') ?? '60', 10) },
        extendedProps: { courseKey: el.getAttribute('data-course-key') ?? '' },
      }),
    });

    return () => draggable.destroy();
  }, [parsedCourses]);

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

      // Injecter les données imposées dans les cours concernés
      const coursesWithEnforced = courses.map((course, i) => {
        const enforced = enforcedMap[String(i)];
        return enforced ? { ...course, enforced } : course;
      });

      const payload: RawScheduleData = { week: weekNum, resources, courses: coursesWithEnforced, ...(constraints ? { constraints } : {}) };

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
      let data: unknown;
      try {
        data = JSON.parse(rawText);
      } catch {
        throw new Error(`L'API a répondu avec une erreur ${response.status} : ${rawText.slice(0, 200)}`);
      }

      console.groupCollapsed('📥 Réponse /api/schedule');
      console.log(data);
      console.groupEnd();

      if (!response.ok) {
        const err = data as { error?: string };
        throw new Error(err?.error ?? `Erreur ${response.status}`);
      }

      const d = data as { isComplete: boolean; scheduledCount: number; conflictCount: number; solutions: TaskSolutionJSON[] };
      setResult({ ...d, week: weekNum });
      const summary = `${d.isComplete ? '✅ Planification complète' : '⚠️ Incomplète'} — ${d.scheduledCount} cours planifiés, ${d.conflictCount} conflit(s)`;
      setStatus({ message: summary, kind: d.isComplete ? 'ok' : 'err' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('❌ Erreur :', message);
      setStatus({ message: `❌ ${message}`, kind: 'err' });
    } finally {
      setIsLoading(false);
    }
  }

  function handleEnforceChange(map: Record<string, EnforcedData>) {
    setEnforcedMap(map);
    setResult(null); // Les résultats précédents sont inactifs si les impositions changent
  }

  const bannerClass = status
    ? status.kind === 'ok'
      ? 'bg-green-100 text-green-800 border-green-200'
      : status.kind === 'err'
      ? 'bg-red-100 text-red-800 border-red-200'
      : 'bg-blue-100 text-blue-800 border-blue-200'
    : '';

  const enforcedCount = Object.keys(enforcedMap).length;

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gray-100 dark:bg-zinc-950">

      {/* Bannière de statut */}
      <div className={`shrink-0 px-6 py-2.5 text-sm font-medium border-b ${bannerClass || 'bg-gray-100 dark:bg-zinc-900 border-gray-200 dark:border-zinc-800'}`}>
        {status?.message ?? '\u00a0'}
      </div>

      {/* Contenu principal : sidebar + calendrier */}
      <div className="flex flex-1 overflow-hidden">

        {/* Sidebar */}
        <aside className="w-80 shrink-0 bg-white dark:bg-zinc-900 border-r border-gray-200 dark:border-zinc-800 p-4 overflow-y-auto flex flex-col gap-4">

          {/* Recherche (visible uniquement si résultats) */}
          {result && (
            <div>
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
          )}

          {/* Formulaire */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-4">
              Planification
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
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
                {isLoading
                  ? 'Traitement…'
                  : enforcedCount > 0
                  ? `Planifier (${enforcedCount} imposé${enforcedCount > 1 ? 's' : ''})`
                  : 'Planifier'}
              </button>
            </form>
          </div>

          {/* Liste des cours de la semaine */}
          {parsedCourses.length > 0 && !result && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
                  Cours S{week}
                </p>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {parsedCourses.length} cours
                </span>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 italic">
                Glissez un cours sur le calendrier pour l&apos;imposer.
              </p>
              <div ref={cardContainerRef} className="flex flex-col gap-1.5">
                {parsedCourses.map((course, i) => (
                  <CourseCard
                    key={i}
                    courseKey={String(i)}
                    course={course}
                    enforced={enforcedMap[String(i)] !== undefined}
                  />
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* Zone calendrier */}
        <main className="flex-1 overflow-hidden p-4 flex flex-col">
          <ScheduleCalendar
            solutions={filteredSolutions}
            week={calendarWeek}
            parsedCourses={parsedCourses}
            onEnforceChange={handleEnforceChange}
          />
        </main>

      </div>

    </div>
  );
}
