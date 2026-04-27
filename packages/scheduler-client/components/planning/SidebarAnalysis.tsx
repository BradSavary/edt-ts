'use client';

import { useRef, useMemo, useState } from 'react';
import { usePlanningStore } from '@/store/usePlanningStore';
import { useNeutralizedDraggable } from '@/hooks/useNeutralizedDraggable';
import { downloadIcalSolution } from '@/lib/icalExport';
import { filterSolutionsByQuery } from '@/lib/calendarUtils';
import type { TaskSolutionJSON } from '@edt-ts/scheduler-common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function SidebarAnalysis() {
  const resetScheduleResult = usePlanningStore((s) => s.resetScheduleResult);
  const activeSolution = usePlanningStore((s) => s.activeSolution);
  const activeNeutralizedTasks = usePlanningStore((s) => s.activeNeutralizedTasks);
  const placedNeutralizedTasks = usePlanningStore((s) => s.placedNeutralizedTasks);
  const manuallyNeutralizedTasks = usePlanningStore((s) => s.manuallyNeutralizedTasks);
  const searchQuery = usePlanningStore((s) => s.searchQuery);
  const setSearchQuery = usePlanningStore((s) => s.setSearchQuery);
  const selectedWeek = usePlanningStore((s) => s.selectedWeek);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const neutralizedContainerRef = useRef<HTMLDivElement | null>(null);

  useNeutralizedDraggable({
    containerRef: neutralizedContainerRef,
    hasItems: activeNeutralizedTasks.some((t) => !placedNeutralizedTasks.some((p) => p.taskId === t.task.taskId)) || manuallyNeutralizedTasks.length > 0,
  });

  const iCalWeek = selectedWeek ?? 1;

  const filteredSolutions = useMemo(
    () => filterSolutionsByQuery(activeSolution, searchQuery),
    [activeSolution, searchQuery],
  );

  const filteredPlacedNeutralized = useMemo((): TaskSolutionJSON[] => {
    const q = searchQuery.trim().toLowerCase();
    return placedNeutralizedTasks
      .filter((task) => {
        if (!q) return true;
        return (
          task.code.toLowerCase().includes(q) ||
          task.name.toLowerCase().includes(q) ||
          task.teachers.some((t) => t.toLowerCase().includes(q)) ||
          task.rooms.some((r) => r.toLowerCase().includes(q)) ||
          task.groups.some((g) => g.toLowerCase().includes(q))
        );
      })
      .map((task) => ({
        taskId: task.taskId,
        code: task.code,
        name: task.name,
        type: task.type,
        week: iCalWeek,
        duration: task.duration,
        startTime: task.startTime,
        resources: [
          ...task.teachers.map((id) => ({ id, type: 'teacher' })),
          ...task.groups.map((id) => ({ id, type: 'group' })),
          ...task.rooms.map((id) => ({ id, type: 'room' })),
        ],
      }));
  }, [placedNeutralizedTasks, searchQuery, iCalWeek]);

  const unplacedNeutralized = activeNeutralizedTasks.filter(
    (t) => !placedNeutralizedTasks.some((p) => p.taskId === t.task.taskId),
  );
  const hasAnyNeutralizedItems = unplacedNeutralized.length > 0 || manuallyNeutralizedTasks.length > 0;

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
            placeholder="Enseignant, salle, groupe, code, cours…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <Separator />

        {/* Actions */}
        <div className="flex flex-col gap-2">
          {activeSolution.length > 0 && (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => downloadIcalSolution([...filteredSolutions, ...filteredPlacedNeutralized], iCalWeek)}
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
              <Badge variant="secondary">{unplacedNeutralized.length + manuallyNeutralizedTasks.length}</Badge>
            </div>
            <p className="text-xs text-muted-foreground italic">
              Glissez un cours sur le calendrier pour le placer.
            </p>
            <div ref={neutralizedContainerRef} className="flex flex-col gap-2">
              {/* Tâches neutralisées par le moteur ou pré-neutralisées */}
              {unplacedNeutralized.map((neutralizedInfo) => {
                const task = neutralizedInfo.task;
                const teachers = task.resources.filter((r) => r.type === 'teacher').map((r) => r.id);
                const groups = task.resources.filter((r) => r.type === 'group').map((r) => r.id);
                const rooms = task.resources.filter((r) => r.type === 'room').map((r) => r.id);

                const isPreNeutralized = task.taskId.startsWith('pre-neutral-');
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

                return (
                  <Tooltip key={task.taskId}>
                    <TooltipTrigger asChild>
                      <div
                        data-task-id={task.taskId}
                        data-title={`${task.code} ${task.type}`}
                        data-duration={task.duration}
                        data-teachers={JSON.stringify(teachers)}
                        data-groups={JSON.stringify(groups)}
                        data-rooms={JSON.stringify(rooms)}
                        data-code={task.code}
                        data-name={task.name}
                        data-type={task.type}
                        className="p-2 rounded-lg border text-xs bg-card border-border cursor-grab active:cursor-grabbing hover:border-primary/50 hover:shadow-sm transition-all"
                      >
                        <div className="flex items-center justify-between gap-1 mb-0.5">
                          <span className="font-bold text-foreground truncate">
                            {task.code}{' '}
                            <span className="font-normal text-muted-foreground">{task.type}</span>
                          </span>
                          <span className="text-muted-foreground shrink-0">{task.duration}min</span>
                        </div>
                        <div className="truncate text-foreground/80 mb-0.5">{task.name}</div>
                        {teachers.length > 0 && (
                          <div className="truncate text-muted-foreground">{teachers.join(', ')}</div>
                        )}
                        {groups.length > 0 && (
                          <div className="truncate text-muted-foreground">{groups.join(', ')}</div>
                        )}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="right" color='light' className="max-w-72 whitespace-pre-line bg-background text-foreground border shadow-md">
                      {tooltipLines.join('\n')}
                    </TooltipContent>
                  </Tooltip>
                );
              })}

              {/* Tâches retirées manuellement du calendrier */}
              {manuallyNeutralizedTasks.map((task) => (
                <div
                  key={task.taskId}
                  data-task-id={task.taskId}
                  data-title={`${task.code} ${task.type}`}
                  data-duration={task.duration}
                  data-teachers={JSON.stringify(task.teachers)}
                  data-groups={JSON.stringify(task.groups)}
                  data-rooms={JSON.stringify(task.rooms)}
                  data-code={task.code}
                  data-name={task.name}
                  data-type={task.type}
                  className="p-2 rounded-lg border text-xs bg-card border-border cursor-grab active:cursor-grabbing hover:border-primary/50 hover:shadow-sm transition-all"
                >
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <span className="font-bold text-foreground truncate">
                      {task.code}{' '}
                      <span className="font-normal text-muted-foreground">{task.type}</span>
                    </span>
                    <span className="text-muted-foreground shrink-0">{task.duration}min</span>
                  </div>
                  <div className="truncate text-foreground/80 mb-0.5">{task.name}</div>
                  {task.teachers.length > 0 && (
                    <div className="truncate text-muted-foreground">{task.teachers.join(', ')}</div>
                  )}
                  {task.groups.length > 0 && (
                    <div className="truncate text-muted-foreground">{task.groups.join(', ')}</div>
                  )}
                </div>
              ))}
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
