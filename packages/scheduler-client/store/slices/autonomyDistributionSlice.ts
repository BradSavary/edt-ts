import type { StateCreator } from 'zustand';
import type { AutonomyDistribution } from '@/store/types';

export interface AutonomyDistributionSlice {
  autonomyDistributions: Record<string, AutonomyDistribution>;
}

/**
 * Fournit uniquement l'état initial de `autonomyDistributions`.
 * Les actions `distributeAutonomy` et `cancelAutonomyDistribution` vivent dans le store
 * principal : elles doivent lire/écrire `placements`, où résident désormais les morceaux
 * répartis (des `Placement` `post-enforced` de plein droit).
 */
export const createAutonomyDistributionSlice: StateCreator<AutonomyDistributionSlice> = () => ({
  autonomyDistributions: {},
});
