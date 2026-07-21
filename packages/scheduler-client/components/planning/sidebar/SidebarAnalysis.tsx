'use client';

import { useRef, useMemo, useState } from 'react';
import { usePlanningStore } from '@/store/usePlanningStore';
import { useProjectStore } from '@/store/useProjectStore';
import { useNeutralizedDraggable } from '@/hooks/useNeutralizedDraggable';
import { downloadIcalSolution } from '@/lib/icalExport';
import { matchesSearchQuery } from '@/lib/calendar/calendarUtils';
import { toTaskSolutionJSON } from '@/lib/calendar/placements';
import { getCoursesForWeek } from '@/lib/weekCourses';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import NeutralizedTaskCard from '@/components/planning/courses/NeutralizedTaskCard';
import ResourceLoadPopover from '@/components/planning/courses/ResourceLoadPopover';
import { solutionToBaseProps, manuallyNeutralizedToBaseProps, selectUnplacedNeutralized, PRE_NEUTRAL_PREFIX } from '@/lib/taskCardUtils';
import { buildAnalysisLoadRows } from '@/lib/resourceLoadAnalysis';

export function SidebarAnalysis() {
  const resetScheduleResult = usePlanningStore((s) => s.resetScheduleResult);
  const scheduleResult = usePlanningStore((s) => s.scheduleResult);
  const placements = usePlanningStore((s) => s.placements);
  const activeNeutralizedTasks = usePlanningStore((s) => s.activeNeutralizedTasks);
  const manuallyNeutralizedTasks = usePlanningStore((s) => s.manuallyNeutralizedTasks);
  const autonomyDistributions = usePlanningStore((s) => s.autonomyDistributions);
  const distributeAutonomy = usePlanningStore((s) => s.distributeAutonomy);
  const cancelAutonomyDistribution = usePlanningStore((s) => s.cancelAutonomyDistribution);
  const searchQuery = usePlanningStore((s) => s.searchQuery);
  const setSearchQuery = usePlanningStore((s) => s.setSearchQuery);
  const selectedWeek = usePlanningStore((s) => s.selectedWeek);
  const blockedZones = usePlanningStore((s) => s.blockedZones);
  const schoolYearConfig = useProjectStore((s) => s.schoolYearConfig);
  const availabilityManager = useProjectStore((s) => s.availabilityManager);
  const resources = useProjectStore((s) => s.resources);
  const allCourses = useProjectStore((s) => s.allCourses);
  const weekSaves = useProjectStore((s) => s.weekSaves);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const neutralizedContainerRef = useRef<HTMLDivElement | null>(null);

  useNeutralizedDraggable({
    containerRef: neutralizedContainerRef,
    hasItems: selectUnplacedNeutralized(activeNeutralizedTasks, placements).length > 0 || manuallyNeutralizedTasks.length > 0,
  });

  const iCalWeek = selectedWeek ?? 1;

  // Résolution de cours nécessaire à toTaskSolutionJSON (règle 1, §3 du plan) : les placements
  // ne recopient plus code/name/type.
  const courseById = useMemo(() => {
    const courses = selectedWeek !== null ? getCoursesForWeek(allCourses, weekSaves, selectedWeek) : [];
    return new Map(courses.map((c) => [c.id, c]));
  }, [allCourses, weekSaves, selectedWeek]);

  // Export iCal : les placements (toutes origines confondues) reflètent l'état affiché,
  // retouches manuelles comprises — remplace filteredSolutions + filteredPlacedNeutralized.
  const filteredPlacements = useMemo(() => {
    return placements
      .filter((p) => {
        const course = courseById.get(p.taskId);
        return matchesSearchQuery(
          [course?.code ?? '', course?.name ?? '', course?.type ?? '', ...p.resources.teachers, ...p.resources.rooms, ...p.resources.groups],
          searchQuery,
        );
      })
      .map((p) => toTaskSolutionJSON(p, courseById.get(p.taskId), iCalWeek));
  }, [placements, courseById, searchQuery, iCalWeek]);

  const unplacedNeutralized = selectUnplacedNeutralized(activeNeutralizedTasks, placements);
  const hasAnyNeutralizedItems = unplacedNeutralized.length > 0 || manuallyNeutralizedTasks.length > 0;

  const filteredUnplacedNeutralized = unplacedNeutralized.filter((t) =>
    matchesSearchQuery([t.task.code, t.task.name, t.task.type, ...t.task.resources.map((r) => r.id)], searchQuery),
  );
  const filteredManuallyNeutralized = manuallyNeutralizedTasks.filter((task) =>
    matchesSearchQuery([task.code, task.name, task.type, ...task.teachers, ...task.rooms, ...task.groups], searchQuery),
  );

  function handleConfirmRetour() {
    setConfirmOpen(false);
    setSearchQuery('');
    resetScheduleResult();
  }

  return (
    <>
      <aside className="w-80 shrink-0 bg-card border-r border-border p-4 overflow-y-auto flex flex-col gap-4">
        <Button
          type="button"
          variant="ghost"
          className="w-full text-muted-foreground justify-start p-1 pt-0 pb-0"
          onClick={() => setConfirmOpen(true)}
        >
          ← Retour à la préparation
        </Button>

        {/* Recherche */}
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Rechercher
          </Label>
          <Input
            type="search"
            placeholder="Enseignant, salle, groupe, code, type, cours… (AND / OR)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <Separator />

        {/* Actions */}
        <div className="flex flex-col gap-2">
          {scheduleResult !== null && (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => downloadIcalSolution(filteredPlacements, iCalWeek, schoolYearConfig, searchQuery)}
            >
              {searchQuery.trim() ? 'Exporter (filtré) en iCal' : 'Exporter en iCal'}
            </Button>
          )}
        </div>

        {/* Pioche — tâches neutralisées et tâches retirées du calendrier */}
        {hasAnyNeutralizedItems && (
          <>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Non placés
              </p>
              <Badge variant="secondary">{filteredUnplacedNeutralized.length + filteredManuallyNeutralized.length}</Badge>
            </div>
            <p className="text-xs text-muted-foreground italic">
              Glissez un cours sur le calendrier pour le placer.
            </p>
            <div ref={neutralizedContainerRef} className="flex flex-col gap-2">
              {/* Tâches neutralisées par le moteur ou pré-neutralisées */}
              {filteredUnplacedNeutralized.map((neutralizedInfo) => {
                const task = neutralizedInfo.task;
                const isPreNeutralized = task.taskId.startsWith(PRE_NEUTRAL_PREFIX);
                const tooltipLines: string[] = [neutralizedInfo.reason];
                if (!isPreNeutralized) {
                  tooltipLines.push(`Échecs : ${neutralizedInfo.failureCount}`);
                  if (neutralizedInfo.requiredMinutes !== undefined) {
                    tooltipLines.push(`Temps nécessaire : ${neutralizedInfo.requiredMinutes} min`);
                  }
                  if (neutralizedInfo.schedulableMinutes !== undefined) {
                    tooltipLines.push(`Temps dispo : ${neutralizedInfo.schedulableMinutes} min`);
                  }
                  if (neutralizedInfo.resourceSnapshots && neutralizedInfo.resourceSnapshots.length > 0) {
                    const conflicting = neutralizedInfo.resourceSnapshots.filter(
                      (s) => s.availableMinutes < (neutralizedInfo.requiredMinutes ?? Infinity),
                    );
                    if (conflicting.length > 0) {
                      tooltipLines.push(`Ressources limitantes : ${conflicting.map((s) => s.resourceId).join(', ')}`);
                    }
                  }
                }
                const baseProps = solutionToBaseProps(task);
                const dist = autonomyDistributions[task.taskId];
                const isAutonomie = task.type === 'Autonomie';
                return (
                  <div key={task.taskId} className="relative">
                    <NeutralizedTaskCard
                      {...baseProps}
                      duration={dist ? dist.remainingDuration : baseProps.duration}
                      taskId={task.taskId}
                      tooltipContent={tooltipLines.join('\n')}
                      dragEnabled={!dist}
                      onDistribute={
                        isAutonomie
                          ? () => (dist ? cancelAutonomyDistribution(task.taskId) : distributeAutonomy(task.taskId))
                          : undefined
                      }
                      distributeLabel={dist ? 'Annuler la répartition' : 'Répartir'}
                    />
                    {!isPreNeutralized && availabilityManager && selectedWeek !== null && (
                      <div className="absolute top-1 right-1">
                        <ResourceLoadPopover
                          mode="analysis"
                          taskDurationMin={task.duration}
                          rows={buildAnalysisLoadRows(
                            neutralizedInfo,
                            scheduleResult?.solution?.tasks ?? [],
                            availabilityManager,
                            selectedWeek,
                            resources,
                            blockedZones,
                            schoolYearConfig,
                          )}
                        />
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Tâches retirées manuellement du calendrier */}
              {filteredManuallyNeutralized.map((task) => {
                const baseProps = manuallyNeutralizedToBaseProps(task);
                const dist = autonomyDistributions[task.taskId];
                const isAutonomie = task.type === 'Autonomie';
                return (
                  <NeutralizedTaskCard
                    key={task.taskId}
                    {...baseProps}
                    duration={dist ? dist.remainingDuration : baseProps.duration}
                    taskId={task.taskId}
                    tooltipContent="Retirée manuellement du calendrier"
                    dragEnabled={!dist}
                    onDistribute={
                      isAutonomie
                        ? () => (dist ? cancelAutonomyDistribution(task.taskId) : distributeAutonomy(task.taskId))
                        : undefined
                    }
                    distributeLabel={dist ? 'Annuler la répartition' : 'Répartir'}
                  />
                );
              })}
            </div>
          </>
        )}
      </aside>

      {/* Dialog de confirmation */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Retour à la préparation</DialogTitle>
            <DialogDescription>
              Attention, cette action va supprimer toutes les solutions en cours. Voulez-vous continuer ?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Annuler</Button>
            <Button variant="destructive" onClick={handleConfirmRetour}>Confirmer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
