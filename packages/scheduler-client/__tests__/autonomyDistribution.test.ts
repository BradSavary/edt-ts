import { describe, it, expect } from 'vitest';
import { AvailabilityManager } from '@edt-ts/scheduler-common';
import type { ConstraintsData } from '@edt-ts/scheduler-common';
import {
  distributeChronologically,
  computeAutonomyDistribution,
  AUTONOMY_MIN_SLOT_MINUTES,
} from '../lib/calendar/autonomyDistribution';

describe('distributeChronologically', () => {
  it('un seul trou plus grand que la durée requise → une pièce exacte, remainingDuration=0', () => {
    const result = distributeChronologically([{ startTime: 100, duration: 300 }], 120);
    expect(result.pieces).toEqual([{ startTime: 100, duration: 120 }]);
    expect(result.remainingDuration).toBe(0);
  });

  it('trou plus petit que la durée → poursuite sur le trou suivant', () => {
    const result = distributeChronologically(
      [{ startTime: 0, duration: 60 }, { startTime: 200, duration: 90 }],
      120,
    );
    expect(result.pieces).toEqual([
      { startTime: 0, duration: 60 },
      { startTime: 200, duration: 60 },
    ]);
    expect(result.remainingDuration).toBe(0);
  });

  it('reste final < 60min posé dans un grand trou (pas de rejet)', () => {
    const result = distributeChronologically(
      [{ startTime: 0, duration: 60 }, { startTime: 200, duration: 180 }],
      80,
    );
    expect(result.pieces).toEqual([
      { startTime: 0, duration: 60 },
      { startTime: 200, duration: 20 },
    ]);
    expect(result.remainingDuration).toBe(0);
  });

  it('aucun trou → remainingDuration = totalDuration', () => {
    const result = distributeChronologically([], 150);
    expect(result.pieces).toEqual([]);
    expect(result.remainingDuration).toBe(150);
  });

  it('épuisement pile au dernier trou', () => {
    const result = distributeChronologically(
      [{ startTime: 0, duration: 60 }, { startTime: 100, duration: 60 }],
      120,
    );
    expect(result.remainingDuration).toBe(0);
    expect(result.pieces.reduce((sum, p) => sum + p.duration, 0)).toBe(120);
  });

  it('durée insuffisante malgré plusieurs trous → remainingDuration > 0', () => {
    const result = distributeChronologically(
      [{ startTime: 0, duration: 60 }, { startTime: 100, duration: 60 }],
      200,
    );
    expect(result.remainingDuration).toBe(80);
  });
});

