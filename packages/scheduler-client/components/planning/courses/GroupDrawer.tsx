'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CourseTaskDataWithId } from '@/lib/courseId';
import { usePlanningStore, type TaskGroupConfig } from '@/store/usePlanningStore';
import { useSidebarCourseDrag } from '@/hooks/useSidebarCourseDrag';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { validateParallelGroup, type ParallelGroupIssue } from '@/lib/taskGroupUtils';

interface GroupDrawerProps {
  parsedCourses: CourseTaskDataWithId[];
}

// ── GroupDropZone ──────────────────────────────────────────────────────────
// Zone de dépôt d'un cours dans un groupe existant.
// Détecte le drop via pointerup (capture) pour être prioritaire sur FullCalendar.

interface GroupDropZoneProps {
  groupId: string;
  label: string;
}

function GroupDropZone({ groupId, label }: GroupDropZoneProps) {
  const zoneRef = useRef<HTMLDivElement | null>(null);
  const [over, setOver] = useState(false);
  const addCourseToGroup = usePlanningStore((s) => s.addCourseToGroup);

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const el = zoneRef.current;
      if (!el) return;
      const state = usePlanningStore.getState();
      if (!state.groupDrawerOpen) { setOver(false); return; }
      const dragging = state.draggingExternal;
      if (!dragging?.courseKey) { setOver(false); return; }
      const rect = el.getBoundingClientRect();
      const inside =
        e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top  && e.clientY <= rect.bottom;
      setOver(inside);
    };

    const onPointerUp = (e: PointerEvent) => {
      const el = zoneRef.current;
      if (!el) return;
      const state = usePlanningStore.getState();
      if (!state.groupDrawerOpen) return;
      const dragging = state.draggingExternal;
      if (!dragging?.courseKey) return;
      const rect = el.getBoundingClientRect();
      const inside =
        e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top  && e.clientY <= rect.bottom;
      if (inside) {
        addCourseToGroup(groupId, dragging.courseKey);
      }
      setOver(false);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { capture: true });
    window.addEventListener('pointercancel', () => setOver(false));
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp, { capture: true });
    };
  }, [groupId, addCourseToGroup]);

  return (
    <div
      ref={zoneRef}
      className={`rounded border-2 border-dashed px-2 py-2 text-xs text-center transition-colors ${
        over
          ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300'
          : 'border-border text-muted-foreground'
      }`}
    >
      {label}
    </div>
  );
}

// ── NewGroupSection ────────────────────────────────────────────────────────
// Bouton + pour créer un nouveau groupe vide, avec toggle parallèle/séquentiel.

function NewGroupSection() {
  const [pendingType, setPendingType] = useState<'parallel' | 'sequential'>('parallel');
  const addTaskGroup = usePlanningStore((s) => s.addTaskGroup);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
        Nouveau groupe
      </p>
      <div className="flex items-center gap-2">
        {/* Bouton créer */}
        <button
          type="button"
          onClick={() => addTaskGroup(pendingType)}
          className="shrink-0 w-full text-xs font-semibold px-2 py-1.5 rounded bg-violet-500 hover:bg-violet-600 text-white transition-colors"
          title="Créer un nouveau groupe (puis glisser des cours dedans)"
        >
          + Créer un groupe
        </button>
      </div>
    </div>
  );
}

// ── GroupCard ──────────────────────────────────────────────────────────────

interface GroupCardProps {
  group: TaskGroupConfig;
  parsedCourses: CourseTaskDataWithId[];
  validationIssue?: ParallelGroupIssue | null;
}

