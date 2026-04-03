'use client';

import { create } from 'zustand';
import type { EnforcedData, TaskSolutionJSON } from '@edt-ts/scheduler-common';
import type { BlockedZone } from '@/lib/blockedZones';
import type { ScheduleResult } from '@/lib/scheduleApi';

// ── Status ─────────────────────────────────────────────────────────────────

interface Status {
  message: string;
  kind: 'ok' | 'err' | 'inf';
}

// ── Interface ──────────────────────────────────────────────────────────────
// Contient les données "de travail" de la session : non persistées.
// Correspond à la colonne droite de l'archi.md (usePlanningStore).

export interface PlanningStore {
  // Sélection de la semaine
  selectedWeek: number | null;
  setSelectedWeek: (week: number | null) => void;

  // Résultat de planification (immuable, vient de l'API)
  scheduleResult: ScheduleResult | null;
  selectedSolutionIndex: number;
  setSelectedSolutionIndex: (index: number) => void;

  // Vues dérivées du résultat (mutables via l'UI — drag, édition)
  activeSolution: TaskSolutionJSON[];
  activeNeutralizedTasks: TaskSolutionJSON[];
  placedNeutralizedIds: Set<string>;

  // Filtrage
  searchQuery: string;
  setSearchQuery: (query: string) => void;

  // Contraintes de session
  enforcedMap: Record<string, EnforcedData>;
  blockedZones: BlockedZone[];

  // Statut UI
  isLoading: boolean;
  status: Status | null;

  // ── Actions ──────────────────────────────────────────────────────────────

  // Planification
  runSchedule: (mode: 'standard' | 'elimination') => Promise<void>;

  // Cours forcés
  handleEnforceChange: (map: Record<string, EnforcedData>) => void;

  // Zones bloquées
  handleBlockedZoneAdd: (start: Date, end: Date) => void;
  handleBlockedZoneRemove: (id: string) => void;
  handleBlockedZoneMove: (id: string, start: Date, end: Date) => void;

  // Suivi des tâches neutralisées placées manuellement
  handleNeutralizedTaskPlaced: (taskId: string) => void;
  handleNeutralizedTaskRemoved: (taskId: string) => void;

  // Reset (ex: changement de semaine ou de fichiers)
  reset: () => void;
}

// ── Store ──────────────────────────────────────────────────────────────────
// TODO: implémenter les actions (migration depuis useScheduleState.ts)
// Les actions doivent lire useSchedulerStore.getState() pour accéder à
// allCourses, resources et constraints sans s'abonner au store.

export const usePlanningStore = create<PlanningStore>()(() => ({
  selectedWeek: null,
  setSelectedWeek: (_week) => { /* TODO */ },

  scheduleResult: null,
  selectedSolutionIndex: 0,
  setSelectedSolutionIndex: (_index) => { /* TODO */ },

  activeSolution: [],
  activeNeutralizedTasks: [],
  placedNeutralizedIds: new Set(),

  searchQuery: '',
  setSearchQuery: (_query) => { /* TODO */ },

  enforcedMap: {},
  blockedZones: [],

  isLoading: false,
  status: null,

  runSchedule: async (_mode) => { /* TODO */ },

  handleEnforceChange: (_map) => { /* TODO */ },
  handleBlockedZoneAdd: (_start, _end) => { /* TODO */ },
  handleBlockedZoneRemove: (_id) => { /* TODO */ },
  handleBlockedZoneMove: (_id, _start, _end) => { /* TODO */ },
  handleNeutralizedTaskPlaced: (_taskId) => { /* TODO */ },
  handleNeutralizedTaskRemoved: (_taskId) => { /* TODO */ },

  reset: () => { /* TODO */ },
}));
