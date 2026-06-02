/**
 * Bootstrap worker (plain JS) — enregistre le loader tsx via register(),
 * puis importe dynamiquement le vrai worker TypeScript.
 *
 * Pourquoi ce fichier ?
 * `--import tsx/esm` en execArgv ne propage pas correctement les hooks de
 * résolution de modules dans les worker threads (tsx v4 / Node 22).
 * Utiliser register() juste avant l'import() garantit que les hooks tsx
 * sont actifs avant tout chargement de fichiers .ts.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

// Enregistre le loader ESM de tsx pour résoudre .js → .ts
register('tsx/esm', pathToFileURL(fileURLToPath(new URL('.', import.meta.url))));

// Importe le vrai worker TypeScript (les hooks tsx sont maintenant actifs)
await import('./scheduler.worker.ts');
