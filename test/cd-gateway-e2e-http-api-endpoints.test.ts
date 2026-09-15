/**
 * CD: Subprocess E2E — HTTP API endpoints (health, status, sessions, 401).
 *
 * Complements CC (which tested /health + /mcp tool dispatch). CD exercises
 * the remaining HTTP surface of the gateway binary:
 *
 *   /api/v1/health   — structured liveness probe (returns ok/warn/degraded JSON)
 *   /api/v1/status   — full gateway status snapshot
 *   /api/v1/sessions — session list (bearer-auth required)
 *   /mcp (no auth)   — 401 when CH1TTY_MCP_TOKEN is set and Authorization is absent
 *   unknown path     — 404 JSON response
 *
 * All assertions target the real subprocess binary (dist/index.js) — no mocks.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const GATEWAY_ENTRY = join(REPO_ROOT, 'dist', 'index.js');
const TEST_TOKEN = 'test-cd-e2e';

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close(() => resolve((addr as { port: number }).port));
    });
    srv.on('error', reject);
  });
}

function makeTempConfig(): { dir: string; configPath: string; dlqPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-cd-e2e-'));
  const configPath = join(dir, 'servers.json');
  writeFileSync(configPath, JSON.stringify({ servers: [] }), 'utf8');
  const dlqPath = join(dir, 'ledger.dlq.jsonl');
  return { dir, configPath, dlqPath };
}

async function waitForHealth(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`/health did not respond within ${timeoutMs}ms`);
}

test(
  'CD: HTTP API endpoints — health, status, sessions, 401, 404 (subprocess E2E)',
  { timeout: 35_000 },
  async (t) => {
    const port = await getFreePort();
    const { dir, configPath, dlqPath } = makeTempConfig();
    let proc: ChildProcess | undefined;

    try {
      proc = spawn('node', [GATEWAY_ENTRY], {
        env: {
          ...process.env,
          CH1TTY_PORT: String(port),
          CH1TTY_MCP_TOKEN: TEST_TOKEN,
          CH1TTY_CONFIG: configPath,
          CH1TTY_LEDGER_DLQ: dlqPath,
          CH1TTY_SPAWN_TIMEOUT_MS: '2000',
          CH1TTY_REMOTE_TIMEOUT_MS: '2000',
        },
        stdio: ['ignore', 'ignore', 'ignore'],
      });

      let procError: Error | undefined;
      proc.on('error', (e) => { procError = e; });

      await waitForHealth(port, 12_000);
      assert.ok(!procError, `gateway process errored: ${procError?.message}`);

      const base = `http://127.0.0.1:${port}`;

      await t.test('/api/v1/health returns 200 with ok status and systemHealth', async () => {
        const res = await fetch(`${base}/api/v1/health`);
        assert.equal(res.status, 200);
        const body = await res.json() as Record<string, unknown>;
        assert.equal(body.service, 'ch1tty');
        assert.ok(
          body.status === 'ok' || body.status === 'warn',
          `expected ok or warn, got ${body.status}`,
        );
        assert.ok(typeof body.systemHealth === 'object' && body.systemHealth !== null, 'systemHealth must be present');
        const sh = body.systemHealth as Record<string, unknown>;
        assert.ok(typeof sh.status === 'string', 'systemHealth.status must be a string');
      });

      await t.test('/api/v1/status returns 200 with full snapshot', async () => {
        const res = await fetch(`${base}/api/v1/status`);
        assert.equal(res.status, 200);
        const body = await res.json() as Record<string, unknown>;
        assert.equal(body.gateway, 'ch1tty', `status.gateway expected "ch1tty", got ${body.gateway}`);
        assert.ok(typeof body.version === 'string' && body.version.length > 0, 'status.version missing');
        assert.equal(body.totalServers, 0, `expected totalServers 0, got ${body.totalServers}`);
        assert.equal(body.totalTools, 0, `expected totalTools 0, got ${body.totalTools}`);
        assert.ok(typeof body.uptime === 'number', 'status.uptime must be a number');
      });

      await t.test('/api/v1/sessions returns 200 with valid bearer token', async () => {
        const res = await fetch(`${base}/api/v1/sessions`, {
          headers: { Authorization: `Bearer ${TEST_TOKEN}` },
        });
        assert.equal(res.status, 200);
        const body = await res.json() as Record<string, unknown>;
        assert.ok(Array.isArray(body.sessions), 'sessions must be an array');
      });

      await t.test('/api/v1/sessions returns 401 with no token', async () => {
        const res = await fetch(`${base}/api/v1/sessions`);
        assert.equal(res.status, 401);
        const body = await res.json() as Record<string, unknown>;
        assert.equal(body.error, 'unauthorized');
      });

      await t.test('/api/v1/sessions returns 401 with wrong token', async () => {
        const res = await fetch(`${base}/api/v1/sessions`, {
          headers: { Authorization: 'Bearer wrong-token' },
        });
        assert.equal(res.status, 401);
      });

      await t.test('/mcp POST without auth returns 401', async () => {
        const res = await fetch(`${base}/mcp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1, params: {} }),
        });
        assert.equal(res.status, 401);
        const body = await res.json() as Record<string, unknown>;
        assert.equal(body.error, 'unauthorized');
      });

      await t.test('unknown path returns 404', async () => {
        const res = await fetch(`${base}/unknown-path-xyz`);
        assert.equal(res.status, 404);
        const body = await res.json() as Record<string, unknown>;
        assert.equal(body.error, 'not found');
      });

    } finally {
      if (proc && !proc.killed) {
        proc.kill('SIGTERM');
        await new Promise<void>((res) => {
          proc!.once('exit', () => res());
          setTimeout(res, 2000);
        });
      }
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
