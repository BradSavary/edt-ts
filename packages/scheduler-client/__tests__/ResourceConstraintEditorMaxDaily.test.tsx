import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ResourceConstraints } from '@edt-ts/scheduler-common';
import { ResourceConstraintEditor } from '../components/constraints/ResourceConstraintEditor';
import { pruneOrphanWeeklyMaxDaily } from '../lib/maxDailyResolution';

/**
 * Colonne « Max quot. (h) » du tableau des contraintes. La règle testée ici est un arbitrage
 * d'ergonomie (Frédéric, 2026-07-22) : la limite quotidienne d'une semaine se comporte
 * exactement comme ses créneaux horaires — cocher la semaine la désynchronise du Défaut en
 * copiant sa valeur, décocher la resynchronise en effaçant la copie.
 *
 * Le harness applique `pruneOrphanWeeklyMaxDaily` sur chaque écriture de contraintes, comme
 * le fait le store réel : la purge des limites orphelines n'appartient PAS au composant (elle
 * doit valoir aussi pour les chemins qui décochent sans passer par la case). Sans cela, ces
 * tests vérifieraient un montage qui n'existe nulle part.
 */
function Editor({ defaultMinutes, isDefault, initialValue }: {
  defaultMinutes?: number;
  isDefault?: boolean;
  initialValue?: ResourceConstraints | null;
}) {
  const [value, setValue] = useState<ResourceConstraints | null>(
    initialValue !== undefined ? initialValue : { default: [{ days: 'lundi', from: '08:00', to: '12:00' }] },
  );
  const [weekly, setWeekly] = useState<Record<string, number>>({});
  const [max, setMax] = useState<number | undefined>(defaultMinutes);
  return (
    <>
      <ResourceConstraintEditor
        id="T1"
        resourceType="teacher"
        value={value}
        isDefault={isDefault}
        alwaysExpanded
        csvWeeks={[38]}
        maxDailyMinutes={max}
        weeklyMaxDailyMinutes={weekly}
        onMaxDailyMinutesChange={setMax}
        onWeeklyMaxDailyMinutesChange={(wk, v) => setWeekly((prev) => {
          const next = { ...prev };
          if (v === undefined) delete next[wk]; else next[wk] = v;
          return next;
        })}
        onChange={(v) => {
          setValue(v);
          setWeekly((prev) => {
            const [group] = pruneOrphanWeeklyMaxDaily(
              [{ resourceType: 'teacher', resources: [{ id: 'T1', weeklyMaxDailyMinutes: prev }] }],
              { T1: v },
            );
            return group.resources[0].weeklyMaxDailyMinutes ?? {};
          });
        }}
      />
      <pre data-testid="weekly">{JSON.stringify(weekly)}</pre>
    </>
  );
}

/** Cellule « Max quot. » de la ligne dont le libellé est `label` (2e colonne du tableau). */
function cell(label: string): HTMLTableCellElement {
  const row = [...document.querySelectorAll('tbody tr')].find((tr) =>
    tr.querySelector('td')?.textContent?.includes(label),
  );
  if (!row) throw new Error(`ligne ${label} absente du tableau`);
  return row.querySelectorAll('td')[1] as HTMLTableCellElement;
}

const weeklyState = () => JSON.parse(screen.getByTestId('weekly').textContent!) as Record<string, number>;
const toggleWeek = (wk: string) => fireEvent.click(screen.getByLabelText(`Activer la semaine ${wk}`));

