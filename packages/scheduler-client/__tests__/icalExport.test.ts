import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import JSZip from 'jszip';
import { generateIcalContent, downloadIcalSolution, downloadIcalArchive } from '../lib/icalExport';
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

describe('generateIcalContent', () => {
  describe('structure globale', () => {
    it('génère un fichier iCal avec BEGIN:VCALENDAR et END:VCALENDAR', () => {
      const content = generateIcalContent([makeTask()], 47);
      expect(content).toContain('BEGIN:VCALENDAR');
      expect(content).toContain('END:VCALENDAR');
    });

    it('contient VERSION:2.0', () => {
      expect(generateIcalContent([makeTask()], 47)).toContain('VERSION:2.0');
    });

    it('utilise \\r\\n comme séparateur de lignes (RFC 5545)', () => {
      const content = generateIcalContent([makeTask()], 47);
      expect(content).toContain('\r\n');
    });

    it('retourne uniquement l\'entête si aucune tâche', () => {
      const content = generateIcalContent([], 47);
      expect(content).toContain('BEGIN:VCALENDAR');
      expect(content).not.toContain('BEGIN:VEVENT');
    });
  });

  describe('VEVENT', () => {
    it('contient BEGIN:VEVENT et END:VEVENT pour chaque tâche', () => {
      const content = generateIcalContent(
        [makeTask(), makeTask({ taskId: 'task-1', code: 'R102' })],
        47,
      );
      const veventCount = (content.match(/BEGIN:VEVENT/g) ?? []).length;
      expect(veventCount).toBe(2);
    });

    it('le SUMMARY contient le code et le type du cours', () => {
      const content = generateIcalContent([makeTask()], 47);
      expect(content).toContain('SUMMARY:R101 CM');
    });

    it('le DTSTART correspond à lundi 08:00 de la semaine 47 2025', () => {
      // Semaine 47 2025 : lundi 17 novembre 2025 08:00
      const content = generateIcalContent([makeTask({ startTime: 480 })], 47);
      expect(content).toContain('DTSTART:20251117T080000');
    });

    it('DTEND = startTime + duration (08:00 + 120min → 10:00)', () => {
      const content = generateIcalContent([makeTask({ startTime: 480, duration: 120 })], 47);
      expect(content).toContain('DTEND:20251117T100000');
    });

    it('un cours le mardi (startTime=24*60+480) → DTSTART mardi 08:00', () => {
      const content = generateIcalContent(
        [makeTask({ startTime: 24 * 60 + 480 })],
        47,
      );
      // Mardi 18 novembre 2025 08:00
      expect(content).toContain('DTSTART:20251118T080000');
    });

    it('avec schoolYearConfig "2026-2027", une semaine >= 35 est datée sur 2026 (et non sur l\'année civile courante)', () => {
      // Sans schoolYearConfig, l'heuristique par défaut retombe sur l'année civile
      // courante (voir describe ci-dessus, calée sur 2025). Un utilisateur qui a
      // sélectionné explicitement l'année universitaire 2026-2027 doit obtenir des
      // dates sur 2026 pour les semaines de rentrée, quelle que soit la date du jour.
      const content = generateIcalContent(
        [makeTask({ startTime: 480 })],
        47,
        { year: '2026-2027', zone: 'A', periods: [] },
      );
      expect(content).toContain('DTSTART:20261116T080000');
    });

    it('avec schoolYearConfig "2026-2027", une semaine < 35 est datée sur 2027', () => {
      const content = generateIcalContent(
        [makeTask({ startTime: 480 })],
        10,
        { year: '2026-2027', zone: 'A', periods: [] },
      );
      // Semaine ISO 10 2027 : lundi 8 mars 2027
      expect(content).toContain('DTSTART:20270308T080000');
    });

    it('le LOCATION contient la première salle', () => {
      const content = generateIcalContent([makeTask()], 47);
      expect(content).toContain('LOCATION:A101');
    });

    it('contient un UID unique par tâche', () => {
      const content = generateIcalContent([makeTask({ taskId: 'unique-id-123' })], 47);
      expect(content).toContain('unique-id-123');
    });

    it('contient DTSTAMP (horodatage de génération)', () => {
      const content = generateIcalContent([makeTask()], 47);
      expect(content).toContain('DTSTAMP:');
    });
  });

  describe('DESCRIPTION', () => {
    it('inclut le commentaire du cours quand il est présent', () => {
      const content = generateIcalContent([makeTask({ comment: 'Prévoir vidéoprojecteur' })], 47);
      expect(content).toContain('Commentaire: Prévoir vidéoprojecteur');
    });

    it('ne contient pas la ligne "Commentaire" quand le cours n\'a pas de commentaire', () => {
      const content = generateIcalContent([makeTask()], 47);
      expect(content).not.toContain('Commentaire:');
    });

    it(
      'un caractère accentué à la frontière de repli à 75/74 octets n\'est jamais corrompu ' +
        '(pas de U+FFFD), quelle que soit la longueur du commentaire',
      () => {
        // Balaie l'alignement du caractère accentué par rapport à la frontière de repli : sur
        // cette plage, au moins une longueur fait tomber la coupe DANS le caractère multi-octets
        // « é » (2 octets) — avant le correctif, chaque moitié se décodait en U+FFFD.
        for (let len = 0; len < 40; len++) {
          const comment = 'é'.repeat(len) + 'x'.repeat(200) + 'é'.repeat(len);
          const content = generateIcalContent([makeTask({ comment })], 47);
          // Déplie les lignes de continuation RFC 5545 (repli \r\n + espace) avant de vérifier.
          const unfolded = content.replace(/\r\n /g, '');
          expect(unfolded).not.toContain('�');
        }
      },
    );
  });

  describe('ressources', () => {
    it('inclut ORGANIZER avec le nom de l\'enseignant', () => {
      const content = generateIcalContent([makeTask()], 47);
      expect(content).toContain('DUPONT Jean');
    });

    it('génère CATEGORIES avec les groupes', () => {
      const task = makeTask({
        resources: [
          { id: 'DUPONT Jean', type: 'teacher' },
          { id: 'A101', type: 'room' },
          { id: 'BUT1-G1', type: 'group' },
        ],
      });
      const content = generateIcalContent([task], 47);
      expect(content).toContain('CATEGORIES:BUT1-G1');
    });

    it('n\'inclut pas LOCATION si aucune salle', () => {
      const task = makeTask({
        resources: [{ id: 'DUPONT Jean', type: 'teacher' }],
      });
      const content = generateIcalContent([task], 47);
      expect(content).not.toContain('LOCATION:');
    });
  });
});

