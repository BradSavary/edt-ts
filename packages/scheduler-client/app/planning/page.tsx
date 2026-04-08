'use client';

import { useState, useMemo, useRef, useCallback } from 'react';
import type { CourseTaskData } from '@edt-ts/scheduler-common';
import { useSchedulerStore } from '@/store/useSchedulerStore';
import { usePlanningStore } from '@/store/usePlanningStore';
import { useNeutralizedDraggable } from '@/hooks/useNeutralizedDraggable';
import { SidebarLeft } from '@/components/schedule/SidebarLeft';
import { NeutralizedPanel } from '@/components/schedule/NeutralizedPanel';
import ScheduleCalendar from '@/components/ScheduleCalendar';
import { type GroupBy } from '@/components/CourseGroupList';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export default function PlanningPage() {
  // ── Stores ──────────────────────────────────────────────────────────────
  const allCourses = useSchedulerStore((s) => s.allCourses);
  const resources = useSchedulerStore((s) => s.resources);

  const selectedWeek = usePlanningStore((s) => s.selectedWeek);
  const setSelectedWeek = usePlanningStore((s) => s.setSelectedWeek);
  const scheduleResult = usePlanningStore((s) => s.scheduleResult);
  const selectedSolutionIndex = usePlanningStore((s) => s.selectedSolutionIndex);
  const setSelectedSolutionIndex = usePlanningStore((s) => s.setSelectedSolutionIndex);
  const activeSolution = usePlanningStore((s) => s.activeSolution);
  const activeNeutralizedTasks = usePlanningStore((s) => s.activeNeutralizedTasks);
  const searchQuery = usePlanningStore((s) => s.searchQuery);
  const setSearchQuery = usePlanningStore((s) => s.setSearchQuery);
  const isLoading = usePlanningStore((s) => s.isLoading);
  const status = usePlanningStore((s) => s.status);
  const enforcedMap = usePlanningStore((s) => s.enforcedMap);
  const blockedZones = usePlanningStore((s) => s.blockedZones);
  const runSchedule = usePlanningStore((s) => s.runSchedule);
  const handleEnforceChange = usePlanningStore((s) => s.handleEnforceChange);
  const handleBlockedZoneAdd = usePlanningStore((s) => s.handleBlockedZoneAdd);
  const handleBlockedZoneRemove = usePlanningStore((s) => s.handleBlockedZoneRemove);
  const handleBlockedZoneMove = usePlanningStore((s) => s.handleBlockedZoneMove);

  // ── Semaine ──────────────────────────────────────────────────────────────
  const weekStr = selectedWeek !== null ? String(selectedWeek) : '1';

  const handleSetWeek = useCallback((v: string) => {
    const n = parseInt(v, 10);
    if (!isNaN(n) && n >= 1 && n <= 53) setSelectedWeek(n);
  }, [setSelectedWeek]);

  // ── Cours dérivés pour la semaine courante ───────────────────────────────
  const parsedCourses: CourseTaskData[] = useMemo(
    () => selectedWeek !== null ? allCourses.filter((c) => c.week === selectedWeek) : [],
    [allCourses, selectedWeek],
  );

  // ── Solutions filtrées (recherche) ───────────────────────────────────────
  const filteredSolutions = useMemo(() => {
    const tasks = activeSolution ?? [];
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

  // ── UI local ─────────────────────────────────────────────────────────────
  const [groupBy, setGroupBy] = useState<GroupBy>('code');
  const [sidebarDraggingResources, setSidebarDraggingResources] = useState<{
    teachers: string[]; groups: string[]; rooms: string[];
  } | null>(null);
  const [externalDraggingTask, setExternalDraggingTask] = useState<{
    id: string; teachers: string[]; groups: string[]; rooms: string[];
  } | null>(null);

  const neutralizedContainerRef = useRef<HTMLDivElement | null>(null);

  const handleExternalDragStart = useCallback(
    (task: { id: string; teachers: string[]; groups: string[]; rooms: string[] }) =>
      setExternalDraggingTask(task),
    [],
  );
  const handleExternalDragEnd = useCallback(() => setExternalDraggingTask(null), []);

  useNeutralizedDraggable({
    containerRef: neutralizedContainerRef,
    neutralizedTasks: activeNeutralizedTasks.length > 0 ? activeNeutralizedTasks : undefined,
    onExternalDragStart: handleExternalDragStart,
    onExternalDragEnd: handleExternalDragEnd,
  });

  const calendarWeek = selectedWeek ?? 1;
  const enforcedCount = Object.keys(enforcedMap).length;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-secondary/30">

      {/* Contenu principal */}
      <div className="flex flex-1 overflow-hidden">

        <SidebarLeft
          week={weekStr}
          setWeek={handleSetWeek}
          parsedCourses={parsedCourses}
          enforcedMap={enforcedMap}
          groupBy={groupBy}
          setGroupBy={setGroupBy}
          scheduleResult={scheduleResult}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          isLoading={isLoading}
          enforcedCount={enforcedCount}
          runSchedule={runSchedule}
          onDragStart={setSidebarDraggingResources}
          onDragEnd={() => setSidebarDraggingResources(null)}
        />

        <main className="flex-1 overflow-hidden p-4 flex flex-col">
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
            solutionKey={selectedSolutionIndex}
            resourcesList={resources}
            externalDragging={externalDraggingTask ?? sidebarDraggingResources}
          />
        </main>

        {activeNeutralizedTasks.length > 0 && (
          <NeutralizedPanel
            tasks={activeNeutralizedTasks}
            containerRef={neutralizedContainerRef}
          />
        )}

      </div>

      {/* Bannière de statut */}
      {status ? (
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
      ) : (
        <div className="shrink-0 h-10.5 border-b border-border bg-background/50" />
      )}
    </div>
  );
}
