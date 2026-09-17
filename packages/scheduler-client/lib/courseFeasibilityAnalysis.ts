import type { CourseTaskData, ResourceEntry } from '@edt-ts/scheduler-common';
import { Availability, AvailabilityManager } from '@edt-ts/scheduler-common';

export type FeasibilityResourceKind = 'teacher' | 'room' | 'group';

export interface UnschedulableReason {
  resourceKind: FeasibilityResourceKind;
  /** L'entrée bloquante (un seul id, ou toutes les alternatives si aucune ne convient). */
  resourceIds: string[];
  /**
   * `no-availability`/`insufficient-duration` : niveau 1, ressource jugée seule.
   * `no-slot` : niveau 2, croisement de toutes les ressources imposés déduits (§3).
   */
  kind: 'no-availability' | 'insufficient-duration' | 'no-slot';
  message: string;
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

/**
 * Union des disponibilités de toutes les alternatives d'une entrée (une seule alternative
 * disponible suffit à débloquer l'entrée — cf. `ResourceEntry`, "A ET (B OU C)").
 * Contrairement à `getEntryAvailability` (lib/taskConstraintAnalysis.ts), une ressource vide
 * n'est PAS traitée comme "non contrainte" : elle doit apparaître vide, c'est justement ce qu'on
 * cherche à détecter ici (même choix que `capacityByDay` dans lib/resourceLoadAnalysis.ts).
 */
function unionAvailability(ids: string[], am: AvailabilityManager, weekNumber: number): Availability {
  const result = new Availability();
  for (const id of ids) {
    const av = am.getAvailability(id, weekNumber);
    if (!av) continue;
    for (const slot of av.getAvailableIntervals()) {
      result.addAvailability(slot.start, slot.end);
    }
  }
  return result;
}

function checkEntry(
  entry: ResourceEntry,
  resourceKind: FeasibilityResourceKind,
  duration: number,
  am: AvailabilityManager,
  weekNumber: number,
): UnschedulableReason | null {
  const ids = Array.isArray(entry) ? entry : [entry];
  const union = unionAvailability(ids, am, weekNumber);
  const label = ids.length > 1 ? ids.join(' | ') : ids[0];

  if (union.isEmpty()) {
    return {
      resourceKind,
      resourceIds: ids,
      kind: 'no-availability',
      message: `${label} : aucune disponibilité définie`,
    };
  }

  if (!union.hasSlotOfDuration(duration)) {
    const longest = union.getAvailableIntervals().reduce((max, slot) => Math.max(max, slot.end - slot.start), 0);
    return {
      resourceKind,
      resourceIds: ids,
      kind: 'insufficient-duration',
      message: `${label} : aucun créneau ≥ ${formatMinutes(duration)} (dispo max en continu : ${formatMinutes(longest)})`,
    };
  }

  return null;
}

/**
 * Cours structurellement impossible à placer : au moins une ressource associée (enseignant,
 * salle ou groupe) n'a soit aucune disponibilité déclarée pour la semaine, soit jamais de
 * créneau contigu aussi long que la durée du cours. Indépendant du statut `enforced` — un cours
 * imposé ignore les disponibilités, c'est à l'appelant de l'exclure via `enforcedMap`.
 */
export function getCourseUnschedulableReasons(
  course: CourseTaskData,
  am: AvailabilityManager,
  weekNumber: number,
): UnschedulableReason[] {
  const reasons: UnschedulableReason[] = [];
  const groups: { kind: FeasibilityResourceKind; entries: ResourceEntry[] }[] = [
    { kind: 'teacher', entries: course.teacher },
    { kind: 'room', entries: course.rooms ?? [] },
    { kind: 'group', entries: course.groups },
  ];

  for (const { kind, entries } of groups) {
    for (const entry of entries) {
      const reason = checkEntry(entry, kind, course.duration, am, weekNumber);
      if (reason) reasons.push(reason);
    }
  }

  return reasons;
}

// ---------------------------------------------------------------------------
// Niveau 2 — faisabilité EXACTE dans l'état courant du calendrier (§3 du plan
// docs/PlanDiagnosticEchec.md).
//
// Le niveau 1 ci-dessus (`getCourseUnschedulableReasons`) juge chaque ressource
// ISOLÉMENT, sur sa seule disponibilité déclarée. Il capte « cette ressource n'a
// jamais assez de place », et rien d'autre — sur GEA 87 S40 il ne signalait aucun
// cours alors que le CM R3.01 n'avait aucun créneau possible.
//
// Ce niveau-ci croise TOUTES les ressources du cours et retire l'occupation des
// cours déjà imposés. Son verdict est donc CONTEXTUEL : il change dès qu'une
// imposition bouge, contrairement au niveau 1 qui est absolu.
// ---------------------------------------------------------------------------

/** Pas de la grille horaire du moteur — doit rester aligné sur `GRID_MINUTES` (cpsat_engine.py). */
export const GRID_MINUTES = 30;

const DAYS_PER_WEEK = 5;
const MINUTES_PER_DAY = 1440;

/** Occupation d'une ressource par un cours imposé, en minutes depuis lundi 00:00. */
export interface EnforcedOccupancy {
  resourceId: string;
  start: number;
  end: number;
  /** Libellés du cours occupant, pour nommer le coupable dans le message. */
  code: string;
  type: string;
}

/** Une entrée de ressource du cours : un id fixe, ou une liste d'alternatives. */
export interface FeasibilityEntry {
  kind: FeasibilityResourceKind;
  ids: string[];
  /**
   * Aucun des ids n'a d'entrée propre dans les contraintes : la ressource hérite du Défaut.
   * Affiché tel quel (§3.3.1 du plan) — sans ça l'utilisateur cherche une contrainte inexistante.
   */
  inheritsDefault: boolean;
  /** Nombre de débuts possibles pour cette entrée prise seule. */
  slotCount: number;
}

/** Une entrée dont le retrait rendrait le cours plaçable — donc un levier d'action réel. */
export interface FeasibilityLever {
  entry: FeasibilityEntry;
  /** Les débuts qui redeviendraient possibles sans cette entrée. */
  slots: number[];
  /** Les cours imposés qui occupent cette entrée sur ces créneaux. */
  blockedBy: EnforcedOccupancy[];
}

export interface CourseSlotDiagnosis {
  feasible: boolean;
  /** Nombre de débuts compatibles avec TOUTES les ressources (0 ⇒ infaisable). */
  slotCount: number;
  entries: FeasibilityEntry[];
  /**
   * Leviers au sens §3.2 : entrées dont le retrait *seul* débloque le cours. Vide quand aucune
   * ressource ne suffit à elle seule — cas où ne désigner personne est la seule réponse honnête.
   */
  levers: FeasibilityLever[];
}

export interface FeasibilityContext {
  am: AvailabilityManager;
  weekNumber: number;
  /** Ids de toutes les ressources de type `group` — la pause ne s'applique QU'À elles. */
  groupIds: Set<string>;
  /** Pause méridienne fixe en minutes depuis minuit, ou `null`. */
  lunch: { from: number; to: number } | null;
  /** Occupation imposée, indexée par id de ressource. */
  occupancy: Map<string, EnforcedOccupancy[]>;
  /** Ids ayant une entrée propre dans `ConstraintsData` (hors `Default`). */
  constrainedIds: Set<string>;
}

/**
 * Fenêtres réellement libres d'une ressource : disponibilité de la semaine, moins la pause
 * méridienne SI c'est un groupe, moins l'occupation par les cours imposés.
 *
 * ⚠️ Le carving de la pause sur les seuls groupes réplique `_make_availability`
 * (cpsat_engine.py, `if rid in group_ids`) : le moteur ne l'applique ni aux enseignants ni aux
 * salles. Carver partout rendrait ce diagnostic plus pessimiste que le moteur, donc produirait
 * des cours annoncés « impossibles » que le moteur place sans difficulté.
 */
function freeIntervals(id: string, ctx: FeasibilityContext): { start: number; end: number }[] {
  const declared = ctx.am.getAvailability(id, ctx.weekNumber);
  const work = new Availability();
  if (declared) {
    for (const slot of declared.getAvailableIntervals()) work.addAvailability(slot.start, slot.end);
  }

  if (ctx.lunch && ctx.groupIds.has(id)) {
    for (let day = 0; day < DAYS_PER_WEEK; day++) {
      work.removeAvailability(day * MINUTES_PER_DAY + ctx.lunch.from, day * MINUTES_PER_DAY + ctx.lunch.to);
    }
  }

  for (const occ of ctx.occupancy.get(id) ?? []) work.removeAvailability(occ.start, occ.end);

  return work.getAvailableIntervals().map((s) => ({ start: s.start, end: s.end }));
}

/** Débuts sur la grille de 30 min tels que `[t, t+duration]` tienne dans une fenêtre libre. */
function startsOf(intervals: { start: number; end: number }[], duration: number): Set<number> {
  const out = new Set<number>();
  for (const { start, end } of intervals) {
    let t = Math.ceil(start / GRID_MINUTES) * GRID_MINUTES;
    for (; t + duration <= end; t += GRID_MINUTES) out.add(t);
  }
  return out;
}

/** Débuts possibles pour une entrée : union des alternatives (une seule suffit à la satisfaire). */
function startsOfEntry(ids: string[], duration: number, ctx: FeasibilityContext): Set<number> {
  const out = new Set<number>();
  for (const id of ids) {
    for (const t of startsOf(freeIntervals(id, ctx), duration)) out.add(t);
  }
  return out;
}

function intersectAll(sets: Set<number>[]): Set<number> {
  if (sets.length === 0) return new Set();
  let acc = sets[0];
  for (let i = 1; i < sets.length && acc.size > 0; i++) {
    const next = new Set<number>();
    for (const t of acc) if (sets[i].has(t)) next.add(t);
    acc = next;
  }
  return acc;
}

function entriesOf(course: CourseTaskData): { kind: FeasibilityResourceKind; ids: string[] }[] {
  const out: { kind: FeasibilityResourceKind; ids: string[] }[] = [];
  const cats: [ResourceEntry[], FeasibilityResourceKind][] = [
    [course.teacher, 'teacher'],
    [course.groups, 'group'],
    [course.rooms ?? [], 'room'],
  ];
  for (const [entries, kind] of cats) {
    for (const entry of entries) out.push({ kind, ids: Array.isArray(entry) ? entry : [entry] });
  }
  return out;
}

/**
 * Le cours tient-il quelque part, dans l'état courant du calendrier ?
 *
 * Quand la réponse est non, on ne désigne PAS la ressource qui a vidé l'ensemble au fil de
 * l'intersection : ce résultat dépend de l'ordre de parcours, donc il est arbitraire. On refait
 * le calcul en retirant chaque entrée une par une, et on ne retient que celles dont le retrait
 * rend le cours plaçable (§3.2 du plan). Coût : N+1 intersections, sur les seuls cours infaisables.
 */
export function diagnoseCourseSlots(
  course: CourseTaskData,
  ctx: FeasibilityContext,
): CourseSlotDiagnosis {
  const duration = course.duration;
  const raw = entriesOf(course);
  const startSets = raw.map((e) => startsOfEntry(e.ids, duration, ctx));

  const entries: FeasibilityEntry[] = raw.map((e, i) => ({
    kind: e.kind,
    ids: e.ids,
    inheritsDefault: e.ids.every((id) => !ctx.constrainedIds.has(id)),
    slotCount: startSets[i].size,
  }));

  const feasibleStarts = intersectAll(startSets);
  if (feasibleStarts.size > 0) {
    return { feasible: true, slotCount: feasibleStarts.size, entries, levers: [] };
  }

  const levers: FeasibilityLever[] = [];
  for (let skip = 0; skip < raw.length; skip++) {
    const without = intersectAll(startSets.filter((_, i) => i !== skip));
    if (without.size === 0) continue;

    const slots = [...without].sort((a, b) => a - b);
    const blockedBy: EnforcedOccupancy[] = [];
    for (const id of raw[skip].ids) {
      for (const occ of ctx.occupancy.get(id) ?? []) {
        if (slots.some((t) => occ.start < t + duration && occ.end > t)) blockedBy.push(occ);
      }
    }
    levers.push({ entry: entries[skip], slots, blockedBy });
  }

  return { feasible: false, slotCount: 0, entries, levers };
}

const DAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

/** « jeudi 08h30–12h30 » — minutes depuis lundi 00:00. */
function formatSlot(start: number, duration: number): string {
  const day = Math.floor(start / MINUTES_PER_DAY);
  const off = start % MINUTES_PER_DAY;
  const end = off + duration;
  const pad = (n: number) => String(n).padStart(2, '0');
  const name = DAY_NAMES[day] ?? `jour ${day}`;
  return `${name} ${pad(Math.floor(off / 60))}h${pad(off % 60)}–${pad(Math.floor(end / 60))}h${pad(end % 60)}`;
}

/**
 * Message d'un cours sans aucun créneau possible.
 *
 * Jumeau de `_explain_no_slot` (cpsat_engine.py) : même formulation avant et après le run, pour
 * que l'utilisateur reconnaisse le même diagnostic aux deux endroits.
 *
 * Trois formes, et la dernière est la plus importante : quand aucune ressource ne suffit seule à
 * débloquer le cours, on ne désigne personne. Accuser la dernière ressource rencontrée serait
 * une affirmation fausse — et c'est exactement ce que produirait une désignation par ordre
 * d'intersection.
 */
export function explainNoSlot(diagnosis: CourseSlotDiagnosis, duration: number): string {
  if (diagnosis.levers.length === 0) {
    const tightest = [...diagnosis.entries].sort((a, b) => a.slotCount - b.slotCount).slice(0, 3);
    const detail = tightest.map((e) => `${e.ids.join('|')} (${e.slotCount} créneau(x))`).join(', ');
    return 'Aucun créneau possible dans l\'état actuel, et aucune ressource ne suffit seule à '
      + `débloquer le cours — les contraintes se cumulent. Les plus serrées : ${detail}.`;
  }

  const parts = diagnosis.levers.map((lever) => {
    const ids = lever.entry.ids.join('|');
    const slots = lever.slots.slice(0, 3).map((t) => formatSlot(t, duration)).join(', ');
    const more = lever.slots.length > 3 ? '…' : '';
    const blockers = [...new Set(
      lever.blockedBy.map((b) => `${b.code} ${b.type} (${formatSlot(b.start, b.end - b.start)})`),
    )].sort().join(', ');
    let piece = `sans ${ids}, le cours tiendrait : ${slots}${more}`;
    if (blockers) piece += ` — mais ${ids} y est occupé par le cours imposé ${blockers}`;
    // §3.3.1 : sans cette mention, l'utilisateur va chercher une contrainte qui n'existe pas.
    // La ressource est NOMMÉE dans la parenthèse : placée juste après le cours imposé, une mention
    // anonyme se rattache visuellement à lui plutôt qu'à la ressource (remarque Frédéric).
    if (lever.entry.inheritsDefault) piece += ` (${ids} n'a pas de contrainte spécifique, hérite des contraintes par Défaut)`;
    return piece;
  });

  // Majuscule sur la première partie : elle ouvre une phrase, après un point.
  const joined = parts.join(' ; ');
  return `Aucun créneau possible dans l'état actuel du calendrier. ${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`;
}

/**
 * Occupation des ressources par les cours imposés, prête pour `FeasibilityContext`.
 *
 * `EnforcedData` ne porte pas la durée — elle vient du cours référencé, jamais du placement
 * (même règle que `toTaskSolutionJSON`). Un id d'imposition sans cours correspondant est ignoré :
 * il ne peut occuper personne.
 */
export function buildEnforcedOccupancy(
  enforcedMap: Record<string, { startTime: number; teacher: string[]; groups: string[]; rooms: string[] }>,
  courseById: Map<string, { duration: number; code: string; type: string }>,
): Map<string, EnforcedOccupancy[]> {
  const occupancy = new Map<string, EnforcedOccupancy[]>();
  for (const [taskId, enforced] of Object.entries(enforcedMap)) {
    const course = courseById.get(taskId);
    if (!course) continue;
    const start = enforced.startTime;
    const end = start + course.duration;
    for (const id of [...enforced.teacher, ...enforced.groups, ...enforced.rooms]) {
      const list = occupancy.get(id) ?? [];
      list.push({ resourceId: id, start, end, code: course.code, type: course.type });
      occupancy.set(id, list);
    }
  }
  return occupancy;
}

/** Minutes depuis minuit pour un `"HH:MM"`. */
function parseHHMM(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Pause méridienne au format attendu par `FeasibilityContext`. Seule la pause **fixe** réduit les
 * fenêtres : `none` ne réduit rien, et `floating` n'est implémentée par aucun moteur (CP-SAT lève
 * dessus) — la traiter comme une réduction donnerait un verdict que le moteur ne partage pas.
 */
export function lunchFromConfig(
  lunchBreak: { type: string; from?: string; to?: string } | undefined,
): { from: number; to: number } | null {
  if (!lunchBreak || lunchBreak.type !== 'fixed' || !lunchBreak.from || !lunchBreak.to) return null;
  return { from: parseHHMM(lunchBreak.from), to: parseHHMM(lunchBreak.to) };
}