describe('downloadIcalSolution', () => {
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

  function captureDownloadedFileName(...args: Parameters<typeof downloadIcalSolution>): string {
    let fileName = '';
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        fileName = this.download;
      });
    downloadIcalSolution(...args);
    clickSpy.mockRestore();
    return fileName;
  }

  it('sans filtre : "S{{week}} {{year}}.ics", sans espace en tête', () => {
    const fileName = captureDownloadedFileName(
      [makeTask()],
      44,
      { year: '2026-2027', zone: 'A', periods: [] },
    );
    expect(fileName).toBe('S44 2026-2027.ics');
  });

  it('avec filtre : "{{filtre}} S{{week}} {{year}}.ics"', () => {
    const fileName = captureDownloadedFileName(
      [makeTask()],
      44,
      { year: '2026-2027', zone: 'A', periods: [] },
      'Dupont',
    );
    expect(fileName).toBe('Dupont S44 2026-2027.ics');
  });

  it('un filtre composé uniquement d\'espaces est traité comme vide', () => {
    const fileName = captureDownloadedFileName(
      [makeTask()],
      44,
      { year: '2026-2027', zone: 'A', periods: [] },
      '   ',
    );
    expect(fileName).toBe('S44 2026-2027.ics');
  });

  it('retire les caractères invalides pour un nom de fichier dans le filtre', () => {
    const fileName = captureDownloadedFileName(
      [makeTask()],
      44,
      { year: '2026-2027', zone: 'A', periods: [] },
      'Groupe: A/B',
    );
    expect(fileName).toBe('Groupe AB S44 2026-2027.ics');
  });

  it('sans schoolYearConfig, reconstruit un libellé d\'année universitaire cohérent avec la date affichée', () => {
    const fileName = captureDownloadedFileName([makeTask()], 47, null);
    expect(fileName).toMatch(/^S47 \d{4}-\d{4}\.ics$/);
  });
});

describe('downloadIcalArchive', () => {
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
    ...args: Parameters<typeof downloadIcalArchive>
  ): Promise<{ fileName: string; entries: Record<string, string> }> {
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

    await downloadIcalArchive(...args);

    createElementSpy.mockRestore();
    createObjectURLSpy.mockRestore();

    const zip = await JSZip.loadAsync(capturedBlob as unknown as Blob);
    const entries: Record<string, string> = {};
    for (const [path, file] of Object.entries(zip.files)) {
      entries[path] = await file.async('string');
    }
    return { fileName, entries };
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

  it('crée un .ics par ressource du type demandé', async () => {
    const tasks = [
      makeTask({ taskId: 't1', resources: [{ id: 'DUPONT', type: 'teacher' }, { id: 'A101', type: 'room' }] }),
      makeTask({ taskId: 't2', resources: [{ id: 'MARTIN', type: 'teacher' }, { id: 'A101', type: 'room' }] }),
    ];
    const { entries } = await captureDownloadedArchive(tasks, 44, { year: '2026-2027', zone: 'A', periods: [] }, 'room');
    expect(Object.keys(entries)).toEqual(['A101.ics']);
    expect(entries['A101.ics']).toContain('BEGIN:VCALENDAR');
    const veventCount = (entries['A101.ics'].match(/BEGIN:VEVENT/g) ?? []).length;
    expect(veventCount).toBe(2);
  });

  it('une tâche multi-ressources apparaît dans l\'ICS de chacune de ses ressources du type demandé', async () => {
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
    expect(Object.keys(entries).sort()).toEqual(['BUT1-G1.ics', 'BUT1-G2.ics']);
    expect(entries['BUT1-G1.ics']).toContain('BEGIN:VEVENT');
    expect(entries['BUT1-G2.ics']).toContain('BEGIN:VEVENT');
  });

  it('ignore les tâches sans ressource du type demandé', async () => {
    const tasks = [makeTask({ resources: [{ id: 'A101', type: 'room' }] })];
    const { entries } = await captureDownloadedArchive(tasks, 44, { year: '2026-2027', zone: 'A', periods: [] }, 'teacher');
    expect(Object.keys(entries)).toEqual([]);
  });
});
