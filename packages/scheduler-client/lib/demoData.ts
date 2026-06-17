import { parseCsvFull } from '@/lib/parseCsvCourses';
import { useSchedulerStore } from '@/store/useSchedulerStore';
import { usePlanningStore } from '@/store/usePlanningStore';
import type { ConstraintsRecord } from '@/store/slices/constraintsSlice';
import DEMO_CSV from '@/data/cours-demo';
import DEMO_CONSTRAINTS from '@/data/contraintes-demo.json';

export async function loadDemoData(): Promise<void> {
  const { courses, resources, resourceWeeks } = parseCsvFull(DEMO_CSV);
  const constraintsData = DEMO_CONSTRAINTS as unknown as ConstraintsRecord;

  const store = useSchedulerStore.getState();
  store.setCourses(courses, 'cours-demo.csv');
  store.setResources(resources);
  store.setResourceWeeks(resourceWeeks);
  store.clearAllWeekSaves();
  const allNewIds = resources.flatMap((g) => g.resources.map((r) => r.id));
  store.pruneConstraints(allNewIds);
  store.importConstraints(constraintsData);
  usePlanningStore.getState().handleEnforceChange({});
}
