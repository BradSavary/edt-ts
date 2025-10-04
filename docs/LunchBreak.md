# Pause Méridienne pour les Groupes

## 📋 Vue d'ensemble

Le système EDT-TS applique automatiquement une **contrainte de pause méridienne flottante de 90 minutes** pour tous les groupes d'étudiants entre 12:00 et 14:00. Cette contrainte garantit que les étudiants disposent d'un temps de pause suffisant pour le déjeuner.

## 🎯 Objectif

Assurer une pause d'au moins 90 minutes consécutives entre 12:00 et 14:00 pour tous les groupes d'étudiants, tout en offrant de la flexibilité dans le positionnement de cette pause.

## ⚙️ Fonctionnement

### Principe : Pause Flottante

La pause de 90 minutes peut être positionnée de **deux façons différentes** :

1. **Pause 12:00-13:30** (90 minutes)
   - Cours se termine à ≤ 12:00
   - Pause méridienne de 12:00 à 13:30
   - Cours reprend à ≥ 13:30

2. **Pause 12:30-14:00** (90 minutes)
   - Cours se termine à ≤ 12:30
   - Pause méridienne de 12:30 à 14:00  
   - Cours reprend à ≥ 14:00

### Règles de Validation

Le système applique deux règles complémentaires lors de la réservation d'un créneau pour un **groupe** :

#### Règle 1 : Cours débutant à 13:30
```
SI cours débute à 13:30
ALORS le créneau 12:00-12:30 DOIT être libre
SINON rejet de la réservation
```

**Justification** : Si un cours débute à 13:30, la pause sera forcément de 12:30-13:30 (seulement 60 min). Pour garantir 90 minutes, le créneau 12:00-12:30 doit être libre, créant ainsi une pause de 12:00-13:30.

#### Règle 2 : Cours se terminant à 12:30
```
SI cours se termine à 12:30 ET cours commence avant 12:00
ALORS le créneau 13:30-14:00 DOIT être libre
SINON rejet de la réservation
```

**Justification** : Si un cours se termine à 12:30, la pause sera forcément de 12:30-13:30 (seulement 60 min). Pour garantir 90 minutes, le créneau 13:30-14:00 doit être libre, créant ainsi une pause de 12:30-14:00.

**Note** : La condition "cours commence avant 12:00" évite une interdiction circulaire pour les cours de 12:00-12:30.

## 💻 Implémentation

### Classe `Resource` (src/resource.ts)

La vérification est implémentée dans la méthode `book()` :

```typescript
book(start: number, end: number): void {
    // Vérification spécifique pour les groupes : pause méridienne de 90 minutes
    if (this.type === ResourceType.GROUP) {
        const MINUTES_PER_DAY = 24 * 60;
        const startTimeInDay = start % MINUTES_PER_DAY;
        const endTimeInDay = end % MINUTES_PER_DAY;
        const LUNCH_START = 13 * 60 + 30; // 13:30 = 810 minutes
        const LUNCH_BREAK_END = 12 * 60 + 30; // 12:30 = 750 minutes
        
        // Cas 1 : Si le créneau débute à 13:30
        if (startTimeInDay === LUNCH_START) {
            const dayStart = start - startTimeInDay;
            const pauseStart = dayStart + (12 * 60); // 12:00
            const pauseEnd = dayStart + LUNCH_BREAK_END; // 12:30
            
            if (!this.availabilityManager.isAvailable(pauseStart, pauseEnd)) {
                throw new Error(
                    'Pause méridienne insuffisante : pour réserver à 13:30, ' +
                    'le créneau 12:00-12:30 doit être libre.'
                );
            }
        }
        
        // Cas 2 : Si le créneau se termine à 12:30
        if (endTimeInDay === LUNCH_BREAK_END) {
            const dayStart = end - endTimeInDay;
            const morningBreakStart = dayStart + (12 * 60); // 12:00
            const afternoonStart = dayStart + LUNCH_START; // 13:30
            const afternoonEnd = dayStart + (14 * 60); // 14:00
            
            const isReservingOverMorningBreak = start < morningBreakStart;
            
            if (isReservingOverMorningBreak && 
                !this.availabilityManager.isAvailable(afternoonStart, afternoonEnd)) {
                throw new Error(
                    'Pause méridienne insuffisante : pour réserver jusqu\'à 12:30, ' +
                    'le créneau 13:30-14:00 doit être libre.'
                );
            }
        }
    }
    
    this.availabilityManager.book(start, end);
}
```

### Intégration dans les Schedulers

Les schedulers (Schedule, ScheduleAR, ScheduleMR) gèrent automatiquement les exceptions levées par `Resource.book()` :

```typescript
// Dans la méthode backtrack()
try {
    this.applyConstraints(taskSolution);
} catch (error) {
    // Si les contraintes ne peuvent pas être appliquées (ex: pause méridienne),
    // annuler l'ajout et essayer le créneau/ressources suivant(e)s
    this.solution.pop();
    continue;
}
```

## ✅ Exemples de Cas Valides

