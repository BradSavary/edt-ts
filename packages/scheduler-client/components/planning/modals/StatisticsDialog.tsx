'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
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
import { Square, SquareCheck } from 'lucide-react';
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
/** Ticks Y toutes les 2 heures (0h → 12h). */
const Y_TICKS = [0, 120, 240, 360, 480, 600, 720];
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
 * 5 graphes côte à côte — un par jour — double barres (utilisation + amplitude)
 * pour chaque ressource de la liste `resourceIds` (sélection libre par l'utilisateur).
 * Domaine Y fixe 0–12h (720 min).
 */
function DailyGroupedCharts({
  analysis,
  resourceIds,
}: {
  analysis: SolutionAnalysis;
  resourceIds: string[];
}) {
  const perDay = useMemo(() => {
    if (resourceIds.length === 0) {
      return DAY_LABELS.map((label) => ({ label, entries: [] as { id: string; usage: number; amplitude: number }[] }));
    }
    const usageRaw = analysis.dailyUsageMinutes(resourceIds);
    const amplRaw = analysis.dailyAmplitudeMinutes(resourceIds);

    return DAY_LABELS.map((label, dayIdx) => {
      const entries = resourceIds
        .map((id) => ({
          id,
          usage: usageRaw[id]?.[dayIdx] ?? 0,
          amplitude: amplRaw[id]?.[dayIdx] ?? 0,
        }))
        .filter((e) => e.usage > 0 || e.amplitude > 0);
      return { label, entries };
    });
  }, [analysis, resourceIds]);

  if (resourceIds.length === 0) {
    return (
      <div className="flex items-center justify-center h-75 text-sm text-muted-foreground">
        Aucune ressource sélectionnée pour le graphe.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Légende partagée unique */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground px-1">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm bg-[#6366f1]" />
          Utilisation
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm bg-[#f59e0b]" />
          Amplitude
        </span>
      </div>
      <div className="flex gap-2">
        {perDay.map(({ label, entries }) => (
          <div key={label} className="flex-1 min-w-0 flex flex-col">
            <p className="text-xs font-semibold text-center mb-1 text-muted-foreground">{label}</p>
            {entries.length === 0 ? (
              <div className="flex items-center justify-center h-75 text-xs text-muted-foreground">—</div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={entries}
                  margin={{ top: 4, right: 4, left: 2, bottom: 58 }}
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
                    ticks={Y_TICKS}
                    tick={{ fontSize: 9 }}
                    interval={0}
                    width={36}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(v, name) => [
                      formatMinutes(Number(v)),
                      name === 'usage' ? 'Utilisation' : 'Amplitude',
                    ]}
                    contentStyle={{ fontSize: 11 }}
                  />
                  <Bar dataKey="usage" name="Utilisation" fill="#6366f1" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="amplitude" name="Amplitude" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        ))}
      </div>
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
              <YAxis tickFormatter={minutesTickFormatter} domain={[0, 720]} ticks={Y_TICKS} />
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
              <YAxis tickFormatter={minutesTickFormatter} domain={[0, 720]} ticks={Y_TICKS} />
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
            <YAxis tickFormatter={minutesTickFormatter} domain={[0, 720]} ticks={Y_TICKS} />
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

/** Vue comparative "Toutes" avec double barres et sélection libre des ressources */
function AllResourcesView({
  analysis,
  resourceIds,
  selectedResourceIds,
  label,
}: {
  analysis: SolutionAnalysis;
  resourceIds: string[];
  selectedResourceIds: string[];
  label: string;
}) {
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

      {/* Double bar charts per day */}
      <div>
        <p className="text-sm font-medium mb-2">
          Utilisation &amp; Amplitude journalières
          {selectedResourceIds.length > 0 && (
            <span className="ml-2 text-xs text-muted-foreground font-normal">
              ({selectedResourceIds.length} ressource{selectedResourceIds.length > 1 ? 's' : ''} sélectionnée{selectedResourceIds.length > 1 ? 's' : ''})
            </span>
          )}
        </p>
        <DailyGroupedCharts analysis={analysis} resourceIds={selectedResourceIds} />
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

  /** Ressources cochées pour les graphes "Tous les [type]", indexées par type. */
  const [checkedByType, setCheckedByType] = useState<Partial<Record<ResourceType, string[]>>>({});

  const toggleResourceCheck = useCallback((type: ResourceType, id: string) => {
    setCheckedByType((prev) => {
      const current = prev[type] ?? [];
      const next = current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id];
      return { ...prev, [type]: next };
    });
  }, []);

  // Réinitialise la sélection et calcule le top 5 (max usage/amplitude) à chaque ouverture
  useEffect(() => {
    if (open && availableTypes.length > 0) {
      setSelection({ kind: 'all-type', type: availableTypes[0] });
      const initial: Partial<Record<ResourceType, string[]>> = {};
      for (const type of availableTypes) {
        const ids = byTypeFiltered[type];
        if (ids.length === 0) continue;
        const usageRaw = analysis.dailyUsageMinutes(ids);
        const amplRaw = analysis.dailyAmplitudeMinutes(ids);
        const scored = ids
          .map((id) => {
            const totalU = Object.values(usageRaw[id] ?? {}).reduce((a, b) => a + b, 0);
            const totalA = Object.values(amplRaw[id] ?? {}).reduce((a, b) => a + b, 0);
            return { id, score: Math.max(totalU, totalA) };
          })
          .sort((a, b) => b.score - a.score);
        initial[type] = scored.slice(0, TOP_N).map((r) => r.id);
      }
      setCheckedByType(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const activeType = selection?.type ?? availableTypes[0];
  const checkedIds = checkedByType[activeType] ?? [];
  const allTypeIds = byTypeFiltered[activeType] ?? [];

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
                        {selection?.kind === 'all-type' && (
                          <span className="ml-auto text-[10px] text-muted-foreground font-normal">
                            {checkedIds.length}/{allTypeIds.length}
                          </span>
                        )}
                      </Button>
                    )}

                    {/* Contrôles Tout / Aucun (mode "all-type" uniquement) */}
                    {selection?.kind === 'all-type' && activeType && (
                      <div className="flex items-center gap-1.5 px-1 py-0.5 mb-0.5">
                        <span className="text-[10px] text-muted-foreground">Graphe :</span>
                        <button
                          className="text-[10px] underline text-muted-foreground hover:text-foreground"
                          onClick={() =>
                            setCheckedByType((prev) => ({ ...prev, [activeType]: [...allTypeIds] }))
                          }
                        >
                          Tout
                        </button>
                        <span className="text-[10px] text-muted-foreground">/</span>
                        <button
                          className="text-[10px] underline text-muted-foreground hover:text-foreground"
                          onClick={() =>
                            setCheckedByType((prev) => ({ ...prev, [activeType]: [] }))
                          }
                        >
                          Aucun
                        </button>
                      </div>
                    )}

                    {/* Ressources individuelles */}
                    {activeType &&
                      byTypeFiltered[activeType].map((id) => {
                        const isDetailSelected =
                          selection?.kind === 'resource' && selection.id === id;
                        const isAllTypeMode = selection?.kind === 'all-type';
                        const isChecked = checkedIds.includes(id);

                        return (
                          <div
                            key={id}
                            className={cn(
                              'flex items-center rounded-sm min-w-0',
                              isDetailSelected && 'bg-accent',
                            )}
                          >
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setSelection({ kind: 'resource', id, type: activeType })
                              }
                              className={cn(
                                'flex-1 justify-start font-normal text-xs h-7 min-w-0',
                                isDetailSelected && 'bg-accent text-accent-foreground',
                              )}
                              title={id}
                            >
                              <span className="truncate">{id}</span>
                            </Button>
                            {/* Case à cocher graphe (mode all-type uniquement) — à droite pour éviter le décalage */}
                            {isAllTypeMode && (
                              <button
                                className="p-1 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                                onClick={() => toggleResourceCheck(activeType, id)}
                                title={isChecked ? 'Retirer du graphe' : 'Ajouter au graphe'}
                              >
                                {isChecked ? (
                                  <SquareCheck size={14} className="text-primary" />
                                ) : (
                                  <Square size={14} />
                                )}
                              </button>
                            )}
                          </div>
                        );
                      })}
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
                    selectedResourceIds={checkedIds}
                    label={TYPE_LABELS[activeType]}
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
