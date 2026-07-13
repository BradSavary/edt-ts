import type { StateCreator } from 'zustand';
import type { AutonomyDistribution } from '@/store/types';

export interface AutonomyDistributionSlice {
  autonomyDistributions: Record<string, AutonomyDistribution>;
  cancelAutonomyDistribution: (taskId: string) => void;
}

/**
 * Fournit l'état initial de `autonomyDistributions` et `cancelAutonomyDistribution`
 * (simple suppression de l'entrée — la durée affichée n'est qu'un override de lecture,
 * jamais une mutation des données sources, donc rien à restaurer).
 * `distributeAutonomy` (l'action de calcul) vit dans le store principal, qui a besoin
 * de lire plusieurs autres slices (activeSolution, blockedZones, etc.) et useProjectStore.
 */
export const createAutonomyDistributionSlice: StateCreator<AutonomyDistributionSlice> = (set) => ({
  autonomyDistributions: {},

  cancelAutonomyDistribution: (taskId) => {
    set((state) => {
      const next = { ...state.autonomyDistributions };
      delete next[taskId];
      return { autonomyDistributions: next };
    });
  },
});
