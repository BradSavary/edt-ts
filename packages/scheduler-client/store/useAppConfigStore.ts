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
      version: 13,
      migrate: (persistedState) => {
        const state = persistedState as { schedulerConfig?: Record<string, unknown> };
        if (!state?.schedulerConfig) return state;
        const schedulerConfig = { ...state.schedulerConfig };
        delete schedulerConfig.maxSolutions;
        // v5 : l'option unique groupTeacherHalfDays (sémantique « une seule demi-journée par jour »,
        // jamais souhaitée) est remplacée par deux préférences douces indépendantes.
        delete schedulerConfig.groupTeacherHalfDays;
        if (!('engine' in schedulerConfig)) schedulerConfig.engine = 'core';
        if (!('minimizeTeacherDays' in schedulerConfig)) schedulerConfig.minimizeTeacherDays = false;
        // v12 : balanceTeacherDailyLoad retirée (aucun avantage mesuré, trop coûteuse — décision
        // Frédéric 2026-09-11). Simple suppression, pas de report vers une autre préférence.
        delete schedulerConfig.balanceTeacherDailyLoad;
        // v10 : nouvelle préférence douce, indépendante de l'ex-balanceTeacherDailyLoad.
        if (!('reduceTeacherHalfDays' in schedulerConfig)) schedulerConfig.reduceTeacherHalfDays = false;
        // v11 : compactTeacherHalfDays + crossNoonGap fusionnées en une seule préférence, day-wide
        // plutôt que par demi-journée isolée. Si l'une des deux était active, la nouvelle l'est aussi
        // (préserve l'intention de l'utilisateur plutôt que de silencieusement tout désactiver).
        if (!('compactTeacherDay' in schedulerConfig)) {
          schedulerConfig.compactTeacherDay =
            Boolean(schedulerConfig.compactTeacherHalfDays) || Boolean(schedulerConfig.crossNoonGap);
        }
        delete schedulerConfig.compactTeacherHalfDays;
        delete schedulerConfig.crossNoonGap;
        if (!('minimizeTeacherRoomChanges' in schedulerConfig)) schedulerConfig.minimizeTeacherRoomChanges = false;
        // v13 : nouvelle option — respecter (ou non) l'enchaînement CM→TD→TP. Comportement par
        // défaut inchangé pour les configs existantes : la précédence était déjà toujours calculée.
        if (!('respectCmTdTpOrder' in schedulerConfig)) schedulerConfig.respectCmTdTpOrder = true;
        // v9 : moteur unique CP-SAT — les options du moteur maison n'ont plus de destinataire.
        for (const k of ['engine', 'maxSolutions', 'maxIterations', 'maxEliminations',
                         'conflictOrderingSearch', 'conflictSetExact', 'comboBranching',
                         'searchStrategy', 'postRepair']) {
          delete schedulerConfig[k];
        }
        // Aucun moteur ne gère la pause flottante : rabattre sur « aucune ».
        if ((schedulerConfig.lunchBreak as { type?: string } | undefined)?.type === 'floating') {
          schedulerConfig.lunchBreak = { type: 'none' };
        }
        return { ...state, schedulerConfig };
      },
    },
  ),
);
