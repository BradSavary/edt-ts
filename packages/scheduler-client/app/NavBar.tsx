'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const NAV_LINKS = [
  { href: '/', label: 'Planification' },
  { href: '/constraints', label: 'Contraintes' },
];

export function NavBar() {
  const pathname = usePathname();

  return (
    <nav className="shrink-0 border-b border-border bg-card flex items-end gap-0 px-6">
      <span className="text-sm font-bold tracking-tight text-foreground mr-6 pb-2.5">EDT-TS</span>
      {NAV_LINKS.map(({ href, label }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'relative px-3 pb-2.5 pt-2 text-sm transition-colors',
              active
                ? 'text-foreground font-medium after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary after:rounded-t-full'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
