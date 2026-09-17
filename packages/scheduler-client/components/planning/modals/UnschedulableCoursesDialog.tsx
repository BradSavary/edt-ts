'use client';

import type { UnschedulableReason } from '@/lib/courseFeasibilityAnalysis';
import type { CourseTaskDataWithId } from '@/lib/courseId';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

export interface UnschedulableCourseEntry {
  course: CourseTaskDataWithId;
  reasons: UnschedulableReason[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: UnschedulableCourseEntry[];
  /**
   * Ouvre l'onglet « Attention », où vit le diagnostic complet. La popup est conservée malgré ce
   * doublon apparent : un onglet non ouvert ne prévient personne (§4.5 du plan). Elle se contente
   * donc d'un résumé et renvoie vers lui.
   */
  onOpenAttention?: () => void;
}

export function UnschedulableCoursesDialog({ open, onOpenChange, items, onOpenAttention }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>⚠️ Cours impossibles à placer ({items.length})</DialogTitle>
          <DialogDescription>
            Ces cours ne peuvent être placés nulle part. Le détail, et le geste qui débloque,
            sont dans l&apos;onglet <strong>Attention</strong> de la préparation.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-96">
          <div className="flex flex-col gap-3 pr-3">
            {items.map(({ course, reasons }) => (
              <div key={course.id} className="text-sm border rounded-md p-2">
                <div className="font-semibold">
                  {course.code} <span className="font-normal text-muted-foreground">{course.type}</span>
                  {' — '}
                  <span className="font-normal">{course.name}</span>
                </div>
                {/* Résumé seul : le diagnostic complet vit dans l'onglet Attention. Maintenir
                    deux rendus du même contenu, c'est les laisser diverger (§4.5 du plan). */}
                {reasons[0] && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">{reasons[0].message}</p>
                )}
                {reasons.length > 1 && (
                  <p className="mt-0.5 text-[10px] text-muted-foreground italic">
                    et {reasons.length - 1} autre(s) motif(s)
                  </p>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
        <DialogFooter className="gap-2 sm:gap-2">
          {onOpenAttention && (
            <Button onClick={() => { onOpenAttention(); onOpenChange(false); }}>
              Voir dans Attention
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fermer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
