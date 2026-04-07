'use client';

import { useState, useEffect } from 'react';
import type { ResourceGroupData } from '@edt-ts/scheduler-common';
import { parseCsvCoursesAll, extractResourceWeeks } from '@/lib/parseCsvCourses';
import { useSchedulerStore } from '@/store/useSchedulerStore';
import { usePlanningStore } from '@/store/usePlanningStore';
import { Label } from '@/components/ui/label';

export default function ConfigPage() {
  const allCourses = useSchedulerStore((s) => s.allCourses);
  const resources = useSchedulerStore((s) => s.resources);
  const resourcesFileName = useSchedulerStore((s) => s.resourcesFileName);
  const coursesFileName = useSchedulerStore((s) => s.coursesFileName);

  const [resourcesFile, setResourcesFile] = useState<File | null>(null);
  const [coursesCsvFile, setCoursesCsvFile] = useState<File | null>(null);

  useEffect(() => {
    if (!resourcesFile) return;
    resourcesFile.text().then((text) => {
      try {
        const data = JSON.parse(text) as ResourceGroupData[];
        if (Array.isArray(data)) useSchedulerStore.getState().setResources(data, resourcesFile.name);
      } catch { useSchedulerStore.getState().setResources([], undefined); }
    });
  }, [resourcesFile]);

  useEffect(() => {
    if (!coursesCsvFile) return;
    coursesCsvFile.text().then((text) => {
      try {
        const allParsed = parseCsvCoursesAll(text);
        useSchedulerStore.getState().setCourses(allParsed, coursesCsvFile.name);
        useSchedulerStore.getState().setResourceWeeks(extractResourceWeeks(text));
        usePlanningStore.getState().handleEnforceChange({});
      } catch { useSchedulerStore.getState().setCourses([], undefined); }
    });
  }, [coursesCsvFile]);

  const resourceCount = resources.reduce((acc, g) => acc + g.resources.length, 0);

  return (
    <div className="max-w-lg mx-auto p-8 flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-bold mb-1">Configuration</h1>
        <p className="text-sm text-muted-foreground">
          Importez vos fichiers de données avant de passer à la planification.
        </p>
      </div>

      <div className="flex flex-col gap-6 rounded-lg border border-border bg-card p-6">

        {/* Ressources */}
        <div className="space-y-1.5">
          <Label>
            Ressources <span className="text-muted-foreground font-normal">(JSON)</span>
          </Label>
          {resources.length > 0 && !resourcesFile && (
            <div className="flex items-center gap-2 rounded-md border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 px-3 py-2">
              <span className="text-green-600 dark:text-green-400 text-xs shrink-0">✅</span>
              <span className="text-xs text-green-700 dark:text-green-300 truncate font-medium">
                {resourcesFileName ?? 'Fichier chargé'}
              </span>
              <span className="text-xs text-green-600 dark:text-green-400 shrink-0 ml-auto">
                {resourceCount} ressources
              </span>
            </div>
          )}
          <input
            type="file"
            accept=".json"
            onChange={(e) => setResourcesFile(e.target.files?.[0] ?? null)}
            className="w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-secondary file:text-secondary-foreground hover:file:bg-secondary/80"
          />
          {resources.length > 0 && !resourcesFile && (
            <p className="text-xs text-muted-foreground">Sélectionnez un nouveau fichier pour remplacer.</p>
          )}
        </div>

        {/* Cours */}
        <div className="space-y-1.5">
          <Label>
            Cours <span className="text-muted-foreground font-normal">(CSV)</span>
          </Label>
          {allCourses.length > 0 && !coursesCsvFile && (
            <div className="flex items-center gap-2 rounded-md border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 px-3 py-2">
              <span className="text-green-600 dark:text-green-400 text-xs shrink-0">✅</span>
              <span className="text-xs text-green-700 dark:text-green-300 truncate font-medium">
                {coursesFileName ?? 'Fichier chargé'}
              </span>
              <span className="text-xs text-green-600 dark:text-green-400 shrink-0 ml-auto">
                {allCourses.length} cours
              </span>
            </div>
          )}
          <input
            type="file"
            accept=".csv"
            onChange={(e) => setCoursesCsvFile(e.target.files?.[0] ?? null)}
            className="w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-secondary file:text-secondary-foreground hover:file:bg-secondary/80"
          />
          {allCourses.length > 0 && !coursesCsvFile && (
            <p className="text-xs text-muted-foreground">Sélectionnez un nouveau fichier pour remplacer.</p>
          )}
        </div>

        <div className="text-xs text-muted-foreground rounded-md border border-border bg-muted/30 px-3 py-2">
          Les contraintes horaires sont gérées dans{' '}
          <a href="/constraints" className="underline hover:text-foreground">
            le module Contraintes
          </a>.
        </div>
      </div>
    </div>
  );
}
