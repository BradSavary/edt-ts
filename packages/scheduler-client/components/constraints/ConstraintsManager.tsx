'use client';

import { useState, useEffect, useRef } from 'react';
import type { ConstraintsData, ResourceConstraints, TimeSlot } from '@edt-ts/scheduler-common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import {
  loadConstraints,
  saveConstraints,
  exportAsJSON,
  detectResourceType,
  normalizeToRC,
  loadResourceWeeks,
  type ResourceType,
  RESOURCE_TYPE_LABELS,
} from '@/lib/constraintsStorage';
import { ResourceConstraintEditor } from './ResourceConstraintEditor';
import { AddResourceModal } from './AddResourceModal';

// Internal type that accepts null values (matching the actual JSON format)
type ConstraintValue = ResourceConstraints | TimeSlot[] | null | undefined;
type ConstraintsStore = Record<string, ConstraintValue> & { Default?: TimeSlot[] };

const RESOURCE_TABS: { value: ResourceType; label: string }[] = [
  { value: 'teacher', label: 'Enseignants' },
  { value: 'room', label: 'Salles' },
  { value: 'group', label: 'Groupes' },
  { value: 'other', label: 'Autres' },
];

export function ConstraintsManager() {
  const [constraints, setConstraints] = useState<ConstraintsStore>({});
  const [initialized, setInitialized] = useState(false);
  const [resourceWeeks, setResourceWeeks] = useState<Record<string, number[]>>({});
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<ResourceType>('teacher');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [importError, setImportError] = useState('');
  const [saveNotice, setSaveNotice] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load from localStorage on mount
  useEffect(() => {
    const stored = loadConstraints();
    setConstraints((stored as ConstraintsStore | null) ?? {});
    setResourceWeeks(loadResourceWeeks());
    setInitialized(true);
  }, []);

  // Save to localStorage whenever constraints change (not on initial empty load)
  useEffect(() => {
    if (!initialized) return;
    saveConstraints(constraints as ConstraintsData);
    setSaveNotice(true);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => setSaveNotice(false), 2000);
  }, [constraints, initialized]);

  function handleResourceChange(id: string, newValue: ResourceConstraints | null) {
    setConstraints((prev) => ({ ...prev, [id]: newValue }));
  }

  function handleResourceDelete(id: string) {
    setConstraints((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (selectedId === id) setSelectedId(null);
  }

  function handleAddResource(id: string) {
    setConstraints((prev) => ({ ...prev, [id]: null }));
    setSelectedId(id);
    setActiveTab(detectResourceType(id));
  }

  function handleDefaultChange(newValue: ResourceConstraints | null) {
    setConstraints((prev) => ({
      ...prev,
      Default: newValue?.default ?? [],
    }));
  }

  function handleExport() {
    const json = exportAsJSON(constraints as ConstraintsData);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'contraintes.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError('');
    file.text().then((text) => {
      try {
        const parsed = JSON.parse(text) as ConstraintsStore;
        setConstraints(parsed);
        setSelectedId(null);
      } catch {
        setImportError('Fichier JSON invalide ou format non reconnu.');
      }
    });
    e.target.value = '';
  }

  // Group resource keys by detected type (excluding "Default")
  const allIds = Object.keys(constraints).filter((k) => k !== 'Default');
  const byType: Record<ResourceType, string[]> = {
    teacher: [],
    room: [],
    group: [],
    other: [],
  };
  for (const id of allIds) {
    byType[detectResourceType(id)].push(id);
  }
  for (const t of Object.keys(byType) as ResourceType[]) {
    byType[t].sort((a, b) => a.localeCompare(b, 'fr'));
  }

  const defaultRC = normalizeToRC(constraints.Default ?? []);

  function filteredIds(ids: string[]): string[] {
    const q = search.trim().toLowerCase();
    if (!q) return ids;
    return ids.filter((id) => id.toLowerCase().includes(q));
  }

  function getStatusBadge(id: string) {
    const v = constraints[id];
    if (v == null) return { label: 'Aucune', className: 'text-muted-foreground/60 italic' };
    if (typeof v === 'object' && !Array.isArray(v)) {
      const weeks = Object.keys(v).filter((k) => k !== 'default').length;
      if (weeks > 0)
        return {
          label: `${weeks} sem.`,
          className: 'text-emerald-600 dark:text-emerald-400',
        };
      return { label: 'Défaut', className: 'text-blue-600 dark:text-blue-400' };
    }
    return { label: 'Défini', className: 'text-blue-600 dark:text-blue-400' };
  }

  const isDefaultSelected = selectedId === 'Default';
  const selectedValue =
    selectedId && selectedId !== 'Default'
      ? normalizeToRC(constraints[selectedId])
      : null;

  return (
    <div className="flex flex-col h-full">
      {/* Top header */}
      <div className="shrink-0 border-b border-border bg-card px-6 py-3 flex items-center gap-4 flex-wrap">
        <h1 className="text-lg font-semibold mr-auto">Gestion des contraintes</h1>
        {saveNotice && (
          <span className="text-xs text-muted-foreground">Sauvegardé ✓</span>
        )}
        <Button variant="outline" size="sm" onClick={handleExport}>
          Exporter JSON
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => importInputRef.current?.click()}
        >
          Importer JSON
        </Button>
        <input
          ref={importInputRef}
          type="file"
          accept=".json"
          onChange={handleImportFile}
          className="sr-only"
          aria-label="Importer un fichier de contraintes JSON"
        />
        <Button size="sm" onClick={() => setShowAddModal(true)}>
          + Ressource
        </Button>
      </div>

      {importError && (
        <Alert className="shrink-0 rounded-none border-x-0 border-t-0 border-destructive/30 bg-destructive/10 text-destructive py-2 px-6">
          <AlertDescription className="text-sm">{importError}</AlertDescription>
        </Alert>
      )}

      {/* Two-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar — resource navigator */}
        <aside className="w-80 shrink-0 border-r border-border flex flex-col overflow-hidden bg-card">
          {/* Search */}
          <div className="p-3 border-b border-border">
            <Input
              type="search"
              placeholder="Rechercher…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-sm"
            />
          </div>

          {/* Default entry */}
          <button
            type="button"
            onClick={() => setSelectedId('Default')}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 border-b border-border text-left hover:bg-muted/50 transition-colors shrink-0',
              isDefaultSelected && 'bg-primary/10 border-l-2 border-l-primary',
            )}
          >
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 shrink-0">
              Établissement
            </span>
            <span className="text-sm font-medium">Default</span>
          </button>

          {/* Tabs by type */}
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as ResourceType)}
            className="flex flex-col flex-1 overflow-hidden"
          >
            <TabsList className="shrink-0 w-full rounded-none border-b border-border bg-transparent h-9 px-1 gap-0.5 justify-start">
              {RESOURCE_TABS.map(({ value, label }) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="text-[11px] px-2 h-7 rounded data-[state=active]:bg-background data-[state=active]:shadow-sm"
                >
                  {label.slice(0, 4)}
                  <span className="ml-0.5 opacity-60">({filteredIds(byType[value]).length})</span>
                </TabsTrigger>
              ))}
            </TabsList>

            {RESOURCE_TABS.map(({ value: type }) => {
              const ids = filteredIds(byType[type]);
              return (
                <TabsContent
                  key={type}
                  value={type}
                  className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden"
                >
                  {ids.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-8 px-4">
                      {search
                        ? `Aucun résultat pour « ${search} »`
                        : `Aucune ressource de type ${RESOURCE_TYPE_LABELS[type].toLowerCase()}.`}
                    </p>
                  ) : (
                    <ul>
                      {ids.map((id) => {
                        const badge = getStatusBadge(id);
                        return (
                          <li key={id}>
                            <button
                              type="button"
                              onClick={() => setSelectedId(id)}
                              className={cn(
                                'w-full text-left px-4 py-2 flex items-center gap-2 hover:bg-muted/50 transition-colors border-b border-border/40',
                                selectedId === id && 'bg-primary/10 border-l-2 border-l-primary',
                              )}
                            >
                              <span className="text-sm truncate flex-1">{id}</span>
                              <span className={cn('text-[10px] shrink-0', badge.className)}>
                                {badge.label}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </TabsContent>
              );
            })}
          </Tabs>

          {/* Footer stats */}
          <div className="shrink-0 border-t border-border px-4 py-2 text-xs text-muted-foreground">
            {allIds.length} ressource{allIds.length !== 1 ? 's' : ''}
          </div>
        </aside>

        {/* Main content panel */}
        <main className="flex-1 overflow-y-auto bg-background">
          {!selectedId ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8 gap-2">
              <p className="text-base font-medium text-muted-foreground">
                Sélectionnez une ressource
              </p>
              <p className="text-sm text-muted-foreground/70">
                Choisissez une ressource dans la liste à gauche pour visualiser
                et modifier ses contraintes de disponibilité.
              </p>
            </div>
          ) : isDefaultSelected ? (
            <div className="p-6">
              <p className="text-sm text-muted-foreground mb-4">
                Disponibilité de référence appliquée à toutes les ressources sans contrainte propre.
              </p>
              <ResourceConstraintEditor
                id="Default"
                resourceType="other"
                value={defaultRC}
                isDefault
                alwaysExpanded
                onChange={handleDefaultChange}
              />
            </div>
          ) : (
            <div className="p-6">
              <ResourceConstraintEditor
                key={selectedId}
                id={selectedId}
                resourceType={detectResourceType(selectedId)}
                value={selectedValue}
                alwaysExpanded
                csvWeeks={resourceWeeks[selectedId] ?? []}
                onChange={(v) => handleResourceChange(selectedId, v)}
                onDelete={() => handleResourceDelete(selectedId)}
              />
            </div>
          )}
        </main>
      </div>

      <AddResourceModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdd={handleAddResource}
        existingIds={Object.keys(constraints)}
      />
    </div>
  );
}
