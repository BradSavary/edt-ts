import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import type { RawScheduleData, ScheduleSolutionJSON, SchedulerConfig } from '@edt-ts/scheduler-common';

const TIMEOUT_MARGIN_SECONDS = 5;

/**
 * Résolution du chemin par défaut de `cpsat_runner.py`, à partir du cwd du process — PAS de
 * `import.meta.url` : ce module est importé par `scheduler.worker.ts`, bundlé en CJS par esbuild
 * (`JobQueue._getWorkerCode`), contexte où `import.meta.url` est vide et casserait l'import au
 * chargement (pour TOUS les jobs, pas seulement CP-SAT). `process.cwd()` reste fiable : les
 * scripts npm (`api:dev`/`api:start`) l'exécutent depuis `packages/scheduler-api`, et les workers
 * héritent du cwd du process parent. Reste explicitement configurable via `CPSAT_RUNNER`.
 */
const CPSAT_PKG_BASES = [
  '../scheduler-cpsat',     // cwd = packages/scheduler-api
  'packages/scheduler-cpsat', // cwd = racine du repo
  'scheduler-cpsat',        // cwd = packages/
];

function resolveDefaultRunnerPath(): string | undefined {
  return CPSAT_PKG_BASES
    .map((base) => resolvePath(process.cwd(), base, 'cpsat_runner.py'))
    .find(existsSync);
}

/**
 * Interpréteur Python par défaut : le venv provisionné du package `scheduler-cpsat` s'il existe
 * (le seul garanti d'avoir `ortools`), sinon un repli **dépendant de la plateforme** — `python`
 * sur Windows (où `python3` tape l'alias Microsoft Store et échoue en code 9009), `python3`
 * ailleurs. Toujours surchargeable par `CPSAT_PYTHON`.
 */
function resolveDefaultPython(): string {
  const venvRel = process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python';
  const venv = CPSAT_PKG_BASES
    .map((base) => resolvePath(process.cwd(), base, venvRel))
    .find(existsSync);
  if (venv) return venv;
  return process.platform === 'win32' ? 'python' : 'python3';
}

/**
 * Passerelle vers le moteur CP-SAT (subprocess Python). Un seul point d'appel, réutilisé par le
 * handler sync et le worker de jobs async.
 */
export function runCpsat(raw: RawScheduleData, config?: SchedulerConfig): Promise<ScheduleSolutionJSON[]> {
  const pythonPath = process.env.CPSAT_PYTHON ?? resolveDefaultPython();
  const runnerPath = process.env.CPSAT_RUNNER ?? resolveDefaultRunnerPath();
  const timeoutMs = ((config?.timeoutSeconds ?? 30) + TIMEOUT_MARGIN_SECONDS) * 1000;

  if (!runnerPath) {
    return Promise.reject(new Error(
      'Moteur CP-SAT indisponible : impossible de localiser cpsat_runner.py. ' +
      'Définir la variable d\'environnement CPSAT_RUNNER.',
    ));
  }

  return new Promise((resolve, reject) => {
    // PYTHONUTF8=1 force l'UTF-8 sur stdin/stdout du subprocess : sans ça, Python utilise
    // l'encodage de la codepage Windows (cp1252) pour lire le pipe, ce qui corrompt les
    // caractères accentués (ex: "Valérie" -> "ValÃ©rie") dans les solutions retournées.
    const child = spawn(pythonPath, [runnerPath], { env: { ...process.env, PYTHONUTF8: '1' } });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`Moteur CP-SAT : timeout dépassé (${timeoutMs / 1000}s)`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf-8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf-8'); });

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(new Error(
          `Moteur CP-SAT indisponible (Python/ortools non provisionné) : ${pythonPath}`,
        ));
      } else {
        reject(err);
      }
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Moteur CP-SAT : échec (code ${code}) — ${stderr.trim() || '(pas de message)'}`));
        return;
      }
      // Tracé même en succès (code 0) : une passe peut être sautée faute de budget restant
      // (`[cpsat] passe N (...) : sautée, budget épuisé`) sans que ça n'affecte le code de sortie —
      // sans ce log, ce diagnostic existait dans le moteur mais n'était jamais visible nulle part.
      if (stderr.trim()) {
        console.error(`[cpsatGateway] stderr moteur :\n${stderr.trim()}`);
      }
      try {
        resolve(JSON.parse(stdout) as ScheduleSolutionJSON[]);
      } catch (parseErr) {
        reject(new Error(`Moteur CP-SAT : sortie invalide — ${String(parseErr)}`));
      }
    });

    child.stdin.write(JSON.stringify({ raw, config: config ?? {} }));
    child.stdin.end();
  });
}
