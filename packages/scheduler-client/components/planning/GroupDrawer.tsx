'use client';

import { useEffect, useRef, useState } from 'react';
import { usePlanningStore, type TaskGroupConfig } from '@/store/usePlanningStore';
import { Separator } from '@/components/ui/separator';

interface GroupDrawerProps {
  open: boolean;
  onToggle: () => void;
  parsedCourses: { code: string; type: string; name: string; groups?: string[] }[];
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
      const dragging = usePlanningStore.getState().draggingExternal;
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
      const dragging = usePlanningStore.getState().draggingExternal;
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

// ── NewGroupDropZone ───────────────────────────────────────────────────────
// Zone pour créer un nouveau groupe en y déposant un cours.

interface NewGroupDropZoneProps {
  type: 'parallel' | 'sequential';
  label: string;
}

function NewGroupDropZone({ type, label }: NewGroupDropZoneProps) {
  const zoneRef = useRef<HTMLDivElement | null>(null);
  const [over, setOver] = useState(false);
  const addTaskGroup = usePlanningStore((s) => s.addTaskGroup);
  const addCourseToGroup = usePlanningStore((s) => s.addCourseToGroup);

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const el = zoneRef.current;
      if (!el) return;
      const dragging = usePlanningStore.getState().draggingExternal;
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
      const dragging = usePlanningStore.getState().draggingExternal;
      if (!dragging?.courseKey) return;
      const rect = el.getBoundingClientRect();
      const inside =
        e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top  && e.clientY <= rect.bottom;
      if (inside) {
        const newId = addTaskGroup(type, dragging.courseKey);
        // addTaskGroup retourne l'id, mais comme c'est void dans le store on utilise addCourseToGroup après
        // En fait addTaskGroup initialise déjà avec courseKey — pas besoin d'addCourseToGroup
        void newId;
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
  }, [type, addTaskGroup, addCourseToGroup]);

  return (
    <div
      ref={zoneRef}
      className={`rounded border-2 border-dashed px-3 py-3 text-xs text-center transition-colors cursor-pointer ${
        over
          ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300'
          : 'border-border text-muted-foreground hover:border-violet-300 hover:text-violet-500'
      }`}
    >
      {label}
    </div>
  );
}

// ── GroupCard ──────────────────────────────────────────────────────────────

interface GroupCardProps {
  group: TaskGroupConfig;
  parsedCourses: GroupDrawerProps['parsedCourses'];
}

function GroupCard({ group, parsedCourses }: GroupCardProps) {
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
            className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 hover:bg-violet-200 transition-colors"
            title={group.type === 'parallel'
              ? '∥ Parallèle : toutes les tâches commencent au même horaire. (Cliquer pour basculer en Séquentiel)'
              : '→ Séquentiel : les tâches s\'enchaînent consécutivement. (Cliquer pour basculer en Parallèle)'}
          >
            {group.type === 'parallel' ? '∥ Parallèle' : '→ Séquentiel'}
          </button>
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

      {/* Membres — drag & drop pour réordonner */}
      <div className="flex flex-col gap-1">
        {group.courseKeys.map((key, idx) => {
          const courseIdx = parseInt(key, 10);
          const course = parsedCourses[courseIdx];
          return (
            <div
              key={key}
              draggable
              onDragStart={() => { dragIndexRef.current = idx; }}
              onDragOver={(e) => { e.preventDefault(); setDragOverIndex(idx); }}
              onDragLeave={() => setDragOverIndex(null)}
              onDrop={() => {
                if (dragIndexRef.current !== null && dragIndexRef.current !== idx) {
                  reorderCourseInGroup(group.id, dragIndexRef.current, idx);
                }
                dragIndexRef.current = null;
                setDragOverIndex(null);
              }}
              onDragEnd={() => { dragIndexRef.current = null; setDragOverIndex(null); }}
              className={`flex items-center justify-between gap-1 text-xs rounded px-1.5 py-1 cursor-grab active:cursor-grabbing transition-colors ${
                dragOverIndex === idx
                  ? 'bg-violet-100 dark:bg-violet-900/40 border border-violet-400'
                  : 'bg-muted/40'
              }`}
            >
              <span className="text-muted-foreground/50 mr-1 select-none">⠿</span>
              <span className="flex-1 min-w-0">
                <span className="font-medium">{course?.code ?? '?'}</span>{' '}
                <span className="text-muted-foreground">{course?.type ?? ''}</span>
                {course?.name && (
                  <span className="text-muted-foreground/70 ml-1">{course.name}</span>
                )}
                {course?.groups && course.groups.length > 0 && (
                  <span className="text-muted-foreground/60 ml-1">({course.groups.join(', ')})</span>
                )}
              </span>
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

export function GroupDrawer({ open, onToggle, parsedCourses }: GroupDrawerProps) {
  const taskGroups = usePlanningStore((s) => s.taskGroups);

  const hasCoursesForCurrentWeek = parsedCourses.length > 0;

  return (
    <div className="flex shrink-0">
      {/* Arrow toggle button on the left edge */}
      <button
        type="button"
        onClick={onToggle}
        className="self-center h-16 w-5 flex items-center justify-center bg-card border border-border rounded-l text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        title={open ? 'Fermer le panneau groupes' : 'Ouvrir le panneau groupes'}
        aria-label={open ? 'Fermer' : 'Ouvrir'}
      >
        {open ? '›' : '‹'}
      </button>

      <aside
        className={`bg-card border-l border-border flex flex-col overflow-hidden transition-all duration-200 ${
          open ? 'w-72' : 'w-0'
        }`}
        aria-hidden={!open}
      >
        <div className="flex flex-col gap-3 p-4 overflow-y-auto h-full min-w-72">
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
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                Nouveau groupe
              </p>
              <div className="flex flex-col gap-2">
                <NewGroupDropZone
                  type="parallel"
                  label="∥ Déposer ici — Parallèle (même créneau)"
                />
                <NewGroupDropZone
                  type="sequential"
                  label="→ Déposer ici — Séquentiel (consécutif)"
                />
              </div>
              <Separator />
            </>
          )}

          {/* Groupes existants */}
          {taskGroups.length > 0 && (
            <div className="flex flex-col gap-3">
              {taskGroups.map((group) => (
                <GroupCard key={group.id} group={group} parsedCourses={parsedCourses} />
              ))}
            </div>
          )}

          {taskGroups.length === 0 && hasCoursesForCurrentWeek && (
            <p className="text-xs text-muted-foreground italic">
              Aucun groupe défini. Créez-en un en glissant un cours ci-dessus.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
