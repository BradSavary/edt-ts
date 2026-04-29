import type { StateCreator } from 'zustand';
import type { BlockedZone } from '@/lib/calendar/blockedZones';

export interface BlockedZonesSlice {
  blockedZones: BlockedZone[];
  handleBlockedZoneAdd: (start: Date, end: Date) => void;
  handleBlockedZoneRemove: (id: string) => void;
  handleBlockedZoneMove: (id: string, start: Date, end: Date) => void;
}

/**
 * Fournit l'état initial de `blockedZones` et `handleBlockedZoneRemove`.
 * `handleBlockedZoneAdd` et `handleBlockedZoneMove` sont surchargés dans le store
 * principal pour inclure `scheduleResult: null` (effet de bord cross-slice).
 */
export const createBlockedZonesSlice: StateCreator<BlockedZonesSlice> = (set) => ({
  blockedZones: [],

  handleBlockedZoneAdd: (start, end) => {
    set((state) => ({
      blockedZones: [
        ...state.blockedZones,
        { id: `bz-${Date.now()}-${Math.random().toString(36).slice(2)}`, start, end },
      ],
    }));
  },

  handleBlockedZoneRemove: (id) => {
    set((state) => ({
      blockedZones: state.blockedZones.filter((z) => z.id !== id),
    }));
  },

  handleBlockedZoneMove: (id, start, end) => {
    set((state) => ({
      blockedZones: state.blockedZones.map((z) => (z.id === id ? { ...z, start, end } : z)),
    }));
  },
});
