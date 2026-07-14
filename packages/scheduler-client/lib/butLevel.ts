/** Options de sélection du niveau BUT (0=BUT1, 1=BUT2, 2=BUT3) pour les formulaires. */
export const BUT_LEVEL_OPTIONS: { value: 0 | 1 | 2; label: string }[] = [
  { value: 0, label: 'BUT 1' },
  { value: 1, label: 'BUT 2' },
  { value: 2, label: 'BUT 3' },
];

/** Semestre représentatif (impair) associé à un niveau BUT, faute de granularité plus fine côté UI. */
export function semesterFromLevel(level: number): number {
  return level * 2 + 1;
}

/**
 * Priorise dans la liste les groupes dont l'ID est préfixé par le niveau BUT donné
 * (convention "BUT1-G1", "BUT2-G3", ...), sans jamais masquer les autres groupes :
 * certains jeux de données (ex. import GEA) ne suivent pas cette convention.
 */
export function sortGroupsByLevel(groups: string[], level: number): string[] {
  const prefix = `but${level + 1}-`;
  const preferred: string[] = [];
  const rest: string[] = [];
  for (const g of groups) {
    (g.toLowerCase().startsWith(prefix) ? preferred : rest).push(g);
  }
  return [...preferred, ...rest];
}
