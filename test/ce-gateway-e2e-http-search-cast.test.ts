/**
 * CE: Subprocess E2E — search and cast dispatch over HTTP transport.
 *
 * Complements CC (HTTP 5-tool invariant + status) and CD (HTTP API endpoints).
 * CE is the HTTP-transport equivalent of CA (which covered status/search/cast
 * over stdio). The same gateway binary is exercised via its Streamable HTTP
 * transport so the full HTTP → aggregator dispatch path for the two remaining
 * meta-tools is verified end-to-end:
 *
 *   - ch1tty/search  → no-query: registry-summary path (servers/totalTools)
 *                    → with-query: zero-match path against empty backends
 *   - ch1tty/cast    → confirm:true with empty backends → no_match/discovered
 *
 * All assertions target the real aggregator JSON, not a mock.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const GATEWAY_ENTRY = join(REPO_ROOT, 'dist', 'index.js');
const TEST_TOKEN = 'test-ce-e2e';

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

function makeTempConfig(): { dir: string; configPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-ce-e2e-'));
  const configPath = join(dir, 'servers.json');
  writeFileSync(configPath, JSON.stringify({ servers: [] }), 'utf8');
  return { dir, configPath };
}

async function waitForHealth(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const remainingMs = deadline - Date.now();
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(Math.max(1, Math.min(1000, remainingMs))),
      });
      if (res.ok) return;
    } catch {
      // server not up yet or probe aborted
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`/health did not respond within ${timeoutMs}ms`);
}

/** Extract and parse the JSON text payload from an MCP callTool result. */
function parseResult(result: Awaited<ReturnType<Client['callTool']>>): unknown {
  assert.ok(!result.isError, `tool returned isError: ${JSON.stringify(result.content)}`);
  const items = result.content as Array<{ type: string; text?: string }>;
  const text = items[0]?.text ?? '';
  return JSON.parse(text);
}

test(
  'CE: gateway E2E — search and cast dispatch over HTTP transport (subprocess)',
  { timeout: 35_000 },
  async (t) => {
    const port = await getFreePort();
    const { dir, configPath } = makeTempConfig();
    let proc: ChildProcess | undefined;

    try {
      proc = spawn('node', [GATEWAY_ENTRY], {
        env: {
          ...process.env,
          CH1TTY_PORT: String(port),
          CH1TTY_MCP_TOKEN: TEST_TOKEN,
          CH1TTY_CONFIG: configPath,
          CH1TTY_SPAWN_TIMEOUT_MS: '2000',
          CH1TTY_REMOTE_TIMEOUT_MS: '2000',
        },
        stdio: ['ignore', 'ignore', 'ignore'],
      });

      let procError: Error | undefined;
      proc.on('error', (e) => { procError = e; });

      await waitForHealth(port, 12_000);
      assert.ok(!procError, `gateway process errored: ${procError?.message}`);

      const transport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${port}/mcp`),
        { requestInit: { headers: { Authorization: `Bearer ${TEST_TOKEN}` } } },
      );
      const client = new Client({ name: 'ce-e2e', version: '1.0.0' }, { capabilities: {} });

      const deadline = Date.now() + 20_000;
      await client.connect(transport, { timeout: deadline - Date.now() });

      await t.test('search with no query returns registry summary over HTTP', async () => {
        const data = parseResult(
          await client.callTool({ name: 'ch1tty/search', arguments: {} }, undefined, {
            timeout: Math.max(1000, deadline - Date.now()),
          }),
        ) as Record<string, unknown>;
        assert.equal(data.totalTools, 0, `expected totalTools 0, got ${data.totalTools}`);
        assert.ok('servers' in data, 'no-query search response must include "servers" field');
        assert.ok(Array.isArray(data.servers), '"servers" must be an array');
      });

      await t.test('search with query returns zero matches when no backends registered', async () => {
        const data = parseResult(
          await client.callTool(
            { name: 'ch1tty/search', arguments: { query: 'database' } },
            undefined,
            { timeout: Math.max(1000, deadline - Date.now()) },
          ),
        ) as Record<string, unknown>;
        assert.equal(data.matches, 0, `expected 0 matches, got ${data.matches}`);
        assert.equal(data.total, 0, `expected total 0, got ${data.total}`);
        assert.ok(Array.isArray(data.tools), '"tools" must be an array');
        assert.equal((data.tools as unknown[]).length, 0, 'expected empty tools array');
      });

      await t.test('cast confirm:true returns no_match or discovered when no backends registered', async () => {
        const data = parseResult(
          await client.callTool(
            {
              name: 'ch1tty/cast',
              arguments: { intent: 'list all database tables', confirm: true },
            },
            undefined,
            { timeout: Math.max(1000, deadline - Date.now()) },
          ),
        ) as Record<string, unknown>;
        assert.ok(
          data.cast === 'no_match' || data.cast === 'discovered',
          `expected cast "no_match" or "discovered", got ${JSON.stringify(data.cast)}`,
        );
        assert.equal(
          data.intent,
          'list all database tables',
          `cast.intent mismatch: ${data.intent}`,
        );
        assert.ok(typeof data.latencyMs === 'number', 'cast.latencyMs must be a number');
        assert.ok(typeof data.hint === 'string' && data.hint.length > 0, 'cast.hint missing');
      });

      await client.close();
    } finally {
      if (proc && !proc.killed) {
        proc.kill('SIGTERM');
        await new Promise<void>((res) => {
          const timer = setTimeout(res, 2000);
          proc!.once('exit', () => {
            clearTimeout(timer);
            res();
          });
        });
      }
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
