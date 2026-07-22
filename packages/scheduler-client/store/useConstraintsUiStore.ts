import { create } from 'zustand';
import type { ResourceTypeUI } from '@/lib/constraintsUtils';

/**
 * État de navigation du menu Contraintes (ressource sélectionnée + onglet de type).
 * Extrait du `useState` local de ConstraintsManager pour survivre au démontage/remontage
 * du composant lors de la navigation de page (Planification ⇄ Contraintes) : on retombe
 * ainsi sur la dernière ressource éditée plutôt que sur un état réinitialisé.
 *
 * Non persisté (comme usePlanningStore) : purement de la session UI, réinitialisé au
 * rechargement complet de la page.
 */
export interface ConstraintsUiStore {
  selectedId: string | null;
  activeTab: ResourceTypeUI;
  setSelectedId: (id: string | null) => void;
  setActiveTab: (tab: ResourceTypeUI) => void;
}

export const useConstraintsUiStore = create<ConstraintsUiStore>((set) => ({
  selectedId: null,
  activeTab: 'teacher',
  setSelectedId: (selectedId) => set({ selectedId }),
  setActiveTab: (activeTab) => set({ activeTab }),
}));
