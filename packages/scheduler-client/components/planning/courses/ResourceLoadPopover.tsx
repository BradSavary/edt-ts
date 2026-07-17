'use client';

import { BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { ResourceLoadRow } from '@/lib/resourceLoadAnalysis';
import { DAY_LABELS } from '@/lib/resourceLoadAnalysis';
import { cn } from '@/lib/utils';

function formatH(minutes: number): string {
  const h = minutes / 60;
  return `${h % 1 === 0 ? h : h.toFixed(1)}h`;
}

interface Props {
  mode: 'preparation' | 'analysis';
  rows: ResourceLoadRow[];
  /** Durée de la tâche analysée, uniquement affichée en mode 'analysis' (bandeau de synthèse). */
  taskDurationMin?: number;
  className?: string;
}

/**
 * Popover « Analyse de charge » — table capacité/charge/mou (ou capacité/demande/enforced en
 * préparation) par jour et par ressource candidate. Un seul composant, deux modes, deux points
 * de montage (CourseConstraintList en préparation, SidebarAnalysis en analyse) — voir
 * docs/PlanOptionalTasksP2Explication.md §2.3.
 */
export default function ResourceLoadPopover({ mode, rows, taskDurationMin, className }: Props) {
  if (rows.length === 0) return null;
  const noDayFitsAnywhere = mode === 'analysis' && rows.every((r) => !r.anyDayFits);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn('h-5 w-5 text-muted-foreground hover:text-foreground', className)}
          title="Analyse de charge"
          aria-label="Analyse de charge"
          onClick={(e) => e.stopPropagation()}
        >
          <BarChart3 className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Analyse de charge {mode === 'preparation' ? '— demande vs capacité' : '— placement'}
          </p>

          {rows.map((row) => (
            <div key={`${row.resourceKind}-${row.resourceId}`} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">{row.resourceId}</span>
                <span className="text-muted-foreground">
                  hebdo : {mode === 'preparation' ? 'demande' : 'charge'} {formatH(row.weeklyLoad)} / capacité {formatH(row.weeklyCapacity)}
                  {isFinite(row.ratio) ? ` (${Math.round(row.ratio * 100)}%)` : ''}
                </span>
              </div>
              <table className="w-full text-[11px] border-collapse">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="text-left font-normal" />
                    {DAY_LABELS.map((d) => (
                      <th key={d} className="text-center font-normal">{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="text-muted-foreground">cap.</td>
                    {row.days.map((d) => (
                      <td key={d.day} className="text-center">{Math.round(d.capacityMin / 60 * 10) / 10}h</td>
                    ))}
                  </tr>
                  <tr>
                    <td className="text-muted-foreground">{mode === 'preparation' ? 'imp.' : 'chg.'}</td>
                    {row.days.map((d) => (
                      <td key={d.day} className="text-center">{Math.round(d.loadMin / 60 * 10) / 10}h</td>
                    ))}
                  </tr>
                  {mode === 'analysis' && (
                    <tr>
                      <td className="text-muted-foreground">mou</td>
                      {row.days.map((d) => (
                        <td
                          key={d.day}
                          className={cn('text-center', !d.fits && 'text-red-600 dark:text-red-400 font-medium')}
                        >
                          {Math.round(d.slackMin / 60 * 10) / 10}h
                        </td>
                      ))}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ))}

          {noDayFitsAnywhere && (
            <p className="text-xs text-red-600 dark:text-red-400 border-t pt-2">
              Aucun jour n&apos;a assez de mou pour cette tâche{taskDurationMin ? ` (${formatH(taskDurationMin)})` : ''}
              {' '}— ressource(s) en tension sur la semaine.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
