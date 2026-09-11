import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SchedulerConfigDialog } from '@/components/planning/modals/SchedulerConfigDialog';
import { useAppConfigStore } from '@/store/useAppConfigStore';
import { DEFAULT_SCHEDULER_CONFIG } from '@edt-ts/scheduler-common';

function openDialog() {
  fireEvent.click(screen.getByRole('button', { name: /Paramètres de planification/i }));
}

beforeEach(() => {
  useAppConfigStore.setState({ schedulerConfig: DEFAULT_SCHEDULER_CONFIG });
});

describe('SchedulerConfigDialog', () => {
  it('aucune option core-only rendue (moteur, stratégie de recherche, itérations/éliminations)', () => {
    render(<SchedulerConfigDialog />);
    openDialog();

    expect(screen.queryByText(/^Moteur$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Stratégie de recherche/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Itérations max/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Éliminations max/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Priorité aux tâches en échec/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Analyse exacte des conflits/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Réparation post-résolution/i)).not.toBeInTheDocument();
  });

  it('le timeout et la limite journalière restent des réglages présents', () => {
    render(<SchedulerConfigDialog />);
    openDialog();

    expect(screen.getByLabelText(/Timeout \(secondes\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Ignorer les limites journalières/i)).toBeInTheDocument();
  });

  it("l'onglet Flottante est présent mais désactivé", () => {
    render(<SchedulerConfigDialog />);
    openDialog();

    const floatingTab = screen.getByRole('tab', { name: /Flottante/i });
    expect(floatingTab).toBeInTheDocument();
    expect(floatingTab).toBeDisabled();
    expect(screen.getByText(/Pause flottante non supportée par le moteur/i)).toBeInTheDocument();
  });

  it('les préférences douces enseignant sont toujours visibles (aucun garde par moteur)', () => {
    render(<SchedulerConfigDialog />);
    openDialog();

    expect(screen.getByLabelText(/Minimiser le nombre de jours/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Réduire les demi-journées sous-utilisées/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Compacter la journée d.+enseignant/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Limiter les changements de salle/i)).toBeInTheDocument();
  });

  it('cocher les quatre préférences douces et valider : les valeurs survivent à une réouverture', () => {
    render(<SchedulerConfigDialog />);
    openDialog();

    fireEvent.click(screen.getByLabelText(/Minimiser le nombre de jours/i));
    fireEvent.click(screen.getByLabelText(/Réduire les demi-journées sous-utilisées/i));
    fireEvent.click(screen.getByLabelText(/Compacter la journée d.+enseignant/i));
    fireEvent.click(screen.getByLabelText(/Limiter les changements de salle/i));
    fireEvent.click(screen.getByRole('button', { name: /Valider/i }));

    expect(useAppConfigStore.getState().schedulerConfig.minimizeTeacherDays).toBe(true);
    expect(useAppConfigStore.getState().schedulerConfig.reduceTeacherHalfDays).toBe(true);
    expect(useAppConfigStore.getState().schedulerConfig.compactTeacherDay).toBe(true);
    expect(useAppConfigStore.getState().schedulerConfig.minimizeTeacherRoomChanges).toBe(true);

    openDialog();
    expect(screen.getByLabelText(/Minimiser le nombre de jours/i)).toBeChecked();
    expect(screen.getByLabelText(/Réduire les demi-journées sous-utilisées/i)).toBeChecked();
    expect(screen.getByLabelText(/Compacter la journée d.+enseignant/i)).toBeChecked();
    expect(screen.getByLabelText(/Limiter les changements de salle/i)).toBeChecked();
  });

  it('rouvrir le dialog recharge le draft depuis le store', () => {
    useAppConfigStore.setState({
      schedulerConfig: { ...DEFAULT_SCHEDULER_CONFIG, minimizeTeacherDays: true },
    });
    render(<SchedulerConfigDialog />);
    openDialog();

    expect(screen.getByLabelText(/Minimiser le nombre de jours/i)).toBeChecked();
  });
});
