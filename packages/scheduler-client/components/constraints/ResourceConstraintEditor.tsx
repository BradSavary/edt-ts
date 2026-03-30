'use client';

import { useState, useEffect, useRef } from 'react';
import type { ResourceConstraints } from '@edt-ts/scheduler-common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  DAYS,
  type DayName,
  type DaySlot,
  type DayMap,
  type ResourceType,
  getWeekKeys,
  emptyDayMap,
  slotsToDayMap,
  dayMapToSlots,
  normalizeWeekKey,
  RESOURCE_TYPE_LABELS,
} from '@/lib/constraintsStorage';

const DAY_LABELS: Record<DayName, string> = {
  lundi: 'Lundi',
  mardi: 'Mardi',
  mercredi: 'Mercredi',
  jeudi: 'Jeudi',
  vendredi: 'Vendredi',
  samedi: 'Samedi',
};

const TYPE_COLORS: Record<ResourceType, string> = {
  teacher: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  room: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  group: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  other: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

// --- DayCell ---

interface DayCellProps {
  slots: DaySlot[];
  inherited?: boolean;
  onChange: (slots: DaySlot[]) => void;
}

function DayCell({ slots: slotsProp, inherited, onChange }: DayCellProps) {
  // Local state so new empty slots don't get wiped by parent re-serialization
  const [slots, setSlots] = useState<DaySlot[]>(slotsProp);

  // Sync from parent only when complete-slot count changes (parent saved new data)
  useEffect(() => {
    const extComplete = slotsProp.filter((s) => s.from && s.to).length;
    const localComplete = slots.filter((s) => s.from && s.to).length;
    if (extComplete !== localComplete || slotsProp.length < slots.filter((s) => s.from && s.to).length) {
      setSlots(slotsProp);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotsProp]);

  if (inherited) {
    return (
      <div className="flex flex-col gap-0.5 py-0.5">
        {slots.length === 0 ? (
          <span className="text-muted-foreground/30 text-xs select-none text-center">—</span>
        ) : (
          slots.map((s, i) => (
            <div key={i} className="text-[11px] text-muted-foreground/50 italic font-mono text-center whitespace-nowrap">
              {s.from} – {s.to}
            </div>
          ))
        )}
      </div>
    );
  }

  const canAdd = slots.length < 2;
  // Snapshot for Escape: saved on focus, keyed by `${i}-${field}`
  const snapshotRef = useRef<Record<string, string>>({});

  function handleUpdate(i: number, field: 'from' | 'to', val: string) {
    const next = slots.map((s, j) => (j === i ? { ...s, [field]: val } : s));
    setSlots(next);
    onChange(next);
  }

  function handleRemove(i: number) {
    const next = slots.filter((_, j) => j !== i);
    setSlots(next);
    onChange(next);
  }

  function handleAdd(prefilledFrom?: string) {
    const next = [...slots, { from: prefilledFrom ?? '', to: '' }];
    setSlots(next);
    // Don't call onChange yet — parent will get updated when user fills the inputs
  }

  function handleFocus(e: React.FocusEvent<HTMLInputElement>, key: string) {
    snapshotRef.current[key] = e.currentTarget.value;
  }

  function handleTimeKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    i: number,
    field: 'from' | 'to',
  ) {
    // Tab : 1 Tab = 1 input entier (saute HH/MM/horloge natifs)
    if (e.key === 'Tab') {
      e.preventDefault();
      const allInputs = Array.from(
        document.querySelectorAll<HTMLInputElement>('input[type="time"]'),
      );
      const idx = allInputs.indexOf(e.currentTarget);
      const next = e.shiftKey ? allInputs[idx - 1] : allInputs[idx + 1];
      if (next) next.focus();
      return;
    }

    // Escape : restaurer la valeur prise au moment du focus
    if (e.key === 'Escape') {
      e.preventDefault();
      const key = `${i}-${field}`;
      const snapshot = snapshotRef.current[key];
      if (snapshot !== undefined) {
        handleUpdate(i, field, snapshot);
        delete snapshotRef.current[key];
      }
      return;
    }

    // Enter sur le champ "to" : ajouter un second créneau pré-rempli à to + 1h30
    if (e.key === 'Enter' && field === 'to') {
      e.preventDefault();
      if (!canAdd) return;
      const toValue = slots[i]?.to;
      if (!toValue) { handleAdd(); return; }
      const [hStr, mStr] = toValue.split(':');
      const totalMin = parseInt(hStr ?? '0', 10) * 60 + parseInt(mStr ?? '0', 10);
      const newFromMin = Math.min(23 * 60 + 30, totalMin + 90);
      const newFromH = Math.floor(newFromMin / 60);
      const newFromM = newFromMin % 60;
      handleAdd(`${String(newFromH).padStart(2, '0')}:${String(newFromM).padStart(2, '0')}`);
      return;
    }

    // ArrowUp/Down : ±30min (±1h avec Shift)
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const current = field === 'from' ? slots[i].from : slots[i].to;
    if (!current) return;
    const [hStr, mStr] = current.split(':');
    const totalMin = parseInt(hStr ?? '0', 10) * 60 + parseInt(mStr ?? '0', 10);
    const step = e.shiftKey ? 60 : 30;
    const delta = e.key === 'ArrowUp' ? step : -step;
    const clamped = Math.max(0, Math.min(23 * 60 + 30, totalMin + delta));
    const newH = Math.floor(clamped / 60);
    const newM = clamped % 60;
    handleUpdate(i, field, `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`);
  }

  return (
    <div className="flex flex-col gap-1 py-1">
      {slots.map((slot, i) => (
        <div key={i} className="flex items-center gap-0.5 group">
          <input
            type="time"
            value={slot.from}
            tabIndex={0}
            onChange={(e) => handleUpdate(i, 'from', e.target.value)}
            onKeyDown={(e) => handleTimeKeyDown(e, i, 'from')}
            onFocus={(e) => handleFocus(e, `${i}-from`)}
            className="h-6 w-17 rounded border border-input bg-background px-1 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label={`Début créneau ${i + 1}`}
          />
          <span className="text-muted-foreground text-[10px]">–</span>
          <input
            type="time"
            value={slot.to}
            tabIndex={0}
            onChange={(e) => handleUpdate(i, 'to', e.target.value)}
            onKeyDown={(e) => handleTimeKeyDown(e, i, 'to')}
            onFocus={(e) => handleFocus(e, `${i}-to`)}
            className="h-6 w-17 rounded border border-input bg-background px-1 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label={`Fin créneau ${i + 1}`}
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => handleRemove(i)}
            className="ml-0.5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive text-sm leading-none transition-opacity"
            aria-label="Supprimer ce créneau"
          >
            ×
          </button>
        </div>
      ))}
      {slots.length === 0 && (
        <span className="text-muted-foreground/30 text-xs text-center select-none">—</span>
      )}
      {canAdd && (
        <button
          type="button"
          tabIndex={-1}
          onClick={() => handleAdd()}
          className="text-[10px] text-muted-foreground/60 hover:text-primary text-left leading-none mt-0.5"
        >
          + ajouter
        </button>
      )}
    </div>
  );
}

