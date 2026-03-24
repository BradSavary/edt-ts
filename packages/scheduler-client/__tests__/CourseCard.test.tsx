import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CourseCard from '../app/CourseCard';
import type { CourseTaskData } from '@edt-ts/scheduler-common';

const baseCourse: CourseTaskData = {
  week: 47,
  semester: 1,
  level: 0,
  code: 'R101',
  name: 'Algorithmique',
  type: 'CM',
  teacher: ['DUPONT Jean'],
  groups: ['G1', 'G2'],
  rooms: ['A101'],
  duration: 120,
};

describe('CourseCard', () => {
  describe('rendu', () => {
    it('affiche le code et le type du cours', () => {
      render(<CourseCard courseKey="0" course={baseCourse} enforced={false} />);
      expect(screen.getByText('R101')).toBeInTheDocument();
      expect(screen.getByText('CM')).toBeInTheDocument();
    });

    it('affiche le nom du cours', () => {
      render(<CourseCard courseKey="0" course={baseCourse} enforced={false} />);
      expect(screen.getByText('Algorithmique')).toBeInTheDocument();
    });

    it('affiche l\'enseignant', () => {
      render(<CourseCard courseKey="0" course={baseCourse} enforced={false} />);
      expect(screen.getByText('DUPONT Jean')).toBeInTheDocument();
    });

    it('affiche les groupes séparés par des virgules', () => {
      render(<CourseCard courseKey="0" course={baseCourse} enforced={false} />);
      expect(screen.getByText('G1, G2')).toBeInTheDocument();
    });

    it('affiche la durée en minutes', () => {
      render(<CourseCard courseKey="0" course={baseCourse} enforced={false} />);
      expect(screen.getByText('120min')).toBeInTheDocument();
    });
  });

  describe('attributs data-', () => {
    it('définit data-course-key', () => {
      const { container } = render(
        <CourseCard courseKey="42" course={baseCourse} enforced={false} />
      );
      const div = container.firstChild as HTMLElement;
      expect(div.getAttribute('data-course-key')).toBe('42');
    });

    it('définit data-title avec code et type', () => {
      const { container } = render(
        <CourseCard courseKey="0" course={baseCourse} enforced={false} />
      );
      const div = container.firstChild as HTMLElement;
      expect(div.getAttribute('data-title')).toBe('R101 CM');
    });

    it('définit data-duration avec la durée en minutes', () => {
      const { container } = render(
        <CourseCard courseKey="0" course={baseCourse} enforced={false} />
      );
      const div = container.firstChild as HTMLElement;
      expect(div.getAttribute('data-duration')).toBe('120');
    });
  });

  describe('état enforced', () => {
    it('affiche l\'indicateur 📌 Imposé quand enforced=true', () => {
      render(<CourseCard courseKey="0" course={baseCourse} enforced={true} />);
      expect(screen.getByText(/Imposé/i)).toBeInTheDocument();
    });

    it('n\'affiche pas l\'indicateur Imposé quand enforced=false', () => {
      render(<CourseCard courseKey="0" course={baseCourse} enforced={false} />);
      expect(screen.queryByText(/Imposé/i)).not.toBeInTheDocument();
    });
  });

  describe('alternatives de ressources', () => {
    it('affiche les alternatives d\'enseignants séparées par " | "', () => {
      const courseWithAlt: CourseTaskData = {
        ...baseCourse,
        teacher: [['DUPONT Jean', 'MARTIN Paul']],
      };
      render(<CourseCard courseKey="0" course={courseWithAlt} enforced={false} />);
      expect(screen.getByText('DUPONT Jean | MARTIN Paul')).toBeInTheDocument();
    });
  });
});
