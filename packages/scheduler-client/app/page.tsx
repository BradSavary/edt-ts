'use client';

import { useState, useRef, useCallback } from 'react';
import { useScheduleState } from '@/hooks/useScheduleState';
import { useNeutralizedDraggable } from '@/hooks/useNeutralizedDraggable';
import { SidebarLeft } from '@/components/schedule/SidebarLeft';
import { NeutralizedPanel } from '@/components/schedule/NeutralizedPanel';
import ScheduleCalendar from '@/components/ScheduleCalendar';
import { type GroupBy } from '@/components/CourseGroupList';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export default function SchedulePage() {
  const state = useScheduleState();
  const [groupBy, setGroupBy] = useState<GroupBy>('code');
  const [isImportOpen, setIsImportOpen] = useState(true);
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
    neutralizedTasks: state.activeSolution?.neutralizedTasks,
    onExternalDragStart: handleExternalDragStart,
    onExternalDragEnd: handleExternalDragEnd,
  });

  const calendarWeek = parseInt(state.week, 10) || 1;
  const enforcedCount = Object.keys(state.enforcedMap).length;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-secondary/30">

      {/* Contenu principal */}
      <div className="flex flex-1 overflow-hidden">

        <SidebarLeft
          week={state.week}
          setWeek={state.setWeek}
          setResourcesFile={state.setResourcesFile}
          setCoursesCsvFile={state.setCoursesCsvFile}
          parsedCourses={state.parsedCourses}
          enforcedMap={state.enforcedMap}
          groupBy={groupBy}
          setGroupBy={setGroupBy}
          scheduleResult={state.scheduleResult}
          searchQuery={state.searchQuery}
          setSearchQuery={state.setSearchQuery}
          isLoading={state.isLoading}
          enforcedCount={enforcedCount}
          runSchedule={state.runSchedule}
          isImportOpen={isImportOpen}
          setIsImportOpen={setIsImportOpen}
          onDragStart={setSidebarDraggingResources}
          onDragEnd={() => setSidebarDraggingResources(null)}
        />

        <main className="flex-1 overflow-hidden p-4 flex flex-col">
          {state.scheduleResult && state.scheduleResult.solutions.length > 1 && (
            <div className="flex flex-wrap gap-1 mb-2 shrink-0">
              {state.scheduleResult.solutions.map((sol, i) => (
                <Button
                  key={i}
                  type="button"
                  size="sm"
                  variant={state.selectedSolutionIndex === i ? 'default' : 'outline'}
                  onClick={() => state.setSelectedSolutionIndex(i)}
                  className="text-xs h-7 px-3"
                >
                  Solution {i + 1}{sol.score !== undefined ? ` — ${sol.score} pts` : ''}
                </Button>
              ))}
            </div>
          )}

          <ScheduleCalendar
            solutions={state.filteredSolutions}
            week={calendarWeek}
            parsedCourses={state.parsedCourses}
            onEnforceChange={state.handleEnforceChange}
            blockedZones={state.blockedZones}
            onBlockedZoneAdd={state.handleBlockedZoneAdd}
            onBlockedZoneRemove={state.handleBlockedZoneRemove}
            onBlockedZoneMove={state.handleBlockedZoneMove}
            onNeutralizedTaskPlaced={state.handleNeutralizedTaskPlaced}
            onNeutralizedTaskRemoved={state.handleNeutralizedTaskRemoved}
            solutionKey={state.selectedSolutionIndex}
            resourcesList={state.resourcesData}
            constraintsData={state.constraintsData}
            externalDragging={externalDraggingTask ?? sidebarDraggingResources}
          />
        </main>

        {state.activeSolution?.neutralizedTasks && state.activeSolution.neutralizedTasks.length > 0 && (
          <NeutralizedPanel
            tasks={state.activeSolution.neutralizedTasks}
            placedNeutralizedIds={state.placedNeutralizedIds}
            containerRef={neutralizedContainerRef}
          />
        )}

      </div>
            {/* Bannière de statut */}
      {state.status ? (
        <Alert
          className={`shrink-0 rounded-none border-x-0 border-t-0 py-2 px-6 ${
            state.status.kind === 'ok'
              ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300'
              : state.status.kind === 'err'
              ? 'border-destructive/30 bg-destructive/10 text-destructive'
              : 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
          }`}
        >
          <AlertDescription className="text-sm font-medium">{state.status.message}</AlertDescription>
        </Alert>
      ) : (
        <div className="shrink-0 h-10.5 border-b border-border bg-background/50" />
      )}
    </div>
  );
}

