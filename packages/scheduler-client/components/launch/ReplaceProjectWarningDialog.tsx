'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ReplaceProjectWarningDialogProps {
  open: boolean;
  projectName: string | null;
  onExportAndContinue: () => void;
  onContinueWithoutSaving: () => void;
  onCancel: () => void;
}

/**
 * Dialog affiché avant de créer un nouveau projet ou d'en importer un autre,
 * quand un projet est déjà actif : un seul projet persiste en localStorage,
 * donc continuer remplace définitivement celui en cours s'il n'a pas été exporté.
 */
export function ReplaceProjectWarningDialog({
  open,
  projectName,
  onExportAndContinue,
  onContinueWithoutSaving,
  onCancel,
}: ReplaceProjectWarningDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Remplacer le projet en cours ?</DialogTitle>
          <DialogDescription>
            {projectName ? <>Le projet <span className="font-medium text-foreground">{projectName}</span></> : 'Le projet actuel'} n&apos;est
            sauvegardé que dans ce navigateur. Continuer sans l&apos;exporter effacera définitivement son contenu.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col sm:items-stretch">
          <Button onClick={onExportAndContinue}>Exporter puis continuer</Button>
          <Button variant="outline" onClick={onContinueWithoutSaving}>Continuer sans sauvegarder</Button>
          <Button variant="ghost" onClick={onCancel}>Annuler</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
