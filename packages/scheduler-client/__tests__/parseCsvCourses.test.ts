import { describe, it, expect } from 'vitest';
import { parseCsvCourses, parseCsvFull, extractResourceWeeks } from '../lib/parseCsvCourses';
import { courseIdentityKey } from '../lib/courseId';

const BASE_HEADER = 'Semestre,Parcours,Code,Enseignement,Intervenant,Nature,Groupes,Salles,S1,S2,S3,S47,S48';

function makeCsv(rows: string[]): string {
  return [BASE_HEADER, ...rows].join('\n');
}

describe('parseCsvCourses', () => {
  describe('cas génériques', () => {
    it('retourne un tableau vide si aucune ligne ne correspond à la semaine', () => {
      const csv = makeCsv(['S1,INFO,R101,Algo,DUPONT Jean,CM,G1,A101,0,0,0,0,0']);
      const result = parseCsvCourses(csv, 1);
      expect(result).toHaveLength(0);
    });

    it('parse correctement une ligne simple avec une salle', () => {
      const csv = makeCsv(['S1,INFO,R101,Algorithmique,DUPONT Jean,CM,G1,A101,2,0,0,0,0']);
      const result = parseCsvCourses(csv, 1);
      expect(result).toHaveLength(1);
      const course = result[0];
      expect(course.code).toBe('R101');
      expect(course.name).toBe('Algorithmique');
      expect(course.type).toBe('CM');
      expect(course.teacher).toEqual(['DUPONT Jean']);
      expect(course.groups).toEqual(['G1']);
      expect(course.rooms).toEqual(['A101']);
      expect(course.duration).toBe(120); // 2h → 120 min
      expect(course.week).toBe(1);
    });

    it('convertit correctement 1.5h en 90 minutes', () => {
      const csv = makeCsv(['S1,INFO,R102,Maths,MARTIN Paul,TD,G2,B201,1.5,0,0,0,0']);
      const [course] = parseCsvCourses(csv, 1);
      expect(course.duration).toBe(90);
    });

    it('parse les groupes multiples séparés par des virgules', () => {
      const csv = makeCsv(['S1,INFO,R101,Algo,DUPONT Jean,CM,"G1,G2,G3",A101,2,0,0,0,0']);
      const [course] = parseCsvCourses(csv, 1);
      expect(course.groups).toEqual(['G1', 'G2', 'G3']);
    });

    it('retourne rooms comme tableau simple quand une seule salle', () => {
      const csv = makeCsv(['S1,INFO,R101,Algo,DUPONT Jean,CM,G1,A101,2,0,0,0,0']);
      const [course] = parseCsvCourses(csv, 1);
      expect(course.rooms).toEqual(['A101']);
    });

    it('retourne rooms comme alternatives quand plusieurs salles', () => {
      const csv = makeCsv(['S1,INFO,R101,Algo,DUPONT Jean,CM,G1,"A101, B201",2,0,0,0,0']);
      const [course] = parseCsvCourses(csv, 1);
      expect(course.rooms).toEqual([['A101', 'B201']]);
    });

    it('filtre les lignes sans heures pour la semaine donnée', () => {
      const csv = makeCsv([
        'S1,INFO,R101,Algo,DUPONT Jean,CM,G1,A101,2,0,0,0,0',
        'S1,INFO,R102,Maths,MARTIN Paul,TD,G2,B201,0,3,0,0,0',
      ]);
      const result = parseCsvCourses(csv, 1);
      expect(result).toHaveLength(1);
      expect(result[0].code).toBe('R101');
    });

    it('parse plusieurs cours sur la même semaine', () => {
      const csv = makeCsv([
        'S1,INFO,R101,Algo,DUPONT Jean,CM,G1,A101,2,0,0,0,0',
        'S1,INFO,R102,Maths,MARTIN Paul,TD,G2,B201,1.5,0,0,0,0',
      ]);
      const result = parseCsvCourses(csv, 1);
      expect(result).toHaveLength(2);
    });

    it('détecte le niveau BUT1 depuis le semestre S1', () => {
      const csv = makeCsv(['S1,INFO,R101,Algo,DUPONT Jean,CM,G1,A101,2,0,0,0,0']);
      const [course] = parseCsvCourses(csv, 1);
      expect(course.semester).toBe(1);
      expect(course.level).toBe(0); // BUT1
    });

    it('détecte le niveau BUT2 depuis le semestre S3', () => {
      const csv = makeCsv(['S3,INFO,R301,Réseau,MARTIN Paul,CM,G1,A101,2,0,0,0,0']);
      const [course] = parseCsvCourses(csv, 1);
      expect(course.level).toBe(1); // BUT2
    });

    it('détecte le niveau BUT3 depuis le semestre S5', () => {
      const csv = makeCsv(['S5,INFO,R501,Projet,DUPONT Jean,TP,G1,A101,2,0,0,0,0']);
      const [course] = parseCsvCourses(csv, 1);
      expect(course.level).toBe(2); // BUT3
    });

    it('teacher est un tableau vide si la colonne intervenant est vide', () => {
      const csv = makeCsv(['S1,INFO,R101,Algo,,CM,G1,A101,2,0,0,0,0']);
      const [course] = parseCsvCourses(csv, 1);
      expect(course.teacher).toEqual([]);
    });
  });

  describe('cas limites', () => {
    it('lève une erreur si le CSV est vide', () => {
      expect(() => parseCsvCourses('', 1)).toThrow();
    });

    it('lève une erreur si la colonne de semaine est introuvable', () => {
      const csv = makeCsv(['S1,INFO,R101,Algo,DUPONT Jean,CM,G1,A101,2,0,0,0,0']);
      expect(() => parseCsvCourses(csv, 99)).toThrow(/S99/);
    });

    it('ignore les lignes dont la valeur heures n\'est pas un nombre', () => {
      const csv = makeCsv(['S1,INFO,R101,Algo,DUPONT Jean,CM,G1,A101,abc,0,0,0,0']);
      const result = parseCsvCourses(csv, 1);
      expect(result).toHaveLength(0);
    });

    it('gère les champs CSV entre guillemets contenant des virgules', () => {
      const csv = makeCsv(['"S1",INFO,"R101","Algo, avancée","DUPONT Jean",CM,"G1","A101",2,0,0,0,0']);
      const [course] = parseCsvCourses(csv, 1);
      expect(course.code).toBe('R101');
      expect(course.name).toBe('Algo, avancée');
    });

    it('utilise la colonne S47 pour la semaine 47', () => {
      const csv = makeCsv(['S1,INFO,R101,Algo,DUPONT Jean,CM,G1,A101,0,0,0,3,0']);
      const result = parseCsvCourses(csv, 47);
      expect(result).toHaveLength(1);
      expect(result[0].duration).toBe(180);
    });
  });

  describe('doublons de ressources dans une cellule', () => {
    it('déduplique les groupes répétés', () => {
      const csv = makeCsv(['S1,INFO,R101,Algo,DUPONT Jean,CM,"G1, G2, G1",A101,2,0,0,0,0']);
      const [course] = parseCsvCourses(csv, 1);
      expect(course.groups).toEqual(['G1', 'G2']);
    });

    it('déduplique les salles répétées', () => {
      const csv = makeCsv(['S1,INFO,R101,Algo,DUPONT Jean,CM,G1,"A101, B201, A101",2,0,0,0,0']);
      const [course] = parseCsvCourses(csv, 1);
      expect(course.rooms).toEqual([['A101', 'B201']]);
    });

    it('une salle répétée seule reste une salle fixe, pas une fausse alternative', () => {
      // Avant correction : roomList = ['A101','A101'], length > 1 → [['A101','A101']],
      // soit un slot « A101 OU A101 » qui déclenchait l'UI de choix dans EnforceModal.
      const csv = makeCsv(['S1,INFO,R101,Algo,DUPONT Jean,CM,G1,"A101, A101",2,0,0,0,0']);
      const [course] = parseCsvCourses(csv, 1);
      expect(course.rooms).toEqual(['A101']);
    });

    it('conserve l\'ordre de première apparition', () => {
      const csv = makeCsv(['S1,INFO,R101,Algo,DUPONT Jean,CM,"G2, G1, G2, G3",A101,2,0,0,0,0']);
      const [course] = parseCsvCourses(csv, 1);
      expect(course.groups).toEqual(['G2', 'G1', 'G3']);
    });
  });
});

