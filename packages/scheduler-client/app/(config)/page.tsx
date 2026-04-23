'use client';

import { useState, useEffect } from 'react';
import { parseCsvFull } from '@/lib/parseCsvCourses';
import { useSchedulerStore } from '@/store/useSchedulerStore';
import { usePlanningStore } from '@/store/usePlanningStore';
import { Label } from '@/components/ui/label';
import { YEAR_COLOR_PALETTE, getEventColors, type YearColorConfig } from '@/lib/yearColors';
import { SchoolYearBlock } from '@/components/config/SchoolYearBlock';

export default function ConfigPage() {
  const allCourses = useSchedulerStore((s) => s.allCourses);
  const resources = useSchedulerStore((s) => s.resources);
  const coursesFileName = useSchedulerStore((s) => s.coursesFileName);
  const yearColorConfig = useSchedulerStore((s) => s.yearColorConfig);
  const setYearColorConfig = useSchedulerStore((s) => s.setYearColorConfig);

  const [coursesCsvFile, setCoursesCsvFile] = useState<File | null>(null);
  const [importStatus, setImportStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  useEffect(() => {
    if (!coursesCsvFile) return;
    let cancelled = false;
    coursesCsvFile.text().then((text) => {
      if (cancelled) return;
      setImportStatus('loading');
      try {
        const { courses, resources: extractedResources, resourceWeeks } = parseCsvFull(text);
        useSchedulerStore.getState().setCourses(courses, coursesCsvFile.name);
        useSchedulerStore.getState().setResources(extractedResources);
        useSchedulerStore.getState().setResourceWeeks(resourceWeeks);
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

  const resourceCount = resources.reduce((acc, g) => acc + g.resources.length, 0);

  const YEAR_LABELS: { key: keyof YearColorConfig; label: string }[] = [
    { key: 'but1', label: 'BUT 1' },
    { key: 'but2', label: 'BUT 2' },
    { key: 'but3', label: 'BUT 3' },
  ];

  return (
    <div className="max-w-5xl mx-auto p-8 flex flex-row gap-8 items-start flex-wrap">
      

      <div className="flex flex-col gap-6 rounded-lg border border-border bg-card p-6">
        <div>
        <h1 className="text-xl font-bold mb-1">Configuration</h1>
        <p className="text-sm text-muted-foreground">
          Importez votre fichier de cours pour démarrer la planification.
        </p>
      </div>
        {/* Cours CSV */}
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
            type="file"
            accept=".csv"
            onChange={(e) => setCoursesCsvFile(e.target.files?.[0] ?? null)}
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
      </div>

      {/* Thème couleur par année */}
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
        <div>
          <h2 className="text-sm font-semibold mb-0.5">Thème couleur par année de BUT</h2>
          <p className="text-xs text-muted-foreground">
            Choisissez une couleur par année.
          </p>
        </div>

        {YEAR_LABELS.map(({ key, label }) => {
          const base = yearColorConfig[key];
          const cmColors = getEventColors(key === 'but1' ? 0 : key === 'but2' ? 1 : 2, 'CM', yearColorConfig);
          const tdColors = getEventColors(key === 'but1' ? 0 : key === 'but2' ? 1 : 2, 'TD', yearColorConfig);
          const tpColors = getEventColors(key === 'but1' ? 0 : key === 'but2' ? 1 : 2, 'TP', yearColorConfig);
          return (
            <div key={key} className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium w-12 shrink-0">{label}</span>
                {/* Aperçu CM / TD / TP */}
                <div className="flex gap-1">
                  {[
                    { type: 'CM', colors: cmColors },
                    { type: 'TD', colors: tdColors },
                    { type: 'TP', colors: tpColors },
                  ].map(({ type, colors }) => (
                    <span
                      key={type}
                      className="px-2 py-0.5 rounded text-[10px] font-medium border"
                      style={{
                        backgroundColor: colors.backgroundColor,
                        borderColor: colors.borderColor,
                        color: colors.textColor,
                      }}
                    >
                      {type}
                    </span>
                  ))}
                </div>
              </div>
              {/* Palette de sélection */}
              <div className="flex flex-wrap gap-1.5 pl-12">
                {YEAR_COLOR_PALETTE.map((color) => (
                  <button
                    key={color.value}
                    title={color.label}
                    onClick={() => setYearColorConfig({ ...yearColorConfig, [key]: color.value })}
                    className="w-6 h-6 rounded-full border-2 transition-all hover:scale-110 focus:outline-none focus:ring-2 focus:ring-ring"
                    style={{
                      backgroundColor: color.value,
                      borderColor: base === color.value ? '#1e293b' : 'transparent',
                      boxShadow: base === color.value ? '0 0 0 2px white, 0 0 0 3px #1e293b' : undefined,
                    }}
                    aria-label={`${color.label} pour ${label}`}
                    aria-pressed={base === color.value}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <SchoolYearBlock />
    </div>
  );
}
