'use client';

import { useState, useMemo, useEffect } from 'react';
import type { CourseTaskDataWithId } from '@/lib/courseId';
import { getCoursesForWeek } from '@/lib/weekCourses';
import { useProjectStore } from '@/store/useProjectStore';
import { usePlanningStore } from '@/store/usePlanningStore';
import { SidebarLeft } from '@/components/planning/sidebar/SidebarLeft';
import { GroupDrawer } from '@/components/planning/courses/GroupDrawer';
import ScheduleCalendar from '@/components/planning/calendar/ScheduleCalendar';
import { matchesSearchQuery } from '@/lib/calendar/calendarUtils';
import { toTaskSolutionJSON } from '@/lib/calendar/placements';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { StatisticsDialog } from '@/components/planning/modals/StatisticsDialog';

export default function PlanningPage() {
  // ── Stores ──────────────────────────────────────────────────────────────
  const allCourses = useProjectStore((s) => s.allCourses);
  const weekSaves = useProjectStore((s) => s.weekSaves);
  const resources = useProjectStore((s) => s.resources);

  const selectedWeek = usePlanningStore((s) => s.selectedWeek);
  const setSelectedWeek = usePlanningStore((s) => s.setSelectedWeek);
  // `lastRun` (persisté) plutôt que `scheduleResult` (session uniquement) : la présence des
  // actions solution ("↺ Réinitialiser", Statistiques) doit survivre au rechargement (§4.6).
  const lastRun = usePlanningStore((s) => s.lastRun);
  const resetCurrentSolution = usePlanningStore((s) => s.resetCurrentSolution);
  const placements = usePlanningStore((s) => s.placements);
  const unplaced = usePlanningStore((s) => s.unplaced);
  const searchQuery = usePlanningStore((s) => s.searchQuery);
  const status = usePlanningStore((s) => s.status);
  const pendingJobResult = usePlanningStore((s) => s.pendingJobResult);
  const applyPendingResult = usePlanningStore((s) => s.applyPendingResult);

  // ── Auto-application du résultat en attente si on est sur la bonne semaine ──
  useEffect(() => {
    if (pendingJobResult && pendingJobResult.week === selectedWeek) {
      applyPendingResult();
    }
  }, [pendingJobResult, selectedWeek, applyPendingResult]);

  // ── État local ──────────────────────────────────────────────────────────
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [statsDialogOpen, setStatsDialogOpen] = useState(false);
  // Déménagé tel quel depuis SidebarPreparation (§3.1 du plan) : la barre d'outils permanente
  // remplace la sidebar comme seul point d'entrée du sélecteur de semaine.
  const [weekInput, setWeekInput] = useState<string>(selectedWeek !== null ? String(selectedWeek) : '');

  function handleSetWeek(v: string) {
    setWeekInput(v);
    if (v === '') {
      setSelectedWeek(null);
      return;
    }
    const n = parseInt(v, 10);
    if (isNaN(n)) return;
    // Cycle sur 52 semaines : au-delà de 52 on repart à 1, en dessous de 1 on reboucle sur 52
    // (pas de bornes natives min/max — une année universitaire n'a pas de "semaine 1" logique).
    const wrapped = ((n - 1) % 52 + 52) % 52 + 1;
    setWeekInput(String(wrapped));
    setSelectedWeek(wrapped);
  }

  // ── Cours dérivés pour la semaine courante ───────────────────────────────
  const parsedCourses: CourseTaskDataWithId[] = useMemo(
    () => selectedWeek !== null ? getCoursesForWeek(allCourses, weekSaves, selectedWeek) : [],
    [allCourses, weekSaves, selectedWeek],
  );

  // ── Cours indexés par id (résolution code/name/type/duration — règle 1, §3 du plan) ─────────
  const courseById = useMemo(
    () => new Map(parsedCourses.map((c) => [c.id, c])),
    [parsedCourses],
  );

  // ── Placements filtrés (recherche) ───────────────────────────────────────
  const filteredPlacements = useMemo(
    () => placements.filter((p) => {
      const course = courseById.get(p.taskId);
      return matchesSearchQuery(
        [course?.code ?? '', course?.name ?? '', course?.type ?? '', ...p.resources.teachers, ...p.resources.rooms, ...p.resources.groups],
        searchQuery,
      );
    }),
    [placements, courseById, searchQuery],
  );

  // ── Placements convertis pour StatisticsDialog (frontière TaskSolutionJSON[]) ───────────────
  const statisticsSolution = useMemo(
    () => placements.map((p) => toTaskSolutionJSON(p, courseById.get(p.taskId), selectedWeek ?? 1)),
    [placements, courseById, selectedWeek],
  );

  // ── Bandeau reconstruit après rechargement : plus de `scheduleResult` (métadonnées de calcul
  // non persistées), donc pas de prétention à l'optimalité — juste un décompte (§4.6 du plan).
  const fallbackStatus = useMemo(() => {
    if (status || lastRun === null) return null;
    const placedCount = new Set(placements.map((p) => p.taskId)).size;
    return { message: `${placedCount} cours placé(s), ${unplaced.length} non placé(s)`, kind: 'inf' as const };
  }, [status, lastRun, placements, unplaced]);
  const displayedStatus = status ?? fallbackStatus;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-secondary/30">

      {/* Contenu principal */}
      <div className="flex flex-1 overflow-hidden">

        <SidebarLeft parsedCourses={parsedCourses} />

        <GroupDrawer parsedCourses={parsedCourses} />

        <main className="flex-1 overflow-hidden p-4 flex flex-col">
          {/* Barre d'outils permanente : le sélecteur de semaine ne dépend plus de l'état de
              planification (§3.1 du plan) — seuls Statistiques/Réinitialiser restent conditionnés
              par l'existence d'une solution (`lastRun`). */}
          <div className="flex flex-wrap gap-2 mb-2 shrink-0 items-center">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="week-input" className="text-xs whitespace-nowrap">Semaine (1-52)</Label>
              <Input
                id="week-input"
                type="number"
                value={weekInput}
                onChange={(e) => handleSetWeek(e.target.value)}
                className="w-20 h-7 text-xs"
              />
            </div>
            {lastRun !== null && (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setStatsDialogOpen(true)}
                  className="text-xs h-7 px-3 ml-auto"
                  title="Afficher les statistiques de la solution"
                >
                  Statistiques
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setResetDialogOpen(true)}
                  className="text-xs h-7 px-3 text-muted-foreground hover:text-destructive"
                  title="Remettre la solution à son état initial"
                >
                  ↺ Réinitialiser
                </Button>
              </>
            )}
          </div>

          <ScheduleCalendar
            placements={filteredPlacements}
            parsedCourses={parsedCourses}
          />
        </main>

      </div>

      {/* Bannière de statut */}
      {displayedStatus ? (
        <Alert
          className={`shrink-0 rounded-none border-x-0 border-t-0 py-2 px-6 ${
            displayedStatus.kind === 'ok'
              ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300'
              : displayedStatus.kind === 'err'
              ? 'border-destructive/30 bg-destructive/10 text-destructive'
              : 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
          }`}
        >
          <AlertDescription className="text-sm font-medium">{displayedStatus.message}</AlertDescription>
        </Alert>
      ) : (
        <div className="shrink-0 h-10.5 border-b border-border bg-background/50" />
      )}
      {/* Dialog statistiques */}
      <StatisticsDialog
        open={statsDialogOpen}
        onOpenChange={setStatsDialogOpen}
        activeSolution={statisticsSolution}
        resources={resources}
      />
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