describe('computeAutonomyDistribution', () => {
  const MINUTES_PER_DAY = 24 * 60;

  function makeManager(data: ConstraintsData): AvailabilityManager {
    return new AvailabilityManager(data);
  }

  it('un trou traversant midi produit 2 pièces séparées, jamais chevauchant 12:00-13:30', () => {
    const manager = makeManager({
      Default: [],
      G1: [{ days: 'lundi', from: '08:00', to: '20:00' }],
    });
    const result = computeAutonomyDistribution({
      groupIds: ['G1'],
      roomIds: [],
      week: 1,
      availabilityManager: manager,
      blockedZonesMinutes: [],
      occupancy: [],
      totalDuration: 500,
    });
    // 08:00-12:00 (240min) + 13:30-20:00 (390min, partiellement utilisé)
    expect(result.pieces).toEqual([
      { startTime: 8 * 60, duration: 240 },
      { startTime: 13 * 60 + 30, duration: 260 },
    ]);
    expect(result.remainingDuration).toBe(0);
    // Aucune pièce ne doit chevaucher 12:00-13:30
    for (const piece of result.pieces) {
      const end = piece.startTime + piece.duration;
      expect(piece.startTime >= 13 * 60 + 30 || end <= 12 * 60).toBe(true);
    }
  });

  it('plusieurs groupes requis : un créneau où un seul est indisponible est exclu de l\'intersection', () => {
    const manager = makeManager({
      Default: [],
      G1: [{ days: 'lundi', from: '08:00', to: '20:00' }],
      G2: [{ days: 'lundi', from: '08:00', to: '12:00' }], // indisponible l'après-midi
    });
    const result = computeAutonomyDistribution({
      groupIds: ['G1', 'G2'],
      roomIds: [],
      week: 1,
      availabilityManager: manager,
      blockedZonesMinutes: [],
      occupancy: [],
      totalDuration: 1000,
    });
    // Seul 08:00-12:00 (240min) est commun aux deux groupes
    expect(result.pieces).toEqual([{ startTime: 8 * 60, duration: 240 }]);
    expect(result.remainingDuration).toBe(760);
  });

  it('un trou de 59min est exclu, un trou de 60min est inclus', () => {
    const manager = makeManager({
      Default: [],
      G1: [
        { days: 'lundi', from: '08:00', to: '08:59' }, // 59min
        { days: 'mardi', from: '08:00', to: '09:00' }, // 60min
      ],
    });
    expect(AUTONOMY_MIN_SLOT_MINUTES).toBe(60);
    const result = computeAutonomyDistribution({
      groupIds: ['G1'],
      roomIds: [],
      week: 1,
      availabilityManager: manager,
      blockedZonesMinutes: [],
      occupancy: [],
      totalDuration: 1000,
    });
    expect(result.pieces).toEqual([{ startTime: MINUTES_PER_DAY + 8 * 60, duration: 60 }]);
  });

  it('une occupation existante coupe un trou en deux', () => {
    const manager = makeManager({
      Default: [],
      G1: [{ days: 'lundi', from: '08:00', to: '12:00' }],
    });
    const result = computeAutonomyDistribution({
      groupIds: ['G1'],
      roomIds: [],
      week: 1,
      availabilityManager: manager,
      blockedZonesMinutes: [],
      occupancy: [{ startTime: 8 * 60, duration: 60, groups: ['G1'], rooms: [] }], // 08:00-09:00 occupé
      totalDuration: 1000,
    });
    // Reste seulement 09:00-12:00 (180min)
    expect(result.pieces).toEqual([{ startTime: 9 * 60, duration: 180 }]);
  });

  it('une zone bloquée retire une partie de la semaine', () => {
    const manager = makeManager({
      Default: [],
      G1: [
        { days: 'lundi', from: '08:00', to: '12:00' },
        { days: 'mardi', from: '08:00', to: '12:00' },
      ],
    });
    const result = computeAutonomyDistribution({
      groupIds: ['G1'],
      roomIds: [],
      week: 1,
      availabilityManager: manager,
      // Bloque toute la journée de mardi
      blockedZonesMinutes: [{ start: MINUTES_PER_DAY, end: 2 * MINUTES_PER_DAY }],
      occupancy: [],
      totalDuration: 1000,
    });
    // Seul lundi doit rester
    expect(result.pieces).toEqual([{ startTime: 8 * 60, duration: 240 }]);
  });

  it('groupIds vide → retour immédiat sans distribution', () => {
    const manager = makeManager({ Default: [] });
    const result = computeAutonomyDistribution({
      groupIds: [],
      roomIds: [],
      week: 1,
      availabilityManager: manager,
      blockedZonesMinutes: [],
      occupancy: [],
      totalDuration: 300,
    });
    expect(result).toEqual({ pieces: [], remainingDuration: 300 });
  });

  it('ignore les occupations concernant un autre groupe que ceux requis', () => {
    const manager = makeManager({
      Default: [],
      G1: [{ days: 'lundi', from: '08:00', to: '12:00' }],
    });
    const result = computeAutonomyDistribution({
      groupIds: ['G1'],
      roomIds: [],
      week: 1,
      availabilityManager: manager,
      blockedZonesMinutes: [],
      occupancy: [{ startTime: 8 * 60, duration: 60, groups: ['G2'], rooms: [] }], // sans rapport
      totalDuration: 1000,
    });
    expect(result.pieces).toEqual([{ startTime: 8 * 60, duration: 240 }]);
  });

  describe('salles proposées', () => {
    it('aucune salle proposée → les conflits de salle sont ignorés (comportement d\'origine)', () => {
      const manager = makeManager({
        Default: [],
        G1: [{ days: 'lundi', from: '08:00', to: '12:00' }],
      });
      const result = computeAutonomyDistribution({
        groupIds: ['G1'],
        roomIds: [],
        week: 1,
        availabilityManager: manager,
        blockedZonesMinutes: [],
        // Occupe TOUTE la plage en salle, mais roomIds=[] doit rendre ceci sans effet.
        occupancy: [{ startTime: 8 * 60, duration: 240, groups: [], rooms: ['A101'] }],
        totalDuration: 240,
      });
      expect(result.pieces).toEqual([{ startTime: 8 * 60, duration: 240 }]);
      expect(result.remainingDuration).toBe(0);
    });

    it('une salle proposée occupée exclut le créneau : rien à placer', () => {
      const manager = makeManager({
        Default: [],
        G1: [{ days: 'lundi', from: '08:00', to: '12:00' }],
        A101: [{ days: 'lundi', from: '08:00', to: '12:00' }],
      });
      const result = computeAutonomyDistribution({
        groupIds: ['G1'],
        roomIds: ['A101'],
        week: 1,
        availabilityManager: manager,
        blockedZonesMinutes: [],
        occupancy: [{ startTime: 8 * 60, duration: 240, groups: [], rooms: ['A101'] }],
        totalDuration: 240,
      });
      expect(result.pieces).toEqual([]);
      expect(result.remainingDuration).toBe(240);
    });

    it('salle indisponible dans le référentiel de disponibilité (jamais déclarée) → aucun créneau', () => {
      const manager = makeManager({
        Default: [],
        G1: [{ days: 'lundi', from: '08:00', to: '12:00' }],
        // A101 n'a AUCUNE plage déclarée nulle part (ni Default ni override) → indisponible.
      });
      const result = computeAutonomyDistribution({
        groupIds: ['G1'],
        roomIds: ['A101'],
        week: 1,
        availabilityManager: manager,
        blockedZonesMinutes: [],
        occupancy: [],
        totalDuration: 240,
      });
      expect(result.pieces).toEqual([]);
      expect(result.remainingDuration).toBe(240);
    });

    it('première salle occupée mais une alternative libre au même moment → l\'alternative est retenue', () => {
      const manager = makeManager({
        Default: [],
        G1: [{ days: 'lundi', from: '08:00', to: '12:00' }],
        A101: [{ days: 'lundi', from: '08:00', to: '12:00' }],
        A102: [{ days: 'lundi', from: '08:00', to: '12:00' }],
      });
      const result = computeAutonomyDistribution({
        groupIds: ['G1'],
        roomIds: ['A101', 'A102'], // A101 = 1ère alternative, occupée ; A102 libre
        week: 1,
        availabilityManager: manager,
        blockedZonesMinutes: [],
        occupancy: [{ startTime: 8 * 60, duration: 240, groups: [], rooms: ['A101'] }],
        totalDuration: 240,
      });
      expect(result.pieces).toEqual([{ startTime: 8 * 60, duration: 240, roomId: 'A102' }]);
      expect(result.remainingDuration).toBe(0);
    });

    it('les créneaux de deux salles ne se chevauchent jamais dans le résultat (découpe, pas de double comptage)', () => {
      const manager = makeManager({
        Default: [],
        G1: [{ days: 'lundi', from: '08:00', to: '12:00' }],
        A101: [{ days: 'lundi', from: '08:00', to: '12:00' }], // libre toute la matinée
        A102: [{ days: 'lundi', from: '08:00', to: '12:00' }], // libre toute la matinée aussi
      });
      const result = computeAutonomyDistribution({
        groupIds: ['G1'],
        roomIds: ['A101', 'A102'],
        week: 1,
        availabilityManager: manager,
        blockedZonesMinutes: [],
        occupancy: [],
        totalDuration: 240,
      });
      // Une seule pièce de 240min (pas 480 : les deux salles libres au même moment ne doublent
      // pas la capacité disponible), rattachée à la première salle candidate.
      expect(result.pieces).toEqual([{ startTime: 8 * 60, duration: 240, roomId: 'A101' }]);
      expect(result.remainingDuration).toBe(0);
    });

    it('salles avec fenêtres asymétriques : bascule de salle en cours de semaine sans perte ni double comptage', () => {
      const manager = makeManager({
        Default: [],
        G1: [{ days: 'lundi', from: '08:00', to: '12:00' }],
        A101: [{ days: 'lundi', from: '08:00', to: '09:00' }], // libre seulement 1h
        A102: [{ days: 'lundi', from: '08:00', to: '12:00' }], // libre toute la matinée
      });
      const result = computeAutonomyDistribution({
        groupIds: ['G1'],
        roomIds: ['A101', 'A102'],
        week: 1,
        availabilityManager: manager,
        blockedZonesMinutes: [],
        occupancy: [],
        totalDuration: 240,
      });
      // 08:00-09:00 (A101) + 09:00-12:00 (A102) = 240min au total, sans recouvrement.
      expect(result.pieces).toEqual([
        { startTime: 8 * 60, duration: 60, roomId: 'A101' },
        { startTime: 9 * 60, duration: 180, roomId: 'A102' },
      ]);
      expect(result.remainingDuration).toBe(0);
    });
  });
});
