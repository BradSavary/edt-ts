'use client';

import { useEffect, useState } from 'react';
import { useSchedulerStore } from '@/store/useSchedulerStore';
import { loadDemoData } from '@/lib/demoData';

/**
 * Charge automatiquement les données de démo au premier lancement
 * (localStorage vide). Doit être monté une seule fois dans le layout.
 */
export function DemoDataLoader() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Attend que zustand-persist ait hydraté le store depuis localStorage
    const unsubscribe = useSchedulerStore.persist.onFinishHydration(() => {
      setReady(true);
    });

    // Cas déjà hydraté (hot-reload, navigation SPA)
    if (useSchedulerStore.persist.hasHydrated()) {
      setReady(true);
    }

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (useSchedulerStore.getState().allCourses.length === 0) {
      loadDemoData().catch(console.error);
    }
  }, [ready]);

  return null;
}
