'use client';

import { useState, useEffect, useMemo } from 'react';
import type { CourseTaskData, EnforcedData, ConstraintsData } from '@edt-ts/scheduler-common';
import { parseCsvCourses } from '@/lib/parseCsvCourses';
import { extractResourceWeeks } from '@/lib/parseCsvCourses';
import { type BlockedZone } from '@/lib/blockedZones';
import { runScheduleRequest, type ScheduleResult } from '@/lib/scheduleApi';
import { loadConstraints } from '@/lib/constraintsStorage';
import { useSchedulerStore } from '@/store/useSchedulerStore';
import type { TaskSolutionJSON } from '@edt-ts/scheduler-common';

interface Status {
  message: string;
  kind: 'ok' | 'err' | 'inf';
}

export interface ScheduleState {
  // Input
  week: string;
  setWeek: (v: string) => void;
  resourcesFile: File | null;
  setResourcesFile: (f: File | null) => void;
  coursesCsvFile: File | null;
  setCoursesCsvFile: (f: File | null) => void;

  // Derived from files
  parsedCourses: CourseTaskData[];
  resourcesData: import('@edt-ts/scheduler-common').ResourceGroupData[];
  constraintsData: ConstraintsData | null;

  // Planning state
  scheduleResult: ScheduleResult | null;
  selectedSolutionIndex: number;
  setSelectedSolutionIndex: (i: number) => void;
  activeSolution: ScheduleResult['solutions'][number] | undefined;
  filteredSolutions: TaskSolutionJSON[];
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  isLoading: boolean;
  status: Status | null;

  // Enforced courses
  enforcedMap: Record<string, EnforcedData>;
  handleEnforceChange: (map: Record<string, EnforcedData>) => void;

  // Blocked zones
  blockedZones: BlockedZone[];
  handleBlockedZoneAdd: (start: Date, end: Date) => void;
  handleBlockedZoneRemove: (id: string) => void;
  handleBlockedZoneMove: (id: string, start: Date, end: Date) => void;

  // Neutralized tasks placement tracking
  placedNeutralizedIds: Set<string>;
  handleNeutralizedTaskPlaced: (taskId: string) => void;
  handleNeutralizedTaskRemoved: (taskId: string) => void;

  // Actions
  runSchedule: (mode: 'standard' | 'elimination') => void;
}

