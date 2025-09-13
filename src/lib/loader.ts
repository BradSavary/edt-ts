/**
 * Classe utilitaire pour charger des fichiers JSON
 */
export class Loader {
  /**
   * Lit un fichier JSON et retourne son contenu en tant qu'objet JavaScript
   * @param filePath - Le chemin vers le fichier JSON
   * @returns Une promesse qui résout avec le contenu du fichier JSON
   */
  static async loadJson<T = any>(filePath: string): Promise<T> {
    try {
      const response = await fetch(filePath);
      
      if (!response.ok) {
        throw new Error(`Erreur lors du chargement du fichier ${filePath}: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Impossible de charger le fichier JSON ${filePath}: ${error.message}`);
      }
      throw new Error(`Erreur inconnue lors du chargement du fichier ${filePath}`);
    }
  }

  /**
   * Lit un fichier JSON de manière synchrone (pour Node.js uniquement)
   * Note: Cette méthode ne fonctionne que dans un environnement Node.js
   * @param filePath - Le chemin vers le fichier JSON
   * @returns Le contenu du fichier JSON
   */
  static loadJsonSync<T = any>(filePath: string): T {
    if (typeof require === 'undefined') {
      throw new Error('loadJsonSync n\'est disponible que dans un environnement Node.js');
    }
    
    try {
      const fs = require('fs');
      const fileContent = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(fileContent);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Impossible de charger le fichier JSON ${filePath}: ${error.message}`);
      }
      throw new Error(`Erreur inconnue lors du chargement du fichier ${filePath}`);
    }
  }
}