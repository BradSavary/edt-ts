'use client';

import { useMemo, useState, useEffect } from 'react';
import { SolutionAnalysis } from '@edt-ts/scheduler-common';
import type { TaskSolutionJSON, ResourceGroupData } from '@edt-ts/scheduler-common';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

// ── Helpers ────────────────────────────────────────────────────────────────

const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'];
const TOP_N = 5;

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h${m.toString().padStart(2, '0')}`;
}

const PALETTE = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#84cc16',
];

// ── Types internes ─────────────────────────────────────────────────────────

type ResourceType = 'teacher' | 'room' | 'group';

const TYPE_LABELS: Record<ResourceType, string> = {
  teacher: 'Enseignants',
  room: 'Salles',
  group: 'Groupes',
};

// ── Tooltip formatter ──────────────────────────────────────────────────────

function minutesTickFormatter(value: number): string {
  return formatMinutes(value);
}

// ── Sous-composants de graphes ─────────────────────────────────────────────

/**
 * 5 graphes côte à côte — un par jour — barres individuelles (top N de ce jour, triées décroissant).
 * Domaine Y fixe 0–12h (720 min). Axe Y affiché uniquement sur le premier graphe.
 */
function DailyGroupedCharts({
  analysis,
  resourceIds,
  metric,
}: {
  analysis: SolutionAnalysis;
  resourceIds: string[];
  metric: 'usage' | 'amplitude';
  dailyTotals?: Record<number, number>;
}) {
  const perDay = useMemo(() => {
    const raw =
      metric === 'usage'
        ? analysis.dailyUsageMinutes(resourceIds)
        : analysis.dailyAmplitudeMinutes(resourceIds);

    return DAY_LABELS.map((label, dayIdx) => {
      const entries = resourceIds
        .map((id) => ({ id, value: raw[id]?.[dayIdx] ?? 0 }))
        .filter((e) => e.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, TOP_N);
      return { label, dayIdx, entries };
    });
  }, [analysis, resourceIds, metric]);

  return (
    <div className="flex gap-2">
      {perDay.map(({ label, dayIdx, entries }) => (
        <div key={label} className="flex-1 min-w-0 flex flex-col">
          <p className="text-xs font-semibold text-center mb-1 text-muted-foreground">{label}</p>
          {entries.length === 0 ? (
            <div className="flex items-center justify-center h-[300px] text-xs text-muted-foreground">—</div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={entries}
                margin={{ top: 4, right: 4, left: dayIdx === 0 ? 38 : 0, bottom: 58 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="id"
                  angle={-40}
                  textAnchor="end"
                  interval={0}
                  tick={{ fontSize: 9 }}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={minutesTickFormatter}
                  domain={[0, 720]}
                  tick={dayIdx === 0 ? { fontSize: 9 } : false}
                  width={dayIdx === 0 ? 36 : 1}
                  axisLine={dayIdx === 0}
                  tickLine={dayIdx === 0}
                />
                <Tooltip
                  formatter={(v) => [formatMinutes(Number(v)), metric === 'usage' ? 'Utilisation' : 'Amplitude']}
                  contentStyle={{ fontSize: 11 }}
                />
                <Bar dataKey="value" fill="#6366f1" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      ))}
    </div>
  );
}

/** Stats dispersion hebdomadaire pour une ressource */
function WeeklyDispersionCards({
  etendue,
  ecartType,
}: {
  etendue: number;
  ecartType: number;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex-1 rounded-lg border p-4 text-center">
        <p className="text-xs text-muted-foreground mb-1">Étendue hebdo</p>
        <p className="text-2xl font-semibold">{formatMinutes(etendue)}</p>
      </div>
      <div className="flex-1 rounded-lg border p-4 text-center">
        <p className="text-xs text-muted-foreground mb-1">Écart-type hebdo</p>
        <p className="text-2xl font-semibold">{formatMinutes(ecartType)}</p>
      </div>
    </div>
  );
}

/** Vue détaillée d'une ressource */
function ResourceDetailCharts({
  analysis,
  resourceId,
}: {
  analysis: SolutionAnalysis;
  resourceId: string;
}) {
  const usageData = useMemo(() => {
    const raw = analysis.dailyUsageMinutes([resourceId])[resourceId] ?? {};
    return DAY_LABELS.map((label, i) => ({ day: label, minutes: raw[i] ?? 0 }));
  }, [analysis, resourceId]);

  const amplitudeData = useMemo(() => {
    const raw = analysis.dailyAmplitudeMinutes([resourceId])[resourceId] ?? {};
    return DAY_LABELS.map((label, i) => ({ day: label, minutes: raw[i] ?? 0 }));
  }, [analysis, resourceId]);

  const weeklyDisp = useMemo(
    () => analysis.weeklyDispersion([resourceId])[resourceId] ?? { etendue: 0, ecartType: 0 },
    [analysis, resourceId],
  );

  const dailyDispData = useMemo(() => {
    const raw = analysis.dailyDispersion([resourceId])[resourceId] ?? {};
    return DAY_LABELS.map((label, i) => ({
      day: label,
      etendue: raw[i]?.etendue ?? 0,
      ecartType: raw[i]?.ecartType ?? 0,
    }));
  }, [analysis, resourceId]);

  return (
    <div className="flex flex-col gap-6">
      {/* Usage journalier + Amplitude journalière côte à côte */}
      <div className="flex gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium mb-2">Utilisation journalière</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={usageData} margin={{ top: 4, right: 16, left: 24, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" />
              <YAxis tickFormatter={minutesTickFormatter} domain={[0, 720]} />
              <Tooltip formatter={(v) => formatMinutes(Number(v))} />
              <Bar dataKey="minutes" name="Utilisation" fill="#6366f1" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium mb-2">Amplitude journalière (1er cours → fin du dernier)</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={amplitudeData} margin={{ top: 4, right: 16, left: 24, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" />
              <YAxis tickFormatter={minutesTickFormatter} domain={[0, 720]} />
              <Tooltip formatter={(v) => formatMinutes(Number(v))} />
              <Bar dataKey="minutes" name="Amplitude" fill="#f59e0b" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Dispersion hebdomadaire */}
      <div>
        <p className="text-sm font-medium mb-2">Dispersion hebdomadaire des créneaux de début</p>
        <WeeklyDispersionCards etendue={weeklyDisp.etendue} ecartType={weeklyDisp.ecartType} />
      </div>

      {/* Dispersion quotidienne */}
      <div>
        <p className="text-sm font-medium mb-2">Dispersion quotidienne des créneaux de début</p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={dailyDispData} margin={{ top: 4, right: 16, left: 24, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="day" />
            <YAxis tickFormatter={minutesTickFormatter} />
            <Tooltip formatter={(v) => formatMinutes(Number(v))} />
            <Bar dataKey="etendue" name="Étendue" fill="#10b981" />
            <Bar dataKey="ecartType" name="Écart-type" fill="#3b82f6" />
            <Legend />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Vue comparative "Toutes" avec sélecteur de métrique et top N */
function AllResourcesView({
  analysis,
  resourceIds,
  label,
  dailyTotals,
}: {
  analysis: SolutionAnalysis;
  resourceIds: string[];
  label: string;
  dailyTotals: Record<number, number>;
}) {
  const [metric, setMetric] = useState<'usage' | 'amplitude'>('usage');

  const weeklyUsageSorted = useMemo(() => {
    const raw = analysis.dailyUsageMinutes(resourceIds);
    return resourceIds
      .map((id) => ({
        id,
        total: Object.values(raw[id] ?? {}).reduce((a, b) => a + b, 0),
      }))
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [analysis, resourceIds]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-base font-semibold">{label}</p>

      {/* Sélecteur de métrique */}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={metric === 'usage' ? 'default' : 'outline'}
          onClick={() => setMetric('usage')}
        >
          Utilisation
        </Button>
        <Button
          size="sm"
          variant={metric === 'amplitude' ? 'default' : 'outline'}
          onClick={() => setMetric('amplitude')}
        >
          Amplitude
        </Button>
      </div>

      {/* Top 10 par jour — domaine Y partagé */}
      <div>
        <p className="text-sm font-medium mb-2">
          {metric === 'usage' ? 'Utilisation journalière' : 'Amplitude journalière'} — top {TOP_N} par jour
        </p>
        <DailyGroupedCharts analysis={analysis} resourceIds={resourceIds} metric={metric} />
      </div>

      {/* Tableau récap usage total hebdomadaire */}
      <div>
        <p className="text-sm font-medium mb-2">Utilisation totale hebdomadaire</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {weeklyUsageSorted.map((r, i) => (
            <div key={r.id} className="rounded-md border p-2 flex justify-between items-center gap-2">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: PALETTE[i % PALETTE.length] }}
              />
              <span className="text-xs truncate flex-1" title={r.id}>{r.id}</span>
              <Badge variant="secondary" className="text-xs shrink-0">{formatMinutes(r.total)}</Badge>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Sélection dans la sidebar ──────────────────────────────────────────────

type Selection =
  | { kind: 'all-type'; type: ResourceType }
  | { kind: 'resource'; id: string; type: ResourceType };

// ── Composant principal ────────────────────────────────────────────────────

export interface StatisticsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeSolution: TaskSolutionJSON[];
  resources: ResourceGroupData[];
}

export function StatisticsDialog({
  open,
  onOpenChange,
  activeSolution,
  resources,
}: StatisticsDialogProps) {
  const analysis = useMemo(() => {
    return new SolutionAnalysis({ solutions: activeSolution, isComplete: true });
  }, [activeSolution]);

  const byType = useMemo(() => {
    const map: Record<ResourceType, string[]> = { teacher: [], room: [], group: [] };
    for (const group of resources) {
      if (group.resourceType in map) {
        for (const r of group.resources) {
          map[group.resourceType as ResourceType].push(r.id);
        }
      }
    }
    return map;
  }, [resources]);

  // Total de minutes planifiées par jour (toutes tâches confondues, sans doublon)
  const dailyTotals = useMemo(() => {
    const totals: Record<number, number> = {};
    for (const task of activeSolution) {
      if (task.startTime >= 0) {
        const day = Math.floor(task.startTime / (24 * 60));
        totals[day] = (totals[day] ?? 0) + task.duration;
      }
    }
    return totals;
  }, [activeSolution]);

  // IDs des ressources réellement présentes dans la solution courante
  const usedResourceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const task of activeSolution) {
      if (task.startTime >= 0) {
        for (const r of task.resources) ids.add(r.id);
      }
    }
    return ids;
  }, [activeSolution]);

  const byTypeFiltered = useMemo(() => {
    const map: Record<ResourceType, string[]> = { teacher: [], room: [], group: [] };
    for (const type of Object.keys(map) as ResourceType[]) {
      map[type] = byType[type].filter((id) => usedResourceIds.has(id));
    }
    return map;
  }, [byType, usedResourceIds]);

  const availableTypes = (Object.keys(TYPE_LABELS) as ResourceType[]).filter(
    (t) => byTypeFiltered[t].length > 0,
  );

  const [selection, setSelection] = useState<Selection | null>(null);

  // Réinitialise la sélection à "Tous les enseignants" (ou 1er type dispo) à chaque ouverture
  useEffect(() => {
    if (open && availableTypes.length > 0) {
      setSelection({ kind: 'all-type', type: availableTypes[0] });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const activeType = selection?.type ?? availableTypes[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-[95vw] w-[95vw] h-[92vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-3 shrink-0 border-b">
          <DialogTitle>Statistiques de la solution</DialogTitle>
        </DialogHeader>

        {activeSolution.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            Aucune tâche planifiée dans la solution courante.
          </div>
        ) : (
          <div className="flex flex-1 overflow-hidden">
            {/* ── Sidebar ── */}
            <aside className="w-64 shrink-0 border-r flex flex-col min-h-0">
              {/* Sélecteur de type */}
              <div className="p-3 border-b shrink-0">
                <Tabs
                  value={activeType}
                  onValueChange={(v) => setSelection({ kind: 'all-type', type: v as ResourceType })}
                >
                  <TabsList className="w-full">
                    {availableTypes.map((type) => (
                      <TabsTrigger key={type} value={type} className="flex-1 text-xs">
                        {TYPE_LABELS[type]}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>

              {/* Liste des ressources du type actif */}
              <div className="flex-1 overflow-hidden min-h-0">
                <ScrollArea className="h-full">
                  <div className="p-2 flex flex-col gap-0.5">
                    {/* Entrée "Tous les [type]" */}
                    {activeType && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelection({ kind: 'all-type', type: activeType })}
                        className={cn(
                          'w-full justify-start font-medium text-xs',
                          selection?.kind === 'all-type' && 'bg-accent text-accent-foreground',
                        )}
                      >
                        Tous les {TYPE_LABELS[activeType].toLowerCase()}
                      </Button>
                    )}
                    {activeType && byTypeFiltered[activeType].map((id) => (
                      <Button
                        key={id}
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelection({ kind: 'resource', id, type: activeType })}
                        className={cn(
                          'w-full justify-start font-normal text-xs',
                          selection?.kind === 'resource' && selection.id === id && 'bg-accent text-accent-foreground',
                        )}
                        title={id}
                      >
                        <span className="truncate">{id}</span>
                      </Button>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </aside>

            {/* ── Zone principale ── */}
            <ScrollArea className="flex-1">
              <div className="p-6">
                {selection === null || activeType === undefined ? null
                  : selection.kind === 'all-type' ? (
                  <AllResourcesView
                    analysis={analysis}
                    resourceIds={byTypeFiltered[activeType]}
                    label={TYPE_LABELS[activeType]}
                    dailyTotals={dailyTotals}
                  />
                ) : (
                  <ResourceDetailCharts
                    analysis={analysis}
                    resourceId={selection.id}
                  />
                )}
              </div>
            </ScrollArea>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
