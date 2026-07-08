'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { ProjectIdentityBlock } from '@/components/config/ProjectIdentityBlock';
import { CoursesImportBlock } from '@/components/config/CoursesImportBlock';
import { YearColorBlock } from '@/components/config/YearColorBlock';
import { SchoolYearBlock } from '@/components/config/SchoolYearBlock';
import { TightThresholdBlock } from '@/components/config/TightThresholdBlock';
import { ConstraintsImportExportBlock } from '@/components/config/ConstraintsImportExportBlock';
import { hasMigrationBanner, clearMigrationBanner } from '@/lib/project/legacyMigration';

function subscribe(): () => void {
  return () => {};
}

export default function ProjectSettingsPage() {
  // Lecture pure (pas de setState en effet) : hasMigrationBanner() ne mute rien,
  // l'effacement du flag est fait séparément ci-dessous.
  const showMigrationBanner = useSyncExternalStore(subscribe, hasMigrationBanner, () => false);

  useEffect(() => {
    clearMigrationBanner();
  }, []);

  return (
    <div className="max-w-5xl mx-auto p-8 flex flex-col gap-6">
      {showMigrationBanner && (
        <div className="flex items-start gap-2 rounded-md border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950/30 px-3 py-2">
          <span className="text-yellow-600 dark:text-yellow-400 text-xs shrink-0">⚠️</span>
          <span className="text-xs text-yellow-700 dark:text-yellow-300">
            Ce projet a été migré automatiquement depuis votre ancienne configuration.
            Vérifiez l&apos;année scolaire et rechargez les vacances si besoin.
          </span>
        </div>
      )}

      <ProjectIdentityBlock />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <CoursesImportBlock />
        <SchoolYearBlock />
        <ConstraintsImportExportBlock />
        <YearColorBlock />
        <TightThresholdBlock />
      </div>
    </div>
  );
}
