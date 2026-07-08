import { useSyncExternalStore } from 'react';

function subscribe(): () => void {
  return () => {};
}

/**
 * true seulement après l'hydratation côté client (false pendant le rendu serveur/build).
 * L'app est en export statique (next.config.ts: output: 'export') : les pages sont
 * pré-rendues au build avec un store zustand/persist vide (pas de localStorage côté build).
 * Ce hook évite tout flash de contenu/redirection incorrecte avant que le store ait
 * eu l'occasion de s'hydrater depuis localStorage.
 *
 * Implémenté via `useSyncExternalStore` (snapshot serveur/client différents) plutôt
 * qu'un `useState`+`useEffect` classique, pour éviter un set-state synchrone en effet.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
