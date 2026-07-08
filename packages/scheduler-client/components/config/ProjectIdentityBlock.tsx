'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useProjectStore } from '@/store/useProjectStore';
import { stateToProjectFile } from '@/lib/project/projectFile';
import { downloadJson } from '@/lib/downloadJson';
import { getManualCoursesForWeek } from '@/lib/weekCourses';

export function ProjectIdentityBlock() {
  const projectName = useProjectStore((s) => s.projectName);
  const renameProject = useProjectStore((s) => s.renameProject);
  const schoolYearConfig = useProjectStore((s) => s.schoolYearConfig);
  const allCourses = useProjectStore((s) => s.allCourses);
  const weekSaves = useProjectStore((s) => s.weekSaves);

  const manualCourseCount = useMemo(
    () => Object.keys(weekSaves).reduce((sum, week) => sum + getManualCoursesForWeek(weekSaves, Number(week)).length, 0),
    [weekSaves],
  );

  const [name, setName] = useState(projectName ?? '');

  function handleRename() {
    const trimmed = name.trim();
    if (trimmed) renameProject(trimmed);
  }

  function handleExportProject() {
    const file = stateToProjectFile(useProjectStore.getState());
    const safeName = file.name.replace(/[/\\:*?"<>|]/g, '').trim() || 'projet';
    downloadJson(`${safeName}.json`, file);
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
      <div>
        <h2 className="text-sm font-semibold mb-0.5">Projet</h2>
        <p className="text-xs text-muted-foreground">
          {schoolYearConfig?.year ?? '—'} — Zone {schoolYearConfig?.zone ?? '—'} · {allCourses.length + manualCourseCount} cours
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="project-name">Nom du projet</Label>
        <div className="flex gap-2">
          <Input
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); }}
          />
        </div>
        <p className="text-xs text-muted-foreground">Utilisé comme nom de fichier lors de l&apos;export.</p>
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={handleExportProject}>
          Exporter le projet complet
        </Button>
        <Link href="/" className="text-xs text-muted-foreground underline hover:text-foreground">
          Changer de projet
        </Link>
      </div>
    </div>
  );
}
