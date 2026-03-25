'use client';

import { useState } from 'react';

export interface TaskEditUpdate {
  teachers: string[];
  groups: string[];
  rooms: string[];
}

interface Props {
  title: string;
  /** Valeurs courantes assignées */
  teachers: string[];
  groups: string[];
  rooms: string[];
  /** Listes complètes disponibles (issues du resources.json) */
  teacherOptions: string[];
  groupOptions: string[];
  roomOptions: string[];
  onConfirm: (update: TaskEditUpdate) => void;
  onCancel: () => void;
}

interface ResourceSlotProps {
  label: string;
  values: string[];
  options: string[];
  onChange: (index: number, val: string) => void;
}

/** Affiche une <select> par ressource assignée, peuplée par options. */
function ResourceSlots({ label, values, options, onChange }: ResourceSlotProps) {
  if (values.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
        {label}
      </p>
      {values.map((val, i) => (
        <select
          key={i}
          value={val}
          onChange={(e) => onChange(i, e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-sm text-gray-800 dark:text-gray-200 mb-1"
        >
          {options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
          {/* Inclure la valeur actuelle si absent des options */}
          {!options.includes(val) && (
            <option value={val}>{val}</option>
          )}
        </select>
      ))}
    </div>
  );
}

export default function TaskEditModal({ title, teachers, groups, rooms, teacherOptions, groupOptions, roomOptions, onConfirm, onCancel }: Props) {
  const [selTeachers, setSelTeachers] = useState<string[]>(teachers);
  const [selGroups, setSelGroups] = useState<string[]>(groups);
  const [selRooms, setSelRooms] = useState<string[]>(rooms);

  function handleConfirm() {
    onConfirm({ teachers: selTeachers, groups: selGroups, rooms: selRooms });
  }

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
          Modifier les ressources
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 truncate">{title}</p>

        <div className="space-y-4 mb-5">
          <ResourceSlots
            label="Enseignant(s)"
            values={selTeachers}
            options={teacherOptions}
            onChange={(i, v) => setSelTeachers((p) => p.map((x, j) => (j === i ? v : x)))}
          />
          <ResourceSlots
            label="Groupe(s)"
            values={selGroups}
            options={groupOptions}
            onChange={(i, v) => setSelGroups((p) => p.map((x, j) => (j === i ? v : x)))}
          />
          <ResourceSlots
            label="Salle(s)"
            values={selRooms}
            options={roomOptions}
            onChange={(i, v) => setSelRooms((p) => p.map((x, j) => (j === i ? v : x)))}
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 border border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-gray-300 text-sm font-semibold rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-800 transition"
          >
            Annuler
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition"
          >
            Confirmer
          </button>
        </div>
      </div>
    </div>
  );
}