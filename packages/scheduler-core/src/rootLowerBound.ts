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

/**
 * Minutes de DISPONIBILITÉ que la pause méridienne flottante coûte ce jour-là — c'est-à-dire la
 * capacité de cours qu'il faut retrancher, pas la durée de la pause.
 *
 * Modèle aligné sur `Scheduler._resourceKeepsFloatingBreak` depuis sa réécriture
 * (docs/PlanFloatingLunchBreakGap.md) : la pause est satisfaite dès qu'il reste, dans
 * `[winStart, winEnd]`, un intervalle contigu de `duration` LIBRE DE COURS. Une indisponibilité
 * déclarée n'étant pas un cours, elle peut porter tout ou partie de la pause **sans consommer
 * la moindre minute de disponibilité**. Le coût réel est donc celui de la position de pause la
 * MOINS chère :
 *
 *     déduction = min over t ∈ [winStart, winEnd − duration] de  mesure( dispo ∩ [t, t+duration] )
 *
 * Sûreté (principe cardinal du fichier) : prendre le MINIMUM sous-estime la déduction, donc
 * surestime la capacité, donc surestime MaxPack, donc SOUS-estime `lb` — jamais l'inverse.
 *
 * L'ancienne version retranchait `duration` en bloc dès que `dispo ∩ fenêtre ≥ duration`, ce qui
 * était cohérent avec l'ancien gate (fondé sur la disponibilité) mais **surestimait `lb` après la
 * réécriture** : contre-exemple vérifié bout en bout — groupe dispo 8:00–13:00 + 13:30–18:00
 * (indispo 30 min DANS la fenêtre 12:00–14:00), 3×90 + 4×60 = 510 min ; le moteur place les 7
 * tâches (pause en 12:30–14:00, dont 30 min portées par l'indispo, coût réel 60 min) alors que
 * l'ancienne formule retranchait 90, ramenait la capacité à 480 < 510 et rendait `lb = 1` sur un
 * optimum réel de 0 — une preuve d'optimalité FAUSSE.
 *
 * Les tâches enforced ont déjà été retirées de `dayIvs` par l'appelant : elles sont donc traitées
 * ici comme de l'indisponibilité (pause gratuite) alors que le moteur les voit comme des cours.
 * Écart volontairement laissé dans le sens sûr (déduction plus petite ⟹ `lb` plus faible).
 */
function floatingLunchDeduction(dayIvs: Iv[], day: number, lunchBreak: LunchBreakConfig): number {
  if (lunchBreak.type !== 'floating') return 0;
  const [eh, em] = lunchBreak.earliest.split(':').map(Number);
  const [lh, lm] = lunchBreak.latest.split(':').map(Number);
  const winStart = day * DAY + eh * 60 + em;
  const winEnd = day * DAY + lh * 60 + lm;
  const duration = lunchBreak.duration;

  // Même garde d'inapplicabilité que le moteur (`winEnd - winStart < duration` ⟹ return true) :
  // fenêtre structurellement trop courte, la contrainte n'a jamais pu s'appliquer.
  if (winEnd - winStart < duration) return 0;

  const availableWithin = (from: number, to: number): number => {
    let m = 0;
    for (const iv of dayIvs) {
      const s = Math.max(iv.start, from);
      const e = Math.min(iv.end, to);
      if (s < e) m += e - s;
    }
    return m;
  };

  // `t ↦ availableWithin(t, t+duration)` est linéaire par morceaux : ses minima sont atteints en
  // un point où l'une des deux bornes du trou coïncide avec une borne d'intervalle de dispo.
  // Énumérer ces candidats (plus les deux extrémités) suffit donc à trouver le minimum exact.
  const lo = winStart;
  const hi = winEnd - duration;
  const candidates = new Set<number>([lo, hi]);
  for (const iv of dayIvs) {
    for (const t of [iv.start, iv.end, iv.start - duration, iv.end - duration]) {
      if (t > lo && t < hi) candidates.add(t);
    }
  }

  let best = Infinity;
  for (const t of candidates) {
    const cost = availableWithin(t, t + duration);
    if (cost < best) best = cost;
  }
  return best === Infinity ? 0 : best;
}

// ── §1.2 — Certificats mono-ressource ────────────────────────────────────

interface Win { day: number; len: number }

