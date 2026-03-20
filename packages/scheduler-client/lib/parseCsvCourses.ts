import type { CourseTaskData } from '@edt-ts/scheduler-common';

/** Convertit un semestre textuel ("S1"…"S6") en numéro entier. */
function parseSemester(raw: string): number {
  const m = raw.trim().match(/^S(\d+)$/i);
  return m ? parseInt(m[1], 10) : 0;
}

/** Détermine le niveau BUT (0=BUT1, 1=BUT2, 2=BUT3) depuis le numéro de semestre. */
function levelFromSemester(semester: number): number {
  if (semester <= 2) return 0;
  if (semester <= 4) return 1;
  return 2;
}

/**
 * Parse un fichier CSV de ventilation horaire et extrait les tâches planifiables
 * pour la semaine ISO donnée.
 *
 * Format attendu des colonnes :
 *   Semestre, Parcours, Code, Enseignement, Intervenant, Nature, Groupes, Salles,
 *   S35, S36, …, S52, S1, S2, …, S28
 *
 * Les salles multiples (séparées par ", ") sont envoyées comme liste d'alternatives
 * au planificateur : rooms = [["salle1", "salle2", ...]]
 */
export function parseCsvCourses(csvText: string, week: number): CourseTaskData[] {
  const lines = csvText.split(/\r?\n/);
  if (lines.length < 2) {
    throw new Error('Le fichier CSV est vide ou ne contient pas d\'en-tête.');
  }

  // Première ligne non vide = en-tête
  const headerLine = lines.find((l) => l.trim().length > 0) ?? '';
  const headers = parseCSVRow(headerLine);

  const weekCol = `S${week}`;
  const weekIndex = headers.findIndex(
    (h) => h.trim().toLowerCase() === weekCol.toLowerCase()
  );

  if (weekIndex === -1) {
    throw new Error(
      `La colonne "${weekCol}" est introuvable dans le CSV. Semaines disponibles : ${
        headers.filter((h) => /^S\d+$/i.test(h.trim())).map((h) => h.trim()).join(', ')
      }`
    );
  }

  const courses: CourseTaskData[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = parseCSVRow(line);
    if (cols.length <= weekIndex) continue;

    const rawHours = cols[weekIndex].trim();
    if (!rawHours) continue;

    const hours = parseFloat(rawHours);
    if (isNaN(hours) || hours <= 0) continue;

    const rawSemester = cols[0]?.trim() ?? '';
    const semester = parseSemester(rawSemester);
    const level = levelFromSemester(semester);

    const code = cols[2]?.trim() ?? '';
    const name = cols[3]?.trim() ?? '';
    const teacher = cols[4]?.trim() ?? '';
    const type = cols[5]?.trim() ?? '';

    const rawGroups = cols[6]?.trim() ?? '';
    const groups = rawGroups
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean);

    const rawRooms = cols[7]?.trim() ?? '';
    const roomList = rawRooms
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);

    // Une seule entrée avec toutes les salles alternatives
    const rooms: (string | string[])[] = roomList.length > 1 ? [roomList] : roomList;

    courses.push({
      week,
      semester,
      level,
      code,
      name,
      type,
      teacher: teacher ? [teacher] : [],
      groups,
      rooms,
      duration: Math.round(hours * 60),
    });
  }

  return courses;
}

/**
 * Parse une ligne CSV en respectant les guillemets (champs pouvant contenir des virgules).
 * Ex: `a,"b,c",d` → `['a', 'b,c', 'd']`
 */
function parseCSVRow(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}
