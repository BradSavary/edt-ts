'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { usePlanningStore } from '@/store/usePlanningStore';
import { Button } from '@/components/ui/button';

const NAV_LINKS = [
  { href: '/', label: 'Accueil' },
  { href: '/project', label: 'Paramètres' },
  { href: '/planning', label: 'Planification' },
  { href: '/constraints', label: 'Contraintes' },
];

export function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const pendingJobResult = usePlanningStore((s) => s.pendingJobResult);
  const applyPendingResult = usePlanningStore((s) => s.applyPendingResult);

  function handleViewResult() {
    applyPendingResult();
    router.push('/planning');
  }

  return (
    <nav className="shrink-0 border-b border-border bg-card flex items-center gap-0 px-6">
      <span className="text-sm font-bold tracking-tight text-foreground mr-6">EDT-TS</span>
      {NAV_LINKS.map(({ href, label }) => {
        const active = pathname === href || pathname === href + '/';
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'relative px-3 pb-2.5 pt-2 text-sm transition-colors',
              active
                ? "text-foreground font-medium after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary after:rounded-t-full"
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </Link>
        );
      })}
      {pendingJobResult && (
        <div className="ml-auto flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
          <span>✅ Semaine {pendingJobResult.week} planifiée</span>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={handleViewResult}>
            Voir le résultat
          </Button>
        </div>
      )}
    </nav>
  );
}
