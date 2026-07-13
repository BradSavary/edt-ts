'use client';

import { useState } from 'react';
import { StickyNote } from 'lucide-react';
import { usePlanningStore } from '@/store/usePlanningStore';
import { useProjectStore } from '@/store/useProjectStore';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

/**
 * Note libre associée à la semaine sélectionnée. Édition directe dans la modale,
 * enregistrement automatique à la fermeture (pas d'auto-save au fil de la frappe).
 */
export function WeekNoteDialog() {
  const selectedWeek = usePlanningStore((s) => s.selectedWeek);
  const schoolYearConfig = useProjectStore((s) => s.schoolYearConfig);
  const weekSaves = useProjectStore((s) => s.weekSaves);
  const setWeekNote = useProjectStore((s) => s.setWeekNote);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');

  if (selectedWeek === null) return null;

  const savedNote = weekSaves[String(selectedWeek)]?.note ?? '';
  const hasNote = savedNote.trim().length > 0;

  function handleOpenChange(next: boolean) {
    if (next) {
      setDraft(savedNote);
    } else if (schoolYearConfig) {
      setWeekNote(selectedWeek!, schoolYearConfig.year, draft);
    }
    setOpen(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <div className="relative inline-flex">
          <Button
            type="button"
            variant="outline"
            size="icon"
            title="Note de la semaine"
            aria-label="Note de la semaine"
          >
            <StickyNote className="size-4" />
          </Button>
          {hasNote && (
            <span className="absolute -top-1 -right-1 size-2.5 rounded-full bg-violet-500 pointer-events-none" />
          )}
        </div>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Note — semaine {selectedWeek}</DialogTitle>
          <DialogDescription>
            Informations contextuelles utiles à la planification de cette semaine.
            Enregistrement automatique à la fermeture.
          </DialogDescription>
        </DialogHeader>
        <textarea
          autoFocus
          className="w-full min-h-[160px] resize-y rounded-md border border-input bg-transparent p-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          placeholder="Ex. Prévoir de libérer les étudiants à 17h le lundi pour assister à la réunion…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </DialogContent>
    </Dialog>
  );
}
