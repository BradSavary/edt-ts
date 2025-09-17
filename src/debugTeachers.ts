import { Loader } from './lib/loader.js';

console.log('🔍 === ANALYSE DES ENSEIGNANTS ===\n');

// Analyser les enseignants dans le ResourcesManager
const resourcesManager = Loader.resourcesManager;
const allResources = Array.from(resourcesManager.getAllResources());

const teachers = allResources.filter(r => r.type === 'teacher');
const rooms = allResources.filter(r => r.type === 'room');
const groups = allResources.filter(r => r.type === 'group');

console.log(`👨‍🏫 Enseignants chargés: ${teachers.length}`);
console.log(`🏢 Salles chargées: ${rooms.length}`);
console.log(`👥 Groupes chargés: ${groups.length}`);

console.log('\n📋 Liste des enseignants:');
teachers.forEach(teacher => {
    console.log(`  - ${teacher.id}`);
});

// Analyser les enseignants dans cours.json
const coursesData: any = Loader.loadJson('./src/json/cours.json');
const teachersInTasks = new Set<string>();

console.log('\n📚 Enseignants mentionnés dans cours.json:');
coursesData.tasks.forEach((task: any) => {
    if (task.teacher) {
        teachersInTasks.add(task.teacher);
    }
});

Array.from(teachersInTasks).forEach((teacher: string) => {
    const exists = resourcesManager.hasResource(teacher);
    console.log(`  - ${teacher}: ${exists ? '✅' : '❌'}`);
});

// Identifier les enseignants manquants
const missingTeachers = Array.from(teachersInTasks).filter((teacher: string) => 
    !resourcesManager.hasResource(teacher)
);

if (missingTeachers.length > 0) {
    console.log('\n⚠️ Enseignants manquants dans ResourcesManager:');
    missingTeachers.forEach(teacher => {
        console.log(`  - ${teacher}`);
    });
}

// Analyser quelques tâches
console.log('\n📋 Analyse des premières tâches:');
Loader.tasks.slice(0, 5).forEach(task => {
    const teacherResources = task.resources.filter(r => r.type === 'teacher');
    console.log(`  - ${task.name}: ${teacherResources.length} enseignant(s) - ${teacherResources.map(t => t.id).join(', ')}`);
});