function GroupCard({ group, parsedCourses, validationIssue }: GroupCardProps) {
  const removeTaskGroup = usePlanningStore((s) => s.removeTaskGroup);
  const removeCourseFromGroup = usePlanningStore((s) => s.removeCourseFromGroup);
  const setGroupType = usePlanningStore((s) => s.setGroupType);
  const reorderCourseInGroup = usePlanningStore((s) => s.reorderCourseInGroup);

  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  return (
    <div className="rounded-lg border border-border bg-card p-2 flex flex-col gap-2">
      {/* En-tête */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setGroupType(group.id, group.type === 'parallel' ? 'sequential' : 'parallel')}
            className="group/typebtn text-[11px] font-semibold px-1.5 py-0.5 rounded border border-violet-300 dark:border-violet-700 bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 hover:bg-violet-200 transition-colors flex items-center gap-1"
            title={group.type === 'parallel'
              ? '∥ Parallèle : toutes les tâches commencent au même horaire. (Cliquer pour basculer en Séquentiel)'
              : '→ Séquentiel : les tâches s\'enchaînent consécutivement. (Cliquer pour basculer en Parallèle)'}
          >
            {group.type === 'parallel' ? '∥ Parallèle' : '→ Séquentiel'}
            <span className="opacity-40 group-hover/typebtn:opacity-100 transition-opacity text-[9px]">↺</span>
          </button>
          {validationIssue && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-amber-500 dark:text-amber-400 text-sm cursor-help select-none" aria-label="Problème de planification">
                  ⚠
                </span>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-56 text-xs bg-background text-foreground border shadow-md">
                <ul className="list-disc list-inside space-y-0.5">
                  {validationIssue.conflictingTeachers && (
                    <li>Intervenant(s) en conflit : {validationIssue.conflictingTeachers.join(', ')}</li>
                  )}
                  {validationIssue.conflictingGroups && (
                    <li>Groupe(s) étudiant en conflit : {validationIssue.conflictingGroups.join(', ')}</li>
                  )}
                  {validationIssue.roomShortfall && (
                    <li>Salles insuffisantes : {validationIssue.roomShortfall.available} disponible(s) pour {validationIssue.roomShortfall.needed} tâche(s)</li>
                  )}
                </ul>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <button
          type="button"
          onClick={() => removeTaskGroup(group.id)}
          className="text-muted-foreground hover:text-destructive text-xs px-1"
          title="Supprimer ce groupe"
        >
          ✕
        </button>
      </div>

      {/* Membres — drag & drop pour réordonner + drop sur calendrier */}
      <div className="flex flex-col gap-1">
        {group.courseKeys.map((key, idx) => {
          const course = parsedCourses.find((c) => c.id === key);
          return (
            <div
              key={key}
              onDragOver={(e) => { e.preventDefault(); setDragOverIndex(idx); }}
              onDragLeave={() => setDragOverIndex(null)}
              onDrop={() => {
                if (dragIndexRef.current !== null && dragIndexRef.current !== idx) {
                  reorderCourseInGroup(group.id, dragIndexRef.current, idx);
                }
                dragIndexRef.current = null;
                setDragOverIndex(null);
              }}
              className={`flex items-center gap-1 text-xs rounded px-1.5 py-1 transition-colors ${
                dragOverIndex === idx
                  ? 'bg-violet-100 dark:bg-violet-900/40 border border-violet-400'
                  : 'bg-muted/40'
              }`}
            >
              {/* Poignée HTML5 pour réordonner */}
              <span
                draggable
                onDragStart={() => { dragIndexRef.current = idx; }}
                onDragEnd={() => { dragIndexRef.current = null; setDragOverIndex(null); }}
                className="text-muted-foreground/50 select-none cursor-grab active:cursor-grabbing shrink-0 mr-1"
              >⠿</span>
              {/* Zone FC-draggable vers le calendrier */}
              <div
                data-course-key={key}
                data-title={`${course?.code ?? '?'} ${course?.type ?? ''}`}
                data-duration={course?.duration ?? 60}
                className="flex-1 min-w-0 cursor-grab active:cursor-grabbing"
              >
                <div className="truncate">
                  <span className="font-medium">{course?.code ?? '?'}</span>{' '}
                  <span className="text-muted-foreground">{course?.type ?? ''}</span>
                  {course?.name && <span className="text-muted-foreground/70 ml-1">{course.name}</span>}
                </div>
                {course?.teacher && course.teacher.length > 0 && (
                  <div className="truncate text-muted-foreground/70">{course.teacher.join(', ')}</div>
                )}
                {course?.rooms && course.rooms.length > 0 ? (
                  <div className="truncate text-muted-foreground/60 italic">{course.rooms.join(', ')}</div>
                ) : (
                  <div className="truncate text-red-400/70 dark:text-red-500/70 italic text-[10px]">Pas de salle par défaut</div>
                )}
                {course?.groups && course.groups.length > 0 && (
                  <div className="truncate text-muted-foreground/60">({course.groups.join(', ')})</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeCourseFromGroup(group.id, key)}
                className="shrink-0 text-muted-foreground hover:text-destructive text-xs ml-1"
                title="Retirer du groupe"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      {/* Zone d'ajout */}
      <GroupDropZone groupId={group.id} label="Glisser un cours ici pour l'ajouter" />
    </div>
  );
}

// ── GroupDrawer ────────────────────────────────────────────────────────────

export function GroupDrawer({ parsedCourses }: GroupDrawerProps) {
  const taskGroups = usePlanningStore((s) => s.taskGroups);
  const groupDrawerOpen = usePlanningStore((s) => s.groupDrawerOpen);
  const toggleGroupDrawer = usePlanningStore((s) => s.toggleGroupDrawer);

  // Ref pour le container FC Draggable
  const [drawerContainer, setDrawerContainer] = useState<HTMLDivElement | null>(null);
  const drawerContainerRef = useCallback((node: HTMLDivElement | null) => setDrawerContainer(node), []);

  // Drag vers le calendrier depuis les GroupCards
  useSidebarCourseDrag({ container: drawerContainer, courses: parsedCourses });

  // Déclenche un resize après la transition (200ms) pour que FullCalendar recalcule sa taille
  useEffect(() => {
    const timer = setTimeout(() => { window.dispatchEvent(new Event('resize')); }, 210);
    return () => clearTimeout(timer);
  }, [groupDrawerOpen]);

  const hasCoursesForCurrentWeek = parsedCourses.length > 0;

  return (
    <div className="flex shrink-0">
      <aside
        className={`bg-card border-r border-border flex flex-col overflow-hidden transition-all duration-200 ${
          groupDrawerOpen ? 'w-72' : 'w-0'
        }`}
        aria-hidden={!groupDrawerOpen}
      >
        <div ref={drawerContainerRef} className="flex flex-col gap-3 p-4 overflow-y-auto h-full min-w-72">
          <div>
            <h2 className="text-sm font-semibold">Groupes de tâches</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Glissez des cours dans les zones pour les regrouper.
            </p>
          </div>

          <Separator />

          {!hasCoursesForCurrentWeek && (
            <p className="text-xs text-muted-foreground italic">
              Sélectionnez une semaine pour voir les cours.
            </p>
          )}

          {/* Nouveau groupe — EN HAUT */}
          {hasCoursesForCurrentWeek && (
            <>
              <NewGroupSection />
              <Separator />
            </>
          )}

          {/* Groupes existants */}
          {taskGroups.length > 0 && (
            <div className="flex flex-col gap-3">
              {taskGroups.map((group) => (
                <GroupCard key={group.id} group={group} parsedCourses={parsedCourses} validationIssue={validateParallelGroup(group, parsedCourses)} />
              ))}
            </div>
          )}

          {taskGroups.length === 0 && hasCoursesForCurrentWeek && (
            <p className="text-xs text-muted-foreground italic">
              Aucun groupe défini. Créez-en un ci-dessus.
            </p>
          )}
        </div>
      </aside>

      {/* Arrow toggle button on the right edge */}
      <button
        type="button"
        onClick={toggleGroupDrawer}
        className="self-center h-16 w-5 flex items-center justify-center bg-card border border-border rounded-r text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        title={groupDrawerOpen ? 'Fermer le panneau groupes' : 'Ouvrir le panneau groupes'}
        aria-label={groupDrawerOpen ? 'Fermer' : 'Ouvrir'}
      >
        {groupDrawerOpen ? '‹' : '›'}
      </button>
    </div>
  );
}
