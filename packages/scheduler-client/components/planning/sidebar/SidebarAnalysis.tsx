'use client';

import { useRef, useMemo, useState } from 'react';
import type { NeutralizedTaskInfoJSON, ResourceEntry } from '@edt-ts/scheduler-common';
import { usePlanningStore } from '@/store/usePlanningStore';
import { useProjectStore } from '@/store/useProjectStore';
import { useNeutralizedDraggable } from '@/hooks/useNeutralizedDraggable';
import { downloadIcalArchive, downloadIcalSolution, ICAL_RESOURCE_TYPE_LABELS, type IcalResourceType } from '@/lib/icalExport';
import { matchesSearchQuery, formatStartTime } from '@/lib/calendar/calendarUtils';
import { toTaskSolutionJSON } from '@/lib/calendar/placements';
import { selectPromotionCandidates } from '@/lib/calendar/promotion';
import { selectPiocheEntries } from '@/lib/calendar/unplaced';
import { getCoursesForWeek } from '@/lib/weekCourses';
import type { CourseTaskDataWithId } from '@/lib/courseId';
import type { Unplaced } from '@/store/types';
import { Button } from '@/components/ui/button';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

/**
 * Adaptateur vers la forme attendue par `buildAnalysisLoadRows`. Seuls `task.duration` et
 * `task.resources` sont lus par l'analyse de charge : `reason` tombe à la chaîne vide pour les
 * entrées d'origine `user-pre`/`user-post`, qui n'en ont jamais.
 * `remaining` (et non `course.duration`) : la question posée est « où reste-t-il assez de mou pour
 * ce qu'il reste à placer ? » — identique pour une tâche jamais placée (reste = durée entière) et
 * pour une Autonomie déjà partiellement répartie.
 */
function toNeutralizedInfo(
  entry: Unplaced,
  course: CourseTaskDataWithId,
  remaining: number,
): NeutralizedTaskInfoJSON {
  return {
    task: {
      taskId: entry.taskId,
      code: course.code,
      name: course.name,
      type: course.type,
      week: course.week,
      duration: remaining,
      startTime: -1,
      resources: [
        ...candidateIds(course.teacher).map((id) => ({ id, type: 'teacher' })),
        ...candidateIds(course.groups).map((id) => ({ id, type: 'group' })),
        ...candidateIds(course.rooms ?? []).map((id) => ({ id, type: 'room' })),
      ],
    },
    reason: entry.diagnostics?.reason ?? '',
  };
}

