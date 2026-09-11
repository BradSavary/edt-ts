import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import JSZip from 'jszip';
import { generateWeeklyGridPdf, downloadPdfSolution, downloadPdfArchive } from '../lib/pdfExport';
import type { TaskSolutionJSON } from '@edt-ts/scheduler-common';

function makeTask(overrides: Partial<TaskSolutionJSON> = {}): TaskSolutionJSON {
  return {
    taskId: 'task-0',
    code: 'R101',
    name: 'Algorithmique',
    type: 'CM',
    week: 47,
    startTime: 480, // lundi 08:00
    duration: 120,
    resources: [
      { id: 'DUPONT Jean', type: 'teacher' },
      { id: 'A101', type: 'room' },
    ],
    ...overrides,
  };
}

describe('generateWeeklyGridPdf', () => {
  it('produit un document PDF valide (en-tête %PDF)', () => {
    const doc = generateWeeklyGridPdf([makeTask()], 'S47 2025-2026');
    expect(doc.output().startsWith('%PDF')).toBe(true);
  });

  it('inclut le titre passé en en-tête de page', () => {
    const doc = generateWeeklyGridPdf([], 'Mon titre');
    expect(doc.output()).toContain('Mon titre');
  });

  it('ne plante pas sans aucune tâche', () => {
    expect(() => generateWeeklyGridPdf([], 'titre')).not.toThrow();
  });

  it('inclut le code et le type du cours', () => {
    const doc = generateWeeklyGridPdf([makeTask()], 'titre');
    expect(doc.output()).toContain('R101 CM');
  });

  it("inclut le nom de l'enseignant", () => {
    const doc = generateWeeklyGridPdf([makeTask()], 'titre');
    expect(doc.output()).toContain('DUPONT Jean');
  });

  it('inclut la salle', () => {
    const doc = generateWeeklyGridPdf([makeTask()], 'titre');
    expect(doc.output()).toContain('A101');
  });

  it('inclut le groupe quand présent', () => {
    const task = makeTask({
      resources: [
        { id: 'DUPONT Jean', type: 'teacher' },
        { id: 'BUT1-G1', type: 'group' },
      ],
    });
    const doc = generateWeeklyGridPdf([task], 'titre');
    expect(doc.output()).toContain('BUT1-G1');
  });

  it('ignore une tâche dont le jour tombe hors de la grille (dayOffset >= 6)', () => {
    const task = makeTask({ startTime: 6 * 24 * 60 + 480, code: 'HORSGRILLE' });
    const doc = generateWeeklyGridPdf([task], 'titre');
    expect(doc.output()).not.toContain('HORSGRILLE');
  });

  it('une tâche entièrement avant 7h (limite basse de la grille) est clippée sans planter et sans être dessinée', () => {
    const task = makeTask({ startTime: 6 * 60, duration: 60, code: 'AVANT7H' }); // 06:00-07:00 lundi
    const doc = generateWeeklyGridPdf([task], 'titre');
    expect(doc.output()).not.toContain('AVANT7H');
  });
});

describe('downloadPdfSolution', () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  function captureDownloadedFileName(...args: Parameters<typeof downloadPdfSolution>): string {
    let fileName = '';
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        fileName = this.download;
      });
    downloadPdfSolution(...args);
    clickSpy.mockRestore();
    return fileName;
  }

  it('sans filtre : "S{{week}} {{year}}.pdf", sans espace en tête', () => {
    const fileName = captureDownloadedFileName(
      [makeTask()],
      44,
      { year: '2026-2027', zone: 'A', periods: [] },
    );
    expect(fileName).toBe('S44 2026-2027.pdf');
  });

  it('avec filtre : "{{filtre}} S{{week}} {{year}}.pdf"', () => {
    const fileName = captureDownloadedFileName(
      [makeTask()],
      44,
      { year: '2026-2027', zone: 'A', periods: [] },
      'Dupont',
    );
    expect(fileName).toBe('Dupont S44 2026-2027.pdf');
  });

  it('retire les caractères invalides pour un nom de fichier dans le filtre', () => {
    const fileName = captureDownloadedFileName(
      [makeTask()],
      44,
      { year: '2026-2027', zone: 'A', periods: [] },
      'Groupe: A/B',
    );
    expect(fileName).toBe('Groupe AB S44 2026-2027.pdf');
  });
});

