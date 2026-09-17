# Plan — Filtre par semaine des ressources (onglet Contraintes)

> **Public : session d'implémentation (Sonnet).** Ce plan est autoportant.
> Objectif : dans l'onglet **Contraintes**, pouvoir n'afficher dans la liste de gauche que les
> ressources **utilisées par au moins un cours d'une semaine donnée**.
> Périmètre : **client uniquement, affichage uniquement**. Aucun changement moteur, aucun changement
> de format de données, aucune migration.

## 0. Décisions verrouillées (ne pas rouvrir)

- **Sémantique retenue = A (décision Frédéric, 2026-09-17).** « Ressource de la semaine N » =
  ressource référencée (enseignant / groupe / salle, alternatives aplaties) par au moins un cours
  de la semaine N — cours CSV **et** cours manuels. C'est exactement la map `resourceWeeks` déjà
  calculée dans le composant, celle qui alimente le badge `N sem.`.
  La sémantique **B** (ressource ayant une clé `S<N>` dans ses contraintes ou dans
  `weeklyMaxDailyMinutes`) est **hors périmètre** : ne pas l'implémenter, ne pas la mélanger.

- **Filtrage d'affichage, pas de restriction d'édition.** Le filtre agit sur la liste de gauche
  (listes + compteurs d'onglets + pied de liste). Il ne touche ni aux contraintes, ni au store
  projet, ni à ce que reçoit le moteur.

- **L'entrée « Défaut » n'est jamais filtrée.** Elle est au-dessus des onglets
  ([ConstraintsManager.tsx:271-288](../packages/scheduler-client/components/constraints/ConstraintsManager.tsx#L271-L288))
  et doit rester visible en permanence.

- **La sélection courante n'est pas invalidée par le filtre.** Si la ressource éditée sort du filtre,
  l'éditeur de droite reste ouvert tel quel. `hasValidSelection` continue de s'appuyer sur `allIds`
  (non filtré) — **ne pas y toucher**.

- **Les ressources sans semaine disparaissent quand un filtre est actif.** C'est voulu : ressources
  créées via « + Ressource », ou marquées `inutilisée` après fusion CSV (badge `—`). Le pied de liste
  rend la disparition lisible (§2.4).

- **État du filtre = local et éphémère**, comme `search`
  ([:75](../packages/scheduler-client/components/constraints/ConstraintsManager.tsx#L75)) — **pas**
  dans `useConstraintsUiStore`. Raison : ce store mémorise *où l'on était* (onglet, ressource
  sélectionnée), pas *ce qu'on avait masqué* ; un filtre qui survit à un aller-retour
  Planification ⇄ Contraintes donnerait une liste tronquée sans que l'utilisateur se souvienne
  pourquoi. Le déplacer dans le store reste un changement de 3 lignes si Frédéric le demande après
  usage — ne pas le faire de sa propre initiative.

- **Branche dédiée obligatoire : `feature/constraints-week-filter`.** Ne jamais travailler sur
  `master` (règle Frédéric). Ne pas merger, ne pas pousser.

## 1. Ancrages de code (tout est dans UN seul fichier + un helper)

`packages/scheduler-client/components/constraints/ConstraintsManager.tsx` :

| Ligne | Rôle |
|---|---|
| [38-58](../packages/scheduler-client/components/constraints/ConstraintsManager.tsx#L38-L58) | `resourceWeeks` : `Record<id, number[]>` trié — **déjà existant, à réutiliser tel quel, ne pas le modifier** |
| [75](../packages/scheduler-client/components/constraints/ConstraintsManager.tsx#L75) | `const [search, setSearch]` — modèle pour le nouvel état |
| [115-121](../packages/scheduler-client/components/constraints/ConstraintsManager.tsx#L115-L121) | `handleAddResource` — piège §2.5 |
| [149-158](../packages/scheduler-client/components/constraints/ConstraintsManager.tsx#L149-L158) | `allIds` |
| [160-172](../packages/scheduler-client/components/constraints/ConstraintsManager.tsx#L160-L172) | `byType` (non filtré, calculé inline) |
| [175-181](../packages/scheduler-client/components/constraints/ConstraintsManager.tsx#L175-L181) | `allCsvWeeks` : semaines existantes triées — **déjà existant**, alimente le sélecteur |
| [183-187](../packages/scheduler-client/components/constraints/ConstraintsManager.tsx#L183-L187) | `filteredIds` : **point de passage unique** du filtrage |
| [260-268](../packages/scheduler-client/components/constraints/ConstraintsManager.tsx#L260-L268) | champ « Rechercher… » — le sélecteur se place à côté |
| [292-303](../packages/scheduler-client/components/constraints/ConstraintsManager.tsx#L292-L303) | compteurs d'onglets `(N)` |
| [314-318](../packages/scheduler-client/components/constraints/ConstraintsManager.tsx#L314-L318) | message « Aucun résultat… » |
| [357-361](../packages/scheduler-client/components/constraints/ConstraintsManager.tsx#L357-L361) | pied de liste `N ressources` |

Composant `Select` disponible : `@/components/ui/select` — idiome exact dans
[SidebarAnalysis.tsx:225-233](../packages/scheduler-client/components/planning/sidebar/SidebarAnalysis.tsx#L225-L233).
**Attention Radix : `SelectItem value=""` lève une erreur** → sentinelle `"all"` pour « Toutes ».

## 2. Implémentation

### 2.1 Helper pur + tests (à faire EN PREMIER)

Dans `packages/scheduler-client/lib/constraintsUtils.ts`, ajouter une fonction pure — c'est elle
qui porte la logique, pour qu'elle soit testable sans rendu React :

```ts
/**
 * Filtre une liste d'ids de ressources par texte libre et/ou par semaine d'utilisation.
 * `week === null` ⇒ pas de filtre semaine. Une ressource sans semaine connue (ajoutée à la main,
 * ou absente du dernier CSV) est exclue dès qu'une semaine est demandée — sémantique A : « utilisée
 * par un cours de cette semaine ».
 */
export function filterResourceIds(
  ids: string[],
  opts: { search: string; week: number | null },
  resourceWeeks: Record<string, number[]>,
): string[] {
  const q = opts.search.trim().toLowerCase();
  return ids.filter((id) => {
    if (q && !id.toLowerCase().includes(q)) return false;
    if (opts.week !== null && !(resourceWeeks[id]?.includes(opts.week) ?? false)) return false;
    return true;
  });
}
```

Tests à ajouter dans `packages/scheduler-client/__tests__/constraintsUtils.test.ts` (fichier
existant, même style `describe`/`it` en français) — **5 cas, pas plus** :
1. `week: null` + `search: ''` ⇒ liste inchangée (identité) ;
2. filtre semaine seul ⇒ ne garde que les ids dont `resourceWeeks[id]` contient la semaine ;
3. ressource absente de `resourceWeeks` ⇒ exclue quand une semaine est demandée, **incluse** quand
   `week === null` ;
4. combinaison texte + semaine ⇒ ET logique (les deux doivent passer) ;
5. la casse du texte est ignorée (`"dup"` trouve `"DUPONT Jean"`).

### 2.2 État local + semaine effective

Près de [:75](../packages/scheduler-client/components/constraints/ConstraintsManager.tsx#L75) :

```ts
const [weekFilter, setWeekFilter] = useState<number | null>(null);
```

Puis, **après** `allCsvWeeks` ([:175](../packages/scheduler-client/components/constraints/ConstraintsManager.tsx#L175)),
dériver la semaine réellement appliquée — pas de `useEffect` de resynchronisation :

```ts
// Un changement de projet / réimport CSV peut faire disparaître la semaine filtrée : on retombe
// alors sur « Toutes » par dérivation plutôt que par effet de bord, pour ne jamais afficher une
// liste vide inexplicable.
const effectiveWeek = weekFilter !== null && allCsvWeeks.includes(weekFilter) ? weekFilter : null;
```

### 2.3 Brancher le filtrage (point de passage unique)

Remplacer `filteredIds` ([:183-187](../packages/scheduler-client/components/constraints/ConstraintsManager.tsx#L183-L187))
par un `visibleByType` mémoïsé, pour ne calculer le filtrage qu'une fois au lieu de le refaire à
chaque compteur d'onglet et à chaque rendu de liste :

```ts
const visibleByType = useMemo(() => {
  const out = {} as Record<ResourceTypeUI, string[]>;
  for (const t of Object.keys(byType) as ResourceTypeUI[]) {
    out[t] = filterResourceIds(byType[t], { search, week: effectiveWeek }, resourceWeeks);
  }
  return out;
}, [byType, search, effectiveWeek, resourceWeeks]);

const visibleCount = useMemo(
  () => Object.values(visibleByType).reduce((n, ids) => n + ids.length, 0),
  [visibleByType],
);
```

> `byType` est aujourd'hui recalculé à chaque rendu (objet neuf à chaque fois, donc `useMemo` ne
> mémoïse rien de plus qu'un calcul direct). **Ne pas partir en refonte de `byType` pour ça** : la
> liste fait quelques centaines d'ids, le coût est négligeable et ce n'est pas l'objet du chantier.

Puis remplacer les appels : `filteredIds(byType[value])` → `visibleByType[value]` dans les compteurs
d'onglets ([:301](../packages/scheduler-client/components/constraints/ConstraintsManager.tsx#L301))
et `const ids = filteredIds(byType[type])` → `const ids = visibleByType[type]`
([:306](../packages/scheduler-client/components/constraints/ConstraintsManager.tsx#L306)).
`filteredIds` disparaît du composant.

### 2.4 UI — sélecteur + pied de liste

À côté du champ de recherche ([:260-268](../packages/scheduler-client/components/constraints/ConstraintsManager.tsx#L260-L268)),
dans le même bloc `p-3 border-b` : passer le conteneur en `flex items-center gap-2`, le champ de
recherche en `flex-1 min-w-0`, et ajouter le sélecteur **uniquement si `allCsvWeeks.length > 0`**
(sans cours importés, il n'y a rien à filtrer) :

```tsx
{allCsvWeeks.length > 0 && (
  <Select
    value={effectiveWeek === null ? 'all' : String(effectiveWeek)}
    onValueChange={(v) => setWeekFilter(v === 'all' ? null : Number(v))}
  >
    <SelectTrigger size="sm" className="w-24 shrink-0 px-2" aria-label="Filtrer par semaine">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="all">Toutes</SelectItem>
      {allCsvWeeks.map((w) => (
        <SelectItem key={w} value={String(w)}>S{w}</SelectItem>
      ))}
    </SelectContent>
  </Select>
)}
```

> Rappel largeurs : la barre d'export a déjà débordé pour cette raison (f845b45). Le champ de
> recherche doit être `flex-1 min-w-0` et le `SelectTrigger` `shrink-0` à largeur fixe, dans une
> sidebar de 320 px (`w-80`). Vérifier visuellement qu'aucun débordement horizontal n'apparaît.

Pied de liste ([:357-361](../packages/scheduler-client/components/constraints/ConstraintsManager.tsx#L357-L361)) —
rendre la troncature lisible :

```tsx
{visibleCount === allIds.length
  ? `${allIds.length} ressource${allIds.length !== 1 ? 's' : ''}`
  : `${visibleCount} / ${allIds.length} ressources`}
```

Message de liste vide ([:314-318](../packages/scheduler-client/components/constraints/ConstraintsManager.tsx#L314-L318)) —
il ne doit plus mentionner que la recherche. Ordre des cas : recherche + semaine, semaine seule,
recherche seule, sinon message « aucune ressource de type … » existant. Exemples de formulations :
`Aucun résultat pour « X » en semaine N`, `Aucune ressource utilisée en semaine N.`

### 2.5 Piège obligatoire — « + Ressource » sous filtre actif

Dans `handleAddResource` ([:115-121](../packages/scheduler-client/components/constraints/ConstraintsManager.tsx#L115-L121)),
ajouter `setWeekFilter(null);`. Sans ça, une ressource fraîchement créée (0 semaine) est
**invisible** dans la liste alors qu'elle vient d'être sélectionnée : l'utilisateur croit que la
création a échoué.

## 3. Checkpoint feu-vert (obligatoire)

**S'arrêter ici et rendre la main.** À l'issue de §2 : typecheck + lint verts, et un résumé factuel
de ce qui a été modifié. **Ne pas enchaîner sur la validation UI ni sur un commit** avant le feu vert
de Frédéric — il peut vouloir manipuler l'écran lui-même à ce stade.

## 4. Validation (dimensionnée sur ce que le changement peut casser)

Le changement est un filtrage d'affichage dans un composant : la validation se limite à ce périmètre.

1. `npm run typecheck` et `npm run lint` dans `packages/scheduler-client` — attendus verts.
2. `npm test` dans `packages/scheduler-client` : les nouveaux tests de §2.1 doivent passer.
   **9 échecs sont PRÉEXISTANTS sur `master`** (`storage.setItem is not a function` dans
   `SchedulerConfigDialog`, + 3 dates dans `icalExport`) — ils ne sont pas imputables à ce chantier.
   Ne pas tenter de les corriger ; si le compte d'échecs change, le dire sans conclure.
3. Vérification manuelle (après feu vert §3), sur le vrai projet de Frédéric :
   - sélectionner une semaine ⇒ les listes ET les compteurs d'onglets se réduisent de façon
     cohérente avec le badge `N sem.` de chaque ressource ;
   - « Toutes » restaure exactement la liste d'origine ;
   - « + Ressource » sous filtre actif ⇒ la nouvelle ressource est visible et sélectionnée ;
   - entrée « Défaut » toujours visible et éditable, filtre actif ou non ;
   - pas de débordement horizontal de la sidebar.

## 5. Hors périmètre (ne pas faire)

- Sémantique B (semaines des *contraintes*), et tout filtre combiné A+B.
- Toute modification de `resourceWeeks`, `allIds`, `hasValidSelection`, ou de
  `ResourceConstraintEditor` (y compris `csvWeeks`, qui continue d'afficher **toutes** les semaines
  de la ressource, indépendamment du filtre).
- Persistance du filtre (store / localStorage).
- Filtrage par plage de semaines, multi-sélection, ou synchronisation avec la semaine courante de
  Planification (`usePlanningStore.selectedWeek`).

## 6. STATUT (à remplir par l'exécutant)

Rapporter des **faits bruts** : fichiers touchés, sortie des commandes, ce qui a été observé.
Ne pas écrire « vérifié / validé / corrigé » : les conclusions et l'attribution des gains sont
écrites au retour par le relecteur (règle Frédéric 2026-07-19).
