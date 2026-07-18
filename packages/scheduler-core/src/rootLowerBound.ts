import { Task, Resource, ResourceType, type LunchBreakConfig } from '@edt-ts/scheduler-common';
import { getApplicableResources, intersectResources } from './taskScheduling.js';

const DAY = 24 * 60;

/**
 * Preuve d'optimalité racine par certificats de bin-packing exact (docs/PlanOptionalTasksP2Preuve.md).
 *
 * Fonctions pures, aucun état partagé, aucune mutation des ressources/tâches passées en entrée.
 * `computeRootLowerBound` prend le graphe d'unités déjà chargé (avant toute passe de recherche) et
 * retourne une borne inférieure sûre sur le nombre de tâches devant être sautées, avec les
 * certificats qui la justifient.
 *
 * Principe de sûreté cardinal (à respecter dans CHAQUE approximation ci-dessous) : la borne n'est
 * valide que si le packing (`MaxPack`) est SURESTIMÉ. Toute simplification doit aller dans le sens
 * « plus de tâches plaçables qu'en réalité », jamais l'inverse. Un dépassement de limite de nœuds du
 * DFS retombe sur la borne de comptage (mono-ressource) ou abandonne le certificat (cluster) —
 * jamais sur le meilleur packing partiel trouvé, qui sous-estimerait MaxPack et donc surestimerait
 * la borne.
 */

// ── Intervalles ───────────────────────────────────────────────────────────

interface Iv { start: number; end: number }

function unionIntervals(ivs: Iv[]): Iv[] {
  const sorted = [...ivs].filter(iv => iv.end > iv.start).sort((a, b) => a.start - b.start);
  const out: Iv[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else out.push({ ...iv });
  }
  return out;
}

function subtractIntervals(ivs: Iv[], holes: Iv[]): Iv[] {
  let cur = ivs.map(iv => ({ ...iv }));
  for (const h of holes) {
    const next: Iv[] = [];
    for (const iv of cur) {
      if (h.end <= iv.start || h.start >= iv.end) { next.push(iv); continue; }
      if (h.start > iv.start) next.push({ start: iv.start, end: h.start });
      if (h.end < iv.end) next.push({ start: h.end, end: iv.end });
    }
    cur = next;
  }
  return cur;
}

/** Plus long run contigu de l'intersection ivs ∩ [wStart,wEnd]. */
function maxRunWithin(ivs: Iv[], wStart: number, wEnd: number): number {
  let best = 0;
  for (const iv of ivs) {
    const s = Math.max(iv.start, wStart);
    const e = Math.min(iv.end, wEnd);
    if (e - s > best) best = e - s;
  }
  return best;
}

// ── §1.1 — Domaine réel d'une tâche ──────────────────────────────────────

/**
 * Union, sur tous les combos applicables de `task`, de l'intersection des disponibilités du
 * combo — pas seulement le combo actuellement décidé par earlySchedule. C'est ce niveau qui
 * distingue un créneau structurellement inatteignable (aucun combo ne le couvre) d'un créneau
 * simplement non retenu par l'heuristique de placement.
 */
export function computeTaskDomain(task: Task): Iv[] {
  const union: Iv[] = [];
  for (const combo of getApplicableResources(task)) {
    for (const iv of intersectResources(combo).getAvailableIntervals()) {
      union.push({ start: iv.start, end: iv.end });
    }
  }
  return unionIntervals(union);
}

// ── Occupations enforced par ressource ───────────────────────────────────

function buildEnforcedOccupancy(tasks: Task[]): Map<string, Iv[]> {
  const occ = new Map<string, Iv[]>();
  for (const t of tasks) {
    if (!t.isEnforced || !t.enforced) continue;
    for (const rid of [...t.enforced.teacher, ...t.enforced.groups, ...t.enforced.rooms]) {
      const list = occ.get(rid) ?? [];
      list.push({ start: t.enforced.startTime, end: t.enforced.startTime + t.duration });
      occ.set(rid, list);
    }
  }
  return occ;
}

/** Pause méridienne flottante applicable à ce jour : même garde d'inapplicabilité que
 *  `Scheduler._resourceKeepsFloatingBreak` — si la dispo du jour ne recouvre déjà la fenêtre
 *  que sur moins que sa durée, la contrainte n'a jamais pu être satisfaite ce jour-là et ne
 *  doit pas être re-déduite (sinon la borne devient invalide sur les jours courts). */
