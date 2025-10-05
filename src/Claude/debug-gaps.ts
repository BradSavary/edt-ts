/**
 * Script de débogage pour analyser les gaps de HUBERT Quentin le lundi
 */

import { ScheduleAR } from '../scheduleAR.js';
import { Loader } from '../lib/loader.js';

console.log('🔍 DEBUG GAPS - HUBERT Quentin (Lundi)\n');

// Charger les données et planifier
Loader.reload();
const scheduler = new ScheduleAR();
const result = scheduler.solve();

console.log(`✅ ${result.solutions.length} tâches planifiées\n`);

// Fonction pour convertir les minutes en format HH:MM
function formatTime(minutes: number): string {
    const totalMinutes = minutes % (24 * 60);
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return `${hours.toString().padStart(2, '0')}h${mins.toString().padStart(2, '0')}`;
}

// Fonction pour obtenir le jour depuis les minutes
function getDayFromMinutes(minutes: number): number {
    return Math.floor(minutes / (24 * 60));
}

// Fonction pour obtenir les minutes dans la journée
function getTimeOfDay(minutes: number): number {
    return minutes % (24 * 60);
}

// Filtrer les cours de HUBERT Quentin le lundi (jour 0)
const springinsfeldCourses = result.solutions.filter(sol => {
    const day = getDayFromMinutes(sol.startTime);
    const hasSpringinsfeld = sol.task.getAllResources().some(r => r.id === 'HUBERT Quentin');
    return day === 0 && hasSpringinsfeld;
});

console.log(`📚 Cours de HUBERT Quentin le Lundi (${springinsfeldCourses.length} cours):\n`);

// Trier par heure de début
const sortedCourses = springinsfeldCourses
    .map(sol => ({
        name: sol.task.name,
        start: sol.startTime,
        end: sol.startTime + sol.task.duration,
        duration: sol.task.duration
    }))
    .sort((a, b) => a.start - b.start);

sortedCourses.forEach((course, idx) => {
    console.log(`${idx + 1}. ${course.name}`);
    console.log(`   Début: ${formatTime(course.start)} (${course.start} min absolues, ${getTimeOfDay(course.start)} min dans jour)`);
    console.log(`   Fin:   ${formatTime(course.end)} (${course.end} min absolues, ${getTimeOfDay(course.end)} min dans jour)`);
    console.log(`   Durée: ${course.duration} min\n`);
});

// Calculer les gaps
console.log('⏸️  Calcul des gaps:\n');

let totalGapMinutes = 0;
let gapCount = 0;

for (let i = 0; i < sortedCourses.length - 1; i++) {
    const currentEnd = sortedCourses[i].end;
    const nextStart = sortedCourses[i + 1].start;
    const gap = nextStart - currentEnd;
    
    if (gap > 0) {
        gapCount++;
        totalGapMinutes += gap;
        const gapHours = (gap / 60).toFixed(1);
        console.log(`Gap ${gapCount}: Entre cours ${i + 1} et ${i + 2}`);
        console.log(`   Fin cours ${i + 1}: ${formatTime(currentEnd)}`);
        console.log(`   Début cours ${i + 2}: ${formatTime(nextStart)}`);
        console.log(`   Durée du gap: ${gap} minutes = ${gapHours}h\n`);
    }
}

// Vérifier si cours matin + après-midi
const firstTimeOfDay = getTimeOfDay(sortedCourses[0].start);
const lastTimeOfDay = getTimeOfDay(sortedCourses[sortedCourses.length - 1].end);
const morningEnd = 12 * 60; // 12h00
const afternoonStart = 14 * 60; // 14h00
const lunchBreakMinutes = 120;

let adjustedGap = totalGapMinutes;
let lunchBreakApplied = false;

if (firstTimeOfDay < morningEnd && lastTimeOfDay > afternoonStart) {
    adjustedGap = Math.max(0, totalGapMinutes - lunchBreakMinutes);
    lunchBreakApplied = true;
}

console.log('📊 RÉSUMÉ:');
console.log(`   Nombre de gaps: ${gapCount}`);
console.log(`   Total gaps brut: ${totalGapMinutes} minutes = ${(totalGapMinutes / 60).toFixed(1)}h`);
console.log(`   Premier cours: ${formatTime(sortedCourses[0].start)}`);
console.log(`   Dernier cours: ${formatTime(sortedCourses[sortedCourses.length - 1].end)}`);
console.log(`   Cours matin+après-midi: ${lunchBreakApplied ? 'OUI' : 'NON'}`);
if (lunchBreakApplied) {
    console.log(`   Pause méridienne soustraite: ${lunchBreakMinutes} minutes = ${(lunchBreakMinutes / 60).toFixed(1)}h`);
    console.log(`   Total gaps ajusté: ${adjustedGap} minutes = ${(adjustedGap / 60).toFixed(1)}h`);
}