describe('parseCsvFull', () => {
  it('déduplique groupes et salles portés par le cours', () => {
    const csv = makeCsv(['S1,INFO,R101,Algo,DUPONT Jean,CM,"G1, G1","A101, A101",2,0,0,0,0']);
    const { courses } = parseCsvFull(csv);
    expect(courses).toHaveLength(1);
    expect(courses[0].groups).toEqual(['G1']);
    expect(courses[0].rooms).toEqual(['A101']);
  });

  it('produit la même clef d\'identité qu\'un CSV sans doublon (merge non destructif)', () => {
    // Sans déduplication, courseIdentityKey joignait "G1,G1" ≠ "G1" : réimporter le CSV corrigé
    // faisait passer le cours pour supprimé puis recréé, perdant groupes de tâches et impositions.
    const withDup = parseCsvFull(
      makeCsv(['S1,INFO,R101,Algo,DUPONT Jean,CM,"G1, G1",A101,2,0,0,0,0'])
    ).courses[0];
    const withoutDup = parseCsvFull(
      makeCsv(['S1,INFO,R101,Algo,DUPONT Jean,CM,G1,A101,2,0,0,0,0'])
    ).courses[0];
    expect(courseIdentityKey(withDup)).toBe(courseIdentityKey(withoutDup));
    expect(withDup.id).toBe(withoutDup.id);
  });

  it('la liste globale des ressources reste sans doublon', () => {
    const csv = makeCsv([
      'S1,INFO,R101,Algo,DUPONT Jean,CM,"G1, G1",A101,2,0,0,0,0',
      'S1,INFO,R102,Maths,DUPONT Jean,TD,G1,A101,1,0,0,0,0',
    ]);
    const { resources } = parseCsvFull(csv);
    const groups = resources.find((g) => g.resourceType === 'group')!.resources;
    expect(groups.map((r) => r.id)).toEqual(['G1']);
  });
});

describe('extractResourceWeeks', () => {
  it('gère les cellules à doublons sans les compter deux fois', () => {
    const csv = makeCsv(['S1,INFO,R101,Algo,DUPONT Jean,CM,"G1, G1",A101,2,0,0,3,0']);
    const weeks = extractResourceWeeks(csv);
    expect(weeks['G1']).toEqual([1, 47]);
  });
});
