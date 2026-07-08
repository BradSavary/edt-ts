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
