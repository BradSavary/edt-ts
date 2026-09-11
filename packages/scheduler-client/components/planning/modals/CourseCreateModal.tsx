'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { CourseTaskData, ResourceEntry } from '@edt-ts/scheduler-common';
import { ResourceSlots } from '@/components/planning/modals/ResourceSlots';
import { BUT_LEVEL_OPTIONS, semesterFromLevel, sortGroupsByLevel } from '@/lib/butLevel';

interface Props {
  week: number;
  teacherOptions: string[];
  groupOptions: string[];
  roomOptions: string[];
  /** Si défini, pré-remplit la modale pour dupliquer ce cours */
  initialCourse?: CourseTaskData;
  onConfirm: (course: CourseTaskData) => void;
  onCancel: () => void;
}

export default function CourseCreateModal({
  week,
  teacherOptions,
  groupOptions,
  roomOptions,
  initialCourse,
  onConfirm,
  onCancel,
}: Props) {
  const isDuplicate = initialCourse !== undefined;

  const [code, setCode] = useState(initialCourse?.code ?? '');
  const [name, setName] = useState(initialCourse?.name ?? '');
  const [type, setType] = useState(initialCourse?.type ?? 'CM');
  const [level, setLevel] = useState(initialCourse?.level ?? 0);
  const [duration, setDuration] = useState(initialCourse?.duration ?? 60);
  const [teachers, setTeachers] = useState<ResourceEntry[]>(initialCourse?.teacher ?? []);
  const [groups, setGroups] = useState<ResourceEntry[]>(initialCourse?.groups ?? []);
  const [rooms, setRooms] = useState<ResourceEntry[]>(initialCourse?.rooms ?? []);
  const [comment, setComment] = useState(initialCourse?.comment ?? '');

  const canConfirm = code.trim().length > 0 && duration > 0;

  function handleConfirm() {
    if (!canConfirm) return;
    const course: CourseTaskData = {
      week,
      semester: semesterFromLevel(level),
      level,
      code: code.trim(),
      name: name.trim(),
      type: type.trim(),
      duration,
      teacher: teachers,
      groups,
      rooms,
      comment: comment.trim() || undefined,
    };
    onConfirm(course);
  }

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isDuplicate ? 'Dupliquer le cours' : 'Nouveau cours'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Code */}
          <div>
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">
              Code
            </Label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="ex. R101"
              className="h-8 text-sm"
            />
          </div>

          {/* Nom */}
          <div>
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">
              Nom
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex. Introduction à l'informatique"
              className="h-8 text-sm"
            />
          </div>

          {/* Type */}
          <div>
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">
              Type
            </Label>
            <Input
              value={type}
              onChange={(e) => setType(e.target.value)}
              placeholder="ex. CM, TD, TP"
              className="h-8 text-sm"
            />
          </div>

          {/* Niveau */}
          <div>
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">
              Niveau
            </Label>
            <Select value={String(level)} onValueChange={(v) => setLevel(Number(v))}>
              <SelectTrigger className="h-8 text-sm w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUT_LEVEL_OPTIONS.map((l) => (
                  <SelectItem key={l.value} value={String(l.value)}>{l.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Durée */}
          <div>
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">
              Durée (minutes)
            </Label>
            <Input
              type="number"
              min="15"
              max="480"
              step="15"
              value={duration}
              onChange={(e) => setDuration(Math.max(15, parseInt(e.target.value, 10) || 15))}
              className="h-8 text-sm"
            />
          </div>

          {/* Commentaires */}
          <div>
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">
              Commentaires
            </Label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Informations libres sur ce cours…"
              className="w-full min-h-[70px] resize-y rounded-md border border-input bg-transparent p-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          <ResourceSlots
            label="Enseignant(s)"
            values={teachers}
            options={teacherOptions}
            onChange={setTeachers}
          />
          <ResourceSlots
            label="Groupe(s)"
            values={groups}
            options={sortGroupsByLevel(groupOptions, level)}
            onChange={setGroups}
          />
          <ResourceSlots
            label="Salle(s)"
            values={rooms}
            options={roomOptions}
            onChange={setRooms}
          />
        </div>

        <div className="flex gap-3 pt-2">
          <Button variant="outline" onClick={onCancel} className="flex-1">
            Annuler
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm} className="flex-1">
            {isDuplicate ? 'Dupliquer' : 'Créer'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
