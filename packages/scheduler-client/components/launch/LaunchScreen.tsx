'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useProjectStore } from '@/store/useProjectStore';
import { useHydrated } from '@/hooks/useHydrated';
import { stateToProjectFile } from '@/lib/project/projectFile';
import { downloadJson, filenameTimestamp } from '@/lib/downloadJson';
import { loadProjectFromFile } from '@/lib/project/projectLifecycle';
import { ReplaceProjectWarningDialog } from './ReplaceProjectWarningDialog';

type PendingAction = { type: 'create' } | { type: 'import'; file: File };

export function LaunchScreen() {
  const mounted = useHydrated();
  const router = useRouter();
  const projectName = useProjectStore((s) => s.projectName);
  const hasProject = projectName !== null;
  const hasCourses = useProjectStore((s) => s.allCourses.length > 0);

  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [error, setError] = useState('');
  const importInputRef = useRef<HTMLInputElement>(null);

  function exportCurrentProject() {
    const file = stateToProjectFile(useProjectStore.getState());
    const safeName = file.name.replace(/[/\\:*?"<>|]/g, '').trim() || 'projet';
    downloadJson(`${safeName}_${filenameTimestamp(file.exportedAt)}.json`, file);
  }

  async function runPendingAction(action: PendingAction) {
    setError('');
    if (action.type === 'create') {
      router.push('/new-project');
      return;
    }
    try {
      await loadProjectFromFile(action.file);
      const loaded = useProjectStore.getState();
      router.push(loaded.allCourses.length > 0 ? '/planning' : '/project');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleCreateClick() {
    if (hasProject) {
      setPendingAction({ type: 'create' });
    } else {
      void runPendingAction({ type: 'create' });
    }
  }

  function handleImportFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (hasProject) {
      setPendingAction({ type: 'import', file });
    } else {
      void runPendingAction({ type: 'import', file });
    }
  }

  function handleContinue() {
    router.push(hasCourses ? '/planning' : '/project');
  }

  function handleExportAndContinue() {
    exportCurrentProject();
    const action = pendingAction;
    setPendingAction(null);
    if (action) void runPendingAction(action);
  }

  function handleContinueWithoutSaving() {
    const action = pendingAction;
    setPendingAction(null);
    if (action) void runPendingAction(action);
  }

  function handleCancelWarning() {
    setPendingAction(null);
  }

  if (!mounted) return null;

  return (
    <div className="max-w-lg mx-auto p-8 flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold mb-1">EDT-TS</h1>
        <p className="text-sm text-muted-foreground">
          Choisissez comment démarrer : un projet regroupe l&apos;année scolaire, les cours,
          les contraintes et la préparation des semaines.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-2">
          <span className="text-red-600 dark:text-red-400 text-xs shrink-0">❌</span>
          <span className="text-xs text-red-700 dark:text-red-300">{error}</span>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {hasProject && (
          <Button type="button" size="lg" className="justify-start h-auto py-4" onClick={handleContinue}>
            <div className="text-left">
              <div className="font-medium">Continuer sur le projet courant</div>
              <div className="text-xs font-normal opacity-80">{projectName}</div>
            </div>
          </Button>
        )}

        <Button type="button" size="lg" variant="outline" className="justify-start h-auto py-4" onClick={handleCreateClick}>
          <div className="text-left">
            <div className="font-medium">Créer un nouveau projet</div>
            <div className="text-xs font-normal text-muted-foreground">Nom, année scolaire, import CSV des cours</div>
          </div>
        </Button>

        <Button
          type="button"
          size="lg"
          variant="outline"
          className="justify-start h-auto py-4"
          onClick={() => importInputRef.current?.click()}
        >
          <div className="text-left">
            <div className="font-medium">Importer un projet existant</div>
            <div className="text-xs font-normal text-muted-foreground">Depuis un fichier .json précédemment exporté</div>
          </div>
        </Button>
        <input
          ref={importInputRef}
          type="file"
          accept=".json"
          onChange={handleImportFileChange}
          className="sr-only"
          aria-label="Importer un fichier de projet JSON"
        />
      </div>

      <ReplaceProjectWarningDialog
        open={pendingAction !== null}
        projectName={projectName}
        onExportAndContinue={handleExportAndContinue}
        onContinueWithoutSaving={handleContinueWithoutSaving}
        onCancel={handleCancelWarning}
      />
    </div>
  );
}
