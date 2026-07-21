'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import type FullCalendar from '@fullcalendar/react';
import type { EventApi, EventDropArg } from '@fullcalendar/core';
import type { EventReceiveArg, EventDragStopArg } from '@fullcalendar/interaction';
import type { EventClickArg } from '@fullcalendar/core';
import type { CourseTaskData, EnforcedData } from '@edt-ts/scheduler-common';
import type { CourseTaskDataWithId } from '@/lib/courseId';
import type { Placement } from '@/store/types';
import type { EnforceSelection } from '@/components/planning/modals/EnforceModal';
import type { TaskEditUpdate } from '@/components/planning/modals/TaskEditModal';
import { getMondayOfISOWeek, startTimeToDate, computeStaticConflicts, computeDragHighlights, computeConstraintViolation } from '@/lib/calendar/calendarUtils';
import type { ResourceEventInfo } from '@/lib/calendar/calendarUtils';
import { computeConstraintUnavailableZones, subtractDateZones } from '@/lib/calendar/blockedZones';
import { resolveCalendarYear } from '@/lib/schoolHolidays';
import { levelFromCode, getEventColors } from '@/lib/calendar/yearColors';
import type { YearColorConfig } from '@/lib/calendar/yearColors';
import { usePlanningStore } from '@/store/usePlanningStore';
import { useProjectStore } from '@/store/useProjectStore';
import type { PendingDrop, PendingNeutralizedDrop, CalendarEventExtProps, CalendarEventData, DraggingState, PendingEditData } from '@/lib/calendar/types';

export type { PendingDrop, PendingNeutralizedDrop, CalendarEventExtProps, CalendarEventData, DraggingState, PendingEditData };

/**
 * Construction unique d'événement calendrier pour un placement, quelle que soit son origine —
 * modèle repris de l'ancien `enforcedEventsState` (résolution du cours, titre, couleurs, durée).
 */
function buildPlacementEvent(
  placement: Placement,
  course: CourseTaskDataWithId | undefined,
  monday: Date,
  yearColorConfig: YearColorConfig,
  violation: 'red' | 'orange' | 'none',
): CalendarEventData {
  const { teachers, groups, rooms } = placement.resources;
  const duration = placement.duration ?? course?.duration ?? 60;
  const start = startTimeToDate(monday, placement.startTime);
  const end = new Date(start.getTime() + duration * 60 * 1000);
  const teacherStr = teachers.join(', ');
  const title = [course?.code ?? '?', course?.type ?? '', teacherStr].filter(Boolean).join(' • ');

  // Badge "placé manuellement" : toujours pour un retouche/replacement (`post-enforced`), et
  // uniquement sur violation pour une imposition (`pre-enforced`) — le 📌 marque déjà son
  // origine manuelle, pas la peine de doubler l'indicateur en l'absence de violation.
  const manuallyPlaced =
    placement.origin === 'post-enforced' ? true :
    placement.origin === 'pre-enforced' ? (violation !== 'none' || undefined) :
    undefined;

  return {
    id: placement.placementId,
    title,
    start,
    end,
    ...getEventColors(course?.level ?? levelFromCode(course?.code ?? ''), course?.type ?? '', yearColorConfig),
    // Morceau d'Autonomie réparti (placementId ≠ taskId) : hachures pour préserver son identité
    // visuelle — il reste un placement de plein droit (déplaçable/éditable/exporté).
    ...(placement.taskId !== placement.placementId ? { classNames: ['fc-autonomy-piece'] } : {}),
    extendedProps: {
      name: course?.name ?? '',
      code: course?.code ?? '',
      type: course?.type ?? '',
      teachers,
      groups,
      rooms,
      durationMin: duration,
      origin: placement.origin,
      taskId: placement.taskId,
      manuallyPlaced,
      constraintViolation: violation,
    },
  };
}

// ── Hook principal ─────────────────────────────────────────────────────────

