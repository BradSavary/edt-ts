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

/** Un slot à choix du cours, indexé par sa position **dans les entrées du modèle**. */
interface AltSlot {
  entryIndex: number;
  alts: string[];
}

/**
 * Les slots à choix, porteurs de leur index d'entrée : c'est cet index qui clef la sélection et
 * ordonne le combo rendu par `resolveCombo`. Une numérotation propre aux alternatives (0, 1, 2… en
 * ignorant les entrées fixes) produirait un combo dans l'ordre `[...fixes, ...alternatives]`, que
 * les consommateurs devraient réapparier au modèle.
 */
function altSlots(entries: ResourceEntry[]): AltSlot[] {
  return entries.flatMap((e, entryIndex) =>
    // Dédupliquer chaque alternative : les valeurs servent de clef React ci-dessous, et deux
    // boutons radio de même `name` ET même `value` rendraient la sélection ambiguë. L'import CSV
    // déduplique déjà à la source (lib/parseCsvCourses.ts) ; ce filet couvre les cours créés ou
    // édités à la main, où `ResourceSlots` n'empêche pas de choisir deux fois la même ressource.
    Array.isArray(e) ? [{ entryIndex, alts: [...new Set(e)] }] : [],
  );
}

/** Combo concret dans l'ordre du modèle : une valeur par entrée, le choix pour les alternatives. */
function resolveCombo(entries: ResourceEntry[], selected: Record<number, string>): string[] {
  return entries
    .map((e, i) => (Array.isArray(e) ? selected[i] ?? e[0] : e))
    .filter(Boolean);
}

export default function EnforceModal({ courseKey, course, startTime, title, onConfirm, onCancel }: Props) {
  const roomSlots = altSlots(course.rooms);
  const teacherSlots = altSlots(course.teacher);

  const [selectedRooms, setSelectedRooms] = useState<Record<number, string>>(() =>
    Object.fromEntries(roomSlots.map((s) => [s.entryIndex, s.alts[0]]))
  );
  const [selectedTeachers, setSelectedTeachers] = useState<Record<number, string>>(() =>
    Object.fromEntries(teacherSlots.map((s) => [s.entryIndex, s.alts[0]]))
  );

  function handleConfirm() {
    const resolvedTeachers = resolveCombo(course.teacher, selectedTeachers);
    const resolvedRooms = resolveCombo(course.rooms, selectedRooms);
    const resolvedGroups = course.groups.flatMap((e) => (Array.isArray(e) ? [e[0]] : [e]));

    onConfirm({
      courseKey,
      startTime,
      teacher: resolvedTeachers,
      groups: resolvedGroups,
      rooms: resolvedRooms,
    });
  }

  const hasAnyAlternative = roomSlots.length > 0 || teacherSlots.length > 0;

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
            {teacherSlots.map(({ entryIndex: i, alts }) => (
              <div key={`teacher-alt-${i}`}>
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Enseignant (choix)
                </Label>
                <div className="space-y-1 mt-1.5">
                  {alts.map((t) => (
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

            {roomSlots.map(({ entryIndex: i, alts }) => (
              <div key={`room-alt-${i}`}>
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Salle (choix)
                </Label>
                <div className="space-y-1 mt-1.5">
                  {alts.map((r) => (
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