describe('ResourceConstraintEditor — colonne Max quot.', () => {
  it('semaine décochée : lecture seule, affiche la limite en vigueur (celle du Défaut)', () => {
    render(<Editor defaultMinutes={240} />);

    const td = cell('S38');
    expect(td.querySelector('input')).toBeNull();
    expect(td.textContent).toBe('4');
    expect(td.querySelector('span')?.className).toContain('italic'); // hérité
  });

  it('cocher une semaine copie la limite du Défaut et la rend modifiable', () => {
    render(<Editor defaultMinutes={240} />);

    toggleWeek('S38');

    expect(weeklyState()).toEqual({ S38: 240 });
    const input = cell('S38').querySelector('input')!;
    expect(input.value).toBe('4'); // valeur propre, plus un placeholder grisé
    expect(input.className).not.toContain('placeholder:italic');
  });

  it('décocher une semaine efface sa limite (pas de limite active sur une semaine inactive)', () => {
    render(<Editor defaultMinutes={240} />);

    toggleWeek('S38');
    fireEvent.change(cell('S38').querySelector('input')!, { target: { value: '2' } });
    fireEvent.blur(cell('S38').querySelector('input')!);
    expect(weeklyState()).toEqual({ S38: 120 });

    toggleWeek('S38');

    expect(weeklyState()).toEqual({});
    expect(cell('S38').querySelector('input')).toBeNull();
  });

  it('saisie en heures : commit en minutes, valeur nulle ou négative ⇒ retour à l\'héritage', () => {
    render(<Editor defaultMinutes={240} />);
    toggleWeek('S38');
    const input = () => cell('S38').querySelector('input')!;

    fireEvent.change(input(), { target: { value: '1.5' } });
    fireEvent.blur(input());
    expect(weeklyState()).toEqual({ S38: 90 });

    fireEvent.change(input(), { target: { value: '0' } });
    fireEvent.blur(input());
    expect(weeklyState()).toEqual({});
  });

  it('cellule héritée : le focus pré-remplit avec le défaut pour que les flèches partent de là', () => {
    render(<Editor defaultMinutes={240} />);
    toggleWeek('S38');
    const input = () => cell('S38').querySelector('input')!;
    // Repartir d'une cellule cochée mais vidée (donc de nouveau héritée).
    fireEvent.change(input(), { target: { value: '' } });
    fireEvent.blur(input());
    expect(weeklyState()).toEqual({});
    expect(input().placeholder).toBe('4');

    fireEvent.focus(input());
    expect(input().value).toBe('4');

    // Flèche haut depuis 4 h : commit à 4,5 h.
    fireEvent.change(input(), { target: { value: '4.5' } });
    fireEvent.blur(input());
    expect(weeklyState()).toEqual({ S38: 270 });
  });

  it('focus puis sortie sans modification : aucun override écrit, la semaine reste en héritage', () => {
    render(<Editor defaultMinutes={240} />);
    toggleWeek('S38');
    const input = () => cell('S38').querySelector('input')!;
    fireEvent.change(input(), { target: { value: '' } });
    fireEvent.blur(input());

    fireEvent.focus(input());
    fireEvent.blur(input());

    expect(weeklyState()).toEqual({});
    expect(input().value).toBe('');
  });

  it('défaut illimité : cocher n\'écrit aucune limite', () => {
    render(<Editor />);

    toggleWeek('S38');

    expect(weeklyState()).toEqual({});
    expect(cell('S38').querySelector('input')!.placeholder).toBe('illimité');
  });

  it('une semaine qui n\'a QU\'une limite reste visible dans le tableau', () => {
    render(<Editor defaultMinutes={240} />);
    // S99 n'est ni une semaine CSV ni un override d'horaires : seule une limite la fait exister.
    expect(screen.queryByText('S99')).toBeNull();

    fireEvent.click(screen.getByText('+ Ajouter une semaine personnalisée'));
    fireEvent.change(screen.getByPlaceholderText('ex: 36 ou S36'), { target: { value: '99' } });
    fireEvent.click(screen.getByText('Confirmer'));

    expect(screen.getByText('S99')).toBeTruthy();
    expect(weeklyState()).toEqual({ S99: 240 });
  });

  it('fiche « Défaut » de l\'établissement : aucune colonne Max quot.', () => {
    render(<Editor defaultMinutes={240} isDefault />);

    expect(screen.queryByText('Max quot. (h)')).toBeNull();
    // La ligne Défaut n'a alors que la colonne Semaine + les 6 jours.
    const cells = document.querySelectorAll('tbody tr')[0].querySelectorAll('td');
    expect(cells).toHaveLength(7);
  });
});

describe('ResourceConstraintEditor — ressource sans contraintes propres', () => {
  /**
   * Sans contraintes il n'y a pas de tableau, donc pas de colonne. La limite quotidienne par
   * défaut doit rester réglable : « dispos par défaut mais plafonné à N h/jour » est un
   * réglage courant, possible avant que la colonne ne remplace le bandeau.
   */
  it('la limite quotidienne par défaut reste éditable', () => {
    render(<Editor defaultMinutes={240} initialValue={null} />);

    const input = document.querySelector('input[type="number"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('4');

    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.blur(input);
    expect((document.querySelector('input[type="number"]') as HTMLInputElement).value).toBe('3');
  });
});