/** MaxPack exact (DFS + élagage) avec éligibilité item×fenêtre. Repli sûr sur dépassement de
 *  nœuds : borne de comptage (préfixe croissant des durées vs capacité totale), jamais le
 *  meilleur packing partiel trouvé — voir le principe de sûreté cardinal en tête de fichier.
 *
 *  `bestInit` (warm start) : nombre de tâches de S que la passe gourmande a effectivement
 *  placées — un packing RÉALISABLE, donc MaxPack ≥ bestInit. Amorcer `best` avec cette valeur
 *  rend l'élagage `placed + restantes <= best` mordant dès le nœud racine, sans changer le
 *  résultat : l'élagage ne coupe que les branches incapables de dépasser STRICTEMENT `best`,
 *  donc si tout est coupé, MaxPack ≤ bestInit, et avec MaxPack ≥ bestInit on a l'égalité.
 *  Sûr même si `bestInit` s'avérait NON réalisable dans la relaxation (relaxation plus serrée
 *  que la réalité) : `best` surestimé ⟹ lb = |S| − best SOUS-estimé ⟹ jamais de preuve fausse.
 *
 *  `deadline` (§2.2) : même repli que le dépassement de nœuds, contrôlé tous les 4096 nœuds
 *  seulement (`Date.now()` coûterait plus cher que l'exploration si testé à chaque nœud). */
