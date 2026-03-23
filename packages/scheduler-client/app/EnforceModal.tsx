'use client';

import { useState } from 'react';
import type { CourseTaskData, ResourceEntry } from '@edt-ts/scheduler-common';

export interface EnforceSelection {
  courseKey: string;
  startTime: number;
  teacher: string[];
  groups: string[];
  rooms: string[];
}

interface Props {
  courseKey: string;
  course: CourseTaskData;
  startTime: number;
  onConfirm: (sel: EnforceSelection) => void;
  onCancel: () => void;
}

/** Sépare les ressources fixes des alternatives dans un tableau ResourceEntry[]. */
function splitEntries(entries: ResourceEntry[]): { fixed: string[]; alternatives: string[][] } {
  const fixed: string[] = [];
  const alternatives: string[][] = [];
  for (const e of entries) {
    if (Array.isArray(e)) alternatives.push(e);
    else fixed.push(e);
  }
  return { fixed, alternatives };
}

/** Formatte un startTime (minutes depuis lundi) en "Lun 08:00" etc. */
function formatStartTime(startTime: number): string {
  const days = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const dayIndex = Math.floor(startTime / (24 * 60));
  const minutesInDay = startTime % (24 * 60);
  const h = Math.floor(minutesInDay / 60).toString().padStart(2, '0');
  const m = (minutesInDay % 60).toString().padStart(2, '0');
  return `${days[dayIndex] ?? '?'} ${h}:${m}`;
}

export default function EnforceModal({ courseKey, course, startTime, onConfirm, onCancel }: Props) {
  const rooms = splitEntries(course.rooms);
  const teachers = splitEntries(course.teacher);

  // For alternatives, maintain selected index per group
  const [selectedRooms, setSelectedRooms] = useState<Record<number, string>>(() =>
    Object.fromEntries(rooms.alternatives.map((alt, i) => [i, alt[0]]))
  );
  const [selectedTeachers, setSelectedTeachers] = useState<Record<number, string>>(() =>
    Object.fromEntries(teachers.alternatives.map((alt, i) => [i, alt[0]]))
  );

  function handleConfirm() {
    const resolvedTeachers = [
      ...teachers.fixed,
      ...teachers.alternatives.map((_, i) => selectedTeachers[i] ?? ''),
    ].filter(Boolean);

    const resolvedRooms = [
      ...rooms.fixed,
      ...rooms.alternatives.map((_, i) => selectedRooms[i] ?? ''),
    ].filter(Boolean);

    const resolvedGroups = course.groups.flatMap((e) => (Array.isArray(e) ? [e[0]] : [e]));

    onConfirm({
      courseKey,
      startTime,
      teacher: resolvedTeachers,
      groups: resolvedGroups,
      rooms: resolvedRooms,
    });
  }

  const hasAnyAlternative = rooms.alternatives.length > 0 || teachers.alternatives.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-sm p-6 mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-gray-900 dark:text-white mb-1">
          Imposer le cours
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          {course.code} {course.type} — {course.name}
        </p>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">
          Horaire : <span className="font-bold">{formatStartTime(startTime)}</span> ({course.duration} min)
        </p>

        {hasAnyAlternative ? (
          <div className="space-y-4 mb-5">
            {/* Alternatives d'enseignants */}
            {teachers.alternatives.map((alt, i) => (
              <div key={`teacher-alt-${i}`}>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                  Enseignant (choix)
                </label>
                <div className="space-y-1">
                  {alt.map((t) => (
                    <label key={t} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name={`teacher-alt-${i}`}
                        value={t}
                        checked={selectedTeachers[i] === t}
                        onChange={() => setSelectedTeachers((prev) => ({ ...prev, [i]: t }))}
                        className="accent-blue-600"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">{t}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}

            {/* Alternatives de salles */}
            {rooms.alternatives.map((alt, i) => (
              <div key={`room-alt-${i}`}>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                  Salle (choix)
                </label>
                <div className="space-y-1">
                  {alt.map((r) => (
                    <label key={r} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name={`room-alt-${i}`}
                        value={r}
                        checked={selectedRooms[i] === r}
                        onChange={() => setSelectedRooms((prev) => ({ ...prev, [i]: r }))}
                        className="accent-blue-600"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">{r}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
            Aucune alternative — toutes les ressources seront imposées telles quelles.
          </p>
        )}

        <div className="flex gap-3">
          <button
            onClick={handleConfirm}
            className="flex-1 px-4 py-2 bg-black dark:bg-white text-white dark:text-black text-sm font-semibold rounded-lg hover:opacity-90 transition"
          >
            Confirmer
          </button>
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 border border-gray-200 dark:border-zinc-600 text-gray-700 dark:text-gray-300 text-sm font-semibold rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-800 transition"
          >
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}
