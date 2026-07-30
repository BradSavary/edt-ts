import type { ResourceEntry } from '@edt-ts/scheduler-common';

/**
 * Sens calendrier → modèle. Réinjecte un combo concret (retouche d'une tuile imposée) dans les
 * entrées du cours-modèle.
 *
 * L'appariement se fait **par valeur**, jamais par index : le combo concret n'est pas garanti
 * d'être dans l'ordre des entrées (`EnforceModal` le construit en listant d'abord les ressources
 * fixes, puis les alternatives résolues), et la modale du calendrier tourne avec
 * `allowAlternatives={false}` — elle rend donc des chaînes, pas la structure du modèle. Apparier
 * `concrete[i]` à `entries[i]` détruisait un OU sur deux.
 *
 * Trois passes, de l'appariement le plus sûr au plus spéculatif :
 *   1. une entrée fixe **égale** à la valeur — prioritaire pour qu'un modèle mêlant un fixe et une
 *      alternative qui le recouvre (`['R02', ['R01','R02']]`) s'apparie sans ambiguïté ;
 *   2. une alternative qui **contient** la valeur : elle est laissée **intacte**, elle doit rester
 *      ouverte pour le moteur si l'imposition est retirée plus tard ;
 *   3. les entrées libres restantes, dans l'ordre : la valeur du slot a changé. Une alternative est
 *      alors **élargie** (`[...alts, value]`) et non remplacée — un OU du modèle ne doit jamais se
 *      dégrader en valeur concrète au retour d'un placement. Une entrée fixe, elle, n'a pas de OU à
 *      perdre : elle prend la nouvelle valeur.
 *
 * Le résultat garde l'**ordre du modèle** (une retouche ne doit pas réordonner la carte sidebar) ;
 * les valeurs sans entrée d'accueil sont ajoutées en fin comme nouveaux créneaux requis (le « + ET »
 * de la modale), et les entrées qu'aucune valeur ne réclame sont supprimées (slot retiré dans la
 * modale). Les valeurs vides sont ignorées, comme dans `resolveEntriesAgainstPrevious`.
 */
export function mergeConcreteIntoEntries(
  entries: ResourceEntry[],
  concrete: string[],
): ResourceEntry[] {
  /** index d'entrée → valeur concrète qui l'occupe */
  const matched = new Map<number, string>();

  function claim(value: string, accepts: (entry: ResourceEntry) => boolean): boolean {
    const i = entries.findIndex((e, idx) => !matched.has(idx) && accepts(e));
    if (i === -1) return false;
    matched.set(i, value);
    return true;
  }

  const values = concrete.filter(Boolean);
  const afterExact = values.filter((v) => !claim(v, (e) => e === v));
  const afterAlts = afterExact.filter((v) => !claim(v, (e) => Array.isArray(e) && e.includes(v)));
  const appended = afterAlts.filter((v) => !claim(v, () => true));

  const kept = entries.flatMap((entry, i): ResourceEntry[] => {
    const value = matched.get(i);
    if (value === undefined) return [];
    if (!Array.isArray(entry)) return [value];
    return entry.includes(value) ? [entry] : [[...entry, value]];
  });

  return [...kept, ...appended];
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
