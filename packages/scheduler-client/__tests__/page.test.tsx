import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SchedulePage from '../app/page';

describe('SchedulePage', () => {
  it('renders the scheduling form heading', () => {
    render(<SchedulePage />);
    expect(screen.getByRole('heading', { name: /Planification/i })).toBeInTheDocument();
  });

  it('renders the submit button', () => {
    render(<SchedulePage />);
    expect(screen.getByRole('button', { name: /Envoyer/i })).toBeInTheDocument();
  });

  it('submit button is enabled by default', () => {
    render(<SchedulePage />);
    expect(screen.getByRole('button', { name: /Envoyer/i })).not.toBeDisabled();
  });
});
