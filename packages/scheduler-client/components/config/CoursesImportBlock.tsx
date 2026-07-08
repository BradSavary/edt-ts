'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useProjectStore } from '@/store/useProjectStore';
import { usePlanningStore } from '@/store/usePlanningStore';
import { downloadJson } from '@/lib/downloadJson';
import { CoursesImportField } from './CoursesImportField';
import type { ParseCsvFullResult } from '@/lib/parseCsvCourses';
import type { CourseTaskDataWithId } from '@/lib/courseId';
import type { ResourceGroupData } from '@edt-ts/scheduler-common';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';

interface CoursesJsonFile {
  courses: CourseTaskDataWithId[];
  resources: ResourceGroupData[];
  coursesFileName?: string | null;
}

function isCoursesJsonFile(value: unknown): value is CoursesJsonFile {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.courses) && Array.isArray(v.resources);
}

export function CoursesImportBlock() {
  const allCourses = useProjectStore((s) => s.allCourses);
  const resources = useProjectStore((s) => s.resources);
  const coursesFileName = useProjectStore((s) => s.coursesFileName);
  const weekSaves = useProjectStore((s) => s.weekSaves);
  const constraints = useProjectStore((s) => s.constraints);
  const importCsvData = useProjectStore((s) => s.importCsvData);

  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [showWarning, setShowWarning] = useState(false);
  const [jsonImportError, setJsonImportError] = useState('');
  const resolveConfirmRef = useRef<((proceed: boolean) => void) | null>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  // Nombre de semaines sauvegardées dans le projet actif (une seule année, donc à plat)
  const weekSaveCount = Object.keys(weekSaves).length;

  // Nombre de ressources avec des contraintes explicites (hors Default)
  const constraintCount = Object.keys(constraints).filter(
    (k) => k !== 'Default' && constraints[k] !== null && constraints[k] !== undefined,
  ).length;

  const resourceCount = resources.reduce((acc, g) => acc + g.resources.length, 0);

  /** Passerelle commune CSV/JSON : demande confirmation avant de remplacer des cours déjà chargés. */
  function confirmReplace(file: File): Promise<boolean> {
    if (allCourses.length === 0) return Promise.resolve(true);
    setPendingFile(file);
    setShowWarning(true);
    return new Promise((resolve) => { resolveConfirmRef.current = resolve; });
  }

  function handleConfirmReplace() {
    setShowWarning(false);
    resolveConfirmRef.current?.(true);
    resolveConfirmRef.current = null;
  }

  function handleCancelReplace() {
    setShowWarning(false);
    resolveConfirmRef.current?.(false);
    resolveConfirmRef.current = null;
    setPendingFile(null);
  }

  function handleParsed(result: ParseCsvFullResult, fileName: string) {
    importCsvData(result.courses, result.resources, fileName);
    usePlanningStore.getState().handleEnforceChange({});
    setPendingFile(null);
  }

  function handleExportCourses() {
    downloadJson('cours.json', { courses: allCourses, resources, coursesFileName });
  }

  async function handleImportJsonFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setJsonImportError('');
    const proceed = await confirmReplace(file);
    if (!proceed) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      if (!isCoursesJsonFile(parsed)) throw new Error('format invalide');
      importCsvData(parsed.courses, parsed.resources, parsed.coursesFileName ?? file.name);
      usePlanningStore.getState().handleEnforceChange({});
      setPendingFile(null);
    } catch {
      setJsonImportError('Fichier JSON invalide ou format non reconnu.');
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
      <div>
        <h2 className="text-sm font-semibold mb-0.5">Import des cours</h2>
        <p className="text-xs text-muted-foreground">
          Importez votre fichier de cours pour démarrer la planification.
        </p>
      </div>

      <CoursesImportField
        initialSummary={
          allCourses.length > 0
            ? { fileName: coursesFileName ?? 'Fichier chargé', courseCount: allCourses.length, resourceCount }
            : null
        }
        onParsed={handleParsed}
        confirmReplace={confirmReplace}
      />

      <div className="flex items-center gap-2 flex-wrap">
        <Button type="button" variant="outline" size="sm" onClick={handleExportCourses} disabled={allCourses.length === 0}>
          Exporter les cours (JSON)
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => jsonInputRef.current?.click()}>
          Importer des cours (JSON)
        </Button>
        <input
          ref={jsonInputRef}
          type="file"
          accept=".json"
          onChange={handleImportJsonFile}
          className="sr-only"
          aria-label="Importer un fichier de cours JSON"
        />
      </div>
      {jsonImportError && (
        <p className="text-xs text-destructive">{jsonImportError}</p>
      )}
      <p className="text-xs text-muted-foreground">
        L&apos;export JSON permet de réutiliser des cours d&apos;un projet à l&apos;autre sans repasser par le fichier CSV source.
      </p>

      <div className="text-xs text-muted-foreground rounded-md border border-border bg-muted/30 px-3 py-2">
        Les contraintes horaires sont gérées dans{' '}
        <a href="/constraints" className="underline hover:text-foreground">
          le module Contraintes
        </a>.
      </div>

      {/* Dialog de confirmation de remplacement (déclenché par confirmReplace, CSV ou JSON) */}
      <Dialog open={showWarning} onOpenChange={(open) => { if (!open) handleCancelReplace(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remplacer les cours actuels ?</DialogTitle>
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
                  Les contraintes des ressources absentes du nouvel import seront supprimées
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
