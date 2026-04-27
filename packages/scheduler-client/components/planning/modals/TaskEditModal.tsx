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
import { ResourceSlots } from '@/components/planning/modals/ResourceSlots';

export interface TaskEditUpdate {
  teachers: string[];
  groups: string[];
  rooms: string[];
  duration?: number;
}

interface Props {
  title: string;
  teachers: string[];
  groups: string[];
  rooms: string[];
  teacherOptions: string[];
  groupOptions: string[];
  roomOptions: string[];
  duration?: number;
  showDuration?: boolean;
  isEnforced?: boolean;
  onRemoveEnforced?: () => void;
  onConfirm: (update: TaskEditUpdate) => void;
  onCancel: () => void;
}

export default function TaskEditModal({
  title,
  teachers,
  groups,
  rooms,
  teacherOptions,
  groupOptions,
  roomOptions,
  duration,
  showDuration = false,
  isEnforced,
  onRemoveEnforced,
  onConfirm,
  onCancel,
}: Props) {
  const [selTeachers, setSelTeachers] = useState<string[]>(teachers);
  const [selGroups, setSelGroups] = useState<string[]>(groups);
  const [selRooms, setSelRooms] = useState<string[]>(rooms);
  const [selDuration, setSelDuration] = useState<string>(String(duration ?? 60));

  function handleConfirm() {
    const parsedDuration = parseInt(selDuration, 10);
    const finalDuration = isNaN(parsedDuration) || parsedDuration < 15 ? 15 : parsedDuration;
    onConfirm({ teachers: selTeachers, groups: selGroups, rooms: selRooms, ...(showDuration ? { duration: finalDuration } : {}) });
  }

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-sm" onKeyDown={(e) => { if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); handleConfirm(); } }}>
        <DialogHeader>
          <DialogTitle>Modifier les ressources</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground truncate">{title}</p>

        <div className="space-y-4">
          {showDuration && (
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">
                Durée (minutes)
              </Label>
              <Input
                type="number"
                min="15"
                max="480"
                step="15"
                value={selDuration}
                onChange={(e) => setSelDuration(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          )}
          <ResourceSlots
            label="Enseignant(s)"
            values={selTeachers}
            options={teacherOptions}
            onChange={(i, v) => setSelTeachers((p) => p.map((x, j) => (j === i ? v : x)))}
            onAdd={(v) => setSelTeachers((p) => [...p, v])}
            onRemove={(i) => setSelTeachers((p) => p.filter((_, j) => j !== i))}
          />
          <ResourceSlots
            label="Groupe(s)"
            values={selGroups}
            options={groupOptions}
            onChange={(i, v) => setSelGroups((p) => p.map((x, j) => (j === i ? v : x)))}
            onAdd={(v) => setSelGroups((p) => [...p, v])}
            onRemove={(i) => setSelGroups((p) => p.filter((_, j) => j !== i))}
          />
          <ResourceSlots
            label="Salle(s)"
            values={selRooms}
            options={roomOptions}
            onChange={(i, v) => setSelRooms((p) => p.map((x, j) => (j === i ? v : x)))}
            onAdd={(v) => setSelRooms((p) => [...p, v])}
            onRemove={(i) => setSelRooms((p) => p.filter((_, j) => j !== i))}
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

        {isEnforced && onRemoveEnforced && (
          <Button
            variant="outline"
            className="w-full border-destructive text-destructive hover:bg-destructive/10"
            onClick={() => { onRemoveEnforced(); onCancel(); }}
          >
            Retirer l&apos;imposition
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
