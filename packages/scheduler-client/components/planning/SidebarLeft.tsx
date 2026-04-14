'use client';

import { useRef } from 'react';
import type { CourseTaskData } from '@edt-ts/scheduler-common';
import { downloadIcalSolution } from '@/lib/icalExport';
import CourseGroupList, { type GroupBy } from '@/components/planning/CourseGroupList';
import { SchedulerConfigDialog } from '@/components/planning/SchedulerConfigDialog';
import { useSidebarCourseDrag } from '@/hooks/useSidebarCourseDrag';
import { usePlanningStore } from '@/store/usePlanningStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

interface SidebarLeftProps {
  // Cours pour la semaine courante (dérivé dans page.tsx)
  parsedCourses: CourseTaskData[];
  // UI local
  groupBy: GroupBy;
  setGroupBy: (v: GroupBy) => void;
}

export function SidebarLeft({
  parsedCourses,
  groupBy, setGroupBy,
}: SidebarLeftProps) {
  // ── Store planning ────────────────────────────────────────────────────────
  const selectedWeek = usePlanningStore((s) => s.selectedWeek);
  const setSelectedWeek = usePlanningStore((s) => s.setSelectedWeek);
  const scheduleResult = usePlanningStore((s) => s.scheduleResult);
  const activeSolution = usePlanningStore((s) => s.activeSolution);
  const searchQuery = usePlanningStore((s) => s.searchQuery);
  const setSearchQuery = usePlanningStore((s) => s.setSearchQuery);
  const isLoading = usePlanningStore((s) => s.isLoading);
  const runSchedule = usePlanningStore((s) => s.runSchedule);
  const enforcedMap = usePlanningStore((s) => s.enforcedMap);


  const week = selectedWeek !== null ? String(selectedWeek) : '1';

  function handleSetWeek(v: string) {
    const n = parseInt(v, 10);
    if (!isNaN(n) && n >= 1 && n <= 53) setSelectedWeek(n);
  }

  const cardContainerRef = useRef<HTMLDivElement | null>(null);

  useSidebarCourseDrag({
    containerRef: cardContainerRef,
    courses: parsedCourses,
  });

  // iCal : on passe l'activeSolution uniquement si la semaine est connue
  const iCalWeek = selectedWeek ?? 1;

  return (
    <aside className="w-80 shrink-0 bg-card border-r border-border p-4 overflow-y-auto flex flex-col gap-4">

      {/* Recherche */}
      {scheduleResult && (
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Rechercher
          </Label>
          <Input
            type="search"
            placeholder="Enseignant, salle, groupe, code, cours…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      )}

      {/* Formulaire de planification */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">
          Planification
        </p>
        <form className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="week-input">Semaine (1–53)</Label>
            <Input
              id="week-input"
              type="number"
              min="1"
              max="53"
              value={week}
              onChange={(e) => handleSetWeek(e.target.value)}
              required
            />
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() => runSchedule('elimination')}
              disabled={isLoading}
              className="flex-1 bg-black hover:bg-zinc-800 text-white dark:bg-zinc-900 dark:hover:bg-zinc-700"
            >
              {isLoading ? 'Traitement…' : 'Planifier'}
            </Button>
            <SchedulerConfigDialog />
          </div>
          {activeSolution.length > 0 && (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => downloadIcalSolution(activeSolution, iCalWeek)}
            >
              Exporter en iCal
            </Button>
          )}
        </form>
      </div>

      {/* Liste des cours (avant les résultats) */}
      {parsedCourses.length > 0 && !scheduleResult && (
        <div className="flex flex-col gap-2">
          <Separator />
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Cours S{week}
            </p>
            <Badge variant="secondary">{parsedCourses.length} cours</Badge>
          </div>
          <p className="text-xs text-muted-foreground italic">
            Glissez un cours sur le calendrier pour l&apos;imposer.
          </p>
          <Tabs value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
            <TabsList className="w-full">
              <TabsTrigger value="code" className="flex-1">Par code</TabsTrigger>
              <TabsTrigger value="teacher" className="flex-1">Par enseignant</TabsTrigger>
            </TabsList>
          </Tabs>
          <div ref={cardContainerRef}>
            <CourseGroupList
              courses={parsedCourses}
              groupBy={groupBy}
              enforcedMap={enforcedMap}
            />
          </div>
        </div>
      )}
    </aside>
  );
}

