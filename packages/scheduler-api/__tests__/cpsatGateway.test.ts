import { describe, it, expect, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { runCpsat } from '../src/cpsatGateway.js';
import type { RawScheduleData } from '@edt-ts/scheduler-common';

/**
 * Passerelle testée avec un FAUX runner (Node, pas Python) pointé via CPSAT_PYTHON/CPSAT_RUNNER —
 * vérifie le comportement de cpsatGateway.ts lui-même (routage, timeout, erreurs), indépendamment
 * de la disponibilité de Python/ortools en CI (cf. plan §6, gate CI).
 */

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const NODE = process.execPath;

const raw: RawScheduleData = {
  week: 38,
  resources: [],
  courses: [],
};

const originalPython = process.env.CPSAT_PYTHON;
const originalRunner = process.env.CPSAT_RUNNER;

afterEach(() => {
  if (originalPython === undefined) delete process.env.CPSAT_PYTHON; else process.env.CPSAT_PYTHON = originalPython;
  if (originalRunner === undefined) delete process.env.CPSAT_RUNNER; else process.env.CPSAT_RUNNER = originalRunner;
});

describe('runCpsat — acheminement stdin/stdout', () => {
  it('transmet raw + config sur stdin et restitue la sortie stdout parsée', async () => {
    process.env.CPSAT_PYTHON = NODE;
    process.env.CPSAT_RUNNER = FIXTURES + 'fakeRunnerEcho.cjs';

    const result = await runCpsat(raw, { timeoutSeconds: 5 }) as unknown as {
      echo: { raw: RawScheduleData; config: { timeoutSeconds: number } };
    };

    expect(result.echo.raw).toEqual(raw);
    expect(result.echo.config).toEqual({ timeoutSeconds: 5 });
  });
});

describe('runCpsat — exit ≠ 0', () => {
  it('rejette avec le contenu stderr', async () => {
    process.env.CPSAT_PYTHON = NODE;
    process.env.CPSAT_RUNNER = FIXTURES + 'fakeRunnerFail.cjs';

    await expect(runCpsat(raw)).rejects.toThrow(/pause flottante non supportée/);
  });
});

describe('runCpsat — ENOENT (Python absent)', () => {
  it('rejette avec un message explicite', async () => {
    process.env.CPSAT_PYTHON = 'binaire-python-totalement-inexistant-xyz';
    process.env.CPSAT_RUNNER = FIXTURES + 'fakeRunnerEcho.cjs';

    await expect(runCpsat(raw)).rejects.toThrow(/moteur CP-SAT indisponible/i);
  });
});

describe('runCpsat — timeout', () => {
  it('tue le process et rejette après le délai configuré', async () => {
    process.env.CPSAT_PYTHON = NODE;
    process.env.CPSAT_RUNNER = FIXTURES + 'fakeRunnerHang.cjs';

    await expect(runCpsat(raw, { timeoutSeconds: 0.1 })).rejects.toThrow(/timeout/i);
  }, 10_000);
});
