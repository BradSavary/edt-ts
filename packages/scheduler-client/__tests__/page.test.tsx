import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SchedulePage from '../app/page';

describe('SchedulePage', () => {
  it('affiche le titre de la section Planification', () => {
    render(<SchedulePage />);
    expect(screen.getByText(/Planification/i)).toBeInTheDocument();
  });

  it('affiche le bouton Planifier', () => {
    render(<SchedulePage />);
    expect(screen.getByRole('button', { name: /Planifier/i })).toBeInTheDocument();
  });

  it('le bouton Planifier est actif par défaut', () => {
    render(<SchedulePage />);
    expect(screen.getByRole('button', { name: /Planifier/i })).not.toBeDisabled();
  });
});
