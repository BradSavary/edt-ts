# Candidats à la migration vers `scheduler-common`

Fonctions dans `scheduler-client/lib/constraintsStorage.ts` qui opèrent sur des types de `@edt-ts/scheduler-common`
et n'ont aucune dépendance UI.

---

## ✅ Migration directe (aucune condition)

### `normalizeWeekKey(raw: string): string`
Normalise une clé de semaine ISO : `"36"` → `"S36"`, `"s47"` → `"S47"`.  
Opère sur les clés de `ResourceConstraints`. Utile côté API pour normaliser les entrées.

### `normalizeToRC(value: TimeSlot[] | ResourceConstraints | null | undefined): ResourceConstraints | null`
Normalise une valeur contrainte vers `ResourceConstraints` :
- `TimeSlot[]` → `{ default: [...] }`
- `ResourceConstraints` → inchangé
- `null`/`undefined` → `null`

### `getWeekKeys(rc: ResourceConstraints): string[]`
Extrait les clés de semaines explicites en excluant `"default"`.  
Exemple : `{ default: [...], S36: [...], S47: [...] }` → `["S36", "S47"]`

---

## 🟡 Migration conditionnelle (nécessite de déplacer aussi les types UI)

### `slotsToDayMap(slots: TimeSlot[]): DayMap`
Développe `TimeSlot[]` en format per-jour `DayMap` pour l'éditeur de contraintes.  
**Condition** : déplacer `DayMap`, `DayName`, `DaySlot`, `DAYS` dans `common`.

### `dayMapToSlots(dayMap: DayMap): TimeSlot[]`
Inverse de `slotsToDayMap`.  
**Condition** : même que ci-dessus.
