import type { ConstraintsData, ResourceConstraints, TimeSlot } from '@edt-ts/scheduler-common';
import type { StateCreator } from 'zustand';
import {
  loadResourceWeeks, // conservé temporairement : resourceWeeks est encore alimenté par
  //   useScheduleState.ts via saveResourceWeeks() jusqu'à la migration complète.
  exportAsJSON,
} from '@/lib/constraintsStorage';

// Type interne correspondant au format JSON réel des contraintes
type ConstraintValue = ResourceConstraints | TimeSlot[] | null | undefined;
export type ConstraintsRecord = Record<string, ConstraintValue> & { Default?: TimeSlot[] };

// Timer module-level — détail d'implémentation, pas dans l'état
let saveNoticeTimer: ReturnType<typeof setTimeout> | null = null;

export interface ConstraintsSlice {
  constraints: ConstraintsRecord;
  resourceWeeks: Record<string, number[]>;
  /** true dès que le middleware persist a hydraté le state côté client */
  constraintsInitialized: boolean;
  /** true pendant 2s après une modification (feedback UI) */
  saveNotice: boolean;

  initConstraints: () => void;
  setConstraint: (id: string, value: ResourceConstraints | null) => void;
  deleteConstraint: (id: string) => void;
  addResource: (id: string) => void;
  setDefaultConstraint: (value: ResourceConstraints | null) => void;
  importConstraints: (data: ConstraintsRecord) => void;
  exportConstraints: () => string;
  /** Appelé par useScheduleState lors du parsing CSV — alimente les semaines disponibles par ressource */
  setResourceWeeks: (weeks: Record<string, number[]>) => void;
}

export const createConstraintsSlice: StateCreator<ConstraintsSlice> = (set, get) => ({
  constraints: {},
  resourceWeeks: {},
  constraintsInitialized: false,
  saveNotice: false,

  initConstraints: () => {
    // `constraints` et `resourceWeeks` sont déjà restaurés par le middleware `persist`
    // avant ce premier rendu côté client. On se contente de marquer l'initialisation.
    set({ constraintsInitialized: true });
  },

  setConstraint: (id, value) => {
    const next = { ...get().constraints, [id]: value };
    set({ constraints: next });
    _triggerSaveNotice(set);
  },

  deleteConstraint: (id) => {
    const next = { ...get().constraints };
    delete next[id];
    set({ constraints: next });
    _triggerSaveNotice(set);
  },

  addResource: (id) => {
    const next = { ...get().constraints, [id]: null };
    set({ constraints: next });
    _triggerSaveNotice(set);
  },

  setDefaultConstraint: (value) => {
    const next = { ...get().constraints, Default: value?.default ?? [] };
    set({ constraints: next });
    _triggerSaveNotice(set);
  },

  importConstraints: (data) => {
    set({ constraints: data });
    _triggerSaveNotice(set);
  },

  exportConstraints: () => {
    // exportAsJSON formate les données pour le téléchargement — pas de localStorage
    return exportAsJSON(get().constraints as ConstraintsData);
  },

  setResourceWeeks: (weeks) => {
    // Appelé depuis useScheduleState.ts lors du parsing du CSV.
    // persist écrit automatiquement dans edt-scheduler.
    set({ resourceWeeks: weeks });
  },
});

function _triggerSaveNotice(set: (partial: Partial<ConstraintsSlice>) => void) {
  set({ saveNotice: true });
  if (saveNoticeTimer) clearTimeout(saveNoticeTimer);
  saveNoticeTimer = setTimeout(() => set({ saveNotice: false }), 2000);
}
