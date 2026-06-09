import type { ConstraintsData, ResourceConstraints, TimeSlot } from '@edt-ts/scheduler-common';
import type { StateCreator } from 'zustand';
import {
  exportAsJSON, // utilisé uniquement pour l'export/import JSON (pas de localStorage)
} from '@/lib/constraintsUtils';

// Type interne correspondant au format JSON réel des contraintes
type ConstraintValue = ResourceConstraints | TimeSlot[] | null | undefined;
export type ConstraintsRecord = Record<string, ConstraintValue> & { Default?: TimeSlot[] | ResourceConstraints };

export interface ConstraintsSlice {
  constraints: ConstraintsRecord;
  resourceWeeks: Record<string, number[]>;
  /** true pendant 2s après une modification (feedback UI) */
  saveNotice: boolean;

  setConstraint: (id: string, value: ResourceConstraints | null) => void;
  deleteConstraint: (id: string) => void;
  addResource: (id: string) => void;
  setDefaultConstraint: (value: ResourceConstraints | null) => void;
  importConstraints: (data: ConstraintsRecord) => void;
  exportConstraints: () => string;
  setResourceWeeks: (weeks: Record<string, number[]>) => void;
  /** Supprime les contraintes des ressources absentes de validIds (conserve Default). */
  pruneConstraints: (validIds: string[]) => void;
}

export const createConstraintsSlice: StateCreator<ConstraintsSlice> = (set, get) => {
  // Timer dans la closure : chaque instance du store a son propre timer,
  // évite le partage d'état entre instances (hot-reload, tests).
  let saveNoticeTimer: ReturnType<typeof setTimeout> | null = null;

  function triggerSaveNotice() {
    set({ saveNotice: true });
    if (saveNoticeTimer) clearTimeout(saveNoticeTimer);
    saveNoticeTimer = setTimeout(() => set({ saveNotice: false }), 2000);
  }

  return {
    constraints: {},
    resourceWeeks: {},
    saveNotice: false,

    setConstraint: (id, value) => {
      const next = { ...get().constraints, [id]: value };
      set({ constraints: next });
      triggerSaveNotice();
    },

    deleteConstraint: (id) => {
      const next = { ...get().constraints };
      delete next[id];
      set({ constraints: next });
      triggerSaveNotice();
    },

    addResource: (id) => {
      const next = { ...get().constraints, [id]: null };
      set({ constraints: next });
      triggerSaveNotice();
    },

    setDefaultConstraint: (value) => {
      if (value === null) {
        const next = { ...get().constraints, Default: [] };
        set({ constraints: next });
      } else {
        // value est un ResourceConstraints : { default?: TimeSlot[], S36?: TimeSlot[], ... }
        // On serialise en ConstraintsData.Default = TimeSlot[] (legacy) +
        // les semaines perso comme clés de niveau supérieur sous le même objet "Default".
        // Architecture existante : constraints.Default est TimeSlot[] OU ResourceConstraints.
        // Ici on stocke directement l'objet ResourceConstraints sous constraints.Default.
        const next = { ...get().constraints, Default: value };
        set({ constraints: next });
      }
      triggerSaveNotice();
    },

    importConstraints: (data) => {
      set({ constraints: data });
      triggerSaveNotice();
    },

    exportConstraints: () => {
      // exportAsJSON formate les données pour le téléchargement — pas de localStorage
      return exportAsJSON(get().constraints as ConstraintsData);
    },

    setResourceWeeks: (weeks) => {
      set({ resourceWeeks: weeks });
    },

    pruneConstraints: (validIds) => {
      const validSet = new Set(validIds);
      const current = get().constraints;
      const next: ConstraintsRecord = {};
      if ('Default' in current) next.Default = current.Default;
      for (const [id, value] of Object.entries(current)) {
        if (id !== 'Default' && validSet.has(id)) next[id] = value;
      }
      set({ constraints: next });
    },
  };
};