function maxPackMono(itemsIn: number[], winsIn: Win[], dayCaps: Map<number, number>, eligible: boolean[][], nodeLimitIn: number, deadline: number, bestInit = 0): number {
  let nodeLimit = nodeLimitIn;
  const order = itemsIn.map((d, i) => ({ d, i })).sort((a, b) => b.d - a.d);
  const items = order.map(o => o.d);
  const elig = order.map(o => eligible[o.i]);
  const n = items.length;

  const asc = [...items].sort((a, b) => a - b);
  const totalCap = [...dayCaps.values()].reduce((s, c) => s + c, 0);
  let ubCount = 0, acc = 0;
  for (const d of asc) { if (acc + d > totalCap) break; acc += d; ubCount++; }
  const ub = Math.min(n, ubCount);

  // §1.3 — sommes-suffixes de `items` (déjà trié décroissant, ligne ci-dessus) : suf[j] = somme
  // de items[j..n-1]. Comme le suffixe idx.. est lui-même décroissant, ses k plus PETITES durées
  // sont ses k DERNIERS éléments, de somme suf[n-k] — sert à la borne surrogate de nœud ci-dessous.
  const suf = new Array<number>(n + 1).fill(0);
  for (let j = n - 1; j >= 0; j--) suf[j] = suf[j + 1] + items[j];

  // §2.1 — classe d'équivalence par fenêtre : (jour, longueur initiale, colonne d'éligibilité
  // complète). Deux fenêtres INTACTES de même classe sont interchangeables pour tout le reste du
  // DFS (même effet sur winRes/dayRes, même éligibilité pour tous les items) : n'en essayer qu'une
  // seule ne coupe donc aucune solution de valeur supérieure.
  const classId = new Array<number>(winsIn.length);
  {
    const classMap = new Map<string, number>();
    for (let w = 0; w < winsIn.length; w++) {
      let col = '';
      for (let idx = 0; idx < n; idx++) col += elig[idx][w] ? '1' : '0';
      const sig = winsIn[w].day + '|' + winsIn[w].len + '|' + col;
      let id = classMap.get(sig);
      if (id === undefined) { id = classMap.size; classMap.set(sig, id); }
      classId[w] = id;
    }
  }
  // Épinglé par classe : dernier "epoch" (= appel dfs) où une fenêtre intacte de cette classe a
  // déjà été essayée. Réutilisé sans réallocation d'un nœud à l'autre (juste `epoch` incrémenté).
  const lastSeenEpoch = new Int32Array(classId.reduce((m, c) => Math.max(m, c), -1) + 1).fill(-1);
  let epoch = 0;

  let best = bestInit;
  let nodes = 0;
  let exact = true;
  const winRes = winsIn.map(w => w.len);
  const dayRes = new Map(dayCaps);
  let winTotal = winRes.reduce((s, v) => s + v, 0);
  let dayTotal = [...dayRes.values()].reduce((s, v) => s + v, 0);
  const seen = new Map<string, number>();

  const dfs = (idx: number, placed: number): void => {
    if (placed > best) best = placed;
    if (best >= ub) return;
    if (idx >= n) return;
    const rem = n - idx;
    // §1.3 — borne surrogate : plus grand k ≤ rem tel que les k plus petites durées restantes
    // tiennent dans le min des deux capacités résiduelles (fenêtres, jours) — deux bornes duales
    // valides (toute solution complétant ce nœud vit dans CHACUNE des deux), leur min l'est donc
    // aussi. Remplace la borne de cardinalité `placed + rem <= best` : celle-ci correspond au cas
    // k=rem, donc cette borne est toujours au moins aussi mordante (lo ≤ rem par construction).
    const cap = Math.min(winTotal, dayTotal);
    let lo = 0, hi = rem;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (suf[n - mid] <= cap) lo = mid; else hi = mid - 1;
    }
    if (placed + lo <= best) return;
    if (++nodes > nodeLimit) { exact = false; return; }
    // Deadline (§2.2) : Date.now() coûterait plus cher que l'exploration s'il était appelé à
    // chaque nœud, donc contrôlé tous les 4096 nœuds seulement — mais une fois l'échéance
    // détectée, `nodeLimit` est abaissé au nœud courant : TOUS les appels suivants retombent
    // immédiatement sur le check ci-dessus (même chemin de sortie, effet persistant comme un
    // vrai dépassement de nœuds, pas un pruning ponctuel isolé).
    if ((nodes & 0xFFF) === 0 && Date.now() > deadline) { nodeLimit = nodes; exact = false; return; }
    const key = idx + '|' + winRes.join(',');
    const prev = seen.get(key);
    if (prev !== undefined && prev >= placed) return;
    seen.set(key, placed);
    const d = items[idx];
    // Capturé localement : `epoch` (partagé) continue d'avancer pendant les appels récursifs
    // ci-dessous, `myEpoch` reste stable pour toute la durée de CETTE itération du for w.
    const myEpoch = ++epoch;
    for (let w = 0; w < winsIn.length; w++) {
      if (!elig[idx][w]) continue;
      const day = winsIn[w].day;
      const dc = dayRes.get(day) ?? Infinity;
      if (winRes[w] < d || dc < d) continue;
      const cls = classId[w];
      if (winRes[w] === winsIn[w].len) {
        if (lastSeenEpoch[cls] === myEpoch) continue; // §2.1 : fenêtre symétrique déjà essayée ici
        lastSeenEpoch[cls] = myEpoch;
      }
      winRes[w] -= d; dayRes.set(day, dc - d); winTotal -= d; dayTotal -= d;
      dfs(idx + 1, placed + 1);
      winRes[w] += d; dayRes.set(day, dc); winTotal += d; dayTotal += d;
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
  deadline: number,
  skippedTaskIds?: ReadonlySet<string>,
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
    // Warm start : nombre de tâches de S effectivement placées par la passe gourmande.
    const bestInit = skippedTaskIds ? S.filter(t => !skippedTaskIds.has(t.id)).length : 0;
    const pack = maxPackMono(durations, wins, dayCaps, eligible, nodeLimit, deadline, bestInit);
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

/** §2.3 — entrée de la table de transposition cluster : `snap` est une copie exacte des
 *  capacités au moment de l'insertion, comparée sur collision de hash avant toute conclusion
 *  « déjà vu » (voir dfs de `computeClusterCertificates`). */
interface ClusterMemoEntry { snap: Int32Array; placed: number }

function capsEqual(a: Int32Array, b: Int32Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function computeClusterCertificates(
  nonEnforced: Task[],
  enforcedOcc: Map<string, Iv[]>,
  lunchBreak: LunchBreakConfig,
  ignoreDailyLimits: boolean,
  nodeLimit: number,
  deadline: number,
  skippedTaskIds?: ReadonlySet<string>,
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

  // §2.3 : petits clusters d'abord — sous deadline, l'ordre garantit que les certificats
  // faciles (petit |S|) sont acquis avant que le budget ne se consume sur un cluster condamné
  // à saturer (cf. §0 fait 2 : {BUT1-G1+G2} exact en 23 ms quand {BUT1×4} sature à 415 ms).
  const clustersWithTasks = candidateClusters
    .map(cluster => {
      const clusterIds = new Set(cluster.map(r => r.id));
      const S = nonEnforced.filter(t =>
        t.resources[ResourceType.GROUP].some(s => s.length === 1 && clusterIds.has(s[0].id))
      );
      return { cluster, S };
    })
    .filter(({ S }) => S.length >= 2)
    .sort((a, b) => a.S.length - b.S.length);

  for (const { cluster, S } of clustersWithTasks) {
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

    // §2.3 — capacités indexées par entier plutôt que par clé de chaîne : `capIdx = resIdx*5 +
    // day`, `resIdx` étant l'index d'insertion de la ressource dans `consumed`. Supprime le
    // hachage de chaînes de la boucle chaude ci-dessous et rend la copie d'état (memo, plus bas)
    // triviale (`.slice()` d'un typed array).
    const resIdxOf = new Map<string, number>();
    for (const rid of consumed.keys()) resIdxOf.set(rid, resIdxOf.size);
    const numRes = resIdxOf.size;
    const capsArr = new Int32Array(numRes * 5);
    for (const r of consumed.values()) {
      const ri = resIdxOf.get(r.id)!;
      const enfHoles = enforcedOcc.get(r.id) ?? [];
      const avail = subtractIntervals(
        r.availability.getAvailableIntervals().map(iv => ({ start: iv.start, end: iv.end })),
        enfHoles,
      );
      for (let d = 0; d < 5; d++) {
        const dayIvs = avail.filter(iv => Math.floor(iv.start / DAY) === d);
        let cap = dayIvs.reduce((s, iv) => s + (iv.end - iv.start), 0);
        if (cap === 0) { capsArr[ri * 5 + d] = 0; continue; }
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
        capsArr[ri * 5 + d] = cap;
      }
    }

    const eligDay: boolean[][] = S.map((t, i) => {
      const out: boolean[] = [];
      for (let d = 0; d < 5; d++) out.push(maxRunWithin(domains[i], d * DAY, (d + 1) * DAY) >= t.duration);
      return out;
    });

    // §1.4 — borne surrogate cluster, dimension par ressource : pour chaque ressource consommée,
    // les durées ASCENDANTES des items qui la consomment (sommes-préfixes), et un compteur du
    // nombre de ces items encore non décidés (`restants`). Au nœud k, les `restants[ri]` items non
    // décidés consommant r bornent le placable-sur-r par dichotomie dans les préfixes tronqués à
    // `restants[ri]` — valide car les k plus PETITES durées consommant r GLOBALEMENT sur tout S
    // (pas seulement le sous-ensemble non décidé) sont ≤ toute somme de k durées réellement
    // choisies parmi les non-décidées : substituer le pool global ne peut que surestimer le
    // nombre plaçable, jamais le sous-estimer (sens sûr). Min sur les ressources du cluster.
    const prefByRes: number[][] = new Array(numRes);
    const restants = new Int32Array(numRes);
    for (const [rid, ri] of resIdxOf) {
      const durs = S.filter((_t, i) => itemRes[i].includes(rid)).map(t => t.duration).sort((a, b) => a - b);
      const pref = new Array<number>(durs.length + 1).fill(0);
      for (let j = 0; j < durs.length; j++) pref[j + 1] = pref[j] + durs[j];
      prefByRes[ri] = pref;
      restants[ri] = durs.length;
    }
    const capTotal = new Int32Array(numRes);
    for (let ri = 0; ri < numRes; ri++) {
      let tot = 0;
      for (let d = 0; d < 5; d++) tot += capsArr[ri * 5 + d];
      capTotal[ri] = tot;
    }
    const itemResIdx: number[][] = itemRes.map(rids => rids.map(rid => resIdxOf.get(rid)!));

    const order = S.map((_t, i) => i).sort((a, b) => S[b].duration - S[a].duration || itemRes[b].length - itemRes[a].length);
    // Warm start : cf. la justification de sûreté détaillée sur `maxPackMono`.
    let best = skippedTaskIds ? S.filter(t => !skippedTaskIds.has(t.id)).length : 0;
    let nodes = 0;
    let exact = true;
    // Copie locale par cluster (§2.2) : `nodeLimit` (paramètre) est partagé par TOUS les
    // clusters de la boucle — abaisser cette copie au nœud courant sur dépassement de deadline
    // n'affecte que le cluster en cours, jamais les suivants.
    let clusterNodeLimit = nodeLimit;
    const cur: number[] = S.map(() => -1);

    // §2.3 — hachage Zobrist incrémental de l'état des capacités : évite de reconstruire et
    // comparer une clé de chaîne à chaque nœud (coût chaud identifié au plan §2.3). Un hachage
    // est ambigu par nature (collisions possibles) : on ne conclut JAMAIS « déjà vu » sur la
    // seule égalité de hash — `ClusterMemoEntry.snap` matérialise l'état exact, comparé sur
    // collision (quasi jamais) avant de trancher, seul usage sûr d'un hash pour ce memo.
    let zobSeed = (0x2545F491 ^ (numRes * 2654435761)) | 0 || 1;
    const nextRand = (): number => {
      zobSeed ^= zobSeed << 13; zobSeed ^= zobSeed >>> 17; zobSeed ^= zobSeed << 5;
      return zobSeed >>> 0;
    };
    const zobTable: Map<number, number>[] = Array.from({ length: numRes * 5 }, () => new Map());
    const zobOf = (capIdx: number, v: number): number => {
      const m = zobTable[capIdx];
      let h = m.get(v);
      if (h === undefined) { h = nextRand(); m.set(v, h); }
      return h;
    };
    let hash = 0;
    for (let ci = 0; ci < capsArr.length; ci++) hash ^= zobOf(ci, capsArr[ci]);
    const seenState = new Map<number, Map<number, ClusterMemoEntry[]>>();

    const dfs = (k: number, placed: number): void => {
      if (placed > best) best = placed;
      if (k >= order.length) return;
      const rem = order.length - k;
      // §1.4 — remplace la cardinalité brute `rem` par le min des bornes par ressource
      // (toujours ≤ rem, donc au moins aussi mordante que ce qu'elle remplace).
      let boundK = rem;
      for (let ri = 0; ri < numRes; ri++) {
        const restR = restants[ri];
        if (restR === 0) continue;
        const pref = prefByRes[ri];
        const capR = capTotal[ri];
        let lo = 0, hi = restR;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (pref[mid] <= capR) lo = mid; else hi = mid - 1;
        }
        const boundR = (rem - restR) + lo;
        if (boundR < boundK) boundK = boundR;
      }
      if (placed + boundK <= best) return;
      if (++nodes > clusterNodeLimit) { exact = false; return; }
      // Même repli persistant que maxPackMono (voir sa docstring) : `clusterNodeLimit` abaissé
      // au nœud courant dès l'échéance détectée, tous les appels suivants retombent
      // immédiatement sur le check ci-dessus.
      if ((nodes & 0xFFF) === 0 && Date.now() > deadline) { clusterNodeLimit = nodes; exact = false; return; }

      let bucket = seenState.get(k);
      if (bucket === undefined) { bucket = new Map(); seenState.set(k, bucket); }
      const entries = bucket.get(hash);
      let matched = false;
      if (entries !== undefined) {
        for (const e of entries) {
          if (capsEqual(e.snap, capsArr)) {
            if (e.placed >= placed) return; // déjà vu, état exact identique, pas mieux
            e.placed = placed;
            matched = true;
            break;
          }
        }
      }
      if (!matched) {
        if (entries === undefined) bucket.set(hash, [{ snap: capsArr.slice(), placed }]);
        else entries.push({ snap: capsArr.slice(), placed });
      }

      const i = order[k];
      const dur = S[i].duration;
      const resIdxs = itemResIdx[i];
      // Item i devient "décidé" pour tout le reste de ce sous-arbre (placé ou non) — décrémenté
      // une seule fois ici, restauré une seule fois après épuisement de toutes les branches.
      for (const ri of resIdxs) restants[ri]--;
      for (let d = 0; d < 5; d++) {
        if (!eligDay[i][d]) continue;
        let feasible = true;
        for (const ri of resIdxs) { if (capsArr[ri * 5 + d] < dur) { feasible = false; break; } }
        if (!feasible) continue;
        for (const ri of resIdxs) {
          const ci = ri * 5 + d;
          const oldV = capsArr[ci];
          const newV = oldV - dur;
          hash ^= zobOf(ci, oldV) ^ zobOf(ci, newV);
          capsArr[ci] = newV;
          capTotal[ri] -= dur;
        }
        cur[i] = d;
        dfs(k + 1, placed + 1);
        cur[i] = -1;
        for (const ri of resIdxs) {
          const ci = ri * 5 + d;
          const newV = capsArr[ci];
          const oldV = newV + dur;
          hash ^= zobOf(ci, newV) ^ zobOf(ci, oldV);
          capsArr[ci] = oldV;
          capTotal[ri] += dur;
        }
        if (nodes > clusterNodeLimit) { for (const ri of resIdxs) restants[ri]++; return; }
      }
      dfs(k + 1, placed);
      for (const ri of resIdxs) restants[ri]++;
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
  /**
   * Budget de temps partagé (§2.2), en millisecondes, par l'ENSEMBLE du calcul (mono puis
   * clusters — pas un budget par certificat). Défaut 2000. Même repli sûr que le dépassement de
   * nœuds : `exact = false`, puis borne de comptage (mono) / abandon du certificat (cluster).
   * Borne le pire cas indépendamment de la machine et du projet, là où un seuil de nœuds seul
   * ne le fait pas (§0 fait 3 : coût par nœud non constant, `stateKey`/`seenState` croissants).
   */
  deadlineMs?: number;
  /**
   * Warm start (borne primale) : ids des tâches sautées par la passe gourmande. Fournir cet
   * ensemble amorce chaque DFS avec un packing réalisable connu au lieu de repartir de zéro —
   * voir la justification de sûreté sur `maxPackMono`. Le résultat est inchangé ; seul le coût
   * d'exploration l'est. Impose d'appeler `computeRootLowerBound` APRÈS la passe gourmande.
   */
  skippedTaskIds?: ReadonlySet<string>;
}

const DEFAULT_MONO_NODE_LIMIT = 4_000_000;
// §2.1 : 6M → 200k. Les 10 semaines de référence (docs/PlanLbCoutRacine.md §0) donnent une
// borne IDENTIQUE à tous les budgets entre 50k et 6M ; 200k coûte au pire 1,3 s contre 32 min.
const DEFAULT_CLUSTER_NODE_LIMIT = 200_000;
const DEFAULT_DEADLINE_MS = 2000;

/**
 * Borne inférieure racine sur le nombre de tâches devant être sautées, par certificats de
 * bin-packing exact (mono-ressource §1.2, cluster de groupes §1.3), combinés par sélection
 * disjointe gloutonne (§1.4 — l'optimisation exacte de la sélection est inutile au vu des
 * tailles rencontrées en pratique).
 *
 * **Les deux types de pause méridienne arrivent ici par des chemins OPPOSÉS** — asymétrie à
 * connaître avant de toucher aux capacités :
 * - `floating` : aucune trace dans les disponibilités, c'est un gate au placement
 *   (`Scheduler._resourceKeepsFloatingBreak`). La borne doit le modéliser elle-même, via
 *   `floatingLunchDeduction`. Indépendant de l'ordre des appels.
 * - `fixed` : `Scheduler._applyLunchBreak()` RETIRE la plage des disponibilités des GROUP
 *   (mutation, dans `initSolver()`), et il n'y a aucun gate. La borne ne doit donc rien déduire
 *   — la re-déduire serait un double comptage ⟹ `lb` surestimée ⟹ preuve fausse (verrouillé par
 *   le micro-test (a)). En contrepartie elle DÉPEND de l'ordre : appelée avant `initSolver()`,
 *   elle verrait des disponibilités non amputées, donc une capacité trop grande ⟹ `lb`
 *   sous-estimée. Sens sûr, mais borne plus faible. Le flux réel appelle toujours la borne après
 *   la passe gourmande (§3.1 calcul paresseux), donc après `initSolver()`.
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
  // §2.2 : échéance capturée une fois, partagée par le mono puis les clusters (un seul budget
  // global, pas un par certificat).
  const deadline = Date.now() + (config.deadlineMs ?? DEFAULT_DEADLINE_MS);

  const monoFindings = computeMonoCertificates(
    nonEnforced, enforcedOcc, config.lunchBreak, config.ignoreDailyLimits,
    config.monoNodeLimit ?? DEFAULT_MONO_NODE_LIMIT, deadline, config.skippedTaskIds,
  );
  const clusterFindings = computeClusterCertificates(
    nonEnforced, enforcedOcc, config.lunchBreak, config.ignoreDailyLimits,
    config.clusterNodeLimit ?? DEFAULT_CLUSTER_NODE_LIMIT, deadline, config.skippedTaskIds,
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
