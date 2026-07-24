'use client';

import { useState } from 'react';
import type { LunchBreakFixed, LunchBreakFloating, SchedulerConfig } from '@edt-ts/scheduler-common';
import { DEFAULT_SCHEDULER_CONFIG } from '@edt-ts/scheduler-common';
import { useAppConfigStore } from '@/store/useAppConfigStore';
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
  engine: 'core' | 'cpsat';
  timeoutSeconds: string;
  maxIterations: string;
  maxEliminations: string;
  lunchTab: LunchTab;
  lunchFixed: LunchFixedDraft;
  lunchFloating: LunchFloatingDraft;
  ignoreDailyLimits: boolean;
  conflictOrderingSearch: boolean;
  conflictSetExact: boolean;
  postRepair: boolean;
  searchStrategy: 'elimination' | 'maxPlacement';
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
    engine: config.engine ?? DEFAULT_SCHEDULER_CONFIG.engine,
    timeoutSeconds: String(config.timeoutSeconds ?? DEFAULT_SCHEDULER_CONFIG.timeoutSeconds),
    maxIterations: String(config.maxIterations ?? DEFAULT_SCHEDULER_CONFIG.maxIterations),
    maxEliminations: String(config.maxEliminations ?? DEFAULT_SCHEDULER_CONFIG.maxEliminations),
    lunchTab,
    lunchFixed,
    lunchFloating,
    ignoreDailyLimits: config.ignoreDailyLimits ?? DEFAULT_SCHEDULER_CONFIG.ignoreDailyLimits,
    conflictOrderingSearch: config.conflictOrderingSearch ?? DEFAULT_SCHEDULER_CONFIG.conflictOrderingSearch,
    conflictSetExact: config.conflictSetExact ?? DEFAULT_SCHEDULER_CONFIG.conflictSetExact,
    postRepair: config.postRepair ?? DEFAULT_SCHEDULER_CONFIG.postRepair,
    searchStrategy: config.searchStrategy ?? DEFAULT_SCHEDULER_CONFIG.searchStrategy,
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
    engine: draft.engine,
    timeoutSeconds: Math.max(1, parseInt(draft.timeoutSeconds, 10) || DEFAULT_SCHEDULER_CONFIG.timeoutSeconds),
    maxIterations: Math.max(1000, parseInt(draft.maxIterations, 10) || DEFAULT_SCHEDULER_CONFIG.maxIterations),
    maxEliminations: Math.max(1, parseInt(draft.maxEliminations, 10) || DEFAULT_SCHEDULER_CONFIG.maxEliminations),
    lunchBreak,
    ignoreDailyLimits: draft.ignoreDailyLimits,
    conflictOrderingSearch: draft.conflictOrderingSearch,
    conflictSetExact: draft.conflictSetExact,
    postRepair: draft.postRepair,
    searchStrategy: draft.searchStrategy,
  };
}

// ── Composant ───────────────────────────────────────────────────────────────