function floatingLunchDeduction(dayIvs: Iv[], day: number, lunchBreak: LunchBreakConfig): number {
  if (lunchBreak.type !== 'floating') return 0;
  const [eh, em] = lunchBreak.earliest.split(':').map(Number);
  const [lh, lm] = lunchBreak.latest.split(':').map(Number);
  const winStart = day * DAY + eh * 60 + em;
  const winEnd = day * DAY + lh * 60 + lm;
  let overlap = 0;
  for (const iv of dayIvs) {
    const s = Math.max(iv.start, winStart);
    const e = Math.min(iv.end, winEnd);
    if (s < e) overlap += e - s;
  }
  return overlap >= lunchBreak.duration ? lunchBreak.duration : 0;
}

// ── §1.2 — Certificats mono-ressource ────────────────────────────────────

interface Win { day: number; len: number }

/** MaxPack exact (DFS + élagage) avec éligibilité item×fenêtre. Repli sûr sur dépassement de
 *  nœuds : borne de comptage (préfixe croissant des durées vs capacité totale), jamais le
 *  meilleur packing partiel trouvé — voir le principe de sûreté cardinal en tête de fichier. */
function maxPackMono(itemsIn: number[], winsIn: Win[], dayCaps: Map<number, number>, eligible: boolean[][], nodeLimit: number): number {
  const order = itemsIn.map((d, i) => ({ d, i })).sort((a, b) => b.d - a.d);
  const items = order.map(o => o.d);
  const elig = order.map(o => eligible[o.i]);
  const n = items.length;

  const asc = [...items].sort((a, b) => a - b);
  const totalCap = [...dayCaps.values()].reduce((s, c) => s + c, 0);
  let ubCount = 0, acc = 0;
  for (const d of asc) { if (acc + d > totalCap) break; acc += d; ubCount++; }
  const ub = Math.min(n, ubCount);

  let best = 0;
  let nodes = 0;
  let exact = true;
  const winRes = winsIn.map(w => w.len);
  const dayRes = new Map(dayCaps);
  const seen = new Map<string, number>();

  const dfs = (idx: number, placed: number): void => {
    if (placed > best) best = placed;
    if (best >= ub) return;
    if (idx >= n || placed + (n - idx) <= best) return;
    if (++nodes > nodeLimit) { exact = false; return; }
    const key = idx + '|' + winRes.join(',');
    const prev = seen.get(key);
    if (prev !== undefined && prev >= placed) return;
    seen.set(key, placed);
    const d = items[idx];
    for (let w = 0; w < winsIn.length; w++) {
      if (!elig[idx][w]) continue;
      const day = winsIn[w].day;
      const dc = dayRes.get(day) ?? Infinity;
      if (winRes[w] < d || dc < d) continue;
      winRes[w] -= d; dayRes.set(day, dc - d);
      dfs(idx + 1, placed + 1);
      winRes[w] += d; dayRes.set(day, dc);
      if (best >= ub || nodes > nodeLimit) return;
    }
    dfs(idx + 1, placed); // brancher "item non placé"
  };
  dfs(0, 0);
  return exact ? best : Math.min(ub, n); // repli : borne de comptage, jamais le partiel trouvé
}

interface MonoFinding { resource: Resource; tasks: Task[]; lb: number; note: string }