export function useCalendarCore(placements: Placement[], parsedCourses: CourseTaskDataWithId[]) {
  // ── Store planning ──────────────────────────────────────────────────────
  const selectedWeek = usePlanningStore((s) => s.selectedWeek);
  const week = selectedWeek ?? 1;
  const lastRun = usePlanningStore((s) => s.lastRun);
  const updatePlacement = usePlanningStore((s) => s.updatePlacement);
  const addPlacement = usePlanningStore((s) => s.addPlacement);
  const unplaceTask = usePlanningStore((s) => s.unplaceTask);
  const handleEnforceChange = usePlanningStore((s) => s.handleEnforceChange);
  const blockedZones = usePlanningStore((s) => s.blockedZones);
  const handleBlockedZoneAdd = usePlanningStore((s) => s.handleBlockedZoneAdd);
  const handleBlockedZoneRemove = usePlanningStore((s) => s.handleBlockedZoneRemove);
  const handleBlockedZoneMove = usePlanningStore((s) => s.handleBlockedZoneMove);
  const externalDragging = usePlanningStore((s) => s.draggingExternal);

  const availabilityManager = useProjectStore((s) => s.availabilityManager);
  const resources = useProjectStore((s) => s.resources);
  const yearColorConfig = useProjectStore((s) => s.yearColorConfig);
  const schoolYearConfig = useProjectStore((s) => s.schoolYearConfig);

  const monday = useMemo(
    () => getMondayOfISOWeek(week, resolveCalendarYear(schoolYearConfig, week)),
    [week, schoolYearConfig],
  );

  // ── Options de ressources (pour les modals d'édition) ─────────────────
  const resourceOptions = useMemo(() => ({
    teacherOptions: resources.filter((g) => g.resourceType === 'teacher').flatMap((g) => g.resources.map((r) => r.id)),
    groupOptions: resources.filter((g) => g.resourceType === 'group').flatMap((g) => g.resources.map((r) => r.id)),
    roomOptions: resources.filter((g) => g.resourceType === 'room').flatMap((g) => g.resources.map((r) => r.id)),
  }), [resources]);

  // ── État local UI ──────────────────────────────────────────────────────
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);
  const [pendingEdit, setPendingEdit] = useState<PendingEditData | null>(null);
  const [pendingNeutralizedDrop, setPendingNeutralizedDrop] = useState<PendingNeutralizedDrop | null>(null);
  const [dragging, setDragging] = useState<DraggingState | null>(null);

  const calendarRef = useRef<FullCalendar | null>(null);
  const calendarWrapperRef = useRef<HTMLDivElement | null>(null);
  const pendingEventRef = useRef<EventApi | null>(null);

  // ── Map ID → cours (O(1) lookup) ──────────────────────────────────────
  const courseById = useMemo(
    () => new Map(parsedCourses.map((c) => [c.id, c])),
    [parsedCourses],
  );

  const prevParsedCoursesRef = useRef<CourseTaskData[]>(parsedCourses);
  const prevSelectedWeekRef = useRef<number | null>(selectedWeek);
  const skipNextParsedCoursesResetRef = useRef(false);
  const weekChangedRef = useRef(false);

  // Marque le flag quand la semaine change (setSelectedWeek gère déjà manualEnforcedMap)
  useEffect(() => {
    if (prevSelectedWeekRef.current !== selectedWeek) {
      prevSelectedWeekRef.current = selectedWeek;
      weekChangedRef.current = true;
    }
  }, [selectedWeek]);

  useEffect(() => {
    if (prevParsedCoursesRef.current !== parsedCourses) {
      const prev = prevParsedCoursesRef.current;
      prevParsedCoursesRef.current = parsedCourses;
      // Un ajout de cours (append) ne change pas les indices existants — pas de reset.
      const isAppendOnly =
        parsedCourses.length > prev.length &&
        prev.every((c, i) => parsedCourses[i] === c);
      // parsedCourses fusionne allCourses + weekSaves[week].manualCourses (getCoursesForWeek) :
      // un nouveau tableau est reconstruit à chaque changement de weekSaves, y compris quand
      // l'autosave de préparation de semaine réécrit weekSaves sans qu'aucun cours n'ait
      // réellement changé (ex: juste après ce même handleEnforceChange({}) plus bas). Sans ce
      // garde, ce rebuild "à contenu identique" serait pris pour un vrai changement et
      // redéclencherait handleEnforceChange({}) indéfiniment (boucle infinie).
      const sameContent =
        parsedCourses.length === prev.length &&
        prev.every((c, i) => parsedCourses[i] === c);
      if (skipNextParsedCoursesResetRef.current || weekChangedRef.current || isAppendOnly || sameContent) {
        skipNextParsedCoursesResetRef.current = false;
        weekChangedRef.current = false;
      } else {
        handleEnforceChange({});
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedCourses]);

  // ── Handlers ──────────────────────────────────────────────────────────

  function confirmEnforce(courseKey: string, enforced: EnforcedData, event: EventApi) {
    event.remove();
    const newMap = { ...usePlanningStore.getState().manualEnforcedMap, [courseKey]: enforced };
    handleEnforceChange(newMap);
  }

  function removeEnforced(courseKey: string) {
    const newMap = { ...usePlanningStore.getState().manualEnforcedMap };
    delete newMap[courseKey];
    handleEnforceChange(newMap);
  }

  function handleSelect(selectInfo: { start: Date; end: Date }) {
    handleBlockedZoneAdd(selectInfo.start, selectInfo.end);
    calendarRef.current?.getApi().unselect();
  }

  function handleDateClick(info: { date: Date }) {
    const clicked = info.date;
    const zone = blockedZones.find((z) => z.start <= clicked && z.end > clicked);
    if (zone) handleBlockedZoneRemove(zone.id);
  }

  function handleEventClick(arg: EventClickArg) {
    const ext = arg.event.extendedProps as CalendarEventExtProps;

    if (ext.isBlockedZone && ext.blockedZoneId) {
      handleBlockedZoneRemove(ext.blockedZoneId);
      return;
    }

    const startTime = arg.event.start
      ? Math.round((arg.event.start.getTime() - monday.getTime()) / 60000)
      : 0;

    setPendingEdit({
      placementId: arg.event.id,
      taskId: ext.taskId ?? arg.event.id,
      title: arg.event.title,
      teachers: ext.teachers ?? [],
      groups: ext.groups ?? [],
      rooms: ext.rooms ?? [],
      startTime,
      durationMin: ext.durationMin ?? 0,
      origin: ext.origin ?? 'auto',
      showDuration: true,
      ...resourceOptions,
    });
  }

  function handleEventDragStart(info: { event: { id: string; extendedProps: unknown } }) {
    const ext = info.event.extendedProps as CalendarEventExtProps;
    if (ext.isBlockedZone) return;
    setDragging({
      id: info.event.id,
      teachers: ext.teachers ?? [],
      groups: ext.groups ?? [],
      rooms: ext.rooms ?? [],
    });
  }

  function handleReceiveNeutralizedTask(info: EventReceiveArg) {
    const ext = info.event.extendedProps as {
      taskId?: string;
      teachers?: string[];
      groups?: string[];
      rooms?: string[];
      durationMin?: number;
      code?: string;
      name?: string;
      type?: string;
    };
    const taskId = ext.taskId;
    const startDate = info.event.start;
    if (!startDate || !taskId) { info.event.remove(); return; }

    const teachers = ext.teachers ?? [];
    const groups = ext.groups ?? [];
    const rooms = ext.rooms ?? [];
    const durationMin = ext.durationMin ?? 60;
    const code = ext.code ?? '';
    const name = ext.name ?? '';
    const type = ext.type ?? '';
    const startTime = Math.round((startDate.getTime() - monday.getTime()) / 60000);

    info.event.remove();

    // Si le cours original a des alternatives de salle/enseignant, demander la sélection
    const originalCourse = courseById.get(taskId) ?? null;
    const hasAlts = originalCourse && [...originalCourse.teacher, ...originalCourse.rooms].some((e) => Array.isArray(e));
    // Si pas de cours original mais plusieurs rooms dans les candidats
    const hasMultipleRooms = !originalCourse && rooms.length > 1;

    if (originalCourse && hasAlts) {
      setPendingNeutralizedDrop({ taskId, code, name, type, startTime, durationMin, teachers, groups, rooms, course: originalCourse });
      return;
    }

    if (hasMultipleRooms) {
      // Construire un CourseTaskData synthétique pour réutiliser EnforceModal
      const syntheticCourse: CourseTaskData = {
        week: 0, semester: 0, level: 0, code, name, type, duration: durationMin,
        teacher: teachers,
        groups: groups,
        rooms: [rooms],
      };
      setPendingNeutralizedDrop({ taskId, code, name, type, startTime, durationMin, teachers, groups, rooms, course: syntheticCourse });
      return;
    }

    addPlacement({
      placementId: taskId,
      taskId,
      startTime,
      duration: durationMin,
      resources: { teachers, groups, rooms },
      origin: 'post-enforced',
    });
  }

  function handleEventReceive(info: EventReceiveArg) {
    if (info.event.extendedProps.isNeutralizedTask) {
      handleReceiveNeutralizedTask(info);
      return;
    }
    const courseKey = info.event.extendedProps.courseKey as string;
    const startDate = info.event.start;
    if (!startDate || !courseKey) { info.event.remove(); return; }

    const course = courseById.get(courseKey);
    if (!course) { info.event.remove(); return; }

    const startTime = Math.round((startDate.getTime() - monday.getTime()) / 60000);
    const hasAlternatives = [...course.teacher, ...course.rooms].some((e) => Array.isArray(e));

    if (!hasAlternatives) {
      const teacher = course.teacher.flatMap((e) => (Array.isArray(e) ? [e[0]] : [e]));
      const groups = course.groups.flatMap((e) => (Array.isArray(e) ? [e[0]] : [e]));
      const rooms = course.rooms.flatMap((e) => (Array.isArray(e) ? [e[0]] : [e]));
      confirmEnforce(courseKey, { startTime, teacher, groups, rooms }, info.event);
    } else {
      pendingEventRef.current = info.event;
      setPendingDrop({ courseKey, startTime, course });
    }
  }

  function handleModalConfirm(sel: EnforceSelection) {
    const event = pendingEventRef.current;
    if (!event) return;
    confirmEnforce(sel.courseKey, {
      startTime: sel.startTime,
      teacher: sel.teacher,
      groups: sel.groups,
      rooms: sel.rooms,
    }, event);
    pendingEventRef.current = null;
    setPendingDrop(null);
  }

  function handleModalCancel() {
    pendingEventRef.current?.remove();
    pendingEventRef.current = null;
    setPendingDrop(null);
  }

  function handleNeutralizedPlaceConfirm(sel: EnforceSelection) {
    if (!pendingNeutralizedDrop) return;
    addPlacement({
      placementId: pendingNeutralizedDrop.taskId,
      taskId: pendingNeutralizedDrop.taskId,
      startTime: sel.startTime,
      duration: pendingNeutralizedDrop.durationMin,
      resources: { teachers: sel.teacher, groups: sel.groups, rooms: sel.rooms },
      origin: 'post-enforced',
    });
    setPendingNeutralizedDrop(null);
  }

  function handleNeutralizedPlaceCancel() {
    setPendingNeutralizedDrop(null);
  }

  function handleEditConfirm(update: TaskEditUpdate) {
    if (!pendingEdit) return;

    if (pendingEdit.origin === 'pre-enforced') {
      const courseKey = pendingEdit.taskId;
      const state = usePlanningStore.getState();
      const existing = state.manualEnforcedMap[courseKey] ?? state.enforcedMap[courseKey];
      if (existing) {
        const updated: EnforcedData = { ...existing, teacher: update.teachers.flat(), groups: update.groups.flat(), rooms: update.rooms.flat() };
        const newMap = { ...state.manualEnforcedMap, [courseKey]: updated };
        handleEnforceChange({ ...newMap });
      }

      // Durée : EnforcedData ne porte pas de champ duration, la seule persistance possible
      // pour une imposition est le cours lui-même (acquis du modèle précédent).
      if (update.duration !== undefined) {
        const course = courseById.get(courseKey);
        if (course) {
          const patch = { duration: update.duration };
          skipNextParsedCoursesResetRef.current = true;
          if (course.source === 'manual') {
            if (selectedWeek !== null) useProjectStore.getState().updateManualCourse(selectedWeek, course.id, patch);
          } else {
            const { allCourses, setCourses } = useProjectStore.getState();
            setCourses(allCourses.map((c) => (c === course ? { ...c, ...patch } : c)));
          }
        }
      }
    } else {
      // auto / post-enforced : retouche d'un placement concret (sans alternatives) — teacher/
      // groups/rooms ne sont volontairement PAS recopiés sur le cours-modèle, qui peut en avoir
      // (cf. mémoire du projet).
      updatePlacement(pendingEdit.placementId, {
        resources: { teachers: update.teachers.flat(), groups: update.groups.flat(), rooms: update.rooms.flat() },
        ...(update.duration !== undefined ? { duration: update.duration } : {}),
      });
    }

    setPendingEdit(null);
  }

  function handleEventDrop(info: EventDropArg) {
    setDragging(null);
    const ext = info.event.extendedProps as CalendarEventExtProps;

    if (ext.isBlockedZone && ext.blockedZoneId) {
      const start = info.event.start;
      const end = info.event.end;
      if (!start || !end) { info.revert(); return; }
      handleBlockedZoneMove(ext.blockedZoneId, start, end);
      return;
    }

    const startDate = info.event.start;
    const taskId = ext.taskId;
    if (!startDate || !taskId) return;
    const newStartTime = Math.round((startDate.getTime() - monday.getTime()) / 60000);

    if (ext.origin === 'pre-enforced') {
      const courseKey = taskId;
      const state = usePlanningStore.getState();
      const existing = state.manualEnforcedMap[courseKey] ?? state.enforcedMap[courseKey];
      if (!existing) return;

      const updated: EnforcedData = { ...existing, startTime: newStartTime };
      const newMap = { ...state.manualEnforcedMap, [courseKey]: updated };
      handleEnforceChange({ ...newMap });
      return;
    }

    // auto / post-enforced : chemin unique, la bascule d'origine est faite par le store.
    updatePlacement(info.event.id, { startTime: newStartTime });
  }

  function handleEventDragStop(info: EventDragStopArg) {
    setDragging(null);
    const calEl = calendarWrapperRef.current;
    if (!calEl) return;

    const rect = calEl.getBoundingClientRect();
    const { clientX, clientY } = info.jsEvent as MouseEvent;
    const isOutside =
      clientX < rect.left || clientX > rect.right ||
      clientY < rect.top || clientY > rect.bottom;

    if (!isOutside) return;

    const ext = info.event.extendedProps as CalendarEventExtProps;

    if (ext.isBlockedZone) return;

    if (ext.origin === 'pre-enforced' && ext.taskId) {
      const courseKey = ext.taskId;
      const state = usePlanningStore.getState();
      // Si auto-propagé (pas dans manualEnforcedMap), on le retire de la propagation
      // en l'ajoutant d'abord dans manualEnforcedMap puis en le supprimant
      const newMap = { ...state.manualEnforcedMap };
      delete newMap[courseKey];
      handleEnforceChange({ ...newMap });
      return;
    }

    // Placement auto/post-enforced déposé hors du calendrier → pioche. `unplaceTask` dédup sur
    // `taskId` : si la tâche a déjà une entrée non placée (ex. neutralisée par le moteur), elle
    // n'en gagne pas une seconde — voir lib/calendar/unplaced.ts.
    if (ext.taskId) {
      const placementId = info.event.id;
      info.event.remove();
      unplaceTask(placementId, 'user-post');
    }
  }

  // ── Calcul des événements calendrier ──────────────────────────────────
  const calendarEvents = useMemo(() => {
    const blockEvts = blockedZones.map((zone) => ({
      id: `blocked-${zone.id}`,
      start: zone.start,
      end: zone.end,
      backgroundColor:
        zone.source === 'vacation'
          ? 'rgba(99,179,237,0.95)'
          : zone.source === 'public-holiday'
            ? 'rgba(154,117,210,0.95)'
            : 'rgba(239,68,68,0.95)',
      borderColor:
        zone.source === 'vacation'
          ? 'rgba(66,153,225,0.9)'
          : zone.source === 'public-holiday'
            ? 'rgba(128,90,213,0.9)'
            : 'rgba(220, 34, 34, 1)',
      classNames: ['fc-blocked-zone'],
      extendedProps: {
        isBlockedZone: true,
        blockedZoneId: zone.id,
        blockedZoneSource: zone.source ?? 'manual',
        blockedZoneLabel: zone.label,
      },
    }));

    // Une seule liste rendue, toujours — plus de test de mode selon la présence d'une solution.
    // Violation dérivée au rendu (§1.1/§4.1 du plan) : alignée sur computeStaticConflicts,
    // recalculée à chaque changement de zone bloquée/contrainte plutôt que figée au drag.
    const placementEvts: CalendarEventData[] = placements.map((p) => {
      const course = courseById.get(p.taskId);
      const duration = p.duration ?? course?.duration ?? 60;
      const violation = availabilityManager
        ? computeConstraintViolation(p.startTime, duration, p.resources.teachers, p.resources.groups, p.resources.rooms, availabilityManager, week)
        : 'none';
      return buildPlacementEvent(p, course, monday, yearColorConfig, violation);
    });

    const resourceEvents: ResourceEventInfo[] = placementEvts.map((e) => ({
      id: e.id,
      start: e.start,
      end: e.end,
      teachers: e.extendedProps.teachers ?? [],
      groups: e.extendedProps.groups ?? [],
      rooms: e.extendedProps.rooms ?? [],
    }));

    const activeDragResources = dragging ?? externalDragging ?? null;
    const highlights = dragging
      ? computeDragHighlights(resourceEvents, dragging)
      : activeDragResources
        ? computeDragHighlights(resourceEvents, { id: '', ...activeDragResources })
        : computeStaticConflicts(resourceEvents);

    function applyHighlight(evt: CalendarEventData): CalendarEventData {
      const hl = highlights[evt.id];
      const isDragActive = activeDragResources !== null;
      if (!hl) {
        if (!isDragActive) return evt;
        // Drag actif, aucune collision → vert
        return {
          ...evt,
          backgroundColor: '#22c55e',
          borderColor: '#16a34a',
        };
      }
      return {
        ...evt,
        backgroundColor: hl === 'red' ? '#ef4444' : '#f97316',
        borderColor: hl === 'red' ? '#dc2626' : '#ea580c',
      };
    }

    const constraintBgEvents: { id: string; start: Date; end: Date; display: string; backgroundColor: string; classNames: string[] }[] = [];
    if (activeDragResources && availabilityManager) {
      // Rouge : enseignants indisponibles (prioritaire)
      const teacherIds = activeDragResources.teachers;
      const teacherZones = teacherIds.length > 0
        ? computeConstraintUnavailableZones(teacherIds, availabilityManager, week, monday)
        : [];

      // Orange : salles + groupes indisponibles, SAUF les plages déjà couvertes par le rouge
      const otherIds = [...activeDragResources.groups, ...activeDragResources.rooms];
      const otherZones = otherIds.length > 0
        ? subtractDateZones(
            computeConstraintUnavailableZones(otherIds, availabilityManager, week, monday),
            teacherZones,
          )
        : [];

      otherZones.forEach((z: { start: Date; end: Date }, i: number) => {
        constraintBgEvents.push({
          id: `constraint-bg-other-${i}`,
          start: z.start,
          end: z.end,
          display: 'background',
          backgroundColor: 'rgb(234, 88, 12, 1)',
          classNames: ['fc-constraint-unavailable', 'fc-constraint-other'],
        });
      });

      teacherZones.forEach((z, i) => {
        constraintBgEvents.push({
          id: `constraint-bg-teacher-${i}`,
          start: z.start,
          end: z.end,
          display: 'background',
          backgroundColor: 'rgb(182, 0, 23, 1)',
          classNames: ['fc-constraint-unavailable', 'fc-constraint-teacher'],
        });
      });
    }

    return [
      ...placementEvts.map(applyHighlight),
      ...blockEvts,
      ...constraintBgEvents,
    ];
  }, [placements, courseById, blockedZones, monday, dragging, externalDragging, availabilityManager, week, yearColorConfig]);

  return {
    week,
    monday,
    calendarRef,
    calendarWrapperRef,
    calendarEvents,
    /** Une solution moteur existe pour la semaine courante (bascule les interactions de la préparation). */
    // Fondé sur `lastRun` (persisté) et non `scheduleResult` (session) : après un rechargement en
    // vue solution restaurée, `scheduleResult` est null et la sélection de zone bloquée
    // (`selectable={!hasSolution}`) se réactiverait alors qu'on n'est pas en préparation.
    hasSolution: lastRun !== null,
    // État des modals
    pendingDrop,
    pendingEdit,
    setPendingEdit,
    pendingNeutralizedDrop,
    dragging,
    // Handlers FullCalendar
    handleSelect,
    handleDateClick,
    handleEventClick,
    handleEventDragStart,
    handleEventDrop,
    handleEventDragStop,
    handleEventReceive,
    // Handlers modals
    confirmEnforce,
    removeEnforced,
    handleModalConfirm,
    handleModalCancel,
    handleNeutralizedPlaceConfirm,
    handleNeutralizedPlaceCancel,
    handleEditConfirm,
    // Données pour les modals
    placements,
  };
}
