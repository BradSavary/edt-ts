'use client';

import { useRouter } from 'next/navigation';
import { usePlanningStore } from '@/store/usePlanningStore';
import { Button } from '@/components/ui/button';

export function JobNotificationBanner() {
  const router = useRouter();
  const pendingJobResult = usePlanningStore((s) => s.pendingJobResult);

  if (!pendingJobResult) return null;

  return (
    <div
      role="alert"
      className="flex items-center gap-3 px-4 py-1.5 bg-green-600 text-white text-sm"
    >
      <span>✅ Planification semaine {pendingJobResult.week} terminée</span>
      <Button
        size="sm"
        variant="secondary"
        className="h-6 px-2 text-xs"
        onClick={() => router.push(`/planning?week=${pendingJobResult.week}`)}
      >
        Voir le résultat
      </Button>
    </div>
  );
}
