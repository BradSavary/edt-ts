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
  isEnforced?: boolean;
  onRemoveEnforced?: () => void;
  onConfirm: (update: TaskEditUpdate) => void;
  onCancel: () => void;
}

interface ResourceSlotProps {
  label: string;
  values: string[];
  options: string[];
  onChange: (index: number, val: string) => void;
  onAdd: (value: string) => void;
  onRemove: (index: number) => void;
}

function ResourceSlots({ label, values, options, onChange, onAdd, onRemove }: ResourceSlotProps) {
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
          <button
            type="button"
            onClick={() => onAdd(nextDefault)}
            className="text-xs text-primary hover:underline"
          >
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
                  <SelectItem key={opt} value={opt}>
                    {opt}
                  </SelectItem>
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

      {/* Saisie manuelle d'un ID personnalisé */}
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

export default function TaskEditModal({
  title,
  teachers,
  groups,
  rooms,
  teacherOptions,
  groupOptions,
  roomOptions,
  isEnforced,
  onRemoveEnforced,
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