function computeMonoCertificates(
  nonEnforced: Task[],
  enforcedOcc: Map<string, Iv[]>,
  lunchBreak: LunchBreakConfig,
  ignoreDailyLimits: boolean,
  nodeLimit: number,
): MonoFinding[] {
  const mandatory = new Map<Resource, Task[]>();
  for (const t of nonEnforced) {
    for (const type of [ResourceType.TEACHER, ResourceType.ROOM, ResourceType.GROUP]) {
      for (const slot of t.resources[type]) {
        if (slot.length !== 1) continue; // alternative : pas obligatoire
        const list = mandatory.get(slot[0]) ?? [];
        list.push(t);
        mandatory.set(slot[0], list);
      }
    }
  }

  const findings: MonoFinding[] = [];

  for (const [r, S] of mandatory) {
    if (S.length === 0) continue;

    const enfHoles = enforcedOcc.get(r.id) ?? [];
    const avail = subtractIntervals(
      r.availability.getAvailableIntervals().map(iv => ({ start: iv.start, end: iv.end })),
      enfHoles,
    );
    const wins: Win[] = avail.map(iv => ({ day: Math.floor(iv.start / DAY), len: iv.end - iv.start }));

    const domains = S.map(t => subtractIntervals(computeTaskDomain(t), enfHoles));

    const dayCaps = new Map<number, number>();
    const daysSeen = new Set(wins.map(w => w.day));
    for (const day of daysSeen) {
      const dayIvs = avail.filter(iv => Math.floor(iv.start / DAY) === day);
      let cap = dayIvs.reduce((s, iv) => s + (iv.end - iv.start), 0);
      if (r.type === ResourceType.GROUP) cap -= floatingLunchDeduction(dayIvs, day, lunchBreak);
      if (r.maxDailyMinutes !== undefined && !ignoreDailyLimits) {
        const enfMin = enfHoles.filter(o => Math.floor(o.start / DAY) === day).reduce((s, o) => s + (o.end - o.start), 0);
        cap = Math.min(cap, Math.max(0, r.maxDailyMinutes - enfMin));
      }
      // Raffinement « union des domaines » : le temps occupé par S sur r ce jour-là vit dans
      // l'union des domaines réels des tâches candidates, restreinte aux fenêtres du jour.
      const unionDom = unionIntervals(domains.flatMap(dom =>
        dom.flatMap(iv => dayIvs.map(w => ({ start: Math.max(iv.start, w.start), end: Math.min(iv.end, w.end) })).filter(x => x.end > x.start))
      ));
      cap = Math.min(cap, unionDom.reduce((s, iv) => s + (iv.end - iv.start), 0));
      dayCaps.set(day, cap);
    }

    // Éligibilité item×fenêtre : la tâche doit disposer d'un run contigu ≥ durée dans son
    // domaine réel (déjà amputé des trous enforced) ∩ la fenêtre exacte.
    const eligible: boolean[][] = S.map((_t, i) =>
      avail.map(w => maxRunWithin(domains[i], w.start, w.end) >= S[i].duration)
    );

    const durations = S.map(t => t.duration);
    const pack = maxPackMono(durations, wins, dayCaps, eligible, nodeLimit);
    const lb = S.length - pack;
    if (lb > 0) {
      const capStr = [...dayCaps.entries()].sort((a, b) => a[0] - b[0]).map(([d, c]) => `j${d}:${c}`).join(' ');
      const demand = durations.reduce((s, d) => s + d, 0);
      findings.push({
        resource: r, tasks: S, lb,
        note: `mono-ressource ${r.type} "${r.id}" — ${S.length} tâche(s) obligatoire(s), demande ${demand}min, caps/jour ${capStr}`,
      });
    }
  }

  return findings;
}

// ── §1.3 — Certificats cluster de groupes ────────────────────────────────

interface ClusterFinding { resources: Resource[]; tasks: Task[]; lb: number; note: string }

