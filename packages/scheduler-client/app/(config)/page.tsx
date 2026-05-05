'use client';

import { CoursesImportBlock } from '@/components/config/CoursesImportBlock';
import { YearColorBlock } from '@/components/config/YearColorBlock';
import { SchoolYearBlock } from '@/components/config/SchoolYearBlock';
import { TightThresholdBlock } from '@/components/config/TightThresholdBlock';

export default function ConfigPage() {
  return (
    <div className="max-w-5xl mx-auto p-8">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <CoursesImportBlock />
        <YearColorBlock />
        <SchoolYearBlock />
        <TightThresholdBlock />
      </div>
    </div>
  );
}

