'use client';

import { useState, useEffect } from 'react';
import type { ResourceConstraints } from '@edt-ts/scheduler-common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  DAYS,
  type DayName,
  type DaySlot,
  type DayMap,
  type ResourceTypeUI,
  getWeekKeys,
  emptyDayMap,
  slotsToDayMap,
  dayMapToSlots,
  normalizeWeekKey,
  RESOURCE_TYPE_LABELS,
} from '@/lib/constraintsUtils';
import { TimeRangePicker } from './TimeRangePicker';

const DAY_LABELS: Record<DayName, string> = {
  lundi: 'Lundi',
  mardi: 'Mardi',
  mercredi: 'Mercredi',
  jeudi: 'Jeudi',
  vendredi: 'Vendredi',
  samedi: 'Samedi',
};

const TYPE_COLORS: Record<ResourceTypeUI, string> = {
  teacher: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  room: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  group: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  other: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

// --- DayCell ---

interface DayCellProps {
  slots: DaySlot[];
  inherited?: boolean;
  defaultSlots?: DaySlot[];
  onChange: (slots: DaySlot[]) => void;
}

function DayCell({ slots: slotsProp, inherited, defaultSlots, onChange }: DayCellProps) {
  const [slots, setSlots] = useState<DaySlot[]>(slotsProp);

  useEffect(() => { setSlots(slotsProp); }, [slotsProp]);

  const amIdx = slots.findIndex((s) => parseInt(s.from.split(':')[0] ?? '99', 10) < 12);
  const pmIdx = slots.findIndex((s) => parseInt(s.from.split(':')[0] ?? '0', 10) >= 12);
  const amSlot = amIdx >= 0 ? slots[amIdx] : undefined;
  const pmSlot = pmIdx >= 0 ? slots[pmIdx] : undefined;

  if (inherited) {
    const renderSlot = (s: DaySlot | undefined) =>
      s ? (
        <>
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-muted-foreground/40 w-3 shrink-0">De</span>
            <span className="font-mono text-[11px] text-muted-foreground/50 italic">{s.from}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-muted-foreground/40 w-3 shrink-0">À</span>
            <span className="font-mono text-[11px] text-muted-foreground/50 italic">{s.to}</span>
          </div>
        </>
      ) : (
        <span className="text-muted-foreground/20 text-xs select-none self-center mt-1">—</span>
      );

    return (
      <div className="flex py-1 px-0.5">
        <div className="flex flex-col gap-0.5 flex-1">{renderSlot(amSlot)}</div>
        <div className="w-px bg-border/50 self-stretch mx-2" />
        <div className="flex flex-col gap-0.5 flex-1">{renderSlot(pmSlot)}</div>
      </div>
    );
  }

  const amPreset: DaySlot = (() => {
    const d = defaultSlots?.find((s) => parseInt(s.from.split(':')[0] ?? '99', 10) < 12);
    return d ?? { from: '08:00', to: '12:00' };
  })();
  const pmPreset: DaySlot = (() => {
    const d = defaultSlots?.find((s) => parseInt(s.from.split(':')[0] ?? '0', 10) >= 12);
    return d ?? { from: '14:00', to: '17:00' };
  })();

  function handleUpdateSlot(i: number, updated: DaySlot) {
    const next = slots.map((s, j) => (j === i ? updated : s));
    setSlots(next);
    onChange(next);
  }

  function handleRemoveSlot(i: number) {
    const next = slots.filter((_, j) => j !== i);
    setSlots(next);
    onChange(next);
  }

  function handleAddSlot(preset: DaySlot) {
    const next = [...slots, { ...preset }];
    setSlots(next);
    onChange(next);
  }

  return (
    <div className="flex py-1 px-0.5">
      {/* AM column */}
      <div className="flex flex-col justify-center items-start flex-1 pr-2">
        {amSlot !== undefined ? (
          <TimeRangePicker
            slot={amSlot}
            onChange={(u) => handleUpdateSlot(amIdx, u)}
            onRemove={() => handleRemoveSlot(amIdx)}
          />
        ) : (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => handleAddSlot(amPreset)}
            className="text-[10px] text-muted-foreground/60 hover:text-primary px-1.5 py-0.5 rounded border border-dashed border-muted-foreground/30 hover:border-primary/60 transition-colors self-center"
          >
            + am
          </button>
        )}
      </div>
      {/* Separator */}
      <div className="w-px bg-border/50 self-stretch mx-0" />
      {/* PM column */}
      <div className="flex flex-col justify-center items-start flex-1 pl-2">
        {pmSlot !== undefined ? (
          <TimeRangePicker
            slot={pmSlot}
            onChange={(u) => handleUpdateSlot(pmIdx, u)}
            onRemove={() => handleRemoveSlot(pmIdx)}
          />
        ) : (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => handleAddSlot(pmPreset)}
            className="text-[10px] text-muted-foreground/60 hover:text-primary px-1.5 py-0.5 rounded border border-dashed border-muted-foreground/30 hover:border-primary/60 transition-colors self-center"
          >
            + pm
          </button>
        )}
      </div>
    </div>
  );
}

