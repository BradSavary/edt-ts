import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TaskCard from '@/components/planning/courses/TaskCard';

const baseProps = {
  code: 'R101',
  name: 'Algorithmique',
  type: 'CM',
  teachers: ['DUPONT Jean'],
  groups: ['G1', 'G2'],
  rooms: ['A101'],
  duration: 120,
};

describe('TaskCard', () => {
  describe('rendu', () => {
    it('affiche le code et le type du cours', () => {
      render(<TaskCard {...baseProps} />);
      expect(screen.getByText('R101')).toBeInTheDocument();
      expect(screen.getByText('CM')).toBeInTheDocument();
    });

    it('affiche le nom du cours', () => {
      render(<TaskCard {...baseProps} />);
      expect(screen.getByText('Algorithmique')).toBeInTheDocument();
    });

    it("affiche l'enseignant", () => {
      render(<TaskCard {...baseProps} />);
      expect(screen.getByText('DUPONT Jean')).toBeInTheDocument();
    });

    it('affiche les groupes séparés par des virgules', () => {
      render(<TaskCard {...baseProps} />);
      expect(screen.getByText('G1, G2')).toBeInTheDocument();
    });

    it('affiche la durée en minutes', () => {
      render(<TaskCard {...baseProps} />);
      expect(screen.getByText('120min')).toBeInTheDocument();
    });

    it('affiche la salle', () => {
      render(<TaskCard {...baseProps} />);
      expect(screen.getByText('A101')).toBeInTheDocument();
    });

    it('affiche le message quand aucune salle', () => {
      render(<TaskCard {...baseProps} rooms={[]} />);
      expect(screen.getByText('Pas de salle par défaut')).toBeInTheDocument();
    });
  });

  describe('attributs data- (mode cours)', () => {
    it('définit data-course-key', () => {
      const { container } = render(<TaskCard {...baseProps} courseKey="42" />);
      const div = container.firstChild as HTMLElement;
      expect(div.getAttribute('data-course-key')).toBe('42');
    });

    it('définit data-title avec code et type', () => {
      const { container } = render(<TaskCard {...baseProps} courseKey="0" />);
      const div = container.firstChild as HTMLElement;
      expect(div.getAttribute('data-title')).toBe('R101 CM');
    });

    it('définit data-duration avec la durée en minutes', () => {
      const { container } = render(<TaskCard {...baseProps} courseKey="0" />);
      const div = container.firstChild as HTMLElement;
      expect(div.getAttribute('data-duration')).toBe('120');
    });

    it('ne définit pas data-course-key quand isNeutralized=true', () => {
      const { container } = render(<TaskCard {...baseProps} courseKey="0" isNeutralized />);
      const div = container.firstChild as HTMLElement;
      expect(div.getAttribute('data-course-key')).toBeNull();
    });
  });

  describe('attributs data- (mode tâche neutralisée)', () => {
    it('définit data-task-id et les attributs ressources', () => {
      const { container } = render(<TaskCard {...baseProps} taskId="task-1" />);
      const div = container.firstChild as HTMLElement;
      expect(div.getAttribute('data-task-id')).toBe('task-1');
      expect(div.getAttribute('data-teachers')).toBe('["DUPONT Jean"]');
      expect(div.getAttribute('data-groups')).toBe('["G1","G2"]');
      expect(div.getAttribute('data-rooms')).toBe('["A101"]');
    });
  });

  describe('état isEnforced', () => {
    it("affiche l'indicateur 📌 Imposé quand isEnforced=true", () => {
      render(<TaskCard {...baseProps} isEnforced />);
      expect(screen.getByText(/Imposé/i)).toBeInTheDocument();
    });

    it("n'affiche pas l'indicateur Imposé par défaut", () => {
      render(<TaskCard {...baseProps} />);
      expect(screen.queryByText(/Imposé/i)).not.toBeInTheDocument();
    });
  });

  describe('alternatives de ressources', () => {
    it('affiche les alternatives enseignants séparées par " | "', () => {
      render(<TaskCard {...baseProps} teachers={['DUPONT Jean | MARTIN Paul']} />);
      expect(screen.getByText('DUPONT Jean | MARTIN Paul')).toBeInTheDocument();
    });
  });
});
