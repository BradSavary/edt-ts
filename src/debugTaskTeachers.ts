import { Loader } from './lib/loader.js';
import { Resource } from './resource.js';

console.log('🔍 === DIAGNOSTIC DES TEACHERS DANS LES TÂCHES ===\n');

// Chargement des tâches
const tasks = Loader.loadTasks(39);
console.log(`📚 ${tasks.length} tâches chargées pour la semaine 39\n`);

// Vérification des teachers
let tasksWithTeacher = 0;
let tasksWithoutTeacher = 0;
const tasksWithoutTeacherList: any[] = [];

tasks.forEach((task, index) => {
  // Vérifier si la tâche a un teacher
  const teacherResource = task.resources.find((r: Resource) => r.type === 'teacher');
  
  if (teacherResource) {
    tasksWithTeacher++;
    console.log(`✅ ${task.name} -> Teacher: ${teacherResource.id}`);
  } else {
    tasksWithoutTeacher++;
    tasksWithoutTeacherList.push({
      index: index + 1,
      name: task.name,
      id: task.id
    });
    console.log(`❌ ${task.name} -> Aucun teacher assigné`);
  }
});

console.log('\n📊 === RÉSUMÉ ===');
console.log(`✅ Tâches avec teacher: ${tasksWithTeacher}`);
console.log(`❌ Tâches sans teacher: ${tasksWithoutTeacher}`);

if (tasksWithoutTeacherList.length > 0) {
  console.log('\n⚠️ Détail des tâches sans teacher:');
  tasksWithoutTeacherList.forEach(task => {
    console.log(`   ${task.index}. ${task.name} (${task.id})`);
  });
}

// Vérifier spécifiquement les tâches "Production graphique"
console.log('\n🎨 === VÉRIFICATION SPÉCIFIQUE: PRODUCTION GRAPHIQUE ===');
const productionTasks = tasks.filter(task => task.name.includes('Production graphique'));
productionTasks.forEach(task => {
  const teacherResource = task.resources.find((r: Resource) => r.type === 'teacher');
  console.log(`📍 ${task.name}:`);
  console.log(`   - ID: ${task.id}`);
  console.log(`   - Teacher: ${teacherResource ? teacherResource.id : 'AUCUN'}`);
  console.log(`   - Groupes: ${task.resources.filter((r: Resource) => r.type === 'group').map((r: Resource) => r.id).join(', ')}`);
  console.log(`   - Salles: ${task.resources.filter((r: Resource) => r.type === 'room').map((r: Resource) => r.id).join(', ')}`);
});
