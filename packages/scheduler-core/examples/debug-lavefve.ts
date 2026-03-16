/**
 * Debug - Vérifier les cours de MEUNIER Sandrine
 */

import { ScheduleAR } from '../src/scheduleAR.js';
import { Loader } from '../src/lib/loader.js';

console.log('🔍 DEBUG - Cours de MEUNIER Sandrine\n');

// Fonction pour formater les minutes en HH:MM
function formatTime(minutes: number): string {
    const totalMinutes = minutes % (24 * 60);
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return `${hours.toString().padStart(2, '0')}h${mins.toString().padStart(2, '0')}`;
}

function getDayOfWeek(day: number): string {
    const days = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
    return days[day] || `Jour ${day}`;
}

function getDayFromMinutes(minutes: number): number {
    return Math.floor(minutes / (24 * 60));
}

// Charger les données et planifier
Loader.reload();
const scheduler = new ScheduleAR();
const result = scheduler.solve();

console.log(`✅ ${result.solutions.length} tâches planifiées\n`);

// Filtrer les cours de MEUNIER Sandrine
const lavefveCourses = result.solutions.filter(sol => {
    return sol.task.getAllResources().some(r => r.id === 'MEUNIER Sandrine');
});

console.log(`📚 Cours de MEUNIER Sandrine: ${lavefveCourses.length} cours\n`);

// Trier par jour et heure
const sortedCourses = lavefveCourses
    .map(sol => ({
        name: sol.task.name,
        start: sol.startTime,
        end: sol.startTime + sol.task.duration,
        duration: sol.task.duration,
        day: getDayFromMinutes(sol.startTime),
        timeOfDay: sol.startTime % (24 * 60),
        endTimeOfDay: (sol.startTime + sol.task.duration) % (24 * 60)
    }))
    .sort((a, b) => a.start - b.start);

sortedCourses.forEach((course, idx) => {
    const dayName = getDayOfWeek(course.day);
    const startTime = formatTime(course.start);
    const endTime = formatTime(course.end);
    
    // Déterminer la période
    let period = 'autre';
    if (course.endTimeOfDay <= 13 * 60) {
        period = '🌅 Matin';
    } else if (course.timeOfDay > 13 * 60) {
        period = '🌆 Après-midi';
    }
    
    console.log(`${idx + 1}. ${dayName} ${period} - ${startTime} à ${endTime} (${course.duration}min)`);
    console.log(`   ${course.name}`);
    console.log(`   Start: ${course.start} min absolues, Time of day: ${course.timeOfDay} min\n`);
});

console.log('═══════════════════════════════════════\n');

// Grouper par demi-journée
const LUNCH_BREAK = 13 * 60; // 13h00 = 780 minutes

const halfDays = new Map<string, any[]>();

sortedCourses.forEach(course => {
    let period: string | null = null;
    
    // Matin : cours se termine au plus tard à 13h00
    // Après-midi : cours débute après 13h00
    if (course.endTimeOfDay <= LUNCH_BREAK) {
        period = 'morning';
    } else if (course.timeOfDay > LUNCH_BREAK) {
        period = 'afternoon';
    }
    
    if (period) {
        const key = `${course.day}-${period}`;
        if (!halfDays.has(key)) {
            halfDays.set(key, []);
        }
        halfDays.get(key)!.push(course);
    }
});

console.log(`📊 Regroupement par demi-journée:\n`);
console.log(`Nombre de demi-journées utilisées: ${halfDays.size}\n`);

for (const [key, courses] of halfDays) {
    const [day, period] = key.split('-');
    const dayName = getDayOfWeek(parseInt(day));
    const periodLabel = period === 'morning' ? '🌅 Matin' : '🌆 Après-midi';
    
    console.log(`${dayName} ${periodLabel}: ${courses.length} cours`);
    courses.forEach(c => {
        console.log(`   • ${c.name} (${c.duration}min)`);
    });
    console.log();
}

console.log(`\n🎯 Total: ${lavefveCourses.length} cours sur ${halfDays.size} demi-journées`);
