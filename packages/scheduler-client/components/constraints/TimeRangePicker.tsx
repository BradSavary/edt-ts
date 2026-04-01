'use client';

/**
 * TimeRangePicker — créneau (from + to) avec deux boutons séparés (De / À).
 *
 * - Clic sur De OU À → ouvre un Popover commun avec les deux scrollers côte à côte
 * - Double-clic sur un bouton → bascule ce champ en mode saisie directe (input text)
 * - ↑/↓ sur un bouton focusé → ±30 min (Shift = ±1h), sans ouvrir le popover
 * - Escape → ferme le popover ou annule la saisie
 * - Enter en mode texte → valide
 */

import { useState, useRef, useEffect } from 'react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { DaySlot } from '@/lib/constraintsStorage';

// ---- helpers ----

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function toMinutes(hhmm: string): number | null {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function fromMinutes(total: number): string {
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${pad(h)}:${pad(m)}`;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 15, 30, 45];

// ---- TimeScroller ----

interface TimeScrollerProps {
  label: string;
  value: string; // "HH:MM"
  onChange: (v: string) => void;
  open?: boolean;
}

function TimeScroller({ label, value, onChange, open }: TimeScrollerProps) {
  const [hStr, mStr] = value.split(':');
  const h = parseInt(hStr ?? '0', 10);
  const m = parseInt(mStr ?? '0', 10);

  const mSnapped = MINUTES.reduce(
    (prev, cur) => (Math.abs(cur - m) < Math.abs(prev - m) ? cur : prev),
    0,
  );

  const hourRef = useRef<HTMLDivElement>(null);
  const minRef = useRef<HTMLDivElement>(null);

  function scrollToSelected(ref: React.RefObject<HTMLDivElement | null>, idx: number) {
    const el = ref.current;
    if (!el) return;
    const item = el.children[idx] as HTMLElement | undefined;
    if (!item) return;
    el.scrollTop = item.offsetTop - el.clientHeight / 2 + item.clientHeight / 2;
  }

  useEffect(() => { setTimeout(() => scrollToSelected(hourRef, h), 50); }, [h, open]);
  useEffect(() => { setTimeout(() => scrollToSelected(minRef, MINUTES.indexOf(mSnapped)), 50); }, [mSnapped, open]);

  return (
    <div className="flex flex-col items-center gap-1 min-w-16">
      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      <div className="flex gap-1">
        <div
          ref={hourRef}
          className="h-36 w-10 overflow-y-auto scroll-smooth rounded border border-input bg-background"
          style={{ scrollbarWidth: 'none', paddingTop: '56px', paddingBottom: '56px' }}
        >
          {HOURS.map((hv) => (
            <div
              key={hv}
              onClick={() => onChange(`${pad(hv)}:${pad(mSnapped)}`)}
              className={cn(
                'h-8 flex items-center justify-center text-xs font-mono cursor-pointer select-none rounded transition-colors',
                hv === h
                  ? 'bg-primary text-primary-foreground font-semibold'
                  : 'hover:bg-muted text-foreground',
              )}
            >
              {pad(hv)}
            </div>
          ))}
        </div>
        <span className="self-center text-muted-foreground text-sm">:</span>
        <div
          ref={minRef}
          className="h-36 w-10 overflow-y-auto scroll-smooth rounded border border-input bg-background"
          style={{ scrollbarWidth: 'none', paddingTop: '56px', paddingBottom: '56px' }}
        >
          {MINUTES.map((mv) => (
            <div
              key={mv}
              onClick={() => onChange(`${pad(h)}:${pad(mv)}`)}
              className={cn(
                'h-8 flex items-center justify-center text-xs font-mono cursor-pointer select-none rounded transition-colors',
                mv === mSnapped
                  ? 'bg-primary text-primary-foreground font-semibold'
                  : 'hover:bg-muted text-foreground',
              )}
            >
              {pad(mv)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- TimeRangePicker ----

export interface TimeRangePickerProps {
  slot: DaySlot;
  onChange: (slot: DaySlot) => void;
  onRemove: () => void;
  className?: string;
}

export function TimeRangePicker({ slot, onChange, onRemove, className }: TimeRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [textMode, setTextMode] = useState<'from' | 'to' | null>(null);
  const [textVal, setTextVal] = useState('');

  const textRef = useRef<HTMLInputElement>(null);
  const fromRef = useRef<HTMLButtonElement>(null);
  const toRef = useRef<HTMLButtonElement>(null);
  const snapshotRef = useRef<string>('');

  useEffect(() => {
    if (textMode && textRef.current) {
      textRef.current.focus();
      textRef.current.select();
    }
  }, [textMode]);

  function handleFieldClick(e: React.MouseEvent) {
    if (e.detail === 2) return; // double-clic géré séparément
    setOpen((v) => !v);
  }

  function handleFieldDoubleClick(field: 'from' | 'to') {
    setOpen(false);
    snapshotRef.current = field === 'from' ? slot.from : slot.to;
    setTextVal(field === 'from' ? slot.from : slot.to);
    setTextMode(field);
  }

  function makeFieldKeyDown(field: 'from' | 'to') {
    return (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const val = field === 'from' ? slot.from : slot.to;
        const total = toMinutes(val);
        if (total === null) return;
        const step = e.shiftKey ? 60 : 30;
        const delta = e.key === 'ArrowUp' ? step : -step;
        onChange({ ...slot, [field]: fromMinutes(Math.max(0, Math.min(23 * 60 + 59, total + delta))) });
      }
      if (e.key === 'Escape') setOpen(false);
    };
  }

  function parseTimeInput(raw: string): string | null {
    const digits = raw.trim().replace(':', '');
    if (!/^\d{1,4}$/.test(digits)) return null;
    let h: number, m: number;
    if (digits.length <= 2) { h = parseInt(digits, 10); m = 0; }
    else if (digits.length === 3) { h = parseInt(digits.slice(0, 1), 10); m = parseInt(digits.slice(1), 10); }
    else { h = parseInt(digits.slice(0, 2), 10); m = parseInt(digits.slice(2), 10); }
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return `${pad(h)}:${pad(m)}`;
  }

  function commitText() {
    if (!textMode) return;
    const parsed = parseTimeInput(textVal);
    if (parsed) onChange({ ...slot, [textMode]: parsed });
    setTextMode(null);
  }

  function handleTextKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const field = textMode;
      commitText();
      const ref = field === 'from' ? fromRef : toRef;
      setTimeout(() => ref.current?.focus(), 0);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      const field = textMode;
      setTextVal(snapshotRef.current);
      setTextMode(null);
      const ref = field === 'from' ? fromRef : toRef;
      setTimeout(() => ref.current?.focus(), 0);
      return;
    }
    if (e.key === 'Tab') {
      if (textMode === 'from' && !e.shiftKey) {
        e.preventDefault();
        commitText();
        snapshotRef.current = slot.to;
        setTextVal(slot.to);
        setTextMode('to');
      }
      // Autres cas (Tab depuis 'to', Shift+Tab) : laisser le browser procéder
      // onBlur appelera commitText sans voler le focus
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const parsed = parseTimeInput(textVal);
      const total = parsed ? toMinutes(parsed) : null;
      if (total === null) return;
      const step = e.shiftKey ? 60 : 30;
      const delta = e.key === 'ArrowUp' ? step : -step;
      setTextVal(fromMinutes(Math.max(0, Math.min(23 * 60 + 59, total + delta))));
    }
  }

  const fieldClass = cn(
    'h-6 w-[50px] rounded border border-input bg-background px-1',
    'text-[12px] font-mono text-center',
    'hover:border-primary/60 hover:bg-muted/40 transition-colors',
    'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
  );

  const textInputClass =
    'h-6 w-[50px] rounded border border-primary bg-background px-1 text-[12px] font-mono focus:outline-none focus:ring-1 focus:ring-ring';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className={cn('flex items-center gap-1 group/slot', className)}>
          <div className="flex flex-col gap-0.5">
            {/* De */}
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-muted-foreground/70 w-3 shrink-0 select-none">De</span>
              {textMode === 'from' ? (
                <input
                  ref={textRef}
                  type="text"
                  value={textVal}
                  onChange={(e) => setTextVal(e.target.value)}
                  onBlur={commitText}
                  onKeyDown={handleTextKeyDown}
                  placeholder="HH:MM"
                  className={textInputClass}
                />
              ) : (
                <button
                  ref={fromRef}
                  type="button"
                  onClick={handleFieldClick}
                  onDoubleClick={() => handleFieldDoubleClick('from')}
                  onKeyDown={makeFieldKeyDown('from')}
                  onFocus={(e) => {
                    if (e.currentTarget.matches(':focus-visible')) {
                      snapshotRef.current = slot.from;
                      setTextVal(slot.from);
                      setTextMode('from');
                    }
                  }}
                  className={fieldClass}
                  title="Clic pour modifier • Double-clic pour saisir • ↑↓ ±30min"
                >
                  {slot.from || '--:--'}
                </button>
              )}
            </div>
            {/* À */}
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-muted-foreground/70 w-3 shrink-0 select-none">À</span>
              {textMode === 'to' ? (
                <input
                  ref={textRef}
                  type="text"
                  value={textVal}
                  onChange={(e) => setTextVal(e.target.value)}
                  onBlur={commitText}
                  onKeyDown={handleTextKeyDown}
                  placeholder="HH:MM"
                  className={textInputClass}
                />
              ) : (
                <button
                  ref={toRef}
                  type="button"
                  onClick={handleFieldClick}
                  onDoubleClick={() => handleFieldDoubleClick('to')}
                  onKeyDown={makeFieldKeyDown('to')}
                  onFocus={(e) => {
                    if (e.currentTarget.matches(':focus-visible')) {
                      snapshotRef.current = slot.to;
                      setTextVal(slot.to);
                      setTextMode('to');
                    }
                  }}
                  className={fieldClass}
                  title="Clic pour modifier • Double-clic pour saisir • ↑↓ ±30min"
                >
                  {slot.to || '--:--'}
                </button>
              )}
            </div>
          </div>
          <button
            type="button"
            tabIndex={-1}
            onClick={onRemove}
            className="opacity-0 group-hover/slot:opacity-100 text-muted-foreground hover:text-destructive text-sm leading-none transition-opacity self-center"
            aria-label="Supprimer ce créneau"
          >
            ×
          </button>
        </div>
      </PopoverAnchor>

      <PopoverContent side="bottom" align="start" className="p-3 w-auto" onInteractOutside={() => setOpen(false)}>
        <div className="flex gap-4">
          <TimeScroller
            label="De"
            value={slot.from || '08:00'}
            onChange={(v) => onChange({ ...slot, from: v })}
            open={open}
          />
          <div className="w-px bg-border self-stretch mx-1" />
          <TimeScroller
            label="À"
            value={slot.to || '12:00'}
            onChange={(v) => onChange({ ...slot, to: v })}
            open={open}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
