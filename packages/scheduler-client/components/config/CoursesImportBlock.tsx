'use client';

import { useState, useEffect, useRef } from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { parseCsvFull } from '@/lib/parseCsvCourses';
import { useSchedulerStore } from '@/store/useSchedulerStore';
import { usePlanningStore } from '@/store/usePlanningStore';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';

export function CoursesImportBlock() {
  const allCourses     = useSchedulerStore((s) => s.allCourses);
  const resources      = useSchedulerStore((s) => s.resources);
  const coursesFileName = useSchedulerStore((s) => s.coursesFileName);
  const weekSaves      = useSchedulerStore((s) => s.weekSaves);
  const constraints    = useSchedulerStore((s) => s.constraints);

  const [coursesCsvFile, setCoursesCsvFile]   = useState<File | null>(null);
  const [pendingFile, setPendingFile]         = useState<File | null>(null);
  const [showWarning, setShowWarning]         = useState(false);
  const [importStatus, setImportStatus]       = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Nombre de semaines sauvegardées
  const weekSaveCount = Object.values(weekSaves).reduce(
    (acc, yearSaves) => acc + Object.keys(yearSaves).length, 0,
  );

  // Nombre de ressources avec des contraintes explicites (hors Default)
  const constraintCount = Object.keys(constraints).filter(
    (k) => k !== 'Default' && constraints[k] !== null && constraints[k] !== undefined,
  ).length;

  useEffect(() => {
    if (!coursesCsvFile) return;
    let cancelled = false;
    coursesCsvFile.text().then((text) => {
      if (cancelled) return;
      setImportStatus('loading');
      try {
        const { courses, resources: extractedResources } = parseCsvFull(text);
        useSchedulerStore.getState().setCourses(courses, coursesCsvFile.name);
        useSchedulerStore.getState().setResources(extractedResources);
        useSchedulerStore.getState().clearAllWeekSaves();
        const allNewIds = extractedResources.flatMap((g) => g.resources.map((r) => r.id));
        useSchedulerStore.getState().pruneConstraints(allNewIds);
        usePlanningStore.getState().handleEnforceChange({});
        setImportStatus('success');
      } catch {
        useSchedulerStore.getState().setCourses([], undefined);
        useSchedulerStore.getState().setResources([]);
        setImportStatus('error');
      }
    });
    return () => { cancelled = true; };
  }, [coursesCsvFile]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Si un CSV est déjà chargé, afficher l'avertissement avant d'importer
    if (allCourses.length > 0) {
      setPendingFile(file);
      setShowWarning(true);
    } else {
      setCoursesCsvFile(file);
    }
    // Réinitialiser l'input pour permettre de re-sélectionner le même fichier
    e.target.value = '';
  }

  function handleConfirmReplace() {
    setShowWarning(false);
    setCoursesCsvFile(pendingFile);
    setPendingFile(null);
  }

  function handleCancelReplace() {
    setShowWarning(false);
    setPendingFile(null);
  }

  const resourceCount = resources.reduce((acc, g) => acc + g.resources.length, 0);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
      <div>
        <h2 className="text-sm font-semibold mb-0.5">Import des cours</h2>
        <p className="text-xs text-muted-foreground">
          Importez votre fichier de cours pour démarrer la planification.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>
          Cours <span className="text-muted-foreground font-normal">(CSV)</span>
        </Label>

        {importStatus === 'loading' && (
          <div className="flex items-center gap-2 rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-3 py-2">
            <span className="text-blue-600 dark:text-blue-400 text-xs shrink-0">⏳</span>
            <span className="text-xs text-blue-700 dark:text-blue-300">Chargement en cours…</span>
          </div>
        )}
        {importStatus === 'success' && (
          <div className="flex items-center gap-2 rounded-md border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 px-3 py-2">
            <span className="text-green-600 dark:text-green-400 text-xs shrink-0">✅</span>
            <span className="text-xs text-green-700 dark:text-green-300 truncate font-medium">
              {coursesCsvFile?.name ?? coursesFileName ?? 'Fichier chargé'}
            </span>
            <span className="text-xs text-green-600 dark:text-green-400 shrink-0 ml-auto">
              {allCourses.length} cours · {resourceCount} ressources
            </span>
          </div>
        )}
        {importStatus === 'error' && (
          <div className="flex items-center gap-2 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-2">
            <span className="text-red-600 dark:text-red-400 text-xs shrink-0">❌</span>
            <span className="text-xs text-red-700 dark:text-red-300">Erreur lors du chargement du fichier CSV.</span>
          </div>
        )}
        {importStatus === 'idle' && allCourses.length > 0 && (
          <div className="flex items-center gap-2 rounded-md border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 px-3 py-2">
            <span className="text-green-600 dark:text-green-400 text-xs shrink-0">✅</span>
            <span className="text-xs text-green-700 dark:text-green-300 truncate font-medium">
              {coursesFileName ?? 'Fichier chargé'}
            </span>
            <span className="text-xs text-green-600 dark:text-green-400 shrink-0 ml-auto">
              {allCourses.length} cours · {resourceCount} ressources
            </span>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={handleFileChange}
          className="w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-secondary file:text-secondary-foreground hover:file:bg-secondary/80"
        />
        {importStatus === 'idle' && allCourses.length > 0 && (
          <p className="text-xs text-muted-foreground">Sélectionnez un nouveau fichier pour remplacer.</p>
        )}
      </div>

      <div className="text-xs text-muted-foreground rounded-md border border-border bg-muted/30 px-3 py-2">
        Les contraintes horaires sont gérées dans{' '}
        <a href="/constraints" className="underline hover:text-foreground">
          le module Contraintes
        </a>.
      </div>

      {/* Dialog de confirmation de remplacement */}
      <Dialog open={showWarning} onOpenChange={(open) => { if (!open) handleCancelReplace(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remplacer le fichier CSV ?</DialogTitle>
            <DialogDescription>
              Remplacer <span className="font-medium text-foreground">{coursesFileName}</span> par{' '}
              <span className="font-medium text-foreground">{pendingFile?.name}</span> effacera les données suivantes :
            </DialogDescription>
          </DialogHeader>

          <ul className="text-sm space-y-1.5 my-1">
            {weekSaveCount > 0 && (
              <li className="flex items-start gap-2">
                <span className="text-amber-500 shrink-0 mt-0.5">⚠</span>
                <span>
                  <span className="font-medium">{weekSaveCount} semaine{weekSaveCount > 1 ? 's' : ''} sauvegardée{weekSaveCount > 1 ? 's' : ''}</span>
                  {' '}(préparations, cours imposés, zones bloquées)
                </span>
              </li>
            )}
            {constraintCount > 0 && (
              <li className="flex items-start gap-2">
                <span className="text-amber-500 shrink-0 mt-0.5">⚠</span>
                <span>
                  Les contraintes des ressources absentes du nouveau CSV seront supprimées
                  {' '}(<span className="font-medium">{constraintCount} ressource{constraintCount > 1 ? 's' : ''}</span> avec contraintes actuellement)
                </span>
              </li>
            )}
            <li className="flex items-start gap-2">
              <span className="text-amber-500 shrink-0 mt-0.5">⚠</span>
              <span>Résultats de planification et cours imposés en session</span>
            </li>
          </ul>

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={handleCancelReplace}>
              Annuler
            </Button>
            <Button variant="destructive" size="sm" onClick={handleConfirmReplace}>
              Remplacer quand même
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
