'use client';

import { useRef, useMemo, useState } from 'react';
import type { NeutralizedTaskInfoJSON, ResourceEntry } from '@edt-ts/scheduler-common';
import { usePlanningStore } from '@/store/usePlanningStore';
import { useProjectStore } from '@/store/useProjectStore';
import { useNeutralizedDraggable } from '@/hooks/useNeutralizedDraggable';
import { downloadIcalSolution } from '@/lib/icalExport';
import { matchesSearchQuery, formatStartTime } from '@/lib/calendar/calendarUtils';
import { toTaskSolutionJSON } from '@/lib/calendar/placements';
import { selectPromotionCandidates } from '@/lib/calendar/promotion';
import { selectPiocheEntries } from '@/lib/calendar/unplaced';
import { getCoursesForWeek } from '@/lib/weekCourses';
import type { CourseTaskDataWithId } from '@/lib/courseId';
import type { Unplaced } from '@/store/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  // Nom hérité de l'ancienne formulation « retour à la préparation » : le geste ne sert plus à
  // naviguer (le sélecteur de semaine vit désormais dans la barre d'outils, §3.1 du plan), mais
  // seulement à annuler la planification automatique — non renommé pour ne pas brouiller le lien
  // avec le code déjà écrit (§3.2 du plan).
  const returnToPreparation = usePlanningStore((s) => s.returnToPreparation);
  const scheduleResult = usePlanningStore((s) => s.scheduleResult);
  // `lastRun` (persisté) plutôt que `scheduleResult` (session uniquement) pour le bouton export :
  // même raisonnement que la bascule de mode (§4.6 du plan) — sinon il disparaît après rechargement.
  const lastRun = usePlanningStore((s) => s.lastRun);
  const placements = usePlanningStore((s) => s.placements);
  const unplaced = usePlanningStore((s) => s.unplaced);
  const taskGroups = usePlanningStore((s) => s.taskGroups);
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
  const [checkedPromotionIds, setCheckedPromotionIds] = useState<Set<string>>(new Set());
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

  // Retouches proposables à la promotion en impositions, au retour à la préparation.
  const promotionCandidates = useMemo(
    () => selectPromotionCandidates(placements, taskGroups, courseById),
    [placements, taskGroups, courseById],
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

  function openReturnDialog() {
    setCheckedPromotionIds(new Set());
    setConfirmOpen(true);
  }

  function togglePromotionChecked(placementId: string) {
    setCheckedPromotionIds((prev) => {
      const next = new Set(prev);
      if (next.has(placementId)) next.delete(placementId);
      else next.add(placementId);
      return next;
    });
  }

  function handleConfirmRetour() {
    setConfirmOpen(false);
    setSearchQuery('');
    returnToPreparation([...checkedPromotionIds]);
  }

  return (
    <>
      <aside className="w-80 shrink-0 bg-card border-r border-border p-4 overflow-y-auto flex flex-col gap-4">
        <Button
          type="button"
          variant="ghost"
          className="w-full text-muted-foreground justify-start p-1 pt-0 pb-0"
          onClick={openReturnDialog}
        >
          Annuler la planification automatique
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
          {lastRun !== null && (
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

      {/* Dialog de confirmation / promotion des retouches */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Annuler la planification automatique</DialogTitle>
            <DialogDescription>
              {promotionCandidates.length === 0
                ? 'Attention, cette action va supprimer toutes les solutions en cours. Voulez-vous continuer ?'
                : 'Les retouches manuelles vont être perdues, sauf celles que vous choisissez de conserver comme impositions pour la prochaine planification.'}
            </DialogDescription>
          </DialogHeader>

          {promotionCandidates.length > 0 && (
            <ScrollArea className="max-h-64">
              <div className="flex flex-col gap-2 pr-3">
                {promotionCandidates.map((candidate) => {
                  const blocked = candidate.blockedBy !== undefined;
                  const reason =
                    candidate.blockedBy === 'multi-placement'
                      ? "répartie en plusieurs créneaux : une imposition ne peut porter qu'un seul créneau"
                      : candidate.blockedBy === 'task-group'
                        ? 'membre d\'un groupe de tâches : le moteur ne respecterait pas cette imposition'
                        : undefined;
                  const groupsLabel = normalizeResourceEntries(candidate.course.groups).join(', ');
                  return (
                    <label
                      key={candidate.placementId}
                      className={`flex items-start gap-3 ${blocked ? 'opacity-50' : 'cursor-pointer'}`}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 accent-primary cursor-pointer disabled:cursor-not-allowed"
                        checked={checkedPromotionIds.has(candidate.placementId)}
                        disabled={blocked}
                        onChange={() => togglePromotionChecked(candidate.placementId)}
                      />
                      <div className="space-y-0.5">
                        <p className="text-sm">
                          {candidate.course.code} {candidate.course.type} — {formatStartTime(candidate.startTime)}
                        </p>
                        {groupsLabel && <p className="text-xs text-muted-foreground">{groupsLabel}</p>}
                        {reason && <p className="text-xs text-muted-foreground italic">{reason}</p>}
                      </div>
                    </label>
                  );
                })}
              </div>
            </ScrollArea>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Annuler</Button>
            <Button variant="destructive" onClick={handleConfirmRetour}>
              {checkedPromotionIds.size > 0
                ? `Conserver ${checkedPromotionIds.size} imposition${checkedPromotionIds.size > 1 ? 's' : ''} et annuler`
                : 'Annuler la planification automatique'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
