/**
 * Test pour reproduire le bug de conflit de salles dans ScheduleMR
 * Le bug se produit lorsque deux tâches parallèles se voient attribuer la même salle
 */

import { ScheduleMR } from '../scheduleMR.js';

console.log('🧪 Test de détection de conflits de salles dans ScheduleMR\n');

const scheduler = new ScheduleMR();

console.log('\n📊 Lancement de la planification...\n');
const result = scheduler.solve();

console.log('\n📈 Résultats:');
console.log(`✅ Tâches planifiées: ${result.solutions.length}`);
console.log(`🎯 Planification complète: ${result.isComplete ? 'OUI' : 'NON'}`);
console.log(`⚠️ Conflits détectés: ${result.conflictCount}`);

// Analyse détaillée des conflits de salles
console.log('\n🔍 Vérification des conflits de salles...\n');

interface TimeSlot {
    taskId: string;
    taskName: string;
    startTime: number;
    endTime: number;
    roomId: string;
}

// Organiser les tâches par salle et par créneau
const roomSchedule = new Map<string, TimeSlot[]>();

for (const solution of result.solutions) {
    const task = solution.task;
    const startTime = solution.startTime;
    const endTime = startTime + task.duration;
    
    // Trouver la salle utilisée
    const room = task.getCurrentRoom();
    if (room) {
        const roomId = room.id;
        if (!roomSchedule.has(roomId)) {
            roomSchedule.set(roomId, []);
        }
        
        roomSchedule.get(roomId)!.push({
            taskId: task.id,
            taskName: task.name,
            startTime: startTime,
            endTime: endTime,
            roomId: roomId
        });
    }
}

// Vérifier les conflits pour chaque salle
let totalConflicts = 0;
const conflictDetails: string[] = [];

for (const [roomId, slots] of roomSchedule.entries()) {
    // Trier par heure de début
    slots.sort((a, b) => a.startTime - b.startTime);
    
    // Vérifier les chevauchements
    for (let i = 0; i < slots.length; i++) {
        for (let j = i + 1; j < slots.length; j++) {
            const slotA = slots[i];
            const slotB = slots[j];
            
            // Vérifier si les créneaux se chevauchent
            if (slotA.endTime > slotB.startTime && slotB.endTime > slotA.startTime) {
                totalConflicts++;
                const conflict = `🔴 CONFLIT dans salle ${roomId}:
   Tâche 1: ${slotA.taskName} (${slotA.taskId}) [${slotA.startTime} - ${slotA.endTime}]
   Tâche 2: ${slotB.taskName} (${slotB.taskId}) [${slotB.startTime} - ${slotB.endTime}]
   Chevauchement: [${Math.max(slotA.startTime, slotB.startTime)} - ${Math.min(slotA.endTime, slotB.endTime)}]`;
                conflictDetails.push(conflict);
                console.log(conflict + '\n');
            }
        }
    }
}

if (totalConflicts === 0) {
    console.log('✅ Aucun conflit de salle détecté !\n');
} else {
    console.log(`❌ TOTAL: ${totalConflicts} conflit(s) de salle détecté(s)\n`);
    console.log('Détails des conflits:');
    conflictDetails.forEach(detail => console.log(detail + '\n'));
}

// Afficher un résumé des salles utilisées
console.log('📊 Résumé de utilisation des salles:');
for (const [roomId, slots] of roomSchedule.entries()) {
    console.log(`   ${roomId}: ${slots.length} tâche(s) planifiée(s)`);
}

console.log('\n✅ Test terminé');
