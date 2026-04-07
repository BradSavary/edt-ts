'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type ResourceTypeUI, RESOURCE_TYPE_LABELS } from '@/lib/constraintsUtils';

interface Props {
  open: boolean;
  onClose: () => void;
  onAdd: (id: string, type: ResourceTypeUI) => void;
  existingIds: string[];
}

export function AddResourceModal({ open, onClose, onAdd, existingIds }: Props) {
  const [name, setName] = useState('');
  const [type, setType] = useState<ResourceTypeUI>('teacher');
  const [error, setError] = useState('');

  function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) { setError('Le nom est requis.'); return; }
    if (existingIds.includes(trimmed)) { setError('Cette ressource existe déjà.'); return; }
    onAdd(trimmed, type);
    setName('');
    setType('teacher');
    setError('');
    onClose();
  }

  function handleClose() {
    setName('');
    setError('');
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ajouter une ressource</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="resource-name">Nom / identifiant</Label>
            <Input
              id="resource-name"
              placeholder="ex: DUPONT Jean ou R05"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              autoFocus
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="resource-type">Type</Label>
            <select
              id="resource-type"
              value={type}
              onChange={(e) => setType(e.target.value as ResourceTypeUI)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {(Object.keys(RESOURCE_TYPE_LABELS) as ResourceTypeUI[]).map((t) => (
                <option key={t} value={t}>{RESOURCE_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Annuler</Button>
          <Button onClick={handleSubmit}>Ajouter</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
