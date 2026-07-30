import { describe, it, expect } from 'vitest';
import { mergeConcreteIntoEntries, resolveEntriesAgainstPrevious } from '../lib/enforcedResources';

describe('mergeConcreteIntoEntries', () => {
  it('conserve une alternative quand le choix concret y figure', () => {
    expect(mergeConcreteIntoEntries([['A', 'B']], ['A'])).toEqual([['A', 'B']]);
  });

  it('élargit une alternative quand le choix concret n\'y figure pas, sans la dégrader', () => {
    expect(mergeConcreteIntoEntries([['A', 'B']], ['C'])).toEqual([['A', 'B', 'C']]);
  });

  it('suit un slot ajouté dans la modale', () => {
    expect(mergeConcreteIntoEntries([['A', 'B']], ['A', 'X'])).toEqual([['A', 'B'], 'X']);
  });

  it('suit un slot retiré dans la modale', () => {
    expect(mergeConcreteIntoEntries([['A', 'B']], [])).toEqual([]);
  });

  it('laisse une entrée simple inchangée', () => {
    expect(mergeConcreteIntoEntries(['A'], ['A'])).toEqual(['A']);
  });

  it('remplace une entrée fixe par la nouvelle valeur (aucun OU à perdre)', () => {
    expect(mergeConcreteIntoEntries(['A'], ['B'])).toEqual(['B']);
  });

  it('apparie par valeur, pas par index : un combo désordonné laisse le modèle intact', () => {
    // Ordre produit par EnforceModal : les entrées fixes d'abord, puis les alternatives résolues.
    expect(mergeConcreteIntoEntries([['A', 'B'], 'C'], ['C', 'A'])).toEqual([['A', 'B'], 'C']);
  });

  it('rend les entrées dans l\'ordre du modèle, les ajouts en fin', () => {
    expect(mergeConcreteIntoEntries([['A', 'B'], 'C'], ['X', 'C', 'B'])).toEqual([
      ['A', 'B'],
      'C',
      'X',
    ]);
  });

  it('préfère l\'entrée fixe exactement égale à une alternative qui la recouvre', () => {
    expect(mergeConcreteIntoEntries([['A', 'B'], 'B'], ['B', 'A'])).toEqual([['A', 'B'], 'B']);
  });

  it('n\'apparie pas deux fois la même entrée sur un combo à doublons', () => {
    expect(mergeConcreteIntoEntries([['A', 'B'], ['A', 'C']], ['A', 'A'])).toEqual([
      ['A', 'B'],
      ['A', 'C'],
    ]);
  });

  it('retire l\'entrée qu\'aucune valeur ne réclame, quelle que soit sa position', () => {
    expect(mergeConcreteIntoEntries([['A', 'B'], 'C'], ['C'])).toEqual(['C']);
  });

  it('ignore les valeurs vides', () => {
    expect(mergeConcreteIntoEntries([['A', 'B']], ['A', ''])).toEqual([['A', 'B']]);
  });
});

describe('resolveEntriesAgainstPrevious', () => {
  it('préserve le choix précédent quand il reste admissible', () => {
    expect(resolveEntriesAgainstPrevious([['B', 'A']], ['A'])).toEqual(['A']);
  });

  it('retombe sur le premier choix sinon', () => {
    expect(resolveEntriesAgainstPrevious([['C', 'D']], ['A'])).toEqual(['C']);
  });

  it('rend une entrée simple telle quelle', () => {
    expect(resolveEntriesAgainstPrevious(['C'], ['A'])).toEqual(['C']);
  });

  it('filtre les valeurs vides', () => {
    expect(resolveEntriesAgainstPrevious(['', 'C'], ['A'])).toEqual(['C']);
  });
});