function computeClusterCertificates(
  nonEnforced: Task[],
  enforcedOcc: Map<string, Iv[]>,
  lunchBreak: LunchBreakConfig,
  ignoreDailyLimits: boolean,
  nodeLimit: number,
): ClusterFinding[] {
  const groupResources = new Map<string, Resource>();
  for (const t of nonEnforced) {
    for (const slot of t.resources[ResourceType.GROUP]) {
      if (slot.length === 1) groupResources.set(slot[0].id, slot[0]);
    }
  }

  const candidateClusters: Resource[][] = [];
  const seenCluster = new Set<string>();
  const addCluster = (ids: string[]): void => {
    const key = [...ids].sort().join('|');
    if (ids.length < 2 || seenCluster.has(key)) return;
    seenCluster.add(key);
    candidateClusters.push(ids.map(id => groupResources.get(id)!).filter(Boolean));
  };
  for (const t of nonEnforced) {
    const mand = t.resources[ResourceType.GROUP].filter(s => s.length === 1).map(s => s[0].id);
    addCluster(mand);
  }
  const byPromo = new Map<string, string[]>();
  for (const id of groupResources.keys()) {
    const promo = id.split('-')[0];
    byPromo.set(promo, [...(byPromo.get(promo) ?? []), id]);
  }
  for (const ids of byPromo.values()) addCluster(ids);

  const findings: ClusterFinding[] = [];

  for (const cluster of candidateClusters) {
    const clusterIds = new Set(cluster.map(r => r.id));
    const S = nonEnforced.filter(t =>
      t.resources[ResourceType.GROUP].some(s => s.length === 1 && clusterIds.has(s[0].id))
    );
    if (S.length < 2) continue;

    const domains = S.map(t => computeTaskDomain(t));

    // Chaque item consomme TOUTES ses ressources obligatoires (groupes du cluster, enseignants,
    // salles imposées) — pas seulement les ressources du cluster.
    const consumed = new Map<string, Resource>();
    const itemRes: string[][] = S.map(t => {
      const rs: Resource[] = [];
      for (const type of [ResourceType.TEACHER, ResourceType.ROOM, ResourceType.GROUP]) {
        for (const slot of t.resources[type]) if (slot.length === 1) rs.push(slot[0]);
      }
      rs.forEach(r => consumed.set(r.id, r));
      return rs.map(r => r.id);
    });

    const capKey = (rid: string, d: number): string => `${rid}#${d}`;
    const caps = new Map<string, number>();
    for (const r of consumed.values()) {
      const enfHoles = enforcedOcc.get(r.id) ?? [];
      const avail = subtractIntervals(
        r.availability.getAvailableIntervals().map(iv => ({ start: iv.start, end: iv.end })),
        enfHoles,
      );
      for (let d = 0; d < 5; d++) {
        const dayIvs = avail.filter(iv => Math.floor(iv.start / DAY) === d);
        let cap = dayIvs.reduce((s, iv) => s + (iv.end - iv.start), 0);
        if (cap === 0) { caps.set(capKey(r.id, d), 0); continue; }
        if (r.type === ResourceType.GROUP) cap -= floatingLunchDeduction(dayIvs, d, lunchBreak);
        if (r.maxDailyMinutes !== undefined && !ignoreDailyLimits) {
          const enfMin = enfHoles.filter(o => Math.floor(o.start / DAY) === d).reduce((s, o) => s + (o.end - o.start), 0);
          cap = Math.min(cap, Math.max(0, r.maxDailyMinutes - enfMin));
        }
        // Raffinement « union des domaines » : le temps occupé par S sur r ce jour-là vit dans
        // l'union des domaines réels des tâches consommant r, restreinte aux fenêtres du jour.
        const unionDom = unionIntervals(S.flatMap((_t, i) => {
          if (!itemRes[i].includes(r.id)) return [];
          return domains[i].flatMap(iv => dayIvs.map(w => ({ start: Math.max(iv.start, w.start), end: Math.min(iv.end, w.end) })).filter(x => x.end > x.start));
        }));
        cap = Math.min(cap, unionDom.reduce((s, iv) => s + (iv.end - iv.start), 0));
        caps.set(capKey(r.id, d), cap);
      }
    }

    const eligDay: boolean[][] = S.map((t, i) => {
      const out: boolean[] = [];
      for (let d = 0; d < 5; d++) out.push(maxRunWithin(domains[i], d * DAY, (d + 1) * DAY) >= t.duration);
      return out;
    });

    const order = S.map((_t, i) => i).sort((a, b) => S[b].duration - S[a].duration || itemRes[b].length - itemRes[a].length);
    let best = 0;
    let nodes = 0;
    let exact = true;
    const seenState = new Map<string, number>();
    const cur: number[] = S.map(() => -1);

    const dfs = (k: number, placed: number): void => {
      if (placed > best) best = placed;
      if (k >= order.length || placed + (order.length - k) <= best) return;
      if (++nodes > nodeLimit) { exact = false; return; }
      const stateKey = k + '|' + [...caps.values()].join(',');
      const prevPlaced = seenState.get(stateKey);
      if (prevPlaced !== undefined && prevPlaced >= placed) return;
      seenState.set(stateKey, placed);
      const i = order[k];
      const dur = S[i].duration;
      for (let d = 0; d < 5; d++) {
        if (!eligDay[i][d]) continue;
        const keys = itemRes[i].map(rid => capKey(rid, d));
        if (keys.some(key => (caps.get(key) ?? 0) < dur)) continue;
        for (const key of keys) caps.set(key, caps.get(key)! - dur);
        cur[i] = d;
        dfs(k + 1, placed + 1);
        cur[i] = -1;
        for (const key of keys) caps.set(key, caps.get(key)! + dur);
        if (nodes > nodeLimit) return;
      }
      dfs(k + 1, placed);
    };
    dfs(0, 0);

    // Dépassement de nœuds : cluster abandonné (aucune borne — côté sûr), pas de repli
    // comptage ici (les caps sont réparties sur plusieurs ressources par jour, une borne de
    // comptage globale n'est pas immédiate à établir en restant sûre).
    if (!exact) continue;

    const lb = S.length - best;
    if (lb > 0) {
      const demand = S.reduce((s, t, i) => s + t.duration * itemRes[i].length, 0);
      findings.push({
        resources: cluster, tasks: S, lb,
        note: `cluster {${cluster.map(r => r.id).join('+')}} — ${S.length} tâche(s), demande-groupe ${demand}min`,
      });
    }
  }

  return findings;
}

