'use client';

import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface ResourceSlotsProps {
  label: string;
  values: string[];
  options: string[];
  onChange: (index: number, val: string) => void;
  onAdd: (value: string) => void;
  onRemove: (index: number) => void;
}

export function ResourceSlots({ label, values, options, onChange, onAdd, onRemove }: ResourceSlotsProps) {
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
