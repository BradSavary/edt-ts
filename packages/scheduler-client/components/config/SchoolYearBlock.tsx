'use client';

import { useProjectStore } from '@/store/useProjectStore';
import { SchoolYearPicker } from './SchoolYearPicker';

/** Wrapper fin autour de `SchoolYearPicker`, lié au projet actif. */
export function SchoolYearBlock() {
  const schoolYearConfig = useProjectStore((s) => s.schoolYearConfig);
  const setSchoolYearConfig = useProjectStore((s) => s.setSchoolYearConfig);

  return <SchoolYearPicker initialConfig={schoolYearConfig} onLoaded={setSchoolYearConfig} />;
}
