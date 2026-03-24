import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EnforceModal from '../app/EnforceModal';
import type { CourseTaskData } from '@edt-ts/scheduler-common';

const baseCourse: CourseTaskData = {
  week: 47,
  semester: 1,
  level: 0,
  code: 'R101',
  name: 'Algorithmique',
  type: 'CM',
  teacher: ['DUPONT Jean'],
  groups: ['G1'],
  rooms: ['A101'],
  duration: 120,
};

describe('EnforceModal', () => {
  describe('rendu', () => {
    it('affiche le titre "Imposer le cours"', () => {
      render(
        <EnforceModal
          courseKey="0"
          course={baseCourse}
          startTime={480}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      );
      expect(screen.getByText(/Imposer le cours/i)).toBeInTheDocument();
    });

    it('affiche le code et le nom du cours', () => {
      render(
        <EnforceModal
          courseKey="0"
          course={baseCourse}
          startTime={480}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      );
      expect(screen.getByText(/R101/)).toBeInTheDocument();
      expect(screen.getByText(/Algorithmique/)).toBeInTheDocument();
    });

    it('affiche la durée du cours', () => {
      render(
        <EnforceModal
          courseKey="0"
          course={baseCourse}
          startTime={480}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      );
      expect(screen.getByText(/120 min/)).toBeInTheDocument();
    });

    it('affiche les boutons Confirmer et Annuler', () => {
      render(
        <EnforceModal
          courseKey="0"
          course={baseCourse}
          startTime={480}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      );
      expect(screen.getByRole('button', { name: /Confirmer/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Annuler/i })).toBeInTheDocument();
    });

    it('n\'affiche pas de sélecteur d\'alternatives si ressources fixes uniquement', () => {
      render(
        <EnforceModal
          courseKey="0"
          course={baseCourse}
          startTime={480}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      );
      expect(screen.queryByText(/Enseignant \(choix\)/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Salle \(choix\)/i)).not.toBeInTheDocument();
    });
  });

  describe('alternatives de ressources', () => {
    it('affiche les radios de choix d\'enseignant quand alternatives présentes', () => {
      const courseWithAltTeacher: CourseTaskData = {
        ...baseCourse,
        teacher: [['DUPONT Jean', 'MARTIN Paul']],
      };
      render(
        <EnforceModal
          courseKey="0"
          course={courseWithAltTeacher}
          startTime={480}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      );
      expect(screen.getByText(/Enseignant \(choix\)/i)).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /DUPONT Jean/ })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /MARTIN Paul/ })).toBeInTheDocument();
    });

    it('affiche les radios de choix de salle quand alternatives présentes', () => {
      const courseWithAltRooms: CourseTaskData = {
        ...baseCourse,
        rooms: [['A101', 'B201']],
      };
      render(
        <EnforceModal
          courseKey="0"
          course={courseWithAltRooms}
          startTime={480}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      );
      expect(screen.getByText(/Salle \(choix\)/i)).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'A101' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'B201' })).toBeInTheDocument();
    });

    it('la première alternative est sélectionnée par défaut', () => {
      const courseWithAltTeacher: CourseTaskData = {
        ...baseCourse,
        teacher: [['DUPONT Jean', 'MARTIN Paul']],
      };
      render(
        <EnforceModal
          courseKey="0"
          course={courseWithAltTeacher}
          startTime={480}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      );
      expect(screen.getByRole('radio', { name: /DUPONT Jean/ })).toBeChecked();
      expect(screen.getByRole('radio', { name: /MARTIN Paul/ })).not.toBeChecked();
    });

    it('changer la sélection met à jour le radio', () => {
      const courseWithAltTeacher: CourseTaskData = {
        ...baseCourse,
        teacher: [['DUPONT Jean', 'MARTIN Paul']],
      };
      render(
        <EnforceModal
          courseKey="0"
          course={courseWithAltTeacher}
          startTime={480}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      );
      const martinRadio = screen.getByRole('radio', { name: /MARTIN Paul/ });
      fireEvent.click(martinRadio);
      expect(martinRadio).toBeChecked();
    });
  });

  describe('callbacks', () => {
    it('appelle onCancel quand on clique sur Annuler', () => {
      const onCancel = vi.fn();
      render(
        <EnforceModal
          courseKey="0"
          course={baseCourse}
          startTime={480}
          onConfirm={vi.fn()}
          onCancel={onCancel}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: /Annuler/i }));
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it('appelle onConfirm avec les données correctes (ressources fixes)', () => {
      const onConfirm = vi.fn();
      render(
        <EnforceModal
          courseKey="0"
          course={baseCourse}
          startTime={480}
          onConfirm={onConfirm}
          onCancel={vi.fn()}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: /Confirmer/i }));
      expect(onConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          courseKey: '0',
          startTime: 480,
          teacher: ['DUPONT Jean'],
          groups: ['G1'],
          rooms: ['A101'],
        })
      );
    });

    it('appelle onConfirm avec l\'alternative d\'enseignant choisie', () => {
      const onConfirm = vi.fn();
      const courseWithAlt: CourseTaskData = {
        ...baseCourse,
        teacher: [['DUPONT Jean', 'MARTIN Paul']],
      };
      render(
        <EnforceModal
          courseKey="1"
          course={courseWithAlt}
          startTime={600}
          onConfirm={onConfirm}
          onCancel={vi.fn()}
        />
      );
      fireEvent.click(screen.getByRole('radio', { name: /MARTIN Paul/ }));
      fireEvent.click(screen.getByRole('button', { name: /Confirmer/i }));
      expect(onConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ teacher: ['MARTIN Paul'] })
      );
    });

    it('appelle onCancel en cliquant sur l\'overlay', () => {
      const onCancel = vi.fn();
      const { container } = render(
        <EnforceModal
          courseKey="0"
          course={baseCourse}
          startTime={480}
          onConfirm={vi.fn()}
          onCancel={onCancel}
        />
      );
      // L'overlay est le premier div avec la classe fixed inset-0
      const overlay = container.firstChild as HTMLElement;
      fireEvent.click(overlay);
      expect(onCancel).toHaveBeenCalledOnce();
    });
  });
});