// ── §1.4 — Somme disjointe ────────────────────────────────────────────────

export interface Certificate {
  resourceIds: string[];
  taskIds: string[];
  lb: number;
  note: string;
}

export interface RootLowerBoundResult {
  lb: number;
  certificates: Certificate[];
}

export interface RootLowerBoundConfig {
  lunchBreak: LunchBreakConfig;
  ignoreDailyLimits: boolean;
  /**
   * Limites de nœuds DFS (§1.2/§1.3) — surchargeables pour les tests (repli sûr sur
   * dépassement, cf. micro-tests de rootLowerBound.test.ts) ; défauts de production sinon.
   */
  monoNodeLimit?: number;
  clusterNodeLimit?: number;
}

const DEFAULT_MONO_NODE_LIMIT = 4_000_000;
const DEFAULT_CLUSTER_NODE_LIMIT = 6_000_000;

/**
 * Borne inférieure racine sur le nombre de tâches devant être sautées, par certificats de
 * bin-packing exact (mono-ressource §1.2, cluster de groupes §1.3), combinés par sélection
 * disjointe gloutonne (§1.4 — l'optimisation exacte de la sélection est inutile au vu des
 * tailles rencontrées en pratique).
 *
 * `allTasks` : toutes les tâches du problème (enforced incluses — exclues des candidats mais
 * leurs occupations réduisent les fenêtres et les caps quotidiennes des autres), typiquement
 * `Loader.tasksManager.getAllUnits()`. Opère au niveau Task, pas ISchedulingUnit : l'appartenance
 * à un TaskGroupUnit ne change rien à cette analyse (chaque tâche membre conserve son propre
 * `resources`) — évite de dépendre d'un `initSolver()` préalable (fonction pure, appelable dès
 * que `Loader` est chargé).
 */
export function computeRootLowerBound(allTasks: Task[], config: RootLowerBoundConfig): RootLowerBoundResult {
  const nonEnforced = allTasks.filter(t => !(t.isEnforced && t.enforced));
  const enforcedOcc = buildEnforcedOccupancy(allTasks);

  const monoFindings = computeMonoCertificates(
    nonEnforced, enforcedOcc, config.lunchBreak, config.ignoreDailyLimits,
    config.monoNodeLimit ?? DEFAULT_MONO_NODE_LIMIT,
  );
  const clusterFindings = computeClusterCertificates(
    nonEnforced, enforcedOcc, config.lunchBreak, config.ignoreDailyLimits,
    config.clusterNodeLimit ?? DEFAULT_CLUSTER_NODE_LIMIT,
  );

  interface Finding { resourceIds: string[]; tasks: Task[]; lb: number; note: string }
  const findings: Finding[] = [
    ...monoFindings.map(f => ({ resourceIds: [f.resource.id], tasks: f.tasks, lb: f.lb, note: f.note })),
    ...clusterFindings.map(f => ({ resourceIds: f.resources.map(r => r.id), tasks: f.tasks, lb: f.lb, note: f.note })),
  ];

  // Tri par LB décroissant puis |S| croissant, sélection gloutonne disjointe (§1.4).
  findings.sort((a, b) => b.lb - a.lb || a.tasks.length - b.tasks.length);

  const taken = new Set<Task>();
  const certificates: Certificate[] = [];
  let lb = 0;
  for (const f of findings) {
    if (f.tasks.some(t => taken.has(t))) continue;
    f.tasks.forEach(t => taken.add(t));
    lb += f.lb;
    certificates.push({ resourceIds: f.resourceIds, taskIds: f.tasks.map(t => t.id), lb: f.lb, note: f.note });
  }

  return { lb, certificates };
}
