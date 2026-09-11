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
  timeoutSeconds: string;
  lunchTab: LunchTab;
  lunchFixed: LunchFixedDraft;
  lunchFloating: LunchFloatingDraft;
  ignoreDailyLimits: boolean;
  respectCmTdTpOrder: boolean;
  minimizeTeacherDays: boolean;
  reduceTeacherHalfDays: boolean;
  compactTeacherDay: boolean;
  minimizeTeacherRoomChanges: boolean;
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
    timeoutSeconds: String(config.timeoutSeconds ?? DEFAULT_SCHEDULER_CONFIG.timeoutSeconds),
    lunchTab,
    lunchFixed,
    lunchFloating,
    ignoreDailyLimits: config.ignoreDailyLimits ?? DEFAULT_SCHEDULER_CONFIG.ignoreDailyLimits,
    respectCmTdTpOrder: config.respectCmTdTpOrder ?? DEFAULT_SCHEDULER_CONFIG.respectCmTdTpOrder,
    minimizeTeacherDays: config.minimizeTeacherDays ?? DEFAULT_SCHEDULER_CONFIG.minimizeTeacherDays,
    reduceTeacherHalfDays: config.reduceTeacherHalfDays ?? DEFAULT_SCHEDULER_CONFIG.reduceTeacherHalfDays,
    compactTeacherDay: config.compactTeacherDay ?? DEFAULT_SCHEDULER_CONFIG.compactTeacherDay,
    minimizeTeacherRoomChanges:
      config.minimizeTeacherRoomChanges ?? DEFAULT_SCHEDULER_CONFIG.minimizeTeacherRoomChanges,
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
    timeoutSeconds: Math.max(1, parseInt(draft.timeoutSeconds, 10) || DEFAULT_SCHEDULER_CONFIG.timeoutSeconds),
    lunchBreak,
    ignoreDailyLimits: draft.ignoreDailyLimits,
    respectCmTdTpOrder: draft.respectCmTdTpOrder,
    minimizeTeacherDays: draft.minimizeTeacherDays,
    reduceTeacherHalfDays: draft.reduceTeacherHalfDays,
    compactTeacherDay: draft.compactTeacherDay,
    minimizeTeacherRoomChanges: draft.minimizeTeacherRoomChanges,
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

          {/* ── Préférences (douces) ──────────────────────────────── */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Préférences (douces)
            </h3>
            <p className="text-xs text-muted-foreground">
              Appliquées au mieux, sans jamais déplacer moins de cours ni dépasser les limites des
              ressources. Combinables. Peuvent allonger le temps de calcul ; leur optimum n&apos;est
              pas toujours prouvé sous le timeout (le nombre de cours placés, lui, reste optimal).
            </p>
            <div className="flex items-start gap-3 pt-1">
              <input
                id="cfg-minimizeTeacherDays"
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-primary cursor-pointer"
                checked={draft.minimizeTeacherDays}
                onChange={(e) => setDraftField('minimizeTeacherDays', e.target.checked)}
              />
              <div className="space-y-0.5">
                <Label htmlFor="cfg-minimizeTeacherDays" className="cursor-pointer">
                  Minimiser le nombre de jours de présence d&apos;un enseignant
                </Label>
                <p className="text-xs text-muted-foreground">
                  Concentre les cours d&apos;un même enseignant sur le moins de journées possible
                  (quitte à remplir matin et après-midi d&apos;un même jour) pour lui éviter de
                  venir un jour de plus.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 pt-1">
              <input
                id="cfg-reduceTeacherHalfDays"
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-primary cursor-pointer"
                checked={draft.reduceTeacherHalfDays}
                onChange={(e) => setDraftField('reduceTeacherHalfDays', e.target.checked)}
              />
              <div className="space-y-0.5">
                <Label htmlFor="cfg-reduceTeacherHalfDays" className="cursor-pointer">
                  Réduire les demi-journées sous-utilisées d&apos;un enseignant
                </Label>
                <p className="text-xs text-muted-foreground">
                  Quand une demi-journée de présence ne contient qu&apos;un cours isolé (2h ou
                  moins), essaie de le reporter sur une autre demi-journée pour la vider, sans
                  changer le nombre de jours de présence. Indépendante de l&apos;équilibrage : peut
                  dégrader l&apos;équilibre obtenu si cela élimine une demi-journée sous-utilisée.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 pt-1">
              <input
                id="cfg-compactTeacherDay"
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-primary cursor-pointer"
                checked={draft.compactTeacherDay}
                onChange={(e) => setDraftField('compactTeacherDay', e.target.checked)}
              />
              <div className="space-y-0.5">
                <Label htmlFor="cfg-compactTeacherDay" className="cursor-pointer">
                  Compacter la journée d&apos;un enseignant
                </Label>
                <p className="text-xs text-muted-foreground">
                  Réduit tous les trous entre les cours d&apos;un enseignant sur une journée,
                  hormis la pause méridienne elle-même. S&apos;il a des cours avant ET après la
                  pause, les resserre autour de celle-ci. Sans seuil ni plafond : réduit autant
                  que possible, sans jamais rendre le planning infaisable.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 pt-1">
              <input
                id="cfg-minimizeTeacherRoomChanges"
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-primary cursor-pointer"
                checked={draft.minimizeTeacherRoomChanges}
                onChange={(e) => setDraftField('minimizeTeacherRoomChanges', e.target.checked)}
              />
              <div className="space-y-0.5">
                <Label htmlFor="cfg-minimizeTeacherRoomChanges" className="cursor-pointer">
                  Limiter les changements de salle (enseignant)
                </Label>
                <p className="text-xs text-muted-foreground">
                  Fait en sorte qu&apos;un enseignant garde la même salle d&apos;un cours au
                  suivant dans une même demi-journée, quand une salle commune existe. Confort
                  appliqué en dernier, sans jamais modifier l&apos;emploi du temps ni les autres
                  préférences.
                </p>
              </div>
            </div>
          </section>

          <Separator />

          {/* ── Limites de calcul ─────────────────────────────────────────── */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Limites de calcul
            </h3>

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
            <p className="text-xs text-muted-foreground">
              CP-SAT prouve l&apos;optimum du nombre de cours placés (dans la limite du timeout).
            </p>

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

            <div className="flex items-start gap-3 pt-1">
              <input
                id="cfg-respectCmTdTpOrder"
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-primary cursor-pointer"
                checked={draft.respectCmTdTpOrder}
                onChange={(e) => setDraftField('respectCmTdTpOrder', e.target.checked)}
              />
              <div className="space-y-0.5">
                <Label htmlFor="cfg-respectCmTdTpOrder" className="cursor-pointer">
                  Respecter l&apos;enchaînement CM puis TD puis TP
                </Label>
                <p className="text-xs text-muted-foreground">
                  Si coché (défaut), un TD ne peut être placé avant son CM, ni un TP avant son TD, pour
                  les cours d&apos;un même ensemble. Si décoché, ces dépendances ne sont pas calculées
                  et le moteur a plus de liberté de placement.
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
                <TabsTrigger value="floating" className="flex-1" disabled>Flottante</TabsTrigger>
              </TabsList>
              <p className="text-xs text-muted-foreground pt-2">
                Pause flottante non supportée par le moteur — sélectionnez « Aucune » ou « Fixe ».
              </p>

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
