import { describe, it, expect } from 'vitest';
import { mergeConcreteIntoEntries, resolveEntriesAgainstPrevious } from '../lib/enforcedResources';

describe('mergeConcreteIntoEntries', () => {
  it('conserve une alternative quand le choix concret y figure', () => {
    expect(mergeConcreteIntoEntries([['A', 'B']], ['A'])).toEqual([['A', 'B']]);
  });

  it('remplace une alternative quand le choix concret n\'y figure plus', () => {
    expect(mergeConcreteIntoEntries([['A', 'B']], ['C'])).toEqual(['C']);
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
