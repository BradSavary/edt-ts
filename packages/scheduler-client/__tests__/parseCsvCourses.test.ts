import { describe, it, expect } from 'vitest';
import { parseCsvCourses } from '../lib/parseCsvCourses';

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
});
