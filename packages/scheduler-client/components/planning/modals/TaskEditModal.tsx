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
import type { ResourceEntry } from '@edt-ts/scheduler-common';
import { sortGroupsByLevel } from '@/lib/butLevel';

export interface TaskEditUpdate {
  teachers: ResourceEntry[];
  groups: ResourceEntry[];
  rooms: ResourceEntry[];
  duration?: number;
}

interface Props {
  title: string;
  teachers: ResourceEntry[];
  groups: ResourceEntry[];
  rooms: ResourceEntry[];
  teacherOptions: string[];
  groupOptions: string[];
  roomOptions: string[];
  duration?: number;
  showDuration?: boolean;
  /** Niveau BUT du cours (fixé à la création, non modifiable ici) : sert uniquement à prioriser les groupes du même niveau dans la liste. */
  level?: number;
  isEnforced?: boolean;
  /** Autorise le regroupement en alternative. false pour les placements concrets (calendrier). */
  allowAlternatives?: boolean;
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
  level,
  isEnforced,
  allowAlternatives = true,
  onRemoveEnforced,
  onConfirm,
  onCancel,
}: Props) {
  const [selTeachers, setSelTeachers] = useState<ResourceEntry[]>(teachers);
  const [selGroups, setSelGroups] = useState<ResourceEntry[]>(groups);
  const [selRooms, setSelRooms] = useState<ResourceEntry[]>(rooms);
  const [selDuration, setSelDuration] = useState<string>(String(duration ?? 60));

  function handleConfirm() {
    const parsedDuration = parseInt(selDuration, 10);
    const finalDuration = isNaN(parsedDuration) || parsedDuration < 15 ? 15 : parsedDuration;
    onConfirm({
      teachers: selTeachers,
      groups: selGroups,
      rooms: selRooms,
      ...(showDuration ? { duration: finalDuration } : {}),
    });
  }

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-sm max-h-[90vh] flex flex-col" onKeyDown={(e) => { if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); handleConfirm(); } }}>
        <DialogHeader>
          <DialogTitle>Modifier les ressources</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground truncate">{title}</p>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 px-1 -mx-1">
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
            onChange={setSelTeachers}
            allowAlternatives={allowAlternatives}
          />
          <ResourceSlots
            label="Groupe(s)"
            values={selGroups}
            options={level !== undefined ? sortGroupsByLevel(groupOptions, level) : groupOptions}
            onChange={setSelGroups}
            allowAlternatives={allowAlternatives}
          />
          <ResourceSlots
            label="Salle(s)"
            values={selRooms}
            options={roomOptions}
            onChange={setSelRooms}
            allowAlternatives={allowAlternatives}
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
