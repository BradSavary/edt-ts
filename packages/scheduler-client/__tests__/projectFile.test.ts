import { describe, it, expect } from 'vitest';
import {
  stateToProjectFile,
  projectFileToState,
  isProjectFileV1,
  parseProjectFile,
  PROJECT_FILE_VERSION,
  type PersistedProjectFields,
} from '../lib/project/projectFile';
import { DEFAULT_YEAR_COLORS } from '../lib/calendar/yearColors';

function makeFields(overrides: Partial<PersistedProjectFields> = {}): PersistedProjectFields {
  return {
    projectName: 'BUT Info 2026-2027',
    schoolYearConfig: { year: '2026-2027', zone: 'A', periods: [] },
    allCourses: [],
    resources: [],
    coursesFileName: 'cours.csv',
    constraints: { Default: [] },
    weekSaves: {},
    yearColorConfig: DEFAULT_YEAR_COLORS,
    tightThreshold: 0.5,
    criticalThreshold: 1.0,
    ...overrides,
  };
}

describe('stateToProjectFile / projectFileToState (round-trip)', () => {
  it('round-trip préserve tous les champs persistés', () => {
    const fields = makeFields();
    const file = stateToProjectFile(fields);
    expect(file.formatVersion).toBe(PROJECT_FILE_VERSION);
    expect(projectFileToState(file)).toEqual(fields);
  });

  it('utilise le nom et l\'année du state pour le fichier', () => {
    const fields = makeFields({ projectName: 'Autre projet', schoolYearConfig: { year: '2027-2028', zone: 'B', periods: [] } });
    const file = stateToProjectFile(fields);
    expect(file.name).toBe('Autre projet');
    expect(file.schoolYearConfig.year).toBe('2027-2028');
    expect(file.schoolYearConfig.zone).toBe('B');
  });

  it('lève une erreur si projectName est null (aucun projet actif)', () => {
    expect(() => stateToProjectFile(makeFields({ projectName: null }))).toThrow();
  });

  it('lève une erreur si schoolYearConfig est null', () => {
    expect(() => stateToProjectFile(makeFields({ schoolYearConfig: null }))).toThrow();
  });
});

describe('isProjectFileV1 / parseProjectFile', () => {
  it('accepte un fichier valide', () => {
    const file = stateToProjectFile(makeFields());
    expect(isProjectFileV1(file)).toBe(true);
  });

  it('rejette un objet sans formatVersion', () => {
    const { formatVersion, ...rest } = stateToProjectFile(makeFields());
    expect(isProjectFileV1(rest)).toBe(false);
  });

  it('rejette une version différente de 1', () => {
    const file = { ...stateToProjectFile(makeFields()), formatVersion: 2 };
    expect(isProjectFileV1(file)).toBe(false);
  });

  it('rejette null/undefined/primitives', () => {
    expect(isProjectFileV1(null)).toBe(false);
    expect(isProjectFileV1(undefined)).toBe(false);
    expect(isProjectFileV1('not an object')).toBe(false);
  });

  it('parseProjectFile lève une erreur explicite sur un JSON illisible', () => {
    expect(() => parseProjectFile('{ not valid json')).toThrow(/JSON illisible/);
  });

  it('parseProjectFile lève une erreur explicite sur un JSON valide mais de mauvais format', () => {
    expect(() => parseProjectFile(JSON.stringify({ hello: 'world' }))).toThrow(/non reconnu/);
  });

  it('parseProjectFile accepte un fichier valide et retourne ses champs', () => {
    const file = stateToProjectFile(makeFields({ projectName: 'Projet X' }));
    const parsed = parseProjectFile(JSON.stringify(file));
    expect(parsed.name).toBe('Projet X');
  });
});
