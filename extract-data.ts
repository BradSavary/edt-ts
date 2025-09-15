import fs from 'fs';
import path from 'path';

// Charger les fichiers JSON
const contraintesPath = path.join(process.cwd(), 'src/json/contraintes.json');
const coursPath = path.join(process.cwd(), 'src/json/cours.json');

const contraintes = JSON.parse(fs.readFileSync(contraintesPath, 'utf-8'));
const cours = JSON.parse(fs.readFileSync(coursPath, 'utf-8'));

// Extraire les teachers des contraintes
const teachers = new Set<string>();

// Parcourir les clés des contraintes pour trouver les noms de professeurs
Object.keys(contraintes).forEach(key => {
  // Les teachers sont les propriétés qui ne sont ni des salles (nombres), ni "Default", ni null
  if (!key.match(/^\d+$/) && key !== 'Default' && contraintes[key] !== null && typeof contraintes[key] === 'object') {
    teachers.add(key);
  }
});

// Extraire les groups et rooms des cours
const groups = new Set<string>();
const rooms = new Set<string>();

cours.forEach((course: any) => {
  // Ajouter les groupes
  if (course.groups && Array.isArray(course.groups)) {
    course.groups.forEach((group: string) => groups.add(group));
  }
  
  // Ajouter les salles
  if (course.rooms && Array.isArray(course.rooms)) {
    course.rooms.forEach((room: string) => rooms.add(room));
  }
});

// Créer les structures de données avec des informations détaillées
const teachersData = Array.from(teachers).sort().map(name => ({
  id: name.replace(/\s+/g, '_').toUpperCase(),
  name: name,
  fullName: name,
  email: `${name.toLowerCase().replace(/\s+/g, '.')}@university.fr`,
  department: "Informatique",
  available: true
}));

const groupsData = Array.from(groups).sort().map(name => ({
  id: name,
  name: name,
  level: name.includes('BUT1') ? 1 : name.includes('BUT2') ? 2 : name.includes('BUT3') ? 3 : 0,
  year: name.includes('BUT1') ? 'BUT1' : name.includes('BUT2') ? 'BUT2' : name.includes('BUT3') ? 'BUT3' : 'Unknown',
  capacity: name.includes('G1') || name.includes('G2') || name.includes('G3') || name.includes('G4') ? 30 : 15,
  active: true
}));

const roomsData = Array.from(rooms).sort((a, b) => {
  // Trier numériquement les salles
  const numA = parseInt(a);
  const numB = parseInt(b);
  if (!isNaN(numA) && !isNaN(numB)) {
    return numA - numB;
  }
  return a.localeCompare(b);
}).map(name => ({
  id: name,
  name: `Salle ${name}`,
  number: name,
  capacity: parseInt(name) > 200 ? 100 : parseInt(name) > 100 ? 50 : 30,
  type: parseInt(name) > 200 ? "amphitheatre" : "classroom",
  equipment: ["projector", "computer"],
  available: true
}));

// Écrire les fichiers JSON
const outputDir = path.join(process.cwd(), 'src/json');

fs.writeFileSync(
  path.join(outputDir, 'teachers.json'),
  JSON.stringify(teachersData, null, 2),
  'utf-8'
);

fs.writeFileSync(
  path.join(outputDir, 'groups.json'),
  JSON.stringify(groupsData, null, 2),
  'utf-8'
);

fs.writeFileSync(
  path.join(outputDir, 'rooms.json'),
  JSON.stringify(roomsData, null, 2),
  'utf-8'
);

console.log('✅ Fichiers créés avec succès :');
console.log(`📚 Teachers: ${teachersData.length} professeurs`);
console.log(`👥 Groups: ${groupsData.length} groupes`);
console.log(`🏫 Rooms: ${roomsData.length} salles`);

// Afficher un aperçu
console.log('\n--- Aperçu des données ---');
console.log('Teachers:', teachersData.slice(0, 3).map(t => t.name));
console.log('Groups:', groupsData.slice(0, 5).map(g => g.name));
console.log('Rooms:', roomsData.slice(0, 5).map(r => r.number));
