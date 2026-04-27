'use client';

import { useCallback, useState } from 'react';
import type { CourseTaskData } from '@edt-ts/scheduler-common';
import { usePlanningStore } from '@/store/usePlanningStore';
import { useSchedulerStore } from '@/store/useSchedulerStore';
import { useSidebarCourseDrag } from '@/hooks/useSidebarCourseDrag';
import CourseGroupList, { type GroupBy } from '@/components/planning/courses/CourseGroupList';
import { SchedulerConfigDialog } from '@/components/planning/modals/SchedulerConfigDialog';
import TaskEditModal, { type TaskEditUpdate } from '@/components/planning/modals/TaskEditModal';
import CourseCreateModal from '@/components/planning/modals/CourseCreateModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

interface SidebarPreparationProps {
  parsedCourses: CourseTaskData[];
}

export function SidebarPreparation({ parsedCourses }: SidebarPreparationProps) {
  const selectedWeek = usePlanningStore((s) => s.selectedWeek);
  const setSelectedWeek = usePlanningStore((s) => s.setSelectedWeek);
  const isLoading = usePlanningStore((s) => s.isLoading);
  const runSchedule = usePlanningStore((s) => s.runSchedule);
  const enforcedMap = usePlanningStore((s) => s.enforcedMap);
  const taskGroups = usePlanningStore((s) => s.taskGroups);
  const groupDrawerOpen = usePlanningStore((s) => s.groupDrawerOpen);
  const toggleGroupDrawer = usePlanningStore((s) => s.toggleGroupDrawer);

  const allCourses = useSchedulerStore((s) => s.allCourses);
  const setCourses = useSchedulerStore((s) => s.setCourses);
  const addCourse = useSchedulerStore((s) => s.addCourse);
  const removeCourse = useSchedulerStore((s) => s.removeCourse);
  const resources = useSchedulerStore((s) => s.resources);

  const [groupBy, setGroupBy] = useState<GroupBy>('code');
  const [cardContainer, setCardContainer] = useState<HTMLDivElement | null>(null);
  const cardContainerRef = useCallback((node: HTMLDivElement | null) => setCardContainer(node), []);

  useSidebarCourseDrag({ container: cardContainer, courses: parsedCourses });

  const [weekInput, setWeekInput] = useState<string>(selectedWeek !== null ? String(selectedWeek) : '');

  // ── Edit modal state ───────────────────────────────────────────────────
  const [editingCourse, setEditingCourse] = useState<{ courseKey: string; course: CourseTaskData } | null>(null);
  // ── Create/duplicate modal state ───────────────────────────────────────
  const [createModal, setCreateModal] = useState<{ initialCourse?: CourseTaskData } | null>(null);

  function handleEditCourse(courseKey: string, course: CourseTaskData) {
    setEditingCourse({ courseKey, course });
  }

  function handleEditConfirm(update: TaskEditUpdate) {
    if (!editingCourse) return;
    const courseRef = editingCourse.course;
    const updated = allCourses.map((c) =>
      c === courseRef
        ? { ...c, teacher: update.teachers, groups: update.groups, rooms: update.rooms, ...(update.duration !== undefined ? { duration: update.duration } : {}) }
        : c,
    );
    setCourses(updated);
    setEditingCourse(null);
  }

  function handleCreateConfirm(course: CourseTaskData) {
    addCourse(course);
    setCreateModal(null);
  }

  const teacherOptions = resources
    .filter((g) => g.resourceType === 'teacher')
    .flatMap((g) => g.resources.map((r) => r.id));
  const groupOptions = resources
    .filter((g) => g.resourceType === 'group')
    .flatMap((g) => g.resources.map((r) => r.id));
  const roomOptions = resources
    .filter((g) => g.resourceType === 'room')
    .flatMap((g) => g.resources.map((r) => r.id));

  function handleSetWeek(v: string) {
    setWeekInput(v);
    if (v === '') {
      setSelectedWeek(null);
      return;
    }
    const n = parseInt(v, 10);
    if (!isNaN(n) && n >= 1 && n <= 53) setSelectedWeek(n);
  }

  return (
    <aside className="w-80 shrink-0 bg-card border-r border-border p-4 overflow-y-auto flex flex-col gap-4">

      {/* Formulaire de planification */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">
          Planification
        </p>
        <form className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="week-input">Semaine (1–53)</Label>
            <Input
              id="week-input"
              type="number"
              min="1"
              max="53"
              value={weekInput}
              onChange={(e) => handleSetWeek(e.target.value)}
            />
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() => runSchedule('elimination')}
              disabled={isLoading}
              className="flex-1 bg-black hover:bg-zinc-800 text-white dark:bg-zinc-900 dark:hover:bg-zinc-700"
            >
              {isLoading ? 'Traitement…' : 'Planifier'}
            </Button>
            <SchedulerConfigDialog />
          </div>
        </form>
      </div>

      {/* Liste des cours */}
      {parsedCourses.length > 0 && (
        <div className="flex flex-col gap-2">
          <Separator />
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Cours {weekInput ? `S${weekInput}` : ''}
            </p>
            <div className="flex items-center gap-1">
              <Badge variant="secondary">{parsedCourses.length} cours</Badge>
              {selectedWeek !== null && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => setCreateModal({})}
                  title="Créer un nouveau cours"
                >
                  + Cours
                </Button>
              )}
              <div className="relative inline-flex">
                <Button
                  type="button"
                  variant={groupDrawerOpen ? 'default' : 'outline'}
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={toggleGroupDrawer}
                  title="Gérer les groupes de tâches"
                >
                  ⬡ Groupes
                </Button>
                {taskGroups.length > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 flex items-center justify-center rounded-full bg-violet-500 text-white text-[9px] font-bold leading-none pointer-events-none">
                    {taskGroups.length}
                  </span>
                )}
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground italic">
            Glissez un cours sur le calendrier pour l&apos;imposer.
          </p>
          <Tabs value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
            <TabsList className="w-full">
              <TabsTrigger value="code" className="flex-1">Par code</TabsTrigger>
              <TabsTrigger value="teacher" className="flex-1">Par enseignant</TabsTrigger>
            </TabsList>
          </Tabs>
          <div ref={cardContainerRef}>
            <CourseGroupList
              courses={parsedCourses}
              groupBy={groupBy}
              enforcedMap={enforcedMap}
              onEditCourse={handleEditCourse}
              onDuplicateCourse={(course) => setCreateModal({ initialCourse: course })}
              onDeleteCourse={(indexInParsed) => {
                const courseRef = parsedCourses[indexInParsed];
                const realIndex = allCourses.indexOf(courseRef);
                if (realIndex !== -1) removeCourse(realIndex);
              }}
            />
          </div>
        </div>
      )}

      {/* Modal d'édition des ressources d'un cours */}
      {editingCourse && (
        <TaskEditModal
          title={`${editingCourse.course.code} ${editingCourse.course.type} — ${editingCourse.course.name}`}
          teachers={editingCourse.course.teacher.flat() as string[]}
          groups={editingCourse.course.groups.flat() as string[]}
          rooms={editingCourse.course.rooms.flat() as string[]}
          duration={editingCourse.course.duration}
          showDuration={true}
          teacherOptions={teacherOptions}
          groupOptions={groupOptions}
          roomOptions={roomOptions}
          onConfirm={handleEditConfirm}
          onCancel={() => setEditingCourse(null)}
        />
      )}

      {/* Modal de création / duplication d'un cours */}
      {createModal && selectedWeek !== null && (
        <CourseCreateModal
          week={selectedWeek}
          teacherOptions={teacherOptions}
          groupOptions={groupOptions}
          roomOptions={roomOptions}
          initialCourse={createModal.initialCourse}
          onConfirm={handleCreateConfirm}
          onCancel={() => setCreateModal(null)}
        />
      )}
    </aside>
  );
}
