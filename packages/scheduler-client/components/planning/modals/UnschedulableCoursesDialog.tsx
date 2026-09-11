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
}

export function UnschedulableCoursesDialog({ open, onOpenChange, items }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>⚠️ Cours impossibles à placer ({items.length})</DialogTitle>
          <DialogDescription>
            Ces cours de la semaine ne peuvent jamais être placés : au moins une des ressources
            associées n&apos;a aucune disponibilité déclarée, ou jamais de créneau aussi long que
            la durée du cours.
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
                <ul className="mt-1 space-y-0.5 list-disc list-inside text-xs text-red-600 dark:text-red-400">
                  {reasons.map((r, i) => (
                    <li key={i}>{r.message}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
