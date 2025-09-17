import { TimestampUtils } from './bookable';

console.log('🕒 Démonstration du système de timestamps\n');

// Exemples de conversion jour/heure vers timestamp
console.log('📅 Conversion jour/heure → timestamp:');
const exemples = [
  { jour: 'Lundi', dayIndex: 0, hour: 8, minute: 0 },
  { jour: 'Vendredi', dayIndex: 4, hour: 13, minute: 30 },
  { jour: 'Dimanche', dayIndex: 6, hour: 23, minute: 59 }
];

exemples.forEach(ex => {
  const timestamp = TimestampUtils.toTimestamp(ex.dayIndex, ex.hour, ex.minute);
  console.log(`   ${ex.jour} ${ex.hour.toString().padStart(2, '0')}:${ex.minute.toString().padStart(2, '0')} = ${timestamp} minutes`);
});

console.log('\n🔄 Conversion timestamp → jour/heure:');
const timestamps = [480, 6570, 10079];
timestamps.forEach(ts => {
  const info = TimestampUtils.fromTimestamp(ts);
  console.log(`   ${ts} minutes = ${info.dayName} ${info.hour.toString().padStart(2, '0')}:${info.minute.toString().padStart(2, '0')}`);
});

console.log('\n✨ Formatage lisible:');
timestamps.forEach(ts => {
  console.log(`   ${ts} → ${TimestampUtils.format(ts)}`);
});

console.log('\n📊 Vérification des plages de jours:');
const jours = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
jours.forEach((jour, index) => {
  const debut = TimestampUtils.toTimestamp(index, 0, 0);
  const fin = TimestampUtils.toTimestamp(index, 23, 59);
  console.log(`   ${jour}: ${debut} → ${fin} (${fin - debut + 1} minutes)`);
});

console.log('\n🎯 Exemple concret: Créneau MONDOLLOT Vendredi 13:30-15:00');
const start = TimestampUtils.toTimestamp(4, 13, 30); // Vendredi 13:30
const end = TimestampUtils.toTimestamp(4, 15, 0);    // Vendredi 15:00
const duration = end - start;
console.log(`   Début: ${TimestampUtils.format(start)} (${start} min)`);
console.log(`   Fin: ${TimestampUtils.format(end)} (${end} min)`);
console.log(`   Durée: ${duration} minutes`);