export function SidebarAnalysis() {
  // Nom hérité de l'ancienne formulation « retour à la préparation » : le geste ne sert plus à
  // naviguer (le sélecteur de semaine vit désormais dans la barre d'outils, §3.1 du plan), mais
  // seulement à annuler la planification automatique — non renommé pour ne pas brouiller le lien
  // avec le code déjà écrit (§3.2 du plan).
  const returnToPreparation = usePlanningStore((s) => s.returnToPreparation);
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
  // Mode d'export iCal : 'filtered' reprend le comportement historique (respecte la recherche
  // active) ; les 3 autres éclatent l'export en une archive .zip d'un .ics par ressource, sans
  // tenir compte du filtre (l'archive porte toujours sur l'ensemble des placements affichés).
  const [exportMode, setExportMode] = useState<'filtered' | IcalResourceType>('filtered');
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

  // Charge de référence de l'analyse : les placements affichés, **non filtrés** par la recherche
  // (la charge d'une ressource ne dépend pas de ce que l'utilisateur cherche) et non plus
  // `scheduleResult.solution.tasks`. Deux raisons : le résultat brut du moteur n'est pas persisté
  // (après rechargement la table afficherait une charge nulle), et il compte encore les créneaux
  // des cours remis dans la pioche depuis — la table nierait alors le mou que le geste vient
  // justement de libérer.
  const loadReferenceSolution = useMemo(
    () => placements.map((p) => toTaskSolutionJSON(p, courseById.get(p.taskId), iCalWeek)),
    [placements, courseById, iCalWeek],
  );

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

  function handleExport() {
    if (exportMode === 'filtered') {
      downloadIcalSolution(filteredPlacements, iCalWeek, schoolYearConfig, searchQuery);
    } else {
      void downloadIcalArchive(loadReferenceSolution, iCalWeek, schoolYearConfig, exportMode);
    }
  }

  return (
    <>
      <aside className="w-80 shrink-0 bg-card border-r border-border p-4 overflow-y-auto flex flex-col gap-4">
        <Button
          type="button"
          className="w-full bg-black hover:bg-zinc-800 text-white dark:bg-zinc-900 dark:hover:bg-zinc-700"
          onClick={openReturnDialog}
        >
          Annuler la planification automatique
        </Button>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          {lastRun !== null && (
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={handleExport}>
                {exportMode === 'filtered'
                  ? searchQuery.trim()
                    ? 'Exporter (filtré) en iCal'
                    : 'Exporter en iCal'
                  : 'Exporter en ZIP'}
              </Button>
              <Select value={exportMode} onValueChange={(v) => setExportMode(v as typeof exportMode)}>
                <SelectTrigger size="sm" className="w-32" aria-label="Mode d'export iCal">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="filtered">Filtré</SelectItem>
                  <SelectItem value="group">{ICAL_RESOURCE_TYPE_LABELS.group}</SelectItem>
                  <SelectItem value="teacher">{ICAL_RESOURCE_TYPE_LABELS.teacher}</SelectItem>
                  <SelectItem value="room">{ICAL_RESOURCE_TYPE_LABELS.room}</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
                    ? (entry.diagnostics?.reason ?? '')
                    : entry.origin === 'user-pre'
                      ? 'Neutralisée manuellement avant planification'
                      : 'Retirée manuellement du calendrier';
                const baseProps = courseToBaseProps(course);
                // Une tâche déjà partiellement placée reste dans la pioche avec sa durée
                // résiduelle — même état pilote le libellé du bouton (§4.5 du plan).
                //
                // Ce résidu est redéposable pour la seule Autonomie : c'est le cas d'usage réel
                // (retoucher une répartition automatique, puis reposer à la main ce qu'on a
                // libéré), et c'est le seul type dont la fragmentation ait un sens métier. Pour un
                // cours ordinaire dont on a réduit la durée d'un placement, le résidu reste
                // affiché mais non déposable : éclater un TD en deux créneaux serait un accident,
                // pas une intention.
                const hasPlacements = placements.some((p) => p.taskId === entry.taskId);
                const isAutonomie = course.type === 'Autonomie';
                return (
                  <div key={entry.taskId} className="relative">
                    <NeutralizedTaskCard
                      {...baseProps}
                      duration={remaining}
                      taskId={entry.taskId}
                      tooltipContent={tooltipContent}
                      dragEnabled={isAutonomie || !hasPlacements}
                      onDistribute={
                        isAutonomie
                          ? () => (hasPlacements ? cancelAutonomyDistribution(entry.taskId) : distributeAutonomy(entry.taskId))
                          : undefined
                      }
                      distributeLabel={hasPlacements ? 'Annuler la répartition' : 'Répartir'}
                    />
                    {/* Toutes les origines, pas seulement `engine` : la question « où reste-t-il du
                        mou pour cette tâche ? » se pose à l'identique pour un cours remis dans la
                        pioche à la main. L'ancienne restriction à `engine` n'était que le report
                        du test de préfixe historique (PlanUnifiedUnplaced §5). */}
                    {availabilityManager && selectedWeek !== null && (
                      <div className="absolute top-1 right-1">
                        <ResourceLoadPopover
                          mode="analysis"
                          taskDurationMin={remaining}
                          rows={buildAnalysisLoadRows(
                            toNeutralizedInfo(entry, course, remaining),
                            loadReferenceSolution,
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