// --- WeekRow ---

interface WeekRowProps {
  label: string;
  dayMap: DayMap;
  defaultDayMap: DayMap; // used for inherited display
  inherited?: boolean;
  onDelete?: () => void;
  onChange: (dm: DayMap) => void;
}

function WeekRow({ label, dayMap, defaultDayMap, inherited, onDelete, onChange }: WeekRowProps) {
  function updateDay(day: DayName, slots: DaySlot[]) {
    onChange({ ...dayMap, [day]: slots });
  }

  const rowClass = cn(
    'group',
    inherited && 'bg-muted/20',
  );

  return (
    <tr className={rowClass}>
      <td className="px-2 py-1 text-xs font-medium sticky left-0 bg-inherit z-10 border-r border-border whitespace-nowrap min-w-18">
        <div className="flex items-center gap-1">
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive text-sm leading-none transition-opacity shrink-0"
              aria-label={`Supprimer semaine ${label}`}
            >
              ×
            </button>
          )}
          <span className={cn(inherited && 'text-muted-foreground/60 italic')}>{label}</span>
        </div>
      </td>
      {DAYS.map((day) => (
        <td
          key={day}
          className={cn('px-1.5 border-r border-border align-top last:border-r-0', inherited && 'bg-muted/10')}
        >
          <DayCell
            slots={inherited ? defaultDayMap[day] : dayMap[day]}
            inherited={inherited}
            onChange={(s) => updateDay(day, s)}
          />
        </td>
      ))}
    </tr>
  );
}

