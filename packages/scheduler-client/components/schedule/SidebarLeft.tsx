'use client';

import { useRef } from 'react';
import type { CourseTaskData, EnforcedData } from '@edt-ts/scheduler-common';
import { type ScheduleResult } from '@/lib/scheduleApi';
import { type GroupBy } from '@/components/CourseGroupList';
import CourseGroupList from '@/components/CourseGroupList';
import { useSidebarCourseDrag } from '@/hooks/useSidebarCourseDrag';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

interface SidebarLeftProps {
  // Week
  week: string;
  setWeek: (v: string) => void;

  // Courses
  parsedCourses: CourseTaskData[];
  enforcedMap: Record<string, EnforcedData>;
  groupBy: GroupBy;
  setGroupBy: (v: GroupBy) => void;

  // Results
  scheduleResult: ScheduleResult | null;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  isLoading: boolean;
  enforcedCount: number;
  runSchedule: (mode: 'standard' | 'elimination') => void;

  // Drag callbacks for constraint highlighting
  onDragStart: (resources: { teachers: string[]; groups: string[]; rooms: string[] }) => void;
  onDragEnd: () => void;
}

export function SidebarLeft({
  week, setWeek,
  parsedCourses, enforcedMap, groupBy, setGroupBy,
  scheduleResult, searchQuery, setSearchQuery,
  isLoading, enforcedCount, runSchedule,
  onDragStart, onDragEnd,
}: SidebarLeftProps) {
  const cardContainerRef = useRef<HTMLDivElement | null>(null);

  useSidebarCourseDrag({
    containerRef: cardContainerRef,
    courses: parsedCourses,
    onDragStart,
    onDragEnd,
  });

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
              onChange={(e) => setWeek(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              onClick={() => runSchedule('standard')}
              disabled={isLoading}
            >
              {isLoading
                ? 'Traitement…'
                : enforcedCount > 0
                ? `Planifier (${enforcedCount} imposé${enforcedCount > 1 ? 's' : ''})`
                : 'Planifier'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => runSchedule('elimination')}
              disabled={isLoading}
              className="bg-red-600 hover:bg-red-700 text-white dark:bg-red-500 dark:hover:bg-red-600"
            >
              {isLoading ? 'Traitement…' : 'Avec élimination'}
            </Button>
          </div>
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