// --- WeekRow ---

interface WeekRowProps {
  label: string;
  dayMap: DayMap;
  defaultDayMap: DayMap;
  inherited?: boolean;
  checked?: boolean;
  onToggle?: (checked: boolean) => void;
  onDelete?: () => void;
  onChange: (dm: DayMap) => void;
}

function WeekRow({
  label,
  dayMap,
  defaultDayMap,
  inherited,
  checked,
  onToggle,
  onDelete,
  onChange,
}: WeekRowProps) {
  function updateDay(day: DayName, slots: DaySlot[]) {
    onChange({ ...dayMap, [day]: slots });
  }

  return (
    <tr className={cn('group', inherited && 'bg-muted/20')}>
      <td className="px-2 py-1 text-xs font-medium sticky left-0 bg-inherit z-10 border-r border-border whitespace-nowrap min-w-20">
        <div className="flex items-center gap-1.5">
          {onToggle !== undefined ? (
            <input
              type="checkbox"
              checked={checked ?? false}
              onChange={(e) => onToggle(e.target.checked)}
              className="h-3.5 w-3.5 cursor-pointer accent-primary"
              aria-label={`Activer la semaine ${label}`}
            />
          ) : (
            <div className="h-3.5 w-3.5 shrink-0" />
          )}
          {onDelete && !onToggle && (
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
          className={cn(
            'px-1.5 border-r border-border align-top last:border-r-0',
            inherited && 'bg-muted/10',
          )}
        >
          <DayCell
            slots={inherited ? defaultDayMap[day] : dayMap[day]}
            inherited={inherited}
            defaultSlots={inherited ? undefined : defaultDayMap[day]}
            onChange={(s) => updateDay(day, s)}
          />
        </td>
      ))}
    </tr>
  );
}

// --- ResourceConstraintEditor ---

export interface ResourceConstraintEditorProps {
  id: string;
  resourceType: ResourceTypeUI;
  value: ResourceConstraints | null;
  isDefault?: boolean;
  alwaysExpanded?: boolean;
  csvWeeks?: number[];
  onChange: (newValue: ResourceConstraints | null) => void;
  onDelete?: () => void;
}

