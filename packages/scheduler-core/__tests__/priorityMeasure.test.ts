import { describe, it, expect } from 'vitest';
import {
  Availability, measureProfile, comparePriorityMeasure, encodePriorityMeasure, splitFloatingLunchBreak, type FloatingLunchWindow,
  truncateProfile, findLastSlot, computeDependentsDeadline, reduceToAnchors, shiftRanges, intersectRanges, truncateRanges, countAnchorPositions, type TimeRange,
} from '@edt-ts/scheduler-common';

const SLOT_STEP = 30;

/** Construit une Availability avec des créneaux donnés (en minutes), garantis disjoints. */
function makeProfile(slots: Array<[number, number]>): Availability {
  const availability = new Availability();
  for (const [start, end] of slots) availability.addAvailability(start, end);
  return availability;
}

describe('measureProfile — §5.1 du document de conception', () => {
  it('fragmentation : deux intervalles trop petits pour la tâche → infaisable (0, 0), pas une somme', () => {
    // 90min + 30min = 120min au total, mais aucun intervalle ne fait 120min individuellement.
    const profile = makeProfile([[0, 90], [200, 230]]);
    const measure = measureProfile(profile, 120, SLOT_STEP);
    expect(measure).toEqual({ usableWindowCount: 0, slackTotal: 0 });
  });

  it('cas THARAUD : un seul intervalle pile à la bonne taille → (1, 1), une seule position possible (offset 0)', () => {
    const profile = makeProfile([[0, 240]]);
    const measure = measureProfile(profile, 240, SLOT_STEP);
    expect(measure).toEqual({ usableWindowCount: 1, slackTotal: 1 });
  });

  it('fenêtre large : un intervalle de 6h pour une tâche de 4h → (1, 5) positions à pas 30min', () => {
    const profile = makeProfile([[0, 360]]);
    const measure = measureProfile(profile, 240, SLOT_STEP);
    expect(measure).toEqual({ usableWindowCount: 1, slackTotal: 5 });
  });

  it('deux fenêtres disjointes pile à la bonne taille → (2, 2), pas (1, quelque chose)', () => {
    const profile = makeProfile([[0, 240], [1440, 1680]]); // deux jours différents
    const measure = measureProfile(profile, 240, SLOT_STEP);
    expect(measure).toEqual({ usableWindowCount: 2, slackTotal: 2 });
  });

  it('aucune combinaison candidate (profil vide) → infaisable (0, 0)', () => {
    const profile = makeProfile([]);
    const measure = measureProfile(profile, 60, SLOT_STEP);
    expect(measure).toEqual({ usableWindowCount: 0, slackTotal: 0 });
  });
});

describe('comparePriorityMeasure / encodePriorityMeasure — contre-exemples du §3.4', () => {
  it('THARAUD (1 fenêtre, marge nulle) est plus prioritaire qu\'une fenêtre large (1 fenêtre, marge large)', () => {
    const tharaud = measureProfile(makeProfile([[0, 240]]), 240, SLOT_STEP);
    const wide = measureProfile(makeProfile([[0, 360]]), 240, SLOT_STEP);

    expect(comparePriorityMeasure(tharaud, wide)).toBeLessThan(0);
    expect(encodePriorityMeasure(tharaud)).toBeGreaterThan(encodePriorityMeasure(wide));
  });

  it('THARAUD (1 fenêtre) est plus prioritaire que deux fenêtres disjointes (2 fenêtres) — le nombre de fenêtres prime sur la marge', () => {
    const tharaud = measureProfile(makeProfile([[0, 240]]), 240, SLOT_STEP);
    const twoWindows = measureProfile(makeProfile([[0, 240], [1440, 1680]]), 240, SLOT_STEP);

    expect(comparePriorityMeasure(tharaud, twoWindows)).toBeLessThan(0);
    expect(encodePriorityMeasure(tharaud)).toBeGreaterThan(encodePriorityMeasure(twoWindows));
  });

  it('une tâche infaisable (0, 0) score plus haut que toute tâche faisable — échoue vite plutôt que tard (§5.4)', () => {
    // Pas encore le court-circuit dur envisagé en §6.3/§5.2 (pas implémenté en Phase 1) : ici, une
    // tâche infaisable est simplement essayée en premier (score maximal), donc son échec est
    // découvert au plus tôt plutôt que de gaspiller du temps sur d'autres tâches avant d'y arriver.
    const infeasible = measureProfile(makeProfile([[0, 90], [200, 230]]), 120, SLOT_STEP);
    const feasible = measureProfile(makeProfile([[0, 120]]), 120, SLOT_STEP);

    expect(comparePriorityMeasure(infeasible, feasible)).toBeLessThan(0);
    expect(encodePriorityMeasure(infeasible)).toBeGreaterThan(encodePriorityMeasure(feasible));
  });
});

