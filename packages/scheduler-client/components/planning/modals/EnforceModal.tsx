'use client';

import { useState } from 'react';
import type { CourseTaskData, ResourceEntry } from '@edt-ts/scheduler-common';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { formatStartTime } from '@/lib/calendar/calendarUtils';

export interface EnforceSelection {
  courseKey: string;
  startTime: number;
  teacher: string[];
  groups: string[];
  rooms: string[];
}

interface Props {
  courseKey: string;
  course: CourseTaskData;
  startTime: number;
  title?: string;
  onConfirm: (sel: EnforceSelection) => void;
  onCancel: () => void;
}

function splitEntries(entries: ResourceEntry[]): { fixed: string[]; alternatives: string[][] } {
  const fixed: string[] = [];
  const alternatives: string[][] = [];
  for (const e of entries) {
    if (Array.isArray(e)) alternatives.push(e);
    else fixed.push(e);
  }
  return { fixed, alternatives };
}

export default function EnforceModal({ courseKey, course, startTime, title, onConfirm, onCancel }: Props) {
  const rooms = splitEntries(course.rooms);
  const teachers = splitEntries(course.teacher);

  const [selectedRooms, setSelectedRooms] = useState<Record<number, string>>(() =>
    Object.fromEntries(rooms.alternatives.map((alt, i) => [i, alt[0]]))
  );
  const [selectedTeachers, setSelectedTeachers] = useState<Record<number, string>>(() =>
    Object.fromEntries(teachers.alternatives.map((alt, i) => [i, alt[0]]))
  );

  function handleConfirm() {
    const resolvedTeachers = [
      ...teachers.fixed,
      ...teachers.alternatives.map((_, i) => selectedTeachers[i] ?? ''),
    ].filter(Boolean);

    const resolvedRooms = [
      ...rooms.fixed,
      ...rooms.alternatives.map((_, i) => selectedRooms[i] ?? ''),
    ].filter(Boolean);

    const resolvedGroups = course.groups.flatMap((e) => (Array.isArray(e) ? [e[0]] : [e]));

    onConfirm({
      courseKey,
      startTime,
      teacher: resolvedTeachers,
      groups: resolvedGroups,
      rooms: resolvedRooms,
    });
  }

  const hasAnyAlternative = rooms.alternatives.length > 0 || teachers.alternatives.length > 0;

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title ?? 'Imposer le cours'}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          {course.code} {course.type} — {course.name}
        </p>
        <p className="text-sm font-medium">
          Horaire : <span className="font-bold">{formatStartTime(startTime)}</span>{' '}
          ({course.duration} min)
        </p>

        {hasAnyAlternative ? (
          <div className="space-y-4">
            {teachers.alternatives.map((alt, i) => (
              <div key={`teacher-alt-${i}`}>
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Enseignant (choix)
                </Label>
                <div className="space-y-1 mt-1.5">
                  {alt.map((t) => (
                    <Label key={t} className="flex items-center gap-2 cursor-pointer font-normal">
                      <input
                        type="radio"
                        name={`teacher-alt-${i}`}
                        value={t}
                        checked={selectedTeachers[i] === t}
                        onChange={() => setSelectedTeachers((prev) => ({ ...prev, [i]: t }))}
                        className="accent-blue-600"
                      />
                      {t}
                    </Label>
                  ))}
                </div>
              </div>
            ))}

            {rooms.alternatives.map((alt, i) => (
              <div key={`room-alt-${i}`}>
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Salle (choix)
                </Label>
                <div className="space-y-1 mt-1.5">
                  {alt.map((r) => (
                    <Label key={r} className="flex items-center gap-2 cursor-pointer font-normal">
                      <input
                        type="radio"
                        name={`room-alt-${i}`}
                        value={r}
                        checked={selectedRooms[i] === r}
                        onChange={() => setSelectedRooms((prev) => ({ ...prev, [i]: r }))}
                        className="accent-blue-600"
                      />
                      {r}
                    </Label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Aucune alternative — toutes les ressources seront imposées telles quelles.
          </p>
        )}

        <div className="flex gap-3 pt-2">
          <Button onClick={handleConfirm} className="flex-1">
            Confirmer
          </Button>
          <Button variant="outline" onClick={onCancel} className="flex-1">
            Annuler
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
