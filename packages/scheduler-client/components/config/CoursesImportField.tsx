'use client';

import { useState, useEffect, useRef } from 'react';
import { Label } from '@/components/ui/label';
import { parseCsvFull, type ParseCsvFullResult } from '@/lib/parseCsvCourses';

type ImportStatus = 'idle' | 'loading' | 'success' | 'error';

interface CoursesSummary {
  fileName: string;
  courseCount: number;
  resourceCount: number;
}

interface CoursesImportFieldProps {
  /** Résumé d'un import déjà effectué, affiché tant qu'aucun nouveau fichier n'a été choisi (ex: projet existant). */
  initialSummary?: CoursesSummary | null;
  /** Appelé avec le résultat du parsing dès qu'un fichier est traité avec succès. */
  onParsed: (result: ParseCsvFullResult, fileName: string) => void;
  /**
   * Appelé avant de traiter un fichier sélectionné ; résoudre `false` annule l'import
   * (ex: dialog de confirmation avant remplacement). Absent = toujours autorisé
   * (premier import, rien à écraser — cas de l'assistant de création de projet).
   */
  confirmReplace?: (file: File) => Promise<boolean>;
}

/**
 * Composant contrôlé : ne lit/n'écrit jamais un store directement.
 * Extrait de l'ancien `CoursesImportBlock.tsx` pour être réutilisable à la fois dans
 * l'assistant de création de projet (état local, rien n'est encore persisté) et
 * dans les paramètres du projet actif (`CoursesImportBlock`, qui ajoute le dialog
 * d'avertissement de remplacement via `confirmReplace`).
 */
export function CoursesImportField({ initialSummary = null, onParsed, confirmReplace }: CoursesImportFieldProps) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<ImportStatus>('idle');
  const [summary, setSummary] = useState<CoursesSummary | null>(initialSummary);

  // Ref plutôt que dépendance d'effet : évite de re-déclencher le parsing quand
  // le parent re-render avec une nouvelle référence de callback (onParsed change
  // typiquement à chaque frappe dans le nom du projet, sans rapport avec le fichier).
  const onParsedRef = useRef(onParsed);
  useEffect(() => { onParsedRef.current = onParsed; }, [onParsed]);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    file.text().then((text) => {
      if (cancelled) return;
      try {
        const result = parseCsvFull(text);
        const resourceCount = result.resources.reduce((acc, g) => acc + g.resources.length, 0);
        setSummary({ fileName: file.name, courseCount: result.courses.length, resourceCount });
        onParsedRef.current(result, file.name);
        setStatus('success');
      } catch {
        setStatus('error');
      }
    });
    return () => { cancelled = true; };
  }, [file]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ''; // permet de re-sélectionner le même fichier
    if (!f) return;
    if (confirmReplace) {
      const proceed = await confirmReplace(f);
      if (!proceed) return;
    }
    setStatus('loading');
    setFile(f);
  }

  return (
    <div className="space-y-1.5">
      <Label>
        Cours <span className="text-muted-foreground font-normal">(CSV)</span>
      </Label>

      {status === 'loading' && (
        <div className="flex items-center gap-2 rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-3 py-2">
          <span className="text-blue-600 dark:text-blue-400 text-xs shrink-0">⏳</span>
          <span className="text-xs text-blue-700 dark:text-blue-300">Chargement en cours…</span>
        </div>
      )}
      {status === 'error' && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-2">
          <span className="text-red-600 dark:text-red-400 text-xs shrink-0">❌</span>
          <span className="text-xs text-red-700 dark:text-red-300">Erreur lors du chargement du fichier CSV.</span>
        </div>
      )}
      {status !== 'loading' && status !== 'error' && summary && (
        <div className="flex items-center gap-2 rounded-md border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 px-3 py-2">
          <span className="text-green-600 dark:text-green-400 text-xs shrink-0">✅</span>
          <span className="text-xs text-green-700 dark:text-green-300 truncate font-medium">
            {summary.fileName}
          </span>
          <span className="text-xs text-green-600 dark:text-green-400 shrink-0 ml-auto">
            {summary.courseCount} cours · {summary.resourceCount} ressources
          </span>
        </div>
      )}

      <input
        type="file"
        accept=".csv"
        onChange={handleFileChange}
        className="w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-secondary file:text-secondary-foreground hover:file:bg-secondary/80"
      />
      {status === 'idle' && summary && (
        <p className="text-xs text-muted-foreground">Sélectionnez un nouveau fichier pour remplacer.</p>
      )}
    </div>
  );
}

export type { CoursesSummary };