export function SchedulerConfigDialog() {
  const config = useAppConfigStore((s) => s.schedulerConfig);
  const setSchedulerConfig = useAppConfigStore((s) => s.setSchedulerConfig);

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

  // CP-SAT ne supporte pas la pause flottante : bascule sur "aucune" au changement de moteur.
  function setEngine(engine: Draft['engine']) {
    setDraft((d) => ({
      ...d,
      engine,
      lunchTab: engine === 'cpsat' && d.lunchTab === 'floating' ? 'none' : d.lunchTab,
    }));
  }

  const isCpsat = draft.engine === 'cpsat';

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

          {/* ── Moteur ──────────────────────────────────────────────────── */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Moteur
            </h3>
            <div className="space-y-2">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="cfg-engine"
                  className="mt-0.5 h-4 w-4 accent-primary cursor-pointer"
                  checked={draft.engine === 'core'}
                  onChange={() => setEngine('core')}
                />
                <span className="space-y-0.5">
                  <span className="block text-sm">Élimination / Placement (core)</span>
                  <span className="block text-xs text-muted-foreground">
                    Moteur historique. Options avancées ci-dessous, pause méridienne flottante
                    disponible.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="cfg-engine"
                  className="mt-0.5 h-4 w-4 accent-primary cursor-pointer"
                  checked={draft.engine === 'cpsat'}
                  onChange={() => setEngine('cpsat')}
                />
                <span className="space-y-0.5">
                  <span className="block text-sm">CP-SAT (OR-Tools) — optimum prouvé</span>
                  <span className="block text-xs text-muted-foreground">
                    2e moteur : prouve l&apos;optimum du nombre de cours placés. Pause méridienne
                    flottante non supportée ; options avancées du moteur core sans effet.
                  </span>
                </span>
              </label>
            </div>
          </section>

          <Separator />

          {/* ── Général ─────────────────────────────────────────────────── */}
          {!isCpsat && (
          <section className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Général
            </h3>

            <div className="space-y-2">
              <Label>Stratégie de recherche</Label>
              <div className="space-y-2">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="cfg-searchStrategy"
                    className="mt-0.5 h-4 w-4 accent-primary cursor-pointer"
                    checked={draft.searchStrategy === 'elimination'}
                    onChange={() => setDraftField('searchStrategy', 'elimination')}
                  />
                  <span className="space-y-0.5">
                    <span className="block text-sm">Élimination itérative (par défaut)</span>
                    <span className="block text-xs text-muted-foreground">
                      Moteur historique : élimine une à une les tâches les plus bloquantes,
                      propose jusqu&apos;à N solutions.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="cfg-searchStrategy"
                    className="mt-0.5 h-4 w-4 accent-primary cursor-pointer"
                    checked={draft.searchStrategy === 'maxPlacement'}
                    onChange={() => setDraftField('searchStrategy', 'maxPlacement')}
                  />
                  <span className="space-y-0.5">
                    <span className="block text-sm">Placement maximal (branch-and-bound)</span>
                    <span className="block text-xs text-muted-foreground">
                      Maximise le nombre de cours placés, jamais pire que l&apos;élimination. Peut
                      prouver qu&apos;aucun résultat meilleur n&apos;est atteignable par le moteur —
                      dans ce cas, seul un relâchement de contraintes peut débloquer les cours
                      restants.
                    </span>
                  </span>
                </label>
              </div>
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

            <div className="flex items-start gap-3 pt-1">
              <input
                id="cfg-conflictOrderingSearch"
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-primary cursor-pointer"
                checked={draft.conflictOrderingSearch}
                onChange={(e) => setDraftField('conflictOrderingSearch', e.target.checked)}
              />
              <div className="space-y-0.5">
                <Label htmlFor="cfg-conflictOrderingSearch" className="cursor-pointer">
                  Priorité aux tâches en échec (Conflict Ordering Search)
                </Label>
                <p className="text-xs text-muted-foreground">
                  Le moteur retente en priorité les tâches récemment en échec. Peut améliorer
                  le choix des tâches à neutraliser sur les semaines difficiles — comparez
                  avec/sans sur votre projet.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 pt-1">
              <input
                id="cfg-conflictSetExact"
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-primary cursor-pointer"
                checked={draft.conflictSetExact}
                onChange={(e) => setDraftField('conflictSetExact', e.target.checked)}
              />
              <div className="space-y-0.5">
                <Label htmlFor="cfg-conflictSetExact" className="cursor-pointer">
                  Analyse exacte des conflits (expérimental)
                </Label>
                <p className="text-xs text-muted-foreground">
                  À chaque échec, identifie précisément les tâches responsables au lieu d&apos;une
                  estimation. À ne pas combiner avec la priorité aux tâches en échec ci-dessus :
                  la combinaison des deux donne de moins bons résultats sur les semaines difficiles.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 pt-1">
              <input
                id="cfg-postRepair"
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-primary cursor-pointer"
                checked={draft.postRepair}
                onChange={(e) => setDraftField('postRepair', e.target.checked)}
              />
              <div className="space-y-0.5">
                <Label htmlFor="cfg-postRepair" className="cursor-pointer">
                  Réparation post-résolution des neutralisées
                </Label>
                <p className="text-xs text-muted-foreground">
                  Après résolution, tente de replacer les cours neutralisés en changeant la
                  salle (ou autre ressource alternative) d&apos;un cours déjà placé. Sans effet
                  en stratégie « Placement maximal ».
                </p>
              </div>
            </div>
          </section>
          )}

          {!isCpsat && <Separator />}

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

              {!isCpsat && (
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
              )}
            </div>
            {isCpsat && (
              <p className="text-xs text-muted-foreground">
                CP-SAT prouve l&apos;optimum du nombre de cours placés (dans la limite du timeout).
              </p>
            )}

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
                <TabsTrigger value="floating" className="flex-1" disabled={isCpsat}>Flottante</TabsTrigger>
              </TabsList>
              {isCpsat && (
                <p className="text-xs text-muted-foreground pt-2">
                  Pause flottante non supportée par CP-SAT — sélectionnez « Aucune » ou « Fixe ».
                </p>
              )}

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
