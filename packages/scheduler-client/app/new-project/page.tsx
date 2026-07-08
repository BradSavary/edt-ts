'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { SchoolYearPicker } from '@/components/config/SchoolYearPicker';
import { CoursesImportField } from '@/components/config/CoursesImportField';
import { useProjectStore } from '@/store/useProjectStore';
import { createNewProject } from '@/lib/project/projectLifecycle';
import type { SchoolYearConfig } from '@/lib/schoolHolidays';
import type { ParseCsvFullResult } from '@/lib/parseCsvCourses';
import type { ConstraintsRecord } from '@/store/slices/constraintsSlice';

/**
 * Assistant de création de projet : page unique à révélation séquentielle
 * (pas de wizard générique multi-étapes — usage trop rare pour le justifier).
 * Rien n'est écrit dans le store avant le clic final "Créer le projet" :
 * `SchoolYearPicker`/`CoursesImportField` sont des composants contrôlés qui ne
 * font que reporter leurs résultats en state local via `onLoaded`/`onParsed`.
 */
export default function NewProjectPage() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [schoolYearConfig, setSchoolYearConfig] = useState<SchoolYearConfig | null>(null);
  const [parsed, setParsed] = useState<{ result: ParseCsvFullResult; fileName: string } | null>(null);
  const [constraintsDraft, setConstraintsDraft] = useState<ConstraintsRecord | null>(null);
  const [constraintsError, setConstraintsError] = useState('');
  const constraintsInputRef = useRef<HTMLInputElement>(null);

  const canCreate = name.trim().length > 0 && schoolYearConfig !== null && parsed !== null;

  function handleConstraintsFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setConstraintsError('');
    file.text().then((text) => {
      try {
        setConstraintsDraft(JSON.parse(text) as ConstraintsRecord);
      } catch {
        setConstraintsError('Fichier JSON invalide ou format non reconnu.');
      }
    });
  }

  function handleCreate() {
    if (!canCreate || !schoolYearConfig || !parsed) return;
    createNewProject(name.trim(), schoolYearConfig);
    const store = useProjectStore.getState();
    store.setCourses(parsed.result.courses, parsed.fileName);
    store.setResources(parsed.result.resources);
    if (constraintsDraft) store.importConstraints(constraintsDraft);
    router.push('/project');
  }

  return (
    <div className="max-w-2xl mx-auto p-8 flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold mb-1">Nouveau projet</h1>
        <p className="text-sm text-muted-foreground">
          Un projet regroupe l&apos;année scolaire, les cours, les contraintes et la préparation des semaines.
        </p>
      </div>

      <div className="space-y-1.5 rounded-lg border border-border bg-card p-6">
        <Label htmlFor="new-project-name">Nom du projet</Label>
        <Input
          id="new-project-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex : BUT Informatique 2026-2027"
        />
        <p className="text-xs text-muted-foreground">Utilisé comme nom de fichier lors des exports.</p>
      </div>

      <SchoolYearPicker onLoaded={setSchoolYearConfig} />

      {schoolYearConfig && (
        <div className="rounded-lg border border-border bg-card p-6">
          <CoursesImportField
            onParsed={(result, fileName) => setParsed({ result, fileName })}
          />
        </div>
      )}

      {parsed && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6">
          <div>
            <h2 className="text-sm font-semibold mb-0.5">Contraintes (optionnel)</h2>
            <p className="text-xs text-muted-foreground">
              Importez un fichier de contraintes JSON déjà exporté d&apos;un autre projet, ou passez cette étape.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => constraintsInputRef.current?.click()}>
              Importer des contraintes (JSON)
            </Button>
            {constraintsDraft && <span className="text-xs text-green-600 dark:text-green-400">✅ Contraintes chargées</span>}
          </div>
          <input
            ref={constraintsInputRef}
            type="file"
            accept=".json"
            onChange={handleConstraintsFile}
            className="sr-only"
            aria-label="Importer un fichier de contraintes JSON"
          />
          {constraintsError && <p className="text-xs text-destructive">{constraintsError}</p>}

          <Button type="button" onClick={handleCreate} disabled={!canCreate} className="self-start mt-2">
            Créer le projet
          </Button>
        </div>
      )}
    </div>
  );
}