describe('splitFloatingLunchBreak — §5.5 du document de conception', () => {
  // Journée 8h-17h (480-1020min), pause flottante 12h-14h (720-840min), 90min de durée.
  const LUNCH: FloatingLunchWindow = { earliestMin: 720, latestMin: 840, duration: 90 };

  it('découpe une grande plage en DEUX fenêtres disjointes (pas un simple rognage d\'un bord)', () => {
    const profile = makeProfile([[480, 1020]]); // 8h-17h, un seul jour (lundi = jour 0)
    const split = splitFloatingLunchBreak(profile, LUNCH);

    // Coupure au milieu du chevauchement [720,840] → milieu=780, tranche [735,825]
    // (même résultat qu'avec une fenêtre 690-870 : les deux sont centrées sur 13h).
    expect(split.getAvailableIntervals()).toEqual([
      { start: 480, end: 735, duration: 255 },  // 8h-12h15
      { start: 825, end: 1020, duration: 195 }, // 13h45-17h
    ]);
  });

  it('une tâche trop longue pour tenir dans l\'une ou l\'autre moitié devient infaisable', () => {
    const profile = makeProfile([[480, 1020]]);
    const split = splitFloatingLunchBreak(profile, LUNCH);

    // 5h (300min) ne tient ni dans 255min ni dans 195min.
    const measure = measureProfile(split, 300, SLOT_STEP);
    expect(measure).toEqual({ usableWindowCount: 0, slackTotal: 0 });
  });

  it('une tâche courte tient dans les deux moitiés → usableWindowCount=2', () => {
    const profile = makeProfile([[480, 1020]]);
    const split = splitFloatingLunchBreak(profile, LUNCH);

    const measure = measureProfile(split, 60, SLOT_STEP);
    expect(measure.usableWindowCount).toBe(2);
  });

  it('s\'applique indépendamment à chaque jour ouvré (lundi-vendredi), pas globalement', () => {
    const DAY = 1440;
    const profile = makeProfile([
      [480, 1020],
      [480 + DAY, 1020 + DAY],
      [480 + 2 * DAY, 1020 + 2 * DAY],
      [480 + 3 * DAY, 1020 + 3 * DAY],
      [480 + 4 * DAY, 1020 + 4 * DAY],
    ]);
    const split = splitFloatingLunchBreak(profile, LUNCH);

    expect(split.getAvailableIntervals()).toHaveLength(10); // 2 par jour × 5 jours
  });

  it('un profil qui ne chevauche pas [earliest, latest] reste inchangé', () => {
    const profile = makeProfile([[0, 100]]); // 0h-1h40, bien avant 12h
    const split = splitFloatingLunchBreak(profile, LUNCH);

    expect(split.getAvailableIntervals()).toEqual([{ start: 0, end: 100, duration: 100 }]);
  });

  it('ne mute jamais le profil original passé en entrée', () => {
    const profile = makeProfile([[480, 1020]]);
    const totalBefore = profile.getTotalAvailableTime();

    splitFloatingLunchBreak(profile, LUNCH);

    expect(profile.getTotalAvailableTime()).toBe(totalBefore);
    expect(profile.getAvailableIntervals()).toEqual([{ start: 480, end: 1020, duration: 540 }]);
  });
});

describe('truncateProfile / findLastSlot — §5.6 du document de conception', () => {
  it('truncateProfile coupe à droite de la deadline, sur un seul intervalle', () => {
    const profile = makeProfile([[0, 1000]]);
    const truncated = truncateProfile(profile, 500);
    expect(truncated.getAvailableIntervals()).toEqual([{ start: 0, end: 500, duration: 500 }]);
  });

  it('truncateProfile coupe chaque intervalle indépendamment, en retire certains entièrement', () => {
    const profile = makeProfile([[0, 300], [400, 700], [800, 900]]);
    const truncated = truncateProfile(profile, 500);
    // Le 3e intervalle [800,900] est entièrement après la deadline → retiré.
    expect(truncated.getAvailableIntervals()).toEqual([
      { start: 0, end: 300, duration: 300 },
      { start: 400, end: 500, duration: 100 },
    ]);
  });

  it('truncateProfile avec deadline=-Infinity produit un profil vide (infaisabilité héritée)', () => {
    const profile = makeProfile([[0, 1000]]);
    const truncated = truncateProfile(profile, -Infinity);
    expect(truncated.getAvailableIntervals()).toEqual([]);
  });

  it('findLastSlot retourne le dernier départ valide, en partant de la fin du profil', () => {
    const profile = makeProfile([[0, 300], [400, 1000]]);
    expect(findLastSlot(profile, 100)).toBe(900); // dernier intervalle, 1000-100
  });

  it('findLastSlot retourne null si aucun intervalle n\'est assez grand', () => {
    const profile = makeProfile([[0, 90]]);
    expect(findLastSlot(profile, 120)).toBeNull();
  });

  it('findLastSlot sur un profil vide retourne null', () => {
    expect(findLastSlot(makeProfile([]), 60)).toBeNull();
  });
});

