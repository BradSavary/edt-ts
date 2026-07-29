import type { ResourceEntry } from '@edt-ts/scheduler-common';

/**
 * Sens calendrier → modèle. Réinjecte un combo concret (retouche d'une tuile imposée) dans les
 * entrées du cours-modèle, slot par slot : une alternative qui **contient déjà** le choix est
 * laissée intacte — elle doit rester ouverte pour le moteur si l'imposition est retirée plus tard ;
 * sinon le slot prend la valeur concrète. Les slots ajoutés/supprimés dans la modale suivent, la
 * longueur du résultat est celle de `concrete`.
 */
export function mergeConcreteIntoEntries(
  entries: ResourceEntry[],
  concrete: string[],
): ResourceEntry[] {
  return concrete.map((value, i) => {
    const entry = entries[i];
    return Array.isArray(entry) && entry.includes(value) ? entry : value;
  });
}

/**
 * Sens modèle → imposition. Ré-résout un combo concret sur des entrées de cours modifiées, en
 * **préservant le choix déjà imposé** quand il reste admissible (sinon éditer la salle depuis la
 * sidebar réinitialiserait l'enseignant choisi à la pose). À défaut, premier choix de
 * l'alternative — même règle que `pickDefaultResources`, y compris le filtrage des valeurs vides.
 */
export function resolveEntriesAgainstPrevious(
  entries: ResourceEntry[],
  previous: string[],
): string[] {
  return entries
    .map((entry) => {
      const alts = Array.isArray(entry) ? entry : [entry];
      return alts.find((a) => previous.includes(a)) ?? alts[0];
    })
    .filter((r): r is string => Boolean(r));
}
