import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SchedulerConfig } from '@edt-ts/scheduler-common';
import { DEFAULT_SCHEDULER_CONFIG } from '@edt-ts/scheduler-common';

/**
 * Préférences globales de l'application, indépendantes du Projet actif.
 * `schedulerConfig` (config moteur envoyée à l'API de planification) reste ici
 * volontairement : elle ne fait pas partie des données "utiles à la planification"
 * d'un Projet au sens métier, c'est un réglage de comportement du moteur lui-même.
 */
export interface AppConfigStore {
  schedulerConfig: SchedulerConfig;
  setSchedulerConfig: (config: SchedulerConfig) => void;
}

export const useAppConfigStore = create<AppConfigStore>()(
  persist(
    (set) => ({
      schedulerConfig: DEFAULT_SCHEDULER_CONFIG,
      setSchedulerConfig: (schedulerConfig) => set({ schedulerConfig }),
    }),
    {
      name: 'edt-app-config',
      version: 2,
      migrate: (persistedState) => {
        const state = persistedState as { schedulerConfig?: Record<string, unknown> };
        if (!state?.schedulerConfig || !('maxSolutions' in state.schedulerConfig)) return state;
        const schedulerConfig = { ...state.schedulerConfig };
        delete schedulerConfig.maxSolutions;
        return { ...state, schedulerConfig };
      },
    },
  ),
);