export function useScheduleState(): ScheduleState {
  const [week, setWeek] = useState('1');
  const [resourcesFile, setResourcesFile] = useState<File | null>(null);
  const [coursesCsvFile, setCoursesCsvFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [scheduleResult, setScheduleResult] = useState<ScheduleResult | null>(null);
  const [selectedSolutionIndex, setSelectedSolutionIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [blockedZones, setBlockedZones] = useState<BlockedZone[]>([]);
  const [placedNeutralizedIds, setPlacedNeutralizedIds] = useState<Set<string>>(new Set());
  const [parsedCourses, setParsedCourses] = useState<CourseTaskData[]>([]);
  const [enforcedMap, setEnforcedMap] = useState<Record<string, EnforcedData>>({});
  const [resourcesData, setResourcesData] = useState<import('@edt-ts/scheduler-common').ResourceGroupData[]>([]);
  const [constraintsData, setConstraintsData] = useState<ConstraintsData | null>(null);

  useEffect(() => { setBlockedZones([]); setPlacedNeutralizedIds(new Set()); }, [week]);
  useEffect(() => { setPlacedNeutralizedIds(new Set()); }, [selectedSolutionIndex]);

  useEffect(() => {
    if (!resourcesFile) { setResourcesData([]); return; }
    resourcesFile.text().then((text) => {
      try {
        const data = JSON.parse(text) as import('@edt-ts/scheduler-common').ResourceGroupData[];
        if (Array.isArray(data)) setResourcesData(data);
      } catch { setResourcesData([]); }
    });
  }, [resourcesFile]);

  useEffect(() => { setConstraintsData(loadConstraints()); }, []);

  useEffect(() => {
    if (!coursesCsvFile) { setParsedCourses([]); setEnforcedMap({}); return; }
    const weekNum = parseInt(week, 10);
    if (isNaN(weekNum) || weekNum < 1 || weekNum > 53) return;
    coursesCsvFile.text().then((text) => {
      try {
        setParsedCourses(parseCsvCourses(text, weekNum));
        setEnforcedMap({});
        setScheduleResult(null);
        setSelectedSolutionIndex(0);
        // Mettre à jour resourceWeeks dans le store (persist vers edt-scheduler)
        useSchedulerStore.getState().setResourceWeeks(extractResourceWeeks(text));
      } catch { setParsedCourses([]); }
    });
  }, [coursesCsvFile, week]);

  const activeSolution = scheduleResult?.solutions[selectedSolutionIndex];

  const filteredSolutions = useMemo(() => {
    const tasks = activeSolution?.tasks ?? [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter((task) => {
      const teachers = task.resources.filter((r) => r.type === 'teacher').map((r) => r.id.toLowerCase());
      const rooms = task.resources.filter((r) => r.type === 'room').map((r) => r.id.toLowerCase());
      const groups = task.resources.filter((r) => r.type === 'group').map((r) => r.id.toLowerCase());
      return (
        task.code.toLowerCase().includes(q) ||
        task.name.toLowerCase().includes(q) ||
        teachers.some((t) => t.includes(q)) ||
        rooms.some((r) => r.includes(q)) ||
        groups.some((g) => g.includes(q))
      );
    });
  }, [activeSolution, searchQuery]);

  async function runSchedule(mode: 'standard' | 'elimination') {
    if (!resourcesFile) { setStatus({ message: '❌ Fichier resources requis.', kind: 'err' }); return; }
    if (!coursesCsvFile) { setStatus({ message: '❌ Fichier cours CSV requis.', kind: 'err' }); return; }
    setIsLoading(true);
    setStatus({ message: 'Lecture des fichiers…', kind: 'inf' });
    try {
      const result = await runScheduleRequest({
        weekStr: week,
        resourcesFile,
        coursesCsvFile,
        constraintsData: loadConstraints(),
        enforcedMap,
        blockedZones,
        mode,
      });
      setScheduleResult(result);
      setSelectedSolutionIndex(0);
      const best = result.solutions[0];
      const neutralizedMsg = best.neutralizedTasks?.length
        ? ` — ${best.neutralizedTasks.length} cours non placé(s)` : '';
      setStatus({
        message: `${best.isComplete ? '✅ Planification complète' : '⚠️ Incomplète'} — ${result.solutions.length} solution(s)${neutralizedMsg}`,
        kind: best.isComplete ? 'ok' : 'err',
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus({ message: `❌ ${message}`, kind: 'err' });
    } finally {
      setIsLoading(false);
    }
  }

  function handleEnforceChange(map: Record<string, EnforcedData>) {
    setEnforcedMap(map);
    setScheduleResult(null);
    setSelectedSolutionIndex(0);
    setPlacedNeutralizedIds(new Set());
  }

  function handleBlockedZoneAdd(start: Date, end: Date) {
    setBlockedZones((prev) => [
      ...prev,
      { id: `bz-${Date.now()}-${Math.random().toString(36).slice(2)}`, start, end },
    ]);
    setScheduleResult(null);
  }

  function handleBlockedZoneRemove(id: string) {
    setBlockedZones((prev) => prev.filter((z) => z.id !== id));
  }

  function handleBlockedZoneMove(id: string, start: Date, end: Date) {
    setBlockedZones((prev) => prev.map((z) => (z.id === id ? { ...z, start, end } : z)));
    setScheduleResult(null);
  }

  function handleNeutralizedTaskPlaced(taskId: string) {
    setPlacedNeutralizedIds((prev) => new Set([...prev, taskId]));
  }

  function handleNeutralizedTaskRemoved(taskId: string) {
    setPlacedNeutralizedIds((prev) => { const next = new Set(prev); next.delete(taskId); return next; });
  }

  return {
    week, setWeek,
    resourcesFile, setResourcesFile,
    coursesCsvFile, setCoursesCsvFile,
    parsedCourses, resourcesData, constraintsData,
    scheduleResult, selectedSolutionIndex, setSelectedSolutionIndex,
    activeSolution, filteredSolutions,
    searchQuery, setSearchQuery,
    isLoading, status,
    enforcedMap, handleEnforceChange,
    blockedZones, handleBlockedZoneAdd, handleBlockedZoneRemove, handleBlockedZoneMove,
    placedNeutralizedIds, handleNeutralizedTaskPlaced, handleNeutralizedTaskRemoved,
    runSchedule,
  };
}
