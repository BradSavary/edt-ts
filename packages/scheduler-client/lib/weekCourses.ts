import type { CourseTaskDataWithId } from '@/lib/courseId';
import type { WeekSavesMap, PreparedWeekSnapshot } from '@/store/slices/weekSavesSlice';

// Compat ascendante : un snapshot persisté avant le renommage weeklyCourses -> manualCourses
// est *casté* sans validation réelle à l'hydratation (createProjectStorage.getItem). À l'exécution,
// `snapshot.manualCourses` peut donc être `undefined` malgré le typage — ne jamais faire confiance
// au type ici, toujours passer par ce fallback défensif.
type LegacySnapshot = PreparedWeekSnapshot & { weeklyCourses?: CourseTaskDataWithId[] };

/** Cours créés manuellement pour une semaine (vide si la semaine n'a pas de snapshot). */
export function getManualCoursesForWeek(weekSaves: WeekSavesMap, week: number): CourseTaskDataWithId[] {
  const snapshot = weekSaves[String(week)] as LegacySnapshot | undefined;
  if (!snapshot) return [];
  if (snapshot.manualCourses) return snapshot.manualCourses;
  if (snapshot.weeklyCourses) return snapshot.weeklyCourses.filter((c) => c.source === 'manual');
  return [];
}

/**
 * Tous les cours manuels du projet, toutes semaines confondues (ordre des semaines non garanti).
 * Utile pour raisonner sur l'ensemble des cours du projet — ex. décider qu'une ressource n'est
 * plus utilisée nulle part (voir `diffCsvResources`).
 */
export function getAllManualCourses(weekSaves: WeekSavesMap): CourseTaskDataWithId[] {
  return Object.keys(weekSaves).flatMap((week) => getManualCoursesForWeek(weekSaves, Number(week)));
}

/**
 * Union des cours CSV et manuels d'une semaine.
 * CSV toujours en premier (ordre d'origine), manuel toujours en dernier (ordre de création) —
 * cet ordre doit rester stable partout, c'est celui que le moteur de planification reçoit
 * (voir usePlanningStore.runSchedule).
 */
export function getCoursesForWeek(
  allCourses: CourseTaskDataWithId[],
  weekSaves: WeekSavesMap,
  week: number,
): CourseTaskDataWithId[] {
  return [...allCourses.filter((c) => c.week === week), ...getManualCoursesForWeek(weekSaves, week)];
}

/**
 * Élague sélectivement, pour chaque semaine listée dans `removedIdsByWeek`, les références
 * à des ids de cours supprimés dans `taskGroups[].courseKeys`, `manualEnforcedMap`,
 * `preNeutralizedKeys`, ainsi que dans les placements et non-placés persistés
 * (`placements`, `unplaced`, `lastRun`). Un groupe de tâches tombé à moins de 2 membres est
 * retiré entièrement (un groupe à 1 membre n'a plus de sens). `manualCourses` n'est jamais touché.
 *
 * L'élagage défensif fait à la relecture (`setSelectedWeek`) ne remplace pas celui-ci : il masque
 * les fantômes à l'affichage, alors qu'ici on les retire du disque.
 *
 * Les semaines absentes de `removedIdsByWeek` (ou sans snapshot) gardent leur référence
 * d'objet strictement inchangée — important pour ne pas déclencher de re-render/re-save inutile.
 */
export function pruneWeekSavesOfCourseIds(
  weekSaves: WeekSavesMap,
  removedIdsByWeek: Map<number, Set<string>>,
): WeekSavesMap {
  if (removedIdsByWeek.size === 0) return weekSaves;

  let changed = false;
  const next: WeekSavesMap = { ...weekSaves };

  for (const [week, removedIds] of removedIdsByWeek) {
    if (removedIds.size === 0) continue;
    const key = String(week);
    const snapshot = weekSaves[key];
    if (!snapshot) continue;

    const taskGroups = snapshot.taskGroups
      .map((g) => ({ ...g, courseKeys: g.courseKeys.filter((id) => !removedIds.has(id)) }))
      .filter((g) => g.courseKeys.length >= 2);

    const preNeutralizedKeys = snapshot.preNeutralizedKeys.filter((id) => !removedIds.has(id));

    const manualEnforcedMap = Object.fromEntries(
      Object.entries(snapshot.manualEnforcedMap).filter(([id]) => !removedIds.has(id)),
    );

    const placements = snapshot.placements?.filter((p) => !removedIds.has(p.taskId));
    const unplaced = snapshot.unplaced?.filter((u) => !removedIds.has(u.taskId));
    const lastRun = snapshot.lastRun && {
      placements: snapshot.lastRun.placements.filter((p) => !removedIds.has(p.taskId)),
      unplaced: snapshot.lastRun.unplaced.filter((u) => !removedIds.has(u.taskId)),
    };

    next[key] = {
      ...snapshot,
      taskGroups,
      preNeutralizedKeys,
      manualEnforcedMap,
      ...(placements ? { placements } : {}),
      ...(unplaced ? { unplaced } : {}),
      ...(lastRun ? { lastRun } : {}),
    };
    changed = true;
  }

  return changed ? next : weekSaves;
}
