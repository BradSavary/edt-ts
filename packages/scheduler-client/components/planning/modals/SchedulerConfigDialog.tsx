'use client';

import { useState } from 'react';
import type { LunchBreakFixed, LunchBreakFloating, SchedulerConfig } from '@edt-ts/scheduler-common';
import { DEFAULT_SCHEDULER_CONFIG } from '@edt-ts/scheduler-common';
import { useSchedulerStore } from '@/store/useSchedulerStore';
import { Settings, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';

// ── Types internes ──────────────────────────────────────────────────────────

interface LunchFixedDraft {
  from: string;
  to: string;
}

interface LunchFloatingDraft {
  duration: string; // saisie texte → converti en number à la validation
  earliest: string;
  latest: string;
}

type LunchTab = 'none' | 'fixed' | 'floating';

interface Draft {
  maxSolutions: string;
  timeoutSeconds: string;
  maxIterations: string;
  maxEliminations: string;
  resourceSelection: 'deterministic' | 'random';
  lunchTab: LunchTab;
  lunchFixed: LunchFixedDraft;
  lunchFloating: LunchFloatingDraft;
  ignoreDailyLimits: boolean;
}

// ── Helpers de conversion ────────────────────────────────────────────────────

// Convertit un SchedulerConfig en Draft pour pré-remplir le formulaire à l'ouverture.
function configToDraft(config: SchedulerConfig): Draft {
  const lb = config.lunchBreak ?? DEFAULT_SCHEDULER_CONFIG.lunchBreak;
  let lunchTab: LunchTab = 'none';
  let lunchFixed: LunchFixedDraft = { from: '12:00', to: '13:30' };
  let lunchFloating: LunchFloatingDraft = { duration: '90', earliest: '11:30', latest: '14:00' };

  if (lb.type === 'fixed') {
    lunchTab = 'fixed';
    lunchFixed = { from: lb.from, to: lb.to };
  } else if (lb.type === 'floating') {
    lunchTab = 'floating';
    lunchFloating = {
      duration: String(lb.duration),
      earliest: lb.earliest,
      latest: lb.latest,
    };
  }

  return {
    maxSolutions: String(config.maxSolutions ?? DEFAULT_SCHEDULER_CONFIG.maxSolutions),
    timeoutSeconds: String(config.timeoutSeconds ?? DEFAULT_SCHEDULER_CONFIG.timeoutSeconds),
    maxIterations: String(config.maxIterations ?? DEFAULT_SCHEDULER_CONFIG.maxIterations),
    maxEliminations: String(config.maxEliminations ?? DEFAULT_SCHEDULER_CONFIG.maxEliminations),
    resourceSelection: config.resourceSelection ?? DEFAULT_SCHEDULER_CONFIG.resourceSelection,
    lunchTab,
    lunchFixed,
    lunchFloating,
    ignoreDailyLimits: config.ignoreDailyLimits ?? DEFAULT_SCHEDULER_CONFIG.ignoreDailyLimits,
  };
}

// Convertit un Draft en SchedulerConfig pour sauvegarder les modifications.
function draftToConfig(draft: Draft): SchedulerConfig {
  let lunchBreak: SchedulerConfig['lunchBreak'];
  if (draft.lunchTab === 'fixed') {
    lunchBreak = { type: 'fixed', from: draft.lunchFixed.from, to: draft.lunchFixed.to } satisfies LunchBreakFixed;
  } else if (draft.lunchTab === 'floating') {
    lunchBreak = {
      type: 'floating',
      duration: Math.max(1, parseInt(draft.lunchFloating.duration, 10) || 90),
      earliest: draft.lunchFloating.earliest,
      latest: draft.lunchFloating.latest,
    } satisfies LunchBreakFloating;
  } else {
    lunchBreak = { type: 'none' };
  }

  return {
    maxSolutions: Math.max(1, parseInt(draft.maxSolutions, 10) || DEFAULT_SCHEDULER_CONFIG.maxSolutions),
    timeoutSeconds: Math.max(1, parseInt(draft.timeoutSeconds, 10) || DEFAULT_SCHEDULER_CONFIG.timeoutSeconds),
    maxIterations: Math.max(1000, parseInt(draft.maxIterations, 10) || DEFAULT_SCHEDULER_CONFIG.maxIterations),
    maxEliminations: Math.max(1, parseInt(draft.maxEliminations, 10) || DEFAULT_SCHEDULER_CONFIG.maxEliminations),
    resourceSelection: draft.resourceSelection,
    lunchBreak,
    ignoreDailyLimits: draft.ignoreDailyLimits,
  };
}

// ── Composant ───────────────────────────────────────────────────────────────

export function SchedulerConfigDialog() {
  const config = useSchedulerStore((s) => s.schedulerConfig);
  const setSchedulerConfig = useSchedulerStore((s) => s.setSchedulerConfig);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => configToDraft(config));
  const [resetting, setResetting] = useState(false);

  // Réinitialise le draft depuis le store à chaque ouverture
  function handleOpenChange(next: boolean) {
    if (next) setDraft(configToDraft(config));
    setOpen(next);
  }

  // Charge les valeurs par défaut depuis l'API
  async function handleReset() {
    setResetting(true);
    try {
      const res = await fetch('/api/schedule/config');
      if (!res.ok) throw new Error();
      const data: SchedulerConfig = await res.json() as SchedulerConfig;
      setDraft(configToDraft(data));
    } catch {
      setDraft(configToDraft(DEFAULT_SCHEDULER_CONFIG));
    } finally {
      setResetting(false);
    }
  }

  function handleSave() {
    setSchedulerConfig(draftToConfig(draft));
    setOpen(false);
  }

  function setDraftField<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          title="Paramètres de planification"
          aria-label="Paramètres de planification"
        >
          <Settings className="size-4" />
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Paramètres de planification</DialogTitle>
          <DialogDescription>
            Ces options sont transmises au moteur à chaque lancement. Elles sont sauvegardées
            dans votre navigateur.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">

          {/* ── Général ─────────────────────────────────────────────────── */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Général
            </h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="cfg-maxSolutions">Nombre max de solutions</Label>
                <Input
                  id="cfg-maxSolutions"
                  type="number"
                  min="1"
                  max="20"
                  value={draft.maxSolutions}
                  onChange={(e) => setDraftField('maxSolutions', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Le moteur s&apos;arrête dès qu&apos;il a trouvé ce nombre de solutions complètes.
                  Une valeur trop haute peut ralentir le calcul.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cfg-maxEliminations">Éliminations max</Label>
                <Input
                  id="cfg-maxEliminations"
                  type="number"
                  min="1"
                  max="20"
                  value={draft.maxEliminations}
                  onChange={(e) => setDraftField('maxEliminations', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Nombre de tâches que le moteur peut neutraliser pour
                  trouver une solution. A augmenter si la planification échoue.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 pt-1">
              <input
                id="cfg-ignoreDailyLimits"
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-primary cursor-pointer"
                checked={draft.ignoreDailyLimits}
                onChange={(e) => setDraftField('ignoreDailyLimits', e.target.checked)}
              />
              <div className="space-y-0.5">
                <Label htmlFor="cfg-ignoreDailyLimits" className="cursor-pointer">
                  Ignorer les limites journalières des ressources
                </Label>
                <p className="text-xs text-muted-foreground">
                  Si coché, les limites journalières définies dans les contraintes de toutes les ressources sont ignorées.
                </p>
              </div>
            </div>
          </section>

          <Separator />

          {/* ── Performance ─────────────────────────────────────────────── */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Limites de calcul
            </h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="cfg-timeout">Timeout (secondes)</Label>
                <Input
                  id="cfg-timeout"
                  type="number"
                  min="1"
                  max="600"
                  value={draft.timeoutSeconds}
                  onChange={(e) => setDraftField('timeoutSeconds', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Durée maximale du calcul.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cfg-maxIter">Itérations max</Label>
                <Input
                  id="cfg-maxIter"
                  type="number"
                  min="10000"
                  value={draft.maxIterations}
                  onChange={(e) => setDraftField('maxIterations', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Nombre maximal d&apos;itérations de l&apos;algorithme de recherche.
                </p>
              </div>
            </div>
          </section>

          <Separator />

          {/* ── Sélection des ressources ─────────────────────────────────── */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Sélection des ressources
            </h3>

            <div className="space-y-1.5">
              <Label htmlFor="cfg-resourceSelection">Stratégie initiale</Label>
              <Select
                value={draft.resourceSelection}
                onValueChange={(v) => setDraftField('resourceSelection', v as 'deterministic' | 'random')}
              >
                <SelectTrigger id="cfg-resourceSelection" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="deterministic">Déterministe (recommandé)</SelectItem>
                  <SelectItem value="random">Aléatoire</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                <strong>Déterministe</strong> — sélectionne toujours les mêmes ressources en
                premier ; les résultats sont reproductibles. <strong>Aléatoire</strong> — explore
                des combinaisons différentes à chaque lancement (utile si le mode déterministe
                bute sur un conflit local).
              </p>
            </div>
          </section>

          <Separator />

          {/* ── Pause méridienne ──────────────────────────────────────────── */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Pause méridienne
            </h3>
            <p className="text-xs text-muted-foreground">
              Définit comment le moteur gère la pause déjeuner des groupes d&apos;étudiants.
            </p>

            <Tabs
              value={draft.lunchTab}
              onValueChange={(v) => setDraftField('lunchTab', v as LunchTab)}
            >
              <TabsList className="w-full">
                <TabsTrigger value="none" className="flex-1">Aucune</TabsTrigger>
                <TabsTrigger value="fixed" className="flex-1">Fixe</TabsTrigger>
                <TabsTrigger value="floating" className="flex-1">Flottante</TabsTrigger>
              </TabsList>

              {/* ── Aucune ── */}
              <TabsContent value="none" className="pt-3">
                <p className="text-sm text-muted-foreground">
                  Aucune contrainte particulière. Les cours peuvent être planifiés sur
                  l&apos;ensemble de la plage horaire journalière.
                </p>
              </TabsContent>

              {/* ── Fixe ── */}
              <TabsContent value="fixed" className="pt-3 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Une tranche horaire identique est automatiquement bloquée chaque jour
                  de la semaine pour tous les groupes d&apos;étudiants.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="cfg-lunch-fixed-from">Début</Label>
                    <Input
                      id="cfg-lunch-fixed-from"
                      type="time"
                      value={draft.lunchFixed.from}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          lunchFixed: { ...d.lunchFixed, from: e.target.value },
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cfg-lunch-fixed-to">Fin</Label>
                    <Input
                      id="cfg-lunch-fixed-to"
                      type="time"
                      value={draft.lunchFixed.to}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          lunchFixed: { ...d.lunchFixed, to: e.target.value },
                        }))
                      }
                    />
                  </div>
                </div>
              </TabsContent>

              {/* ── Flottante ── */}
              <TabsContent value="floating" className="pt-3 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Définis une tranche horaire journalière (ex. 11:30–14:00) et une durée minimale (ex. 90 minutes) sur laquelle la pose déjeuner peut avoir lieu.
                </p>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="cfg-lunch-dur">Durée (min)</Label>
                    <Input
                      id="cfg-lunch-dur"
                      type="number"
                      min="30"
                      max="180"
                      value={draft.lunchFloating.duration}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          lunchFloating: { ...d.lunchFloating, duration: e.target.value },
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cfg-lunch-earliest">Fenêtre — début</Label>
                    <Input
                      id="cfg-lunch-earliest"
                      type="time"
                      value={draft.lunchFloating.earliest}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          lunchFloating: { ...d.lunchFloating, earliest: e.target.value },
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cfg-lunch-latest">Fenêtre — fin</Label>
                    <Input
                      id="cfg-lunch-latest"
                      type="time"
                      value={draft.lunchFloating.latest}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          lunchFloating: { ...d.lunchFloating, latest: e.target.value },
                        }))
                      }
                    />
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </section>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={resetting}
            className="text-muted-foreground"
          >
            <RotateCcw className="size-3.5 mr-1.5" />
            {resetting ? 'Chargement…' : 'Valeurs par défaut'}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button type="button" onClick={handleSave}>
              Valider
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
