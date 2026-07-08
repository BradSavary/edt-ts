'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useProjectStore } from '@/store/useProjectStore';
import { downloadJson } from '@/lib/downloadJson';

/**
 * Import/export indépendant des contraintes (JSON), pour faciliter leur réutilisation
 * d'un projet à l'autre. L'éditeur complet des contraintes reste sur /constraints ;
 * ce bloc ne fait que reprendre le pattern d'import/export déjà présent là-bas.
 */
export function ConstraintsImportExportBlock() {
  const constraints = useProjectStore((s) => s.constraints);
  const importConstraints = useProjectStore((s) => s.importConstraints);
  const [importError, setImportError] = useState('');
  const importInputRef = useRef<HTMLInputElement>(null);

  function handleExport() {
    downloadJson('contraintes.json', constraints);
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportError('');
    file.text().then((text) => {
      try {
        const parsed = JSON.parse(text) as typeof constraints;
        importConstraints(parsed);
      } catch {
        setImportError('Fichier JSON invalide ou format non reconnu.');
      }
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
      <div>
        <h2 className="text-sm font-semibold mb-0.5">Contraintes des ressources</h2>
        <p className="text-xs text-muted-foreground">
          Importez ou exportez les contraintes de disponibilité pour les réutiliser entre projets.
          L&apos;édition complète se fait dans{' '}
          <a href="/constraints" className="underline hover:text-foreground">
            le module Contraintes
          </a>.
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Button type="button" variant="outline" size="sm" onClick={handleExport}>
          Exporter les contraintes (JSON)
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => importInputRef.current?.click()}>
          Importer des contraintes (JSON)
        </Button>
        <input
          ref={importInputRef}
          type="file"
          accept=".json"
          onChange={handleImportFile}
          className="sr-only"
          aria-label="Importer un fichier de contraintes JSON"
        />
      </div>
      {importError && <p className="text-xs text-destructive">{importError}</p>}
    </div>
  );
}
