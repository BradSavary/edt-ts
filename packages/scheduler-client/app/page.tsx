'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Draggable } from '@fullcalendar/interaction';
import type { CourseTaskData, EnforcedData, ConstraintsData } from '@edt-ts/scheduler-common';
import { parseCsvCourses } from '@/lib/parseCsvCourses';
import ScheduleCalendar from '@/components/ScheduleCalendar';
import CourseGroupList, { type GroupBy } from '@/components/CourseGroupList';
import { type BlockedZone } from '@/lib/blockedZones';
import { runScheduleRequest } from '@/lib/scheduleApi';
import type { ScheduleResult } from '@/lib/scheduleApi';
import { loadConstraints } from '@/lib/constraintsStorage';
import { useNeutralizedDraggable } from '@/hooks/useNeutralizedDraggable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

export default function SchedulePage() {
  const [week, setWeek] = useState('1');
  const [resourcesFile, setResourcesFile] = useState<File | null>(null);
  const [coursesCsvFile, setCoursesCsvFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<{ message: string; kind: 'ok' | 'err' | 'inf' } | null>(null);
  const [scheduleResult, setScheduleResult] = useState<ScheduleResult | null>(null);
  const [selectedSolutionIndex, setSelectedSolutionIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [isImportOpen, setIsImportOpen] = useState(true);
  const [groupBy, setGroupBy] = useState<GroupBy>('code');
  const [blockedZones, setBlockedZones] = useState<BlockedZone[]>([]);
  // IDs des tâches neutralisées placées manuellement sur le calendrier
  const [placedNeutralizedIds, setPlacedNeutralizedIds] = useState<Set<string>>(new Set());
  // Tâche neutralisée en cours de drag depuis la sidebar (pour l'aperçu de conflits)
  const [externalDraggingTask, setExternalDraggingTask] = useState<{ id: string; teachers: string[]; groups: string[]; rooms: string[] } | null>(null);

  // Cours parsés depuis le CSV pour la semaine sélectionnée
  const [parsedCourses, setParsedCourses] = useState<CourseTaskData[]>([]);
  // Map courseKey → EnforcedData pour les cours imposés (mise à jour via callback ScheduleCalendar)
  const [enforcedMap, setEnforcedMap] = useState<Record<string, EnforcedData>>({});
  // Liste complète des ressources chargée depuis le resources.json (pour les selects d'édition)
  const [resourcesData, setResourcesData] = useState<import('@edt-ts/scheduler-common').ResourceGroupData[]>([]);
  // Contraintes parsées depuis le fichier JSON (pour la mise en évidence des indisponibilités au drag)
  const [constraintsData, setConstraintsData] = useState<ConstraintsData | null>(null);
  // Ressources du cours de la sidebar gauche en cours de drag
  const [sidebarDraggingResources, setSidebarDraggingResources] = useState<{ teachers: string[]; groups: string[]; rooms: string[] } | null>(null);

  const cardContainerRef = useRef<HTMLDivElement | null>(null);
  const neutralizedContainerRef = useRef<HTMLDivElement | null>(null);
  const pendingSidebarDragRef = useRef<{ teachers: string[]; groups: string[]; rooms: string[]; isDragging: boolean } | null>(null);

  const calendarWeek = parseInt(week, 10) || 1;

  // Réinitialise les zones de vide quand la semaine change (elles sont semaine-spécifiques)
  useEffect(() => {
    setBlockedZones([]);
    setPlacedNeutralizedIds(new Set());
  }, [week]);

  // Réinitialise les cours non-placés manuellement quand on change de solution
  useEffect(() => {
    setPlacedNeutralizedIds(new Set());
  }, [selectedSolutionIndex]);

  // Charge les ressources dès que le fichier change
  useEffect(() => {
    if (!resourcesFile) { setResourcesData([]); return; }
    resourcesFile.text().then((text) => {
      try {
        const data = JSON.parse(text) as import('@edt-ts/scheduler-common').ResourceGroupData[];
        if (Array.isArray(data)) setResourcesData(data);
      } catch { setResourcesData([]); }
    });
  }, [resourcesFile]);

  // Charge les contraintes depuis localStorage au montage
  useEffect(() => {
    setConstraintsData(loadConstraints());
  }, []);

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

  // Détecte le drag depuis la sidebar gauche pour la mise en évidence des contraintes
  useEffect(() => {
    const container = cardContainerRef.current;
    if (!container) return;

    const onPointerDown = (e: PointerEvent) => {
      const card = (e.target as Element).closest('[data-course-key]');
      if (!card) return;
      const courseKey = card.getAttribute('data-course-key');
      if (!courseKey) return;
      const course = parsedCourses[parseInt(courseKey, 10)];
      if (!course) return;
      pendingSidebarDragRef.current = {
        teachers: course.teacher.flatMap((r) => (Array.isArray(r) ? r : [r])),
        groups: course.groups.flatMap((r) => (Array.isArray(r) ? r : [r])),
        rooms: course.rooms.flatMap((r) => (Array.isArray(r) ? r : [r])),
        isDragging: false,
      };
    };

    const onPointerMove = (e: PointerEvent) => {
      const pending = pendingSidebarDragRef.current;
      if (!pending || pending.isDragging) return;
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) {
        pending.isDragging = true;
        setSidebarDraggingResources({ teachers: pending.teachers, groups: pending.groups, rooms: pending.rooms });
      }
    };

    const onPointerUp = () => {
      pendingSidebarDragRef.current = null;
      setSidebarDraggingResources(null);
    };

    container.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      container.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [parsedCourses]);

  const activeSolution = scheduleResult?.solutions[selectedSolutionIndex];

  const handleExternalDragStart = useCallback(
    (task: { id: string; teachers: string[]; groups: string[]; rooms: string[] }) => setExternalDraggingTask(task),
    [],
  );
  const handleExternalDragEnd = useCallback(() => setExternalDraggingTask(null), []);

  useNeutralizedDraggable({
    containerRef: neutralizedContainerRef,
    neutralizedTasks: activeSolution?.neutralizedTasks,
    onExternalDragStart: handleExternalDragStart,
    onExternalDragEnd: handleExternalDragEnd,
  });

  const filteredSolutions = useMemo(() => {
    const tasks = activeSolution?.tasks ?? [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter((task) => {
      const teachers = task.resources.filter((r) => r.type === 'teacher').map((r) => r.id.toLowerCase());
      const rooms = task.resources.filter((r) => r.type === 'room').map((r) => r.id.toLowerCase());
      const groups = task.resources.filter((r) => r.type === 'group').map((r) => r.id.toLowerCase());
      return (
        task.code.toLowerCase().includes(q) ||
        task.name.toLowerCase().includes(q) ||
        teachers.some((t) => t.includes(q)) ||
        rooms.some((r) => r.includes(q)) ||
        groups.some((g) => g.includes(q))
      );
    });
  }, [activeSolution, searchQuery]);

  async function runSchedule(mode: 'standard' | 'elimination') {
    if (!resourcesFile) { setStatus({ message: '❌ Fichier resources requis.', kind: 'err' }); return; }
    if (!coursesCsvFile) { setStatus({ message: '❌ Fichier cours CSV requis.', kind: 'err' }); return; }

    setIsLoading(true);
    setStatus({ message: 'Lecture des fichiers…', kind: 'inf' });

    try {
      const result = await runScheduleRequest({
        weekStr: week,
        resourcesFile,
        coursesCsvFile,
        constraintsData: loadConstraints(),
        enforcedMap,
        blockedZones,
        mode,
      });

      setScheduleResult(result);
      setSelectedSolutionIndex(0);

      const best = result.solutions[0];
      const neutralizedMsg = best.neutralizedTasks?.length
        ? ` — ${best.neutralizedTasks.length} cours non placé(s)`
        : '';
      const summary = `${best.isComplete ? '✅ Planification complète' : '⚠️ Incomplète'} — ${result.solutions.length} solution(s)${neutralizedMsg}`;
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
    setPlacedNeutralizedIds(new Set());
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

  function handleNeutralizedTaskPlaced(taskId: string) {
    setPlacedNeutralizedIds((prev) => new Set([...prev, taskId]));
  }

  function handleNeutralizedTaskRemoved(taskId: string) {
    setPlacedNeutralizedIds((prev) => {
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });
  }

  const enforcedCount = Object.keys(enforcedMap).length;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-secondary/30">

      {/* Bannière de statut */}
      {status && (
        <Alert
          className={`shrink-0 rounded-none border-x-0 border-t-0 py-2 px-6 ${
            status.kind === 'ok'
              ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300'
              : status.kind === 'err'
              ? 'border-destructive/30 bg-destructive/10 text-destructive'
              : 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
          }`}
        >
          <AlertDescription className="text-sm font-medium">{status.message}</AlertDescription>
        </Alert>
      )}
      {!status && <div className="shrink-0 h-10.5 border-b border-border bg-background/50" />}

      {/* Contenu principal : sidebar + calendrier */}
      <div className="flex flex-1 overflow-hidden">

        {/* Sidebar */}
        <aside className="w-80 shrink-0 bg-card border-r border-border p-4 overflow-y-auto flex flex-col gap-4">

          {/* Recherche (visible uniquement si résultats) */}
          {scheduleResult && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Rechercher
              </Label>
              <Input
                type="search"
                placeholder="Enseignant, salle, groupe, code, cours…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          )}

          {/* Formulaire */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">
              Planification
            </p>
            <form className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="week-input">Semaine (1–53)</Label>
                <Input
                  id="week-input"
                  type="number"
                  min="1"
                  max="53"
                  value={week}
                  onChange={(e) => setWeek(e.target.value)}
                  required
                />
              </div>

              {/* En-tête repliable pour les imports de fichiers */}
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsImportOpen((v) => !v)}
                  className="w-full justify-between px-0 mb-1.5 h-auto font-medium text-foreground hover:bg-transparent"
                >
                  <span>Fichiers d&apos;import</span>
                  <span className="text-muted-foreground text-[11px]">{isImportOpen ? '▲' : '▼'}</span>
                </Button>
                {isImportOpen && (
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label>
                        Resources <span className="text-muted-foreground font-normal">(JSON)</span>
                      </Label>
                      <input
                        type="file"
                        accept=".json"
                        onChange={(e) => setResourcesFile(e.target.files?.[0] ?? null)}
                        required
                        className="w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-secondary file:text-secondary-foreground hover:file:bg-secondary/80"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label>
                        Cours <span className="text-muted-foreground font-normal">(CSV)</span>
                      </Label>
                      <input
                        type="file"
                        accept=".csv"
                        onChange={(e) => setCoursesCsvFile(e.target.files?.[0] ?? null)}
                        required
                        className="w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-secondary file:text-secondary-foreground hover:file:bg-secondary/80"
                      />
                    </div>

                    <div className="text-xs text-muted-foreground rounded-md border border-border bg-muted/30 px-3 py-2">
                      Les contraintes sont gérées dans{' '}
                      <a href="/constraints" className="underline hover:text-foreground">
                        le module Contraintes
                      </a>.
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  onClick={() => runSchedule('standard')}
                  disabled={isLoading}
                >
                  {isLoading
                    ? 'Traitement…'
                    : enforcedCount > 0
                    ? `Planifier (${enforcedCount} imposé${enforcedCount > 1 ? 's' : ''})`
                    : 'Planifier'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => runSchedule('elimination')}
                  disabled={isLoading}
                  className="bg-orange-600 hover:bg-orange-700 text-white dark:bg-orange-500 dark:hover:bg-orange-600"
                >
                  {isLoading ? 'Traitement…' : 'Avec élimination'}
                </Button>
              </div>
            </form>
          </div>

          {/* Liste des cours de la semaine */}
          {parsedCourses.length > 0 && !scheduleResult && (
            <div className="flex flex-col gap-2">
              <Separator />
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Cours S{week}
                </p>
                <Badge variant="secondary">{parsedCourses.length} cours</Badge>
              </div>
              <p className="text-xs text-muted-foreground italic">
                Glissez un cours sur le calendrier pour l&apos;imposer.
              </p>

              {/* Tabs de regroupement */}
              <Tabs value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
                <TabsList className="w-full">
                  <TabsTrigger value="code" className="flex-1">Par code</TabsTrigger>
                  <TabsTrigger value="teacher" className="flex-1">Par enseignant</TabsTrigger>
                </TabsList>
              </Tabs>

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
                <Button
                  key={i}
                  type="button"
                  size="sm"
                  variant={selectedSolutionIndex === i ? 'default' : 'outline'}
                  onClick={() => setSelectedSolutionIndex(i)}
                  className="text-xs h-7 px-3"
                >
                  Solution {i + 1}{sol.score !== undefined ? ` — ${sol.score} pts` : ''}
                </Button>
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
            onNeutralizedTaskPlaced={handleNeutralizedTaskPlaced}
            onNeutralizedTaskRemoved={handleNeutralizedTaskRemoved}
            solutionKey={selectedSolutionIndex}
            resourcesList={resourcesData}
            constraintsData={constraintsData}
            externalDragging={externalDraggingTask ?? sidebarDraggingResources}
          />
        </main>

        {/* Sidebar droite : cours non placés (neutralisés) */}
        {activeSolution?.neutralizedTasks && activeSolution.neutralizedTasks.length > 0 && (
          <aside className="w-64 shrink-0 bg-amber-50 dark:bg-amber-950/20 border-l border-amber-200 dark:border-amber-900 p-3 overflow-y-auto flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-amber-700 dark:text-amber-400 mb-1">
              Non placés ({activeSolution.neutralizedTasks.filter((t) => !placedNeutralizedIds.has(t.taskId)).length})
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-500 italic">
              Glissez un cours sur le calendrier pour le placer.
            </p>
            <div ref={neutralizedContainerRef} className="flex flex-col gap-2">
            {activeSolution.neutralizedTasks.map((task) => {
              const teachers = task.resources.filter((r) => r.type === 'teacher').map((r) => r.id);
              const groups = task.resources.filter((r) => r.type === 'group').map((r) => r.id);
              const rooms = task.resources.filter((r) => r.type === 'room').map((r) => r.id);
              const isPlaced = placedNeutralizedIds.has(task.taskId);
              return (
                <div
                  key={task.taskId}
                  data-task-id={!isPlaced ? task.taskId : undefined}
                  data-title={`${task.code} ${task.type}`}
                  data-duration={task.duration}
                  data-teachers={JSON.stringify(teachers)}
                  data-groups={JSON.stringify(groups)}
                  data-rooms={JSON.stringify(rooms)}
                  data-code={task.code}
                  data-name={task.name}
                  data-type={task.type}
                  className={`p-2 rounded-lg border border-amber-200 dark:border-amber-800 text-xs transition-all ${
                    isPlaced
                      ? 'bg-green-50 dark:bg-green-950/30 border-green-300 dark:border-green-700 opacity-60'
                      : 'bg-amber-100/60 dark:bg-amber-900/30 cursor-grab active:cursor-grabbing hover:border-amber-400 hover:shadow-sm'
                  }`}
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
                  {isPlaced && (
                    <div className="mt-1 text-green-600 dark:text-green-400 font-medium">✅ Placé</div>
                  )}
                </div>
              );
            })}
            </div>
          </aside>
        )}

      </div>

    </div>
  );
}
