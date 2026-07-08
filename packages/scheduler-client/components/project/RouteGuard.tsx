'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useProjectStore } from '@/store/useProjectStore';
import { useHydrated } from '@/hooks/useHydrated';

/** Enlève le slash final éventuel (next.config.ts: trailingSlash: true), sauf pour "/". */
function normalizePath(pathname: string | null): string {
  if (!pathname) return '/';
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}

/**
 * Bloque /planning et /constraints tant qu'aucun projet n'a de cours,
 * et /project tant qu'aucun projet n'existe. L'app est en export statique
 * (next.config.ts: output: 'export') : aucun middleware serveur possible,
 * ce garde est nécessairement client-side et doit attendre `useHydrated()`
 * pour ne pas rediriger avant que zustand/persist ait relu localStorage.
 */
export function RouteGuard({ children }: { children: React.ReactNode }) {
  const mounted = useHydrated();
  const pathname = normalizePath(usePathname());
  const router = useRouter();
  const hasProject = useProjectStore((s) => s.projectName !== null);
  const hasCourses = useProjectStore((s) => s.allCourses.length > 0);

  const needsProjectAndCourses = pathname === '/planning' || pathname === '/constraints';
  const needsProject = pathname === '/project';

  useEffect(() => {
    if (!mounted) return;
    if (needsProjectAndCourses && (!hasProject || !hasCourses)) {
      router.replace(hasProject ? '/project' : '/');
      return;
    }
    if (needsProject && !hasProject) {
      router.replace('/');
    }
  }, [mounted, hasProject, hasCourses, needsProjectAndCourses, needsProject, router]);

  const blocked = mounted && (
    (needsProjectAndCourses && (!hasProject || !hasCourses)) ||
    (needsProject && !hasProject)
  );
  if (blocked) return null; // évite un flash du contenu pendant la redirection

  return <>{children}</>;
}
