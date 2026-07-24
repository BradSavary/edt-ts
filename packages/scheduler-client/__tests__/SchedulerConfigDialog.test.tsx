import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SchedulerConfigDialog } from '@/components/planning/modals/SchedulerConfigDialog';
import { useAppConfigStore } from '@/store/useAppConfigStore';
import { DEFAULT_SCHEDULER_CONFIG } from '@edt-ts/scheduler-common';

function openDialog() {
  fireEvent.click(screen.getByRole('button', { name: /Paramètres de planification/i }));
}

beforeEach(() => {
  useAppConfigStore.setState({ schedulerConfig: DEFAULT_SCHEDULER_CONFIG });
});

describe('SchedulerConfigDialog — sélecteur de moteur', () => {
  it("engine='core' par défaut : les champs core-only sont visibles, l'onglet Flottante activé", () => {
    render(<SchedulerConfigDialog />);
    openDialog();

    expect(screen.getByRole('radio', { name: /Élimination \/ Placement \(core\)/i })).toBeChecked();
    expect(screen.getByText(/Stratégie de recherche/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Itérations max/i)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Flottante/i })).not.toBeDisabled();
  });

  it("passer sur CP-SAT masque les champs core-only et désactive l'onglet Flottante", () => {
    render(<SchedulerConfigDialog />);
    openDialog();

    fireEvent.click(screen.getByRole('radio', { name: /CP-SAT \(OR-Tools\)/i }));

    expect(screen.queryByText(/Stratégie de recherche/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Itérations max/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Éliminations max/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Priorité aux tâches en échec/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Analyse exacte des conflits/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Réparation post-résolution/i)).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Flottante/i })).toBeDisabled();
    // Le timeout et la limite journalière restent des réglages valides pour CP-SAT.
    expect(screen.getByLabelText(/Timeout \(secondes\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Ignorer les limites journalières/i)).toBeInTheDocument();
  });

  it('rebasculer sur core restaure les champs core-only', () => {
    render(<SchedulerConfigDialog />);
    openDialog();

    fireEvent.click(screen.getByRole('radio', { name: /CP-SAT \(OR-Tools\)/i }));
    expect(screen.queryByText(/Stratégie de recherche/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /Élimination \/ Placement \(core\)/i }));
    expect(screen.getByText(/Stratégie de recherche/i)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Flottante/i })).not.toBeDisabled();
  });

  it("choisir la pause flottante puis passer sur CP-SAT bascule automatiquement sur 'Aucune'", async () => {
    const user = userEvent.setup();
    render(<SchedulerConfigDialog />);
    openDialog();

    await user.click(screen.getByRole('tab', { name: /Flottante/i }));
    expect(screen.getByRole('tab', { name: /Flottante/i })).toHaveAttribute('data-state', 'active');

    fireEvent.click(screen.getByRole('radio', { name: /CP-SAT \(OR-Tools\)/i }));
    expect(screen.getByRole('tab', { name: /Aucune/i })).toHaveAttribute('data-state', 'active');
  });

  it("Valider avec CP-SAT sélectionné sauvegarde engine='cpsat' dans le store", () => {
    render(<SchedulerConfigDialog />);
    openDialog();

    fireEvent.click(screen.getByRole('radio', { name: /CP-SAT \(OR-Tools\)/i }));
    fireEvent.click(screen.getByRole('button', { name: /Valider/i }));

    expect(useAppConfigStore.getState().schedulerConfig.engine).toBe('cpsat');
  });

  it("rouvrir le dialog recharge le draft depuis le store (engine='core' par défaut)", () => {
    useAppConfigStore.setState({ schedulerConfig: { ...DEFAULT_SCHEDULER_CONFIG, engine: 'cpsat' } });
    render(<SchedulerConfigDialog />);
    openDialog();

    expect(screen.getByRole('radio', { name: /CP-SAT \(OR-Tools\)/i })).toBeChecked();
  });
});
