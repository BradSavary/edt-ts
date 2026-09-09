'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { CsvMergeSummary } from '@/lib/csvMerge';

interface CsvMergeChoiceDialogProps {
  open: boolean;
  currentFileName: string | null;
  newFileName: string;
  summary: CsvMergeSummary;
  /** Nombre de semaines préparées — pour le rappel de ce que "Tout remplacer" réinitialise. */
  weekSaveCount: number;
  /** Nombre de ressources avec contraintes explicites — idem. */
  constraintCount: number;
  onReplace: () => void;
  onMerge: () => void;
  onCancel: () => void;
}

/** « 35, 36, 37, 41 » → « S35-37, S41 ». Entrée supposée triée croissante et sans doublon. */
function formatWeekList(weeks: number[]): string {
  const ranges: string[] = [];
  for (let i = 0; i < weeks.length; ) {
    let j = i;
    while (j + 1 < weeks.length && weeks[j + 1] === weeks[j] + 1) j++;
    ranges.push(i === j ? `S${weeks[i]}` : `S${weeks[i]}-${weeks[j]}`);
    i = j + 1;
  }
  return ranges.join(', ');
}

/**
 * Choix entre "Tout remplacer" (comportement historique) et "Fusionner" (diff intelligent,
 * voir lib/csvMerge.ts), avec un aperçu du diff avant confirmation de la fusion.
 * Composant purement présentationnel : toute la logique de calcul du diff et d'application
 * vit dans `CoursesImportBlock.tsx`/`store/useProjectStore.ts`.
 */
export function CsvMergeChoiceDialog({
  open,
  currentFileName,
  newFileName,
  summary,
  weekSaveCount,
  constraintCount,
  onReplace,
  onMerge,
  onCancel,
}: CsvMergeChoiceDialogProps) {
  const [mode, setMode] = useState<'choice' | 'mergePreview'>('choice');

  function handleOpenChange(next: boolean) {
    if (!next) {
      setMode('choice');
      onCancel();
    }
  }

  function handleCancel() {
    setMode('choice');
    onCancel();
  }

  const hasResourceChanges = summary.resourcesAdded.length > 0 || summary.resourcesNewlyUnused.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        {mode === 'choice' ? (
          <>
            <DialogHeader>
              <DialogTitle>Comment importer ce fichier ?</DialogTitle>
              <DialogDescription>
                Remplacer <span className="font-medium text-foreground">{currentFileName}</span> par{' '}
                <span className="font-medium text-foreground">{newFileName}</span>.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3 py-2">
              <button
                type="button"
                onClick={() => setMode('mergePreview')}
                className="text-left rounded-md border border-primary/40 bg-primary/5 p-3 hover:bg-primary/10 transition-colors"
              >
                <div className="text-sm font-semibold">Fusionner (recommandé)</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Conserve les cours inchangés (avec leurs impositions/groupes), ajoute les nouveaux,
                  retire ceux disparus — {summary.totalKept} conservé{summary.totalKept !== 1 ? 's' : ''},{' '}
                  {summary.totalAdded} ajouté{summary.totalAdded !== 1 ? 's' : ''},{' '}
                  {summary.totalRemoved} supprimé{summary.totalRemoved !== 1 ? 's' : ''}.
                  {summary.untouchedWeeks.length > 0 && (
                    <> N&apos;affecte que les {summary.scopeWeeks.length} semaine{summary.scopeWeeks.length !== 1 ? 's' : ''} de ce fichier ;
                    les {summary.untouchedWeeks.length} autre{summary.untouchedWeeks.length !== 1 ? 's' : ''} restent intactes.</>
                  )}
                </div>
              </button>

              <button
                type="button"
                onClick={onReplace}
                className="text-left rounded-md border border-border p-3 hover:bg-muted/50 transition-colors"
              >
                <div className="text-sm font-semibold">Tout remplacer</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Repart de zéro avec ce fichier
                  {weekSaveCount > 0 && (
                    <> — réinitialise les {weekSaveCount} semaine{weekSaveCount !== 1 ? 's' : ''} préparée{weekSaveCount !== 1 ? 's' : ''} (groupes, impositions, zones)</>
                  )}
                  {constraintCount > 0 && <>, retire les contraintes des ressources absentes</>}.
                  {summary.untouchedWeeks.length > 0 && (
                    <> Y compris les {summary.untouchedWeeks.length} semaine{summary.untouchedWeeks.length !== 1 ? 's' : ''} absente{summary.untouchedWeeks.length !== 1 ? 's' : ''} de ce fichier, dont les cours seront perdus.</>
                  )}
                </div>
              </button>
            </div>

            <DialogFooter>
              <Button variant="outline" size="sm" onClick={handleCancel}>Annuler</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Aperçu de la fusion</DialogTitle>
              <DialogDescription>Vérifiez les changements avant de confirmer.</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3 py-2 max-h-80 overflow-y-auto text-sm">
              {summary.perWeek.length === 0 ? (
                <p className="text-muted-foreground text-xs italic">Aucun changement de cours détecté.</p>
              ) : (
                <ul className="space-y-1">
                  {summary.perWeek.map((w) => (
                    <li key={w.week} className="flex items-center justify-between text-xs">
                      <span className="font-medium">Semaine {w.week}</span>
                      <span className="text-muted-foreground">
                        {w.kept} conservé{w.kept !== 1 ? 's' : ''}
                        {w.added > 0 && <span className="text-emerald-600 dark:text-emerald-400"> · +{w.added}</span>}
                        {w.removed > 0 && <span className="text-destructive"> · -{w.removed}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {summary.untouchedWeeks.length > 0 && (
                <p className="text-xs text-muted-foreground border-t border-border pt-2">
                  <span className="font-medium text-foreground">{summary.untouchedWeeks.length} semaine{summary.untouchedWeeks.length !== 1 ? 's' : ''}</span>
                  {' '}absente{summary.untouchedWeeks.length !== 1 ? 's' : ''} de ce fichier ({formatWeekList(summary.untouchedWeeks)}) —
                  cours et préparation conservés tels quels.
                </p>
              )}

              {hasResourceChanges && (
                <div className="border-t border-border pt-2 space-y-1">
                  {summary.resourcesAdded.length > 0 && (
                    <p className="text-xs">
                      <span className="font-medium">{summary.resourcesAdded.length}</span> nouvelle{summary.resourcesAdded.length !== 1 ? 's' : ''} ressource{summary.resourcesAdded.length !== 1 ? 's' : ''}
                      {' '}({summary.resourcesAdded.map((r) => r.id).join(', ')})
                    </p>
                  )}
                  {summary.resourcesNewlyUnused.length > 0 && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      <span className="font-medium">{summary.resourcesNewlyUnused.length}</span> ressource{summary.resourcesNewlyUnused.length !== 1 ? 's' : ''} devenue{summary.resourcesNewlyUnused.length !== 1 ? 's' : ''} inutilisée{summary.resourcesNewlyUnused.length !== 1 ? 's' : ''}
                      {' '}({summary.resourcesNewlyUnused.map((r) => r.id).join(', ')}) — conservée{summary.resourcesNewlyUnused.length !== 1 ? 's' : ''} avec leurs contraintes
                    </p>
                  )}
                </div>
              )}
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" size="sm" onClick={() => setMode('choice')}>Retour</Button>
              <Button size="sm" onClick={onMerge}>Confirmer la fusion</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