describe('downloadPdfArchive', () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  async function captureDownloadedArchive(
    ...args: Parameters<typeof downloadPdfArchive>
  ): Promise<{ fileName: string; entries: Record<string, Uint8Array> }> {
    let fileName = '';
    let capturedBlob: Blob | null = null;
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === 'a') {
        vi.spyOn(el as HTMLAnchorElement, 'click').mockImplementation(function (this: HTMLAnchorElement) {
          fileName = this.download;
        });
      }
      return el;
    });
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((obj: Blob | MediaSource) => {
      capturedBlob = obj as Blob;
      return 'blob:mock';
    });

    await downloadPdfArchive(...args);

    createElementSpy.mockRestore();
    createObjectURLSpy.mockRestore();

    const zip = await JSZip.loadAsync(capturedBlob as unknown as Blob);
    const entries: Record<string, Uint8Array> = {};
    for (const [path, file] of Object.entries(zip.files)) {
      entries[path] = await file.async('uint8array');
    }
    return { fileName, entries };
  }

  function pdfHeader(bytes: Uint8Array): string {
    return new TextDecoder().decode(bytes.slice(0, 4));
  }

  it('nomme l\'archive "{{Label}} S{{week}} {{year}}.zip"', async () => {
    const { fileName } = await captureDownloadedArchive(
      [makeTask()],
      44,
      { year: '2026-2027', zone: 'A', periods: [] },
      'teacher',
    );
    expect(fileName).toBe('Enseignants S44 2026-2027.zip');
  });

  it('crée un .pdf par ressource du type demandé', async () => {
    const tasks = [
      makeTask({ taskId: 't1', resources: [{ id: 'DUPONT', type: 'teacher' }, { id: 'A101', type: 'room' }] }),
      makeTask({ taskId: 't2', resources: [{ id: 'MARTIN', type: 'teacher' }, { id: 'A101', type: 'room' }] }),
    ];
    const { entries } = await captureDownloadedArchive(tasks, 44, { year: '2026-2027', zone: 'A', periods: [] }, 'room');
    expect(Object.keys(entries)).toEqual(['A101.pdf']);
    expect(pdfHeader(entries['A101.pdf'])).toBe('%PDF');
  });

  it("une tâche multi-ressources apparaît dans le PDF de chacune de ses ressources du type demandé", async () => {
    const tasks = [
      makeTask({
        taskId: 't1',
        resources: [
          { id: 'DUPONT', type: 'teacher' },
          { id: 'BUT1-G1', type: 'group' },
          { id: 'BUT1-G2', type: 'group' },
        ],
      }),
    ];
    const { entries } = await captureDownloadedArchive(tasks, 44, { year: '2026-2027', zone: 'A', periods: [] }, 'group');
    expect(Object.keys(entries).sort()).toEqual(['BUT1-G1.pdf', 'BUT1-G2.pdf']);
    expect(pdfHeader(entries['BUT1-G1.pdf'])).toBe('%PDF');
    expect(pdfHeader(entries['BUT1-G2.pdf'])).toBe('%PDF');
  });

  it('ignore les tâches sans ressource du type demandé', async () => {
    const tasks = [makeTask({ resources: [{ id: 'A101', type: 'room' }] })];
    const { entries } = await captureDownloadedArchive(tasks, 44, { year: '2026-2027', zone: 'A', periods: [] }, 'teacher');
    expect(Object.keys(entries)).toEqual([]);
  });
});