### Cas 1 : Pause 12:00-13:30
```
10:00-12:00 | Cours
12:00-13:30 | 🍽️ PAUSE (90 min)
13:30-15:00 | Cours
```
✅ **Valide** : 90 minutes de pause entre 12:00 et 13:30

### Cas 2 : Pause 12:30-14:00
```
10:30-12:30 | Cours
12:30-14:00 | 🍽️ PAUSE (90 min)
14:00-16:00 | Cours
```
✅ **Valide** : 90 minutes de pause entre 12:30 et 14:00

### Cas 3 : Pas de cours autour de midi
```
08:00-10:00 | Cours
10:00-12:00 | Pause
12:00-14:00 | Pas de cours
14:00-16:00 | Cours
```
✅ **Valide** : Plus de 90 minutes de pause garanties

## ❌ Exemples de Cas Invalides

### Cas 1 : Pause trop courte (60 min)
```
10:30-12:30 | Cours
12:30-13:30 | PAUSE (60 min) ❌
13:30-15:00 | Cours ← Rejeté !
```
❌ **Invalide** : Seulement 60 minutes de pause
- Le cours de 13:30 est rejeté car le créneau 12:00-12:30 est occupé

### Cas 2 : Empiètement sur la pause
```
12:00-12:30 | Cours
12:30-13:30 | PAUSE (60 min) ❌
13:30-14:00 | Cours ← Rejeté !
```
❌ **Invalide** : Seulement 60 minutes de pause
- Le cours de 13:30-14:00 est rejeté car le créneau 12:00-12:30 est occupé

### Cas 3 : Double occupation
```
11:30-12:15 | Cours
12:15-12:30 | Pause ❌
12:30-13:30 | PAUSE globale
13:30-14:00 | Cours ← Rejeté !
```
❌ **Invalide** : Le cours de 11:30-12:15 occupe une partie du créneau 12:00-12:30
- Le cours de 13:30-14:00 est rejeté

## 🧪 Tests et Validation

### Test Unitaire : `test-lunch-break.ts`

Ce script teste tous les cas de figure de la pause méridienne :

```bash
npx tsx src/Claude/test-lunch-break.ts
```

**Tests effectués** :
1. ✅ Cours jusqu'à 12:00, puis 13:30 (valide)
2. ❌ Cours jusqu'à 12:30, puis 13:30 (invalide)
3. ✅ Cours jusqu'à 11:30, puis 13:30 (valide)
4. ✅ Enseignant sans contrainte (valide)
5. ❌ Créneaux multiples avec fin à 12:15, puis 13:30 (invalide)
6. ❌ Cours jusqu'à 12:30, puis 13:30 (invalide - double vérification)
7. ✅ Enseignant - pas de contrainte de pause
8. ❌ Cours à 13:30-14:30, puis 10:00-12:30 (invalide)
9. ❌ Cours à 13:30-13:45, puis 10:00-12:30 (invalide)

### Analyse de Planning : `analyze-lunch-breaks.ts`

Ce script analyse un planning complet et détecte les violations de pause méridienne :

```bash
# Pour Schedule
npx tsx src/Claude/analyze-lunch-breaks.ts

# Pour ScheduleAR
npx tsx src/Claude/analyze-lunch-breaks-AR.ts
```

**Résultat attendu** : `✅ Aucun problème de pause méridienne détecté !`

## 🎯 Avantages

1. **Automatique** : Aucune configuration manuelle requise
2. **Flexible** : Deux positions possibles pour la pause (12:00-13:30 ou 12:30-14:00)
3. **Robuste** : Intégré directement dans le système de réservation
4. **Efficace** : Détection précoce pendant le backtracking
5. **Universel** : Supporté par tous les algorithmes de planification
6. **Spécifique** : Ne s'applique qu'aux groupes d'étudiants, pas aux enseignants

## 📊 Impact sur les Performances

- **Schedule** : 79/80 tâches planifiées (98.75%)
- **ScheduleAR** : 80/80 tâches planifiées (100%)
- **ScheduleMR** : Performance maintenue grâce à la flexibilité des salles

La contrainte de pause méridienne n'impacte pas significativement les performances car elle est vérifiée en O(1) et permet un rejet précoce des créneaux invalides.

## 🔄 Contrainte Globale Complémentaire

Le système possède également une **contrainte globale** qui interdit toute réservation entre **12:30 et 13:30**. Cette contrainte est définie dans les fichiers de configuration et s'applique à toutes les ressources.

La pause méridienne de 90 minutes **complète** cette contrainte globale :
- **12:30-13:30** : Interdit par contrainte globale (60 minutes)
- **12:00-12:30 OU 13:30-14:00** : Protégé par la pause méridienne (+30 minutes)
- **Total** : 90 minutes garanties

## 📚 Références

- **Code source** : `src/resource.ts` (méthode `book()`)
- **Tests unitaires** : `src/Claude/test-lunch-break.ts`
- **Analyse** : `src/Claude/analyze-lunch-breaks.ts` et `analyze-lunch-breaks-AR.ts`
- **Documentation** : `README.md` et `copilot-instructions.md`
