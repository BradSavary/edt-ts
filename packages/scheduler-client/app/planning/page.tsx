'use client';

import { useState, useMemo } from 'react';
import type { CourseTaskData } from '@edt-ts/scheduler-common';
import { useSchedulerStore } from '@/store/useSchedulerStore';
import { usePlanningStore } from '@/store/usePlanningStore';
import { SidebarLeft } from '@/components/planning/sidebar/SidebarLeft';
import { GroupDrawer } from '@/components/planning/courses/GroupDrawer';
import ScheduleCalendar from '@/components/planning/calendar/ScheduleCalendar';
import { filterSolutionsByQuery } from '@/lib/calendar/calendarUtils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export default function PlanningPage() {
  // ── Stores ──────────────────────────────────────────────────────────────
  const allCourses = useSchedulerStore((s) => s.allCourses);

  const selectedWeek = usePlanningStore((s) => s.selectedWeek);
  const scheduleResult = usePlanningStore((s) => s.scheduleResult);
  const selectedSolutionIndex = usePlanningStore((s) => s.selectedSolutionIndex);
  const setSelectedSolutionIndex = usePlanningStore((s) => s.setSelectedSolutionIndex);
  const resetCurrentSolution = usePlanningStore((s) => s.resetCurrentSolution);
  const activeSolution = usePlanningStore((s) => s.activeSolution);
  const searchQuery = usePlanningStore((s) => s.searchQuery);
  const status = usePlanningStore((s) => s.status);

  // ── État local ──────────────────────────────────────────────────────────
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  // ── Cours dérivés pour la semaine courante ───────────────────────────────
  const parsedCourses: CourseTaskData[] = useMemo(
    () => selectedWeek !== null ? allCourses.filter((c) => c.week === selectedWeek) : [],
    [allCourses, selectedWeek],
  );

  // ── Solutions filtrées (recherche) ───────────────────────────────────────
  const filteredSolutions = useMemo(
    () => filterSolutionsByQuery(activeSolution ?? [], searchQuery),
    [activeSolution, searchQuery],
  );

  return (
    <div className="h-full flex flex-col overflow-hidden bg-secondary/30">

      {/* Contenu principal */}
      <div className="flex flex-1 overflow-hidden">

        <SidebarLeft parsedCourses={parsedCourses} />

        <GroupDrawer parsedCourses={parsedCourses} />

        <main className="flex-1 overflow-hidden p-4 flex flex-col">
          {scheduleResult && (
            <div className="flex flex-wrap gap-1 mb-2 shrink-0 items-center">
              {scheduleResult.solutions.length > 1 && scheduleResult.solutions.map((sol, i) => (
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
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setResetDialogOpen(true)}
                className="text-xs h-7 px-3 text-muted-foreground hover:text-destructive ml-auto"
                title="Remettre la solution à son état initial"
              >
                ↺ Réinitialiser
              </Button>
            </div>
          )}

          <ScheduleCalendar
            solutions={filteredSolutions}
            parsedCourses={parsedCourses}
          />
        </main>

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
      {/* Dialog de réinitialisation de la solution */}
      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Réinitialiser la solution</DialogTitle>
            <DialogDescription>
              Réinitialiser la solution va supprimer toutes les modifications apportées à celle-ci. Voulez-vous continuer ?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetDialogOpen(false)}>Annuler</Button>
            <Button variant="destructive" onClick={() => { resetCurrentSolution(); setResetDialogOpen(false); }}>Réinitialiser</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

