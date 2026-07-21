'use client';

import { useRef, useMemo, useState } from 'react';
import type { NeutralizedTaskInfoJSON, ResourceEntry } from '@edt-ts/scheduler-common';
import { usePlanningStore } from '@/store/usePlanningStore';
import { useProjectStore } from '@/store/useProjectStore';
import { useNeutralizedDraggable } from '@/hooks/useNeutralizedDraggable';
import { downloadIcalSolution } from '@/lib/icalExport';
import { matchesSearchQuery } from '@/lib/calendar/calendarUtils';
import { toTaskSolutionJSON } from '@/lib/calendar/placements';
import { selectPiocheEntries } from '@/lib/calendar/unplaced';
import { getCoursesForWeek } from '@/lib/weekCourses';
import type { CourseTaskDataWithId } from '@/lib/courseId';
import type { Unplaced } from '@/store/types';
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
import { courseToBaseProps, normalizeResourceEntries } from '@/lib/taskCardUtils';
import { buildAnalysisLoadRows } from '@/lib/resourceLoadAnalysis';

/** Ressources candidates (toutes alternatives, dédupliquées) — même règle que
 *  `serializeNeutralizedUnit` côté API. Adaptateur local : `buildAnalysisLoadRows` n'est pas
 *  modifié, il vit dans `lib/resourceLoadAnalysis.ts` et reste couvert par ses propres tests. */
function candidateIds(entries: ResourceEntry[]): string[] {
  const ids = new Set<string>();
  for (const e of entries) for (const id of Array.isArray(e) ? e : [e]) ids.add(id);
  return [...ids];
}

function toEngineNeutralizedInfo(entry: Unplaced, course: CourseTaskDataWithId): NeutralizedTaskInfoJSON {
  return {
    task: {
      taskId: entry.taskId,
      code: course.code,
      name: course.name,
      type: course.type,
      week: course.week,
      duration: course.duration,
      startTime: -1,
      resources: [
        ...candidateIds(course.teacher).map((id) => ({ id, type: 'teacher' })),
        ...candidateIds(course.groups).map((id) => ({ id, type: 'group' })),
        ...candidateIds(course.rooms ?? []).map((id) => ({ id, type: 'room' })),
      ],
    },
    eliminationRound: entry.diagnostics?.eliminationRound ?? 0,
    failureCount: entry.diagnostics?.failureCount ?? 0,
    reason: entry.diagnostics?.reason ?? '',
  };
}

export function SidebarAnalysis() {
  const resetScheduleResult = usePlanningStore((s) => s.resetScheduleResult);
  const scheduleResult = usePlanningStore((s) => s.scheduleResult);
  const placements = usePlanningStore((s) => s.placements);
  const unplaced = usePlanningStore((s) => s.unplaced);
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

  // Résolution de cours nécessaire à toTaskSolutionJSON (règle 1, §3 du plan) : les placements
  // ne recopient plus code/name/type.
  const courseById = useMemo(() => {
    const courses = selectedWeek !== null ? getCoursesForWeek(allCourses, weekSaves, selectedWeek) : [];
    return new Map(courses.map((c) => [c.id, c]));
  }, [allCourses, weekSaves, selectedWeek]);

  // Pioche unique : une seule dérivation, quelle que soit l'origine (§4.5 du plan).
  const piocheEntries = useMemo(
    () => selectPiocheEntries(unplaced, placements, courseById),
    [unplaced, placements, courseById],
  );

  useNeutralizedDraggable({
    containerRef: neutralizedContainerRef,
    hasItems: piocheEntries.length > 0,
  });

  const iCalWeek = selectedWeek ?? 1;

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

  const filteredPiocheEntries = piocheEntries.filter(({ course }) =>
    matchesSearchQuery(
      [course.code, course.name, course.type, ...normalizeResourceEntries(course.teacher), ...normalizeResourceEntries(course.groups), ...normalizeResourceEntries(course.rooms ?? [])],
      searchQuery,
    ),
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
        {piocheEntries.length > 0 && (
          <>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Non placés
              </p>
              <Badge variant="secondary">{filteredPiocheEntries.length}</Badge>
            </div>
            <p className="text-xs text-muted-foreground italic">
              Glissez un cours sur le calendrier pour le placer.
            </p>
            <div ref={neutralizedContainerRef} className="flex flex-col gap-2">
              {filteredPiocheEntries.map(({ entry, course, remaining }) => {
                const tooltipContent =
                  entry.origin === 'engine'
                    ? [entry.diagnostics?.reason, `Échecs : ${entry.diagnostics?.failureCount ?? 0}`].filter(Boolean).join('\n')
                    : entry.origin === 'user-pre'
                      ? 'Neutralisée manuellement avant planification'
                      : 'Retirée manuellement du calendrier';
                const baseProps = courseToBaseProps(course);
                // Une tâche déjà partiellement distribuée (Autonomie) reste dans la pioche avec
                // sa durée résiduelle, mais ne peut pas être redéposée tant qu'elle ne l'est pas
                // annulée — même état pilote le libellé du bouton (§4.5 du plan).
                const hasPlacements = placements.some((p) => p.taskId === entry.taskId);
                const isAutonomie = course.type === 'Autonomie';
                return (
                  <div key={entry.taskId} className="relative">
                    <NeutralizedTaskCard
                      {...baseProps}
                      duration={remaining}
                      taskId={entry.taskId}
                      tooltipContent={tooltipContent}
                      dragEnabled={!hasPlacements}
                      onDistribute={
                        isAutonomie
                          ? () => (hasPlacements ? cancelAutonomyDistribution(entry.taskId) : distributeAutonomy(entry.taskId))
                          : undefined
                      }
                      distributeLabel={hasPlacements ? 'Annuler la répartition' : 'Répartir'}
                    />
                    {entry.origin === 'engine' && availabilityManager && selectedWeek !== null && (
                      <div className="absolute top-1 right-1">
                        <ResourceLoadPopover
                          mode="analysis"
                          taskDurationMin={course.duration}
                          rows={buildAnalysisLoadRows(
                            toEngineNeutralizedInfo(entry, course),
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