// --- Main component ---

export interface ResourceConstraintEditorProps {
  id: string;
  resourceType: ResourceType;
  value: ResourceConstraints | null;
  isDefault?: boolean;
  alwaysExpanded?: boolean;
  onChange: (newValue: ResourceConstraints | null) => void;
  onDelete?: () => void;
}

export function ResourceConstraintEditor({
  id,
  resourceType,
  value,
  isDefault,
  alwaysExpanded,
  onChange,
  onDelete,
}: ResourceConstraintEditorProps) {
  const [expanded, setExpanded] = useState(alwaysExpanded ?? false);
  const [addingWeek, setAddingWeek] = useState(false);
  const [newWeekKey, setNewWeekKey] = useState('');
  const [weekError, setWeekError] = useState('');

  // Local DayMap state — decoupled from serialized value so empty slots survive
  const [localDefault, setLocalDefault] = useState<DayMap>(() =>
    value?.default ? slotsToDayMap(value.default) : emptyDayMap(),
  );
  const [localWeeks, setLocalWeeks] = useState<Record<string, DayMap>>(() => {
    const maps: Record<string, DayMap> = {};
    for (const wk of getWeekKeys(value ?? {})) {
      maps[wk] = slotsToDayMap((value ?? {})[wk] ?? []);
    }
    return maps;
  });

  const weekKeys = value ? getWeekKeys(value) : [];

  function handleDefaultChange(dm: DayMap) {
    setLocalDefault(dm);
    onChange({ ...(value ?? {}), default: dayMapToSlots(dm) });
  }

  function handleWeekChange(weekKey: string, dm: DayMap) {
    setLocalWeeks((prev) => ({ ...prev, [weekKey]: dm }));
    onChange({ ...(value ?? {}), [weekKey]: dayMapToSlots(dm) });
  }

  function handleWeekDelete(weekKey: string) {
    if (!value) return;
    setLocalWeeks((prev) => { const n = { ...prev }; delete n[weekKey]; return n; });
    const next = { ...value };
    delete next[weekKey];
    onChange(next);
  }

  function handleAddWeek() {
    const key = normalizeWeekKey(newWeekKey);
    if (!key) { setWeekError('Entrez un numéro de semaine.'); return; }
    if (value && key in value) { setWeekError(`La semaine ${key} existe déjà.`); return; }
    const defaultSlots = value?.default ?? [];
    const newDayMap = slotsToDayMap(defaultSlots);
    setLocalWeeks((prev) => ({ ...prev, [key]: newDayMap }));
    onChange({ ...(value ?? { default: [] }), [key]: [...defaultSlots] });
    setNewWeekKey('');
    setWeekError('');
    setAddingWeek(false);
  }

  function handleEnableConstraints() {
    setLocalDefault(emptyDayMap());
    setLocalWeeks({});
    onChange({ default: [] });
    setExpanded(true);
  }

  function handleDisable() {
    if (!window.confirm('Supprimer toutes les contraintes de cette ressource ? Il sera possible d\'en ajouter a nouveau.')) return;
    onChange(null);
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center bg-card">
        <button
          type="button"
          onClick={() => !alwaysExpanded && setExpanded((v) => !v)}
          className={cn(
            'flex items-center gap-2.5 flex-1 text-left px-4 py-2.5 min-w-0',
            alwaysExpanded && 'cursor-default',
          )}
          aria-expanded={expanded}
        >
          <span className={cn('text-[11px] font-semibold px-1.5 py-0.5 rounded-full shrink-0', TYPE_COLORS[resourceType])}>
            {RESOURCE_TYPE_LABELS[resourceType]}
          </span>
          <span className="font-medium text-sm truncate">{id}</span>
          {value === null && (
            <span className="text-[11px] text-muted-foreground italic ml-1 shrink-0">Aucune contrainte</span>
          )}
          {value !== null && weekKeys.length > 0 && (
            <span className="text-[11px] text-muted-foreground shrink-0">
              {weekKeys.length} sem. personnalisée{weekKeys.length > 1 ? 's' : ''}
            </span>
          )}
          {!alwaysExpanded && (
            <span className="ml-auto text-muted-foreground text-[10px] shrink-0">
              {expanded ? '▲' : '▼'}
            </span>
          )}
        </button>
        {!isDefault && onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="px-3 py-2.5 text-muted-foreground hover:text-destructive text-base leading-none shrink-0"
            aria-label={`Supprimer ${id}`}
          >
            ×
          </button>
        )}
      </div>

      {/* Body */}
      {(expanded || alwaysExpanded) && (
        <div className="border-t border-border bg-background">
          {value === null ? (
            <div className="p-4 flex items-center gap-4">
              <p className="text-sm text-muted-foreground flex-1">
                Aucune contrainte définie — l&apos;algorithme utilise le Default de l&apos;établissement.
              </p>
              <Button size="sm" variant="outline" onClick={handleEnableConstraints}>
                + Ajouter des contraintes
              </Button>
            </div>
          ) : (
            <div>
              <div className="overflow-x-auto">
                <table className="text-sm border-collapse w-full">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="px-2 py-1.5 text-left text-[11px] font-semibold text-muted-foreground sticky left-0 bg-muted/50 z-10 border-b border-r border-border w-18">
                        Semaine
                      </th>
                      {DAYS.map((day) => (
                        <th
                          key={day}
                          className="px-1.5 py-1.5 text-center text-[11px] font-semibold text-muted-foreground border-b border-r border-border last:border-r-0 min-w-39.5"
                        >
                          {DAY_LABELS[day]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {/* Default row */}
                    <WeekRow
                      label="Défaut"
                      dayMap={localDefault}
                      defaultDayMap={localDefault}
                      onChange={handleDefaultChange}
                    />

                    {/* Week override rows */}
                    {weekKeys.map((wk) => (
                      <WeekRow
                        key={wk}
                        label={wk}
                        dayMap={localWeeks[wk] ?? slotsToDayMap(value[wk] ?? [])}
                        defaultDayMap={localDefault}
                        onChange={(dm) => handleWeekChange(wk, dm)}
                        onDelete={() => handleWeekDelete(wk)}
                      />
                    ))}

                    {/* Add week row */}
                    {!isDefault && (
                      <tr>
                        <td colSpan={DAYS.length + 1} className="px-3 py-2">
                          {addingWeek ? (
                            <div className="flex items-center gap-2">
                              <Input
                                type="text"
                                placeholder="ex: 36 ou S36"
                                value={newWeekKey}
                                onChange={(e) => { setNewWeekKey(e.target.value); setWeekError(''); }}
                                onKeyDown={(e) => e.key === 'Enter' && handleAddWeek()}
                                className="h-7 w-28 text-xs"
                                autoFocus
                              />
                              <Button size="sm" onClick={handleAddWeek} className="h-7 text-xs">
                                Confirmer
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => { setAddingWeek(false); setNewWeekKey(''); setWeekError(''); }}
                                className="h-7 text-xs"
                              >
                                Annuler
                              </Button>
                              {weekError && <span className="text-xs text-destructive">{weekError}</span>}
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setAddingWeek(true)}
                              className="text-xs text-muted-foreground hover:text-foreground"
                            >
                              + Ajouter une semaine personnalisée
                            </button>
                          )}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {!isDefault && (
                <div className="px-4 py-2 border-t border-border flex justify-end">
                  <button
                    type="button"
                    onClick={handleDisable}
                    className="text-xs text-muted-foreground hover:text-destructive"
                  >
                    Supprimer toutes les contraintes de cette ressource
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
