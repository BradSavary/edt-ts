'use client';

import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ResourceEntry } from '@edt-ts/scheduler-common';

export interface ResourceSlotsProps {
  label: string;
  values: ResourceEntry[];
  options: string[];
  onChange: (values: ResourceEntry[]) => void;
  /** Autorise le regroupement de plusieurs ressources en alternative (une seule requise). */
  allowAlternatives?: boolean;
}

export function ResourceSlots({ label, values, options, onChange, allowAlternatives = true }: ResourceSlotsProps) {
  const used = new Set(values.flat());
  const nextDefault = options.find((o) => !used.has(o));

  function toAlts(slot: ResourceEntry): string[] {
    return Array.isArray(slot) ? slot : [slot];
  }
  function fromAlts(alts: string[]): ResourceEntry {
    return alts.length > 1 ? alts : alts[0];
  }

  function addSlot(value: string) {
    onChange([...values, value]);
  }

  function removeSlot(slotIndex: number) {
    onChange(values.filter((_, i) => i !== slotIndex));
  }

  function updateAlternative(slotIndex: number, altIndex: number, newVal: string) {
    const alts = [...toAlts(values[slotIndex])];
    alts[altIndex] = newVal;
    onChange(values.map((s, i) => (i === slotIndex ? fromAlts(alts) : s)));
  }

  function addAlternative(slotIndex: number) {
    const alts = toAlts(values[slotIndex]);
    const usedInSlot = new Set(alts);
    const candidate = options.find((o) => !usedInSlot.has(o)) ?? '';
    onChange(values.map((s, i) => (i === slotIndex ? [...alts, candidate] : s)));
  }

  function removeAlternative(slotIndex: number, altIndex: number) {
    const alts = toAlts(values[slotIndex]);
    const next = alts.filter((_, i) => i !== altIndex);
    if (next.length === 0) {
      removeSlot(slotIndex);
      return;
    }
    onChange(values.map((s, i) => (i === slotIndex ? fromAlts(next) : s)));
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
            onClick={() => addSlot(nextDefault)}
            className="text-xs text-primary hover:underline"
          >
            + ET
          </button>
        )}
      </div>
      {values.map((slot, slotIndex) => {
        const alts = toAlts(slot);
        return (
          <div
            key={slotIndex}
            className="border rounded-md bg-muted/40 p-2 mb-2 space-y-1"
          >
            {alts.map((val, altIndex) => {
              // `val` reste fusionné aux options du catalogue : un cours peut porter un id
              // qui n'y figure pas (projet ancien, ressource retirée du catalogue depuis).
              // Sans ça le Select s'afficherait vide et la validation écraserait la valeur.
              const allOptions = [...new Set([...options, val])];
              return (
                <div key={altIndex} className="flex gap-1 mb-1 items-center">
                  <Select value={val} onValueChange={(v) => updateAlternative(slotIndex, altIndex, v)}>
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
                    onClick={() => removeAlternative(slotIndex, altIndex)}
                    className="shrink-0 text-muted-foreground hover:text-destructive text-sm px-2"
                    title="Supprimer"
                  >
                    ×
                  </button>
                </div>
              );
            })}
            {allowAlternatives && (
              <button
                type="button"
                onClick={() => addAlternative(slotIndex)}
                className="text-[10px] leading-none text-primary hover:underline block"
              >
                + OU
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