describe('computeDependentsDeadline — §5.6, dépendants multiples (structure en éventail)', () => {
  it('k=1 dégénère exactement en LS(D1) — comportement identique à l\'ancien min(...)', () => {
    expect(computeDependentsDeadline([{ ls: 500, duration: 60 }])).toBe(500);
  });

  it('k=0 (liste vide) retourne Infinity — aucune contrainte', () => {
    expect(computeDependentsDeadline([])).toBe(Infinity);
  });

  it('exemple chiffré du document de conception (CM/TD1/TD2, vérifié à la main)', () => {
    // TD1 : durée 60, LS=640 ; TD2 : durée 200, LS=300 (le plus pressé).
    // échéance(CM) = LS(TD2) - duration(TD1) = 300 - 60 = 240.
    const deadline = computeDependentsDeadline([
      { ls: 640, duration: 60 },
      { ls: 300, duration: 200 },
    ]);
    expect(deadline).toBe(240);
  });

  it('k=3, cas symétrique (reproduit la structure du cas réel R1.04 qui a motivé la conception)', () => {
    // Trois dépendants identiques : ls=180, duration=60 chacun.
    // échéance = 180 - (60+60) = 60.
    const deadline = computeDependentsDeadline([
      { ls: 180, duration: 60 },
      { ls: 180, duration: 60 },
      { ls: 180, duration: 60 },
    ]);
    expect(deadline).toBe(60);
  });

  it('le dépendant le plus pressé est bien celui qui détermine m, quel que soit son ordre dans la liste', () => {
    // Même exemple que ci-dessus mais avec le plus pressé en tête plutôt qu'en fin de liste.
    const deadline = computeDependentsDeadline([
      { ls: 300, duration: 200 },
      { ls: 640, duration: 60 },
    ]);
    expect(deadline).toBe(240);
  });
});

describe('reduceToAnchors / intersectRanges / countAnchorPositions — §5.6, agrégation de groupe', () => {
  it('un ajustement pile à la bonne taille produit une plage de largeur 0, pas une erreur', () => {
    const profile = makeProfile([[0, 240]]);
    const anchors = reduceToAnchors(profile, 240);
    expect(anchors).toEqual([{ start: 0, end: 0 }]);
  });

  it('reduceToAnchors ignore les intervalles trop petits', () => {
    const profile = makeProfile([[0, 90], [200, 500]]);
    const anchors = reduceToAnchors(profile, 120);
    expect(anchors).toEqual([{ start: 200, end: 380 }]); // 500-120
  });

  it('contre-exemple §5.3 : intersection réelle vide alors qu\'un min de mesures indépendantes suggérerait de la marge', () => {
    // Membre A réduit (positions ponctuelles, durée déjà retranchée) : disponible à 8h, 8h30, 9h.
    const anchorsA: TimeRange[] = [{ start: 480, end: 480 }, { start: 510, end: 510 }, { start: 540, end: 540 }];
    // Membre B réduit : disponible à 10h, 10h30 — aucun chevauchement avec A.
    const anchorsB: TimeRange[] = [{ start: 600, end: 600 }, { start: 630, end: 630 }];

    const intersection = intersectRanges(anchorsA, anchorsB);
    expect(intersection).toEqual([]);
    expect(countAnchorPositions(intersection)).toEqual({ usableWindowCount: 0, slackTotal: 0 });
  });

  it('shiftRanges décale toutes les plages du même offset', () => {
    const ranges: TimeRange[] = [{ start: 100, end: 150 }, { start: 300, end: 300 }];
    expect(shiftRanges(ranges, 50)).toEqual([{ start: 50, end: 100 }, { start: 250, end: 250 }]);
  });

  it('truncateRanges coupe à droite de la deadline, retire les plages devenues invalides', () => {
    const ranges: TimeRange[] = [{ start: 0, end: 100 }, { start: 200, end: 300 }];
    expect(truncateRanges(ranges, 150)).toEqual([{ start: 0, end: 100 }]);
  });

  it('countAnchorPositions compte une position par unité de SLOT_STEP dans chaque plage', () => {
    const ranges: TimeRange[] = [{ start: 0, end: 60 }]; // 0,30,60 → 3 positions
    expect(countAnchorPositions(ranges, SLOT_STEP)).toEqual({ usableWindowCount: 1, slackTotal: 3 });
  });
});
