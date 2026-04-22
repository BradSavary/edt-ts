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
import type { CourseTaskData } from '@edt-ts/scheduler-common';

// Réutilisation du composant ResourceSlots depuis TaskEditModal (copie locale simplifiée)
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ResourceSlotsProps {
  label: string;
  values: string[];
  options: string[];
  onChange: (index: number, val: string) => void;
  onAdd: (value: string) => void;
  onRemove: (index: number) => void;
}

function ResourceSlots({ label, values, options, onChange, onAdd, onRemove }: ResourceSlotsProps) {
  const [customInput, setCustomInput] = useState('');
  const nextDefault = options.find((o) => !values.includes(o));

  function handleCustomAdd() {
    const v = customInput.trim();
    if (v) { onAdd(v); setCustomInput(''); }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">
          {label}
        </Label>
        {nextDefault && (
          <button type="button" onClick={() => onAdd(nextDefault)} className="text-xs text-primary hover:underline">
            + Ajouter
          </button>
        )}
      </div>
      {values.map((val, i) => {
        const allOptions = [...new Set([...options, val])];
        return (
          <div key={i} className="flex gap-1 mb-1">
            <Select value={val} onValueChange={(v) => onChange(i, v)}>
              <SelectTrigger className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {allOptions.map((opt) => (
                  <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="shrink-0 text-muted-foreground hover:text-destructive text-sm px-2"
              title="Supprimer"
            >
              ×
            </button>
          </div>
        );
      })}
      <div className="flex gap-1 mt-1">
        <Input
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCustomAdd(); } }}
          placeholder="Ressource personnalisée…"
          className="h-7 text-xs flex-1"
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={handleCustomAdd}
          disabled={!customInput.trim()}
          className="h-7 px-2 text-xs"
        >
          +
        </Button>
      </div>
    </div>
  );
}

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
  const [duration, setDuration] = useState(initialCourse?.duration ?? 60);
  const [teachers, setTeachers] = useState<string[]>(
    initialCourse ? (initialCourse.teacher.flat() as string[]) : []
  );
  const [groups, setGroups] = useState<string[]>(
    initialCourse ? (initialCourse.groups.flat() as string[]) : []
  );
  const [rooms, setRooms] = useState<string[]>(
    initialCourse ? (initialCourse.rooms.flat() as string[]) : []
  );

  const canConfirm = code.trim().length > 0 && duration > 0;

  function handleConfirm() {
    if (!canConfirm) return;
    const course: CourseTaskData = {
      week,
      semester: initialCourse?.semester ?? 0,
      level: initialCourse?.level ?? 0,
      code: code.trim(),
      name: name.trim(),
      type: type.trim(),
      duration,
      teacher: teachers,
      groups,
      rooms,
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

          <ResourceSlots
            label="Enseignant(s)"
            values={teachers}
            options={teacherOptions}
            onChange={(i, v) => setTeachers((p) => p.map((x, j) => (j === i ? v : x)))}
            onAdd={(v) => setTeachers((p) => [...p, v])}
            onRemove={(i) => setTeachers((p) => p.filter((_, j) => j !== i))}
          />
          <ResourceSlots
            label="Groupe(s)"
            values={groups}
            options={groupOptions}
            onChange={(i, v) => setGroups((p) => p.map((x, j) => (j === i ? v : x)))}
            onAdd={(v) => setGroups((p) => [...p, v])}
            onRemove={(i) => setGroups((p) => p.filter((_, j) => j !== i))}
          />
          <ResourceSlots
            label="Salle(s)"
            values={rooms}
            options={roomOptions}
            onChange={(i, v) => setRooms((p) => p.map((x, j) => (j === i ? v : x)))}
            onAdd={(v) => setRooms((p) => [...p, v])}
            onRemove={(i) => setRooms((p) => p.filter((_, j) => j !== i))}
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
