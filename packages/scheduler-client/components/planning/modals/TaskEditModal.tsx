'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface TaskEditUpdate {
  teachers: string[];
  groups: string[];
  rooms: string[];
}

interface Props {
  title: string;
  teachers: string[];
  groups: string[];
  rooms: string[];
  teacherOptions: string[];
  groupOptions: string[];
  roomOptions: string[];
  onConfirm: (update: TaskEditUpdate) => void;
  onCancel: () => void;
}

interface ResourceSlotProps {
  label: string;
  values: string[];
  options: string[];
  onChange: (index: number, val: string) => void;
}

function ResourceSlots({ label, values, options, onChange }: ResourceSlotProps) {
  if (values.length === 0) return null;
  return (
    <div>
      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 block">
        {label}
      </Label>
      {values.map((val, i) => {
        const allOptions = [...new Set([...options, val])];
        return (
          <Select key={i} value={val} onValueChange={(v) => onChange(i, v)}>
            <SelectTrigger className="w-full mb-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {allOptions.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      })}
    </div>
  );
}

export default function TaskEditModal({
  title,
  teachers,
  groups,
  rooms,
  teacherOptions,
  groupOptions,
  roomOptions,
  onConfirm,
  onCancel,
}: Props) {
  const [selTeachers, setSelTeachers] = useState<string[]>(teachers);
  const [selGroups, setSelGroups] = useState<string[]>(groups);
  const [selRooms, setSelRooms] = useState<string[]>(rooms);

  function handleConfirm() {
    onConfirm({ teachers: selTeachers, groups: selGroups, rooms: selRooms });
  }

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Modifier les ressources</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground truncate">{title}</p>

        <div className="space-y-4">
          <ResourceSlots
            label="Enseignant(s)"
            values={selTeachers}
            options={teacherOptions}
            onChange={(i, v) => setSelTeachers((p) => p.map((x, j) => (j === i ? v : x)))}
          />
          <ResourceSlots
            label="Groupe(s)"
            values={selGroups}
            options={groupOptions}
            onChange={(i, v) => setSelGroups((p) => p.map((x, j) => (j === i ? v : x)))}
          />
          <ResourceSlots
            label="Salle(s)"
            values={selRooms}
            options={roomOptions}
            onChange={(i, v) => setSelRooms((p) => p.map((x, j) => (j === i ? v : x)))}
          />
        </div>

        <div className="flex gap-3 pt-2">
          <Button variant="outline" onClick={onCancel} className="flex-1">
            Annuler
          </Button>
          <Button onClick={handleConfirm} className="flex-1">
            Confirmer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
