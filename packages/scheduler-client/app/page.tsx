'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { Draggable } from '@fullcalendar/interaction';
import type { RawScheduleData, TaskSolutionJSON, CourseTaskData, EnforcedData } from '@edt-ts/scheduler-common';
import { parseCsvCourses } from '../lib/parseCsvCourses';
import ScheduleCalendar from './ScheduleCalendar';
import CourseGroupList, { type GroupBy } from './CourseGroupList';
import { type BlockedZone, applyBlockedZonesToConstraints } from '../lib/blockedZones';

interface NormalizedSolution {
  isComplete: boolean;
  score?: number;
  tasks: TaskSolutionJSON[];
  neutralizedTasks?: TaskSolutionJSON[];
}

interface ScheduleResult {
  solutions: NormalizedSolution[];
  week: number;
}

export default function SchedulePage() {
  const [week, setWeek] = useState('1');
  const [resourcesFile, setResourcesFile] = useState<File | null>(null);
  const [coursesCsvFile, setCoursesCsvFile] = useState<File | null>(null);
  const [constraintsFile, setConstraintsFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<{ message: string; kind: 'ok' | 'err' | 'inf' } | null>(null);
  const [scheduleResult, setScheduleResult] = useState<ScheduleResult | null>(null);
  const [selectedSolutionIndex, setSelectedSolutionIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [isImportOpen, setIsImportOpen] = useState(true);
  const [groupBy, setGroupBy] = useState<GroupBy>('code');
  const [blockedZones, setBlockedZones] = useState<BlockedZone[]>([]);

  // Cours parsés depuis le CSV pour la semaine sélectionnée
  const [parsedCourses, setParsedCourses] = useState<CourseTaskData[]>([]);
  // Map courseKey → EnforcedData pour les cours imposés (mise à jour via callback ScheduleCalendar)
  const [enforcedMap, setEnforcedMap] = useState<Record<string, EnforcedData>>({});

  const cardContainerRef = useRef<HTMLDivElement | null>(null);

  const calendarWeek = parseInt(week, 10) || 1;

  // Réinitialise les zones de vide quand la semaine change (elles sont semaine-spécifiques)
  useEffect(() => {
    setBlockedZones([]);
  }, [week]);

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
        setScheduleResult(null);
        setSelectedSolutionIndex(0);
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

  const activeSolution = scheduleResult?.solutions[selectedSolutionIndex];

  const filteredSolutions = useMemo(() => {
    const tasks = activeSolution?.tasks ?? [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter((task) => {
      const teachers = task.resources.filter((r) => r.type === 'teacher').map((r) => r.id.toLowerCase());
      const rooms = task.resources.filter((r) => r.type === 'room').map((r) => r.id.toLowerCase());
      return (
        task.code.toLowerCase().includes(q) ||
        task.name.toLowerCase().includes(q) ||
        teachers.some((t) => t.includes(q)) ||
        rooms.some((r) => r.includes(q))
      );
    });
  }, [activeSolution, searchQuery]);

  async function readJSON<T>(file: File): Promise<T> {
    const text = await file.text();
    return JSON.parse(text) as T;
  }

  async function runSchedule(mode: 'standard' | 'elimination') {
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

      // Fusionner les zones de vide dans les contraintes
      const effectiveConstraints = applyBlockedZonesToConstraints(
        resources,
        constraints ?? null,
        blockedZones,
        weekNum
      );
      const hasConstraints = !!constraintsFile || blockedZones.length > 0;

      const payload: RawScheduleData & { options?: { eliminationCount?: number } } = {
        week: weekNum,
        resources,
        courses: coursesWithEnforced,
        ...(hasConstraints ? { constraints: effectiveConstraints } : {}),
        ...(mode === 'elimination' ? { options: { eliminationCount: 5 } } : {}),
      };

      const endpoint = mode === 'elimination' ? '/api/schedule/elimination' : '/api/schedule';

      console.groupCollapsed(`📤 Payload envoyé à POST ${endpoint}`);
      console.log(payload);
      console.groupEnd();

      setStatus({ message: 'Requête envoyée…', kind: 'inf' });

      const response = await fetch(endpoint, {
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

      console.groupCollapsed(`📥 Réponse ${endpoint}`);
      console.log(data);
      console.groupEnd();

      if (!response.ok) {
        const err = data as { error?: string };
        throw new Error(err?.error ?? `Erreur ${response.status}`);
      }

      let normalized: NormalizedSolution[];

      if (mode === 'standard') {
        // Format: { solutionCount, solutions: [{ score, isComplete, scheduledCount, conflictCount, tasks }] }
        const d = data as { solutionCount: number; solutions: { score?: number; isComplete: boolean; scheduledCount: number; conflictCount: number; tasks: TaskSolutionJSON[] }[] };
        normalized = d.solutions.map(s => ({
          isComplete: s.isComplete,
          score: s.score,
          tasks: s.tasks,
        }));
      } else {
        // Format: ScheduleSolutionJSON[] = [{ solutions, isComplete, score, neutralizedTasks }]
        const d = data as { solutions: TaskSolutionJSON[]; isComplete: boolean; score?: number; neutralizedTasks?: TaskSolutionJSON[] }[];
        normalized = d.map(s => ({
          isComplete: s.isComplete,
          score: s.score,
          tasks: s.solutions,
          neutralizedTasks: s.neutralizedTasks,
        }));
      }

      if (normalized.length === 0) {
        throw new Error('Aucune solution trouvée.');
      }

      setScheduleResult({ solutions: normalized, week: weekNum });
      setSelectedSolutionIndex(0);

      const best = normalized[0];
      const neutralizedMsg = best.neutralizedTasks?.length
        ? ` — ${best.neutralizedTasks.length} cours non placé(s)`
        : '';
      const summary = `${best.isComplete ? '✅ Planification complète' : '⚠️ Incomplète'} — ${normalized.length} solution(s)${neutralizedMsg}`;
      setStatus({ message: summary, kind: best.isComplete ? 'ok' : 'err' });
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
    setScheduleResult(null);
    setSelectedSolutionIndex(0);
  }

  function handleBlockedZoneAdd(start: Date, end: Date) {
    setBlockedZones((prev) => [
      ...prev,
      { id: `bz-${Date.now()}-${Math.random().toString(36).slice(2)}`, start, end },
    ]);
    setScheduleResult(null);
  }

  function handleBlockedZoneRemove(id: string) {
    setBlockedZones((prev) => prev.filter((z) => z.id !== id));
  }

  function handleBlockedZoneMove(id: string, start: Date, end: Date) {
    setBlockedZones((prev) => prev.map((z) => (z.id === id ? { ...z, start, end } : z)));
    setScheduleResult(null);
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
          {scheduleResult && (
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
            <form className="space-y-4">
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

              {/* En-tête repliable pour les imports de fichiers */}
              <div>
                <button
                  type="button"
                  onClick={() => setIsImportOpen((v) => !v)}
                  className="w-full flex items-center justify-between text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 hover:text-gray-900 dark:hover:text-white transition"
                >
                  <span>Fichiers d&apos;import</span>
                  <span className="text-gray-400 text-[11px]">{isImportOpen ? '▲' : '▼'}</span>
                </button>
                {isImportOpen && (
                  <div className="space-y-4">
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
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => runSchedule('standard')}
                  disabled={isLoading}
                  className="px-3 py-2.5 bg-black dark:bg-white text-white dark:text-black text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 transition"
                >
                  {isLoading
                    ? 'Traitement…'
                    : enforcedCount > 0
                    ? `Planifier (${enforcedCount} imposé${enforcedCount > 1 ? 's' : ''})`
                    : 'Planifier'}
                </button>
                <button
                  type="button"
                  onClick={() => runSchedule('elimination')}
                  disabled={isLoading}
                  className="px-3 py-2.5 bg-orange-600 dark:bg-orange-500 text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 transition"
                >
                  {isLoading ? 'Traitement…' : 'Avec élimination'}
                </button>
              </div>
            </form>
          </div>

          {/* Liste des cours de la semaine */}
          {parsedCourses.length > 0 && !scheduleResult && (
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

              {/* Tabs de regroupement */}
              <div className="flex rounded-lg border border-gray-200 dark:border-zinc-700 overflow-hidden text-xs">
                {(['code', 'teacher'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setGroupBy(tab)}
                    className={`flex-1 py-1.5 font-medium transition ${
                      groupBy === tab
                        ? 'bg-gray-900 dark:bg-white text-white dark:text-black'
                        : 'bg-white dark:bg-zinc-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-zinc-700'
                    }`}
                  >
                    {tab === 'code' ? 'Par code' : 'Par enseignant'}
                  </button>
                ))}
              </div>

              <div ref={cardContainerRef}>
                <CourseGroupList
                  courses={parsedCourses}
                  groupBy={groupBy}
                  enforcedMap={enforcedMap}
                />
              </div>
            </div>
          )}
        </aside>

        {/* Zone calendrier */}
        <main className="flex-1 overflow-hidden p-4 flex flex-col">

          {/* Onglets de solutions */}
          {scheduleResult && scheduleResult.solutions.length > 1 && (
            <div className="flex flex-wrap gap-1 mb-2 shrink-0">
              {scheduleResult.solutions.map((sol, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelectedSolutionIndex(i)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
                    selectedSolutionIndex === i
                      ? 'bg-gray-900 dark:bg-white text-white dark:text-black'
                      : 'bg-white dark:bg-zinc-800 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-700 border border-gray-200 dark:border-zinc-600'
                  }`}
                >
                  Solution {i + 1}{sol.score !== undefined ? ` — ${sol.score} pts` : ''}{sol.isComplete ? ' ✓' : ' ⚠️'}
                  {sol.neutralizedTasks && sol.neutralizedTasks.length > 0 && (
                    <span className="ml-1 text-orange-500">({sol.neutralizedTasks.length} éliminé{sol.neutralizedTasks.length > 1 ? 's' : ''})</span>
                  )}
                </button>
              ))}
            </div>
          )}

          <ScheduleCalendar
            solutions={filteredSolutions}
            week={calendarWeek}
            parsedCourses={parsedCourses}
            onEnforceChange={handleEnforceChange}
            blockedZones={blockedZones}
            onBlockedZoneAdd={handleBlockedZoneAdd}
            onBlockedZoneRemove={handleBlockedZoneRemove}
            onBlockedZoneMove={handleBlockedZoneMove}
          />
        </main>

        {/* Sidebar droite : cours non placés (neutralisés) */}
        {activeSolution?.neutralizedTasks && activeSolution.neutralizedTasks.length > 0 && (
          <aside className="w-64 shrink-0 bg-amber-50 dark:bg-amber-950/20 border-l border-amber-200 dark:border-amber-900 p-3 overflow-y-auto flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-amber-700 dark:text-amber-400 mb-1">
              Non placés ({activeSolution.neutralizedTasks.length})
            </p>
            {activeSolution.neutralizedTasks.map((task) => {
              const teachers = task.resources.filter((r) => r.type === 'teacher').map((r) => r.id);
              const groups = task.resources.filter((r) => r.type === 'group').map((r) => r.id);
              return (
                <div
                  key={task.taskId}
                  className="p-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-100/60 dark:bg-amber-900/30 text-xs"
                >
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <span className="font-bold text-amber-900 dark:text-amber-200 truncate">
                      {task.code}{' '}
                      <span className="font-normal text-amber-600 dark:text-amber-400">{task.type}</span>
                    </span>
                    <span className="text-amber-500 dark:text-amber-500 shrink-0">{task.duration}min</span>
                  </div>
                  <div className="truncate text-amber-800 dark:text-amber-300 mb-0.5">{task.name}</div>
                  {teachers.length > 0 && (
                    <div className="truncate text-amber-600 dark:text-amber-400">{teachers.join(', ')}</div>
                  )}
                  {groups.length > 0 && (
                    <div className="truncate text-amber-500 dark:text-amber-500">{groups.join(', ')}</div>
                  )}
                </div>
              );
            })}
          </aside>
        )}

      </div>

    </div>
  );
}
