/**
 * Port-validation subprocess tests for all 5 HTTP-capable app entry points.
 *
 * Each app validates its *_MCP_PORT env var before binding; an invalid value
 * must cause exit(1) with an error on stderr. This file exercises that path by
 * spawning `node --import tsx <index.ts>` with bad port values and asserting
 * on the exit code and stderr output.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

interface AppSpec {
  app: string;
  envVar: string;
  index: string;
}

const APPS: AppSpec[] = [
  {
    app: 'tasks-mcp',
    envVar: 'TASKS_MCP_PORT',
    index: join(ROOT, 'apps/tasks-mcp/src/index.ts'),
  },
  {
    app: 'session-coordinator-mcp',
    envVar: 'SESSION_MCP_PORT',
    index: join(ROOT, 'apps/session-coordinator-mcp/src/index.ts'),
  },
  {
    app: 'ledger-mcp',
    envVar: 'LEDGER_MCP_PORT',
    index: join(ROOT, 'apps/ledger-mcp/src/index.ts'),
  },
  {
    app: 'evidence-mcp',
    envVar: 'EVIDENCE_MCP_PORT',
    index: join(ROOT, 'apps/evidence-mcp/src/index.ts'),
  },
  {
    app: 'comms-mcp',
    envVar: 'COMMS_MCP_PORT',
    index: join(ROOT, 'apps/comms-mcp/src/index.ts'),
  },
];

/** Run app entry point with a specific PORT env var value; capture exit code + stderr. */
async function runWithPort(
  spec: AppSpec,
  portValue: string,
): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve) => {
    let stderr = '';
    const child = spawn(process.execPath, ['--import', 'tsx', spec.index], {
      env: { ...process.env, [spec.envVar]: portValue },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => resolve({ exitCode: code ?? 1, stderr }));
  });
}

// ── Parameterised over APPS × invalid port values ────────────────────────────

const INVALID_PORTS: Array<{ label: string; value: string }> = [
  { label: 'non-numeric', value: 'notaport' },
  { label: 'zero', value: '0' },
  { label: 'negative', value: '-1' },
  { label: 'above-max', value: '65536' },
  { label: 'decimal', value: '3.14' },
];

for (const spec of APPS) {
  for (const { label, value } of INVALID_PORTS) {
    test(`${spec.app}: ${spec.envVar}=${value} (${label}) → exit 1 + stderr error`, async () => {
      const { exitCode, stderr } = await runWithPort(spec, value);
      assert.equal(exitCode, 1, `exit code should be 1; stderr was: ${stderr}`);
      assert.ok(
        stderr.includes(`Invalid ${spec.envVar}`),
        `stderr should include "Invalid ${spec.envVar}"; got: ${stderr}`,
      );
    });
  }
}
