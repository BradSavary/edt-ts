import type { ConstraintsData, ResourceConstraints, TimeSlot } from '@edt-ts/scheduler-common';
import type { StateCreator } from 'zustand';
import {
  exportAsJSON, // utilisé uniquement pour l'export/import JSON (pas de localStorage)
  DEFAULT_SLOTS,
} from '@/lib/constraintsUtils';
import type { ResourceGroupDataWithStatus } from '@/lib/csvMerge';
import { pruneOrphanWeeklyMaxDaily } from '@/lib/maxDailyResolution';

// Type interne correspondant au format JSON réel des contraintes
type ConstraintValue = ResourceConstraints | TimeSlot[] | null | undefined;
export type ConstraintsRecord = Record<string, ConstraintValue> & { Default?: TimeSlot[] | ResourceConstraints };

export interface ConstraintsSlice {
  constraints: ConstraintsRecord;
  /** true pendant 2s après une modification (feedback UI) */
  saveNotice: boolean;

  setConstraint: (id: string, value: ResourceConstraints | null) => void;
  deleteConstraint: (id: string) => void;
  addResource: (id: string) => void;
  setDefaultConstraint: (value: ResourceConstraints | null) => void;
  importConstraints: (data: ConstraintsRecord) => void;
  exportConstraints: () => string;
  /** Supprime les contraintes des ressources absentes de validIds (conserve Default). */
  pruneConstraints: (validIds: string[]) => void;
}

/**
 * `resources` appartient à ProjectDataSlice — type structurel minimal plutôt qu'un import de
 * `ProjectStore`, qui créerait un cycle (useProjectStore importe déjà ce slice).
 */
type WithResources = { resources: ResourceGroupDataWithStatus[] };

export const createConstraintsSlice: StateCreator<ConstraintsSlice> = (set, get) => {
  // Timer dans la closure : chaque instance du store a son propre timer,
  // évite le partage d'état entre instances (hot-reload, tests).
  let saveNoticeTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Écrit `constraints` en réconciliant dans la MÊME transaction les limites quotidiennes
   * hebdomadaires (une limite ne survit pas à la semaine qui la porte). Toute écriture de
   * `constraints` passe par ici : c'est ce qui rend l'invariant vrai par construction plutôt
   * que dépendant du chemin emprunté.
   */
  function setConstraints(constraints: ConstraintsRecord) {
    const resources = (get() as unknown as WithResources).resources;
    set({
      constraints,
      // Store partiel dans les tests du slice seul : pas de `resources` à réconcilier.
      ...(resources ? { resources: pruneOrphanWeeklyMaxDaily(resources, constraints) } : {}),
    } as Partial<ConstraintsSlice>);
  }

  function triggerSaveNotice() {
    set({ saveNotice: true });
    if (saveNoticeTimer) clearTimeout(saveNoticeTimer);
    saveNoticeTimer = setTimeout(() => set({ saveNotice: false }), 2000);
  }

  return {
    constraints: { Default: DEFAULT_SLOTS },
    saveNotice: false,

    setConstraint: (id, value) => {
      setConstraints({ ...get().constraints, [id]: value });
      triggerSaveNotice();
    },

    deleteConstraint: (id) => {
      const next = { ...get().constraints };
      delete next[id];
      setConstraints(next);
      triggerSaveNotice();
    },

    addResource: (id) => {
      setConstraints({ ...get().constraints, [id]: null });
      triggerSaveNotice();
    },

    setDefaultConstraint: (value) => {
      if (value === null) {
        const next = { ...get().constraints, Default: [] };
        setConstraints(next);
      } else {
        // value est un ResourceConstraints : { default?: TimeSlot[], S36?: TimeSlot[], ... }
        // On serialise en ConstraintsData.Default = TimeSlot[] (legacy) +
        // les semaines perso comme clés de niveau supérieur sous le même objet "Default".
        // Architecture existante : constraints.Default est TimeSlot[] OU ResourceConstraints.
        // Ici on stocke directement l'objet ResourceConstraints sous constraints.Default.
        const next = { ...get().constraints, Default: value };
        setConstraints(next);
      }
      triggerSaveNotice();
    },

    importConstraints: (data) => {
      setConstraints(data);
      triggerSaveNotice();
    },

    exportConstraints: () => {
      // exportAsJSON formate les données pour le téléchargement — pas de localStorage
      return exportAsJSON(get().constraints as ConstraintsData);
    },

    pruneConstraints: (validIds) => {
      const validSet = new Set(validIds);
      const current = get().constraints;
      const next: ConstraintsRecord = {};
      if ('Default' in current) next.Default = current.Default;
      for (const [id, value] of Object.entries(current)) {
        if (id !== 'Default' && validSet.has(id)) next[id] = value;
      }
      setConstraints(next);
    },
  };
};