export function ResourceConstraintEditor({
  id,
  resourceType,
  value,
  isDefault,
  alwaysExpanded,
  csvWeeks = [],
  onChange,
  onDelete,
}: ResourceConstraintEditorProps) {
  const [expanded, setExpanded] = useState(alwaysExpanded ?? false);
  const [addingWeek, setAddingWeek] = useState(false);
  const [newWeekKey, setNewWeekKey] = useState('');
  const [weekError, setWeekError] = useState('');
  const [confirmDisableOpen, setConfirmDisableOpen] = useState(false);

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

  const csvWeekKeys = csvWeeks.map((w) => `S${w}`);
  const allDisplayWeekKeys = [...new Set([...csvWeekKeys, ...weekKeys])].sort(
    (a, b) => parseInt(a.replace(/^S/, ''), 10) - parseInt(b.replace(/^S/, ''), 10),
  );

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
    setLocalWeeks((prev) => {
      const n = { ...prev };
      delete n[weekKey];
      return n;
    });
    const next = { ...value };
    delete next[weekKey];
    onChange(next);
  }

  function handleToggleWeek(wk: string, checked: boolean) {
    if (checked) {
      const defaultSlots = value?.default ?? [];
      const newDayMap = slotsToDayMap(defaultSlots);
      setLocalWeeks((prev) => ({ ...prev, [wk]: newDayMap }));
      onChange({ ...(value ?? { default: [] }), [wk]: [...defaultSlots] });
    } else {
      handleWeekDelete(wk);
    }
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
    setConfirmDisableOpen(true);
  }

  function confirmDisable() {
    setConfirmDisableOpen(false);
    onChange(null);
  }

  return (
    <>
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
          <span
            className={cn(
              'text-[11px] font-semibold px-1.5 py-0.5 rounded-full shrink-0',
              TYPE_COLORS[resourceType],
            )}
          >
            {RESOURCE_TYPE_LABELS[resourceType]}
          </span>
          <span className="font-medium text-sm truncate">{id}</span>
          {value === null && (
            <span className="text-[11px] text-muted-foreground italic ml-1 shrink-0">
              Aucune contrainte
            </span>
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
                      <th className="px-2 py-1.5 text-left text-[11px] font-semibold text-muted-foreground sticky left-0 bg-muted/50 z-10 border-b border-r border-border w-20">
                        Semaine
                      </th>
                      {DAYS.map((day) => (
                        <th
                          key={day}
                          className="px-1.5 py-1.5 text-center text-[11px] font-semibold text-muted-foreground border-b border-r border-border last:border-r-0 min-w-35"
                        >
                          {DAY_LABELS[day]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {/* Ligne Défaut */}
                    <WeekRow
                      label="Défaut"
                      dayMap={localDefault}
                      defaultDayMap={localDefault}
                      onChange={handleDefaultChange}
                    />

                    {/* Toutes les semaines : CSV + overrides, avec checkbox */}
                    {allDisplayWeekKeys.map((wk) => {
                      const hasOverride = !!(value && wk in value);
                      return (
                        <WeekRow
                          key={wk}
                          label={wk}
                          dayMap={
                            hasOverride
                              ? (localWeeks[wk] ?? slotsToDayMap((value ?? {})[wk] ?? []))
                              : localDefault
                          }
                          defaultDayMap={localDefault}
                          inherited={!hasOverride}
                          checked={hasOverride}
                          onToggle={(v) => handleToggleWeek(wk, v)}
                          onChange={(dm) => handleWeekChange(wk, dm)}
                        />
                      );
                    })}

                    {/* Ajout manuel (semaines hors CSV) */}
                    {!isDefault && (
                      <tr>
                        <td colSpan={DAYS.length + 1} className="px-3 py-2">
                          {addingWeek ? (
                            <div className="flex items-center gap-2">
                              <Input
                                type="text"
                                placeholder="ex: 36 ou S36"
                                value={newWeekKey}
                                onChange={(e) => {
                                  setNewWeekKey(e.target.value);
                                  setWeekError('');
                                }}
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
                                onClick={() => {
                                  setAddingWeek(false);
                                  setNewWeekKey('');
                                  setWeekError('');
                                }}
                                className="h-7 text-xs"
                              >
                                Annuler
                              </Button>
                              {weekError && (
                                <span className="text-xs text-destructive">{weekError}</span>
                              )}
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

    <Dialog open={confirmDisableOpen} onOpenChange={(open) => !open && setConfirmDisableOpen(false)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Supprimer les contraintes</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Supprimer toutes les contraintes de cette ressource ? Il sera possible d&apos;en ajouter à nouveau.
        </p>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setConfirmDisableOpen(false)}>
            Annuler
          </Button>
          <Button variant="destructive" onClick={confirmDisable}>
            Supprimer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
