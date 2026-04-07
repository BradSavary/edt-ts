import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PlanningPage from '../app/planning/page';

describe('PlanningPage', () => {
  it('affiche le titre de la section Planification', () => {
    render(<PlanningPage />);
    expect(screen.getByText(/Planification/i)).toBeInTheDocument();
  });

  it('affiche le bouton Planifier', () => {
    render(<PlanningPage />);
    expect(screen.getByRole('button', { name: /Planifier/i })).toBeInTheDocument();
  });

  it('le bouton Planifier est actif par défaut', () => {
    render(<PlanningPage />);
    expect(screen.getByRole('button', { name: /Planifier/i })).not.toBeDisabled();
  });
});
