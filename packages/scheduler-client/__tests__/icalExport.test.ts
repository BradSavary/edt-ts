import { describe, it, expect } from 'vitest';
import { generateIcalContent } from '../lib/icalExport';
import type { TaskSolutionJSON } from '@edt-ts/scheduler-common';

function makeTask(overrides: Partial<TaskSolutionJSON> = {}): TaskSolutionJSON {
  return {
    taskId: 'task-0',
    code: 'R101',
    name: 'Algorithmique',
    type: 'CM',
    week: 47,
    startTime: 480, // lundi 08:00
    duration: 120,
    resources: [
      { id: 'DUPONT Jean', type: 'teacher' },
      { id: 'A101', type: 'room' },
    ],
    ...overrides,
  };
}

describe('generateIcalContent', () => {
  describe('structure globale', () => {
    it('génère un fichier iCal avec BEGIN:VCALENDAR et END:VCALENDAR', () => {
      const content = generateIcalContent([makeTask()], 47);
      expect(content).toContain('BEGIN:VCALENDAR');
      expect(content).toContain('END:VCALENDAR');
    });

    it('contient VERSION:2.0', () => {
      expect(generateIcalContent([makeTask()], 47)).toContain('VERSION:2.0');
    });

    it('utilise \\r\\n comme séparateur de lignes (RFC 5545)', () => {
      const content = generateIcalContent([makeTask()], 47);
      expect(content).toContain('\r\n');
    });

    it('retourne uniquement l\'entête si aucune tâche', () => {
      const content = generateIcalContent([], 47);
      expect(content).toContain('BEGIN:VCALENDAR');
      expect(content).not.toContain('BEGIN:VEVENT');
    });
  });

  describe('VEVENT', () => {
    it('contient BEGIN:VEVENT et END:VEVENT pour chaque tâche', () => {
      const content = generateIcalContent(
        [makeTask(), makeTask({ taskId: 'task-1', code: 'R102' })],
        47,
      );
      const veventCount = (content.match(/BEGIN:VEVENT/g) ?? []).length;
      expect(veventCount).toBe(2);
    });

    it('le SUMMARY contient le code et le type du cours', () => {
      const content = generateIcalContent([makeTask()], 47);
      expect(content).toContain('SUMMARY:R101 CM');
    });

    it('le DTSTART correspond à lundi 08:00 de la semaine 47 2025', () => {
      // Semaine 47 2025 : lundi 17 novembre 2025 08:00
      const content = generateIcalContent([makeTask({ startTime: 480 })], 47);
      expect(content).toContain('DTSTART:20251117T080000');
    });

    it('DTEND = startTime + duration (08:00 + 120min → 10:00)', () => {
      const content = generateIcalContent([makeTask({ startTime: 480, duration: 120 })], 47);
      expect(content).toContain('DTEND:20251117T100000');
    });

    it('un cours le mardi (startTime=24*60+480) → DTSTART mardi 08:00', () => {
      const content = generateIcalContent(
        [makeTask({ startTime: 24 * 60 + 480 })],
        47,
      );
      // Mardi 18 novembre 2025 08:00
      expect(content).toContain('DTSTART:20251118T080000');
    });

    it('le LOCATION contient la première salle', () => {
      const content = generateIcalContent([makeTask()], 47);
      expect(content).toContain('LOCATION:A101');
    });

    it('contient un UID unique par tâche', () => {
      const content = generateIcalContent([makeTask({ taskId: 'unique-id-123' })], 47);
      expect(content).toContain('unique-id-123');
    });

    it('contient DTSTAMP (horodatage de génération)', () => {
      const content = generateIcalContent([makeTask()], 47);
      expect(content).toContain('DTSTAMP:');
    });
  });

  describe('ressources', () => {
    it('inclut ORGANIZER avec le nom de l\'enseignant', () => {
      const content = generateIcalContent([makeTask()], 47);
      expect(content).toContain('DUPONT Jean');
    });

    it('génère CATEGORIES avec les groupes', () => {
      const task = makeTask({
        resources: [
          { id: 'DUPONT Jean', type: 'teacher' },
          { id: 'A101', type: 'room' },
          { id: 'BUT1-G1', type: 'group' },
        ],
      });
      const content = generateIcalContent([task], 47);
      expect(content).toContain('CATEGORIES:BUT1-G1');
    });

    it('n\'inclut pas LOCATION si aucune salle', () => {
      const task = makeTask({
        resources: [{ id: 'DUPONT Jean', type: 'teacher' }],
      });
      const content = generateIcalContent([task], 47);
      expect(content).not.toContain('LOCATION:');
    });
  });
});
