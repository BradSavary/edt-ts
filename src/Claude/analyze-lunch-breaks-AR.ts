/**
 * Analyse les pauses méridiennes dans un planning généré avec ScheduleAR
 */

import { ScheduleAR } from '../scheduleAR';

console.log('🔍 ANALYSE DES PAUSES MÉRIDIENNES (ScheduleAR)');
console.log('='.repeat(60));

// Créer et résoudre un planning avec ScheduleAR
const scheduler = new ScheduleAR();
const result = scheduler.solve();

console.log(`\n📊 Planification: ${result.solutions.length}/80 tâches planifiées`);

// Analyser les pauses méridiennes pour chaque groupe
const MINUTES_PER_DAY = 24 * 60;
const days = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];

// Récupérer tous les groupes
const groups = new Set<string>();
for (const sol of result.solutions) {
    const groupResources = sol.task.getAllResources().filter(r => r.type === 'group');
    for (const group of groupResources) {
        groups.add(group.id);
    }
}

console.log(`\n👥 Groupes trouvés: ${groups.size}`);

// Pour chaque groupe et chaque jour, analyser les créneaux
const issues: Array<{group: string, day: string, slots: Array<{start: string, end: string}>}> = [];

for (const groupId of Array.from(groups).sort()) {
    // Récupérer toutes les tâches du groupe
    const groupTasks = result.solutions.filter(sol => 
        sol.task.getAllResources().some(r => r.type === 'group' && r.id === groupId)
    );
    
    // Organiser par jour
    for (let dayIndex = 0; dayIndex < 5; dayIndex++) {
        const dayStart = dayIndex * MINUTES_PER_DAY;
        const dayEnd = (dayIndex + 1) * MINUTES_PER_DAY;
        
        // Tâches de ce jour
        const dayTasks = groupTasks
            .filter(sol => sol.startTime >= dayStart && sol.startTime < dayEnd)
            .sort((a, b) => a.startTime - b.startTime);
        
        if (dayTasks.length === 0) continue;
        
        // Vérifier les créneaux autour de midi
        const LUNCH_START = dayStart + (12 * 60); // 12:00
        const LUNCH_MID = dayStart + (12 * 60 + 30); // 12:30
        const LUNCH_END = dayStart + (13 * 60 + 30); // 13:30
        const AFTERNOON_LIMIT = dayStart + (14 * 60); // 14:00
        
        // Chercher les tâches qui touchent la période 12:00-14:00
        const morningSlots = dayTasks.filter(sol => {
            const taskEnd = sol.startTime + sol.task.duration;
            return sol.startTime < LUNCH_END && taskEnd > LUNCH_START;
        });
        
        if (morningSlots.length === 0) continue;
        
        // Analyser les pauses
        let hasIssue = false;
        const slots: Array<{start: string, end: string}> = [];
        
        for (const sol of morningSlots) {
            const taskStart = sol.startTime;
            const taskEnd = taskStart + sol.task.duration;
            const startInDay = taskStart % MINUTES_PER_DAY;
            const endInDay = taskEnd % MINUTES_PER_DAY;
            
            const formatTime = (minutes: number) => {
                const h = Math.floor(minutes / 60);
                const m = minutes % 60;
                return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
            };
            
            slots.push({
                start: formatTime(startInDay),
                end: formatTime(endInDay)
            });
            
            // Vérifier si le créneau viole la règle des 90 minutes
            // Cas 1: Cours qui se termine entre 12:00 et 12:30
            if (endInDay > LUNCH_START % MINUTES_PER_DAY && endInDay <= LUNCH_MID % MINUTES_PER_DAY) {
                // Vérifier s'il y a un cours entre 13:30 et 14:00
                const afternoonSlots = dayTasks.filter(s => {
                    const sStart = s.startTime;
                    return sStart >= LUNCH_END && sStart < AFTERNOON_LIMIT;
                });
                
                if (afternoonSlots.length > 0) {
                    hasIssue = true;
                }
            }
            
            // Cas 2: Cours qui commence entre 13:30 et 14:00
            if (startInDay >= LUNCH_END % MINUTES_PER_DAY && startInDay < AFTERNOON_LIMIT % MINUTES_PER_DAY) {
                // Vérifier s'il y a un cours entre 12:00 et 12:30
                const morningBreakSlots = dayTasks.filter(s => {
                    const sStart = s.startTime;
                    const sEnd = sStart + s.task.duration;
                    return sStart >= LUNCH_START && sEnd <= LUNCH_MID;
                });
                
                if (morningBreakSlots.length > 0) {
                    hasIssue = true;
                }
            }
        }
        
        if (hasIssue && slots.length > 0) {
            issues.push({
                group: groupId,
                day: days[dayIndex],
                slots: slots
            });
        }
    }
}

console.log(`\n⚠️ Problèmes de pause méridienne détectés: ${issues.length}`);

if (issues.length > 0) {
    console.log('\n📋 Détails des problèmes:');
    for (const issue of issues) {
        console.log(`\n   ❌ ${issue.group} - ${issue.day}`);
        console.log(`      Créneaux:`);
        for (const slot of issue.slots) {
            console.log(`         ${slot.start} → ${slot.end}`);
        }
    }
} else {
    console.log('\n✅ Aucun problème de pause méridienne détecté !');
}

console.log('\n' + '='.repeat(60));
