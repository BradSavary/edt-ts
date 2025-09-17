import { Task } from './task';

/**
 * Calcule un score de difficulté pour une tâche
 * Plus le score est élevé, plus la tâche est difficile à planifier
 */
export function calculateTaskDifficultyScore(task: Task): number {
    let score = 0;
    
    // 1. Nombre de ressources (poids: 10 points par ressource)
    score += task.resources.length * 10;
    
    // 2. Bonus pour les enseignants surchargés (identifiés dans l'analyse)
    const overloadedTeachers = ['HUBERT Quentin', 'RENAUD Kevin', 'ROUSSEAU Camille', 'NOEL Melanie', 'MEUNIER Sandrine'];
    const hasOverloadedTeacher = task.resources.some(r => 
        overloadedTeachers.includes(r.id)
    );
    if (hasOverloadedTeacher) {
        score += 50; // Gros bonus pour enseignants surchargés
    }
    
    // 3. Bonus pour les ressources critiques (salles rares)
    const criticalRooms = ['101', '103', '115', 'R01', 'R04', '102'];
    const usesCriticalRoom = task.resources.some(r => 
        criticalRooms.includes(r.id)
    );
    if (usesCriticalRoom) {
        score += 30; // Bonus pour salles critiques
    }
    
    // 4. Bonus pour les groupes très demandés
    const highDemandGroups = ['BUT1-G1', 'BUT1-G2', 'BUT1-G3', 'BUT1-G4', 
                             'BUT2-G1', 'BUT2-G21', 'BUT2-G22', 'BUT2-G3'];
    const usesHighDemandGroup = task.resources.some(r => 
        highDemandGroups.includes(r.id)
    );
    if (usesHighDemandGroup) {
        score += 20; // Bonus pour groupes très demandés
    }
    
    // 5. Malus pour les tâches longues (plus difficiles à caser)
    if (task.duration >= 180) { // 3h ou plus
        score += 25;
    } else if (task.duration >= 120) { // 2h ou plus
        score += 15;
    }
    
    // 6. Bonus pour les matières problématiques identifiées
    const problematicSubjects = [
        'Intégration et développement front',
        'Projet Personnel et Professionnel', 
        'Culture numérique',
        'Économie, gestion et droit du numérique',
        'Anglais',
        'Intégration',
        'Déploiement de services'
    ];
    const isProblematicSubject = problematicSubjects.some(subject => 
        task.name.includes(subject)
    );
    if (isProblematicSubject) {
        score += 40; // Bonus significatif pour matières problématiques
    }
    
    return score;
}

/**
 * Trie les tâches par ordre de difficulté décroissante
 * Les tâches les plus difficiles sont planifiées en premier
 */
export function sortTasksByDifficulty(tasks: Task[]): Task[] {
    return [...tasks].sort((a, b) => {
        const scoreA = calculateTaskDifficultyScore(a);
        const scoreB = calculateTaskDifficultyScore(b);
        return scoreB - scoreA; // Tri décroissant (plus difficile en premier)
    });
}

/**
 * Analyse et affiche le scoring des tâches pour debug
 */
export function analyzeTaskScoring(tasks: Task[]): void {
    console.log('📊 Analyse du scoring des tâches:\n');
    
    const scored = tasks.map(task => ({
        task,
        score: calculateTaskDifficultyScore(task)
    }));
    
    // Trier par score décroissant
    scored.sort((a, b) => b.score - a.score);
    
    console.log('🔴 Top 10 des tâches les plus difficiles:');
    scored.slice(0, 10).forEach((item, index) => {
        console.log(`   ${index + 1}. ${item.task.name} (${item.score} pts)`);
        console.log(`      - ${item.task.resources.length} ressources: ${item.task.resources.map(r => r.id).join(', ')}`);
        console.log(`      - Durée: ${item.task.duration}min`);
    });
    
    console.log('\n🟢 Top 5 des tâches les plus faciles:');
    scored.slice(-5).reverse().forEach((item, index) => {
        console.log(`   ${index + 1}. ${item.task.name} (${item.score} pts)`);
        console.log(`      - ${item.task.resources.length} ressources: ${item.task.resources.map(r => r.id).join(', ')}`);
    });
    
    // Statistiques
    const scores = scored.map(s => s.score);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const maxScore = Math.max(...scores);
    const minScore = Math.min(...scores);
    
    console.log(`\n📈 Statistiques de scoring:`);
    console.log(`   - Score moyen: ${avgScore.toFixed(1)} pts`);
    console.log(`   - Score maximum: ${maxScore} pts`);
    console.log(`   - Score minimum: ${minScore} pts`);
    console.log(`   - Écart: ${maxScore - minScore} pts`);
}