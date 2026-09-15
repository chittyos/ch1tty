/**
 * CC: Subprocess E2E — HTTP transport (Streamable HTTP /mcp endpoint).
 *
 * Complements BZ/CA/CB (stdio subprocess E2E). CC exercises the same gateway
 * binary via its second transport: Streamable HTTP on `CH1TTY_PORT`.
 *
 * The test:
 *   1. Allocates a free TCP port, starts the gateway subprocess with that port
 *      and a bearer token (`CH1TTY_MCP_TOKEN=test-cc-e2e`).
 *   2. Polls `/health` until the server is up (max 12s).
 *   3. Connects via `StreamableHTTPClientTransport` with the matching bearer token.
 *   4. Asserts `tools/list` returns exactly the 5 slim-MCP meta-tools.
 *   5. Calls `ch1tty/status` and validates the JSON shape returned by the real
 *      aggregator — exercising the full HTTP dispatch path end-to-end.
 *
 * All assertions target the real aggregator response, not a mock.
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
const TEST_TOKEN = 'test-cc-e2e';

const EXPECTED_TOOL_NAMES = [
  'ch1tty/cast',
  'ch1tty/execute',
  'ch1tty/reload',
  'ch1tty/search',
  'ch1tty/status',
];

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
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-cc-e2e-'));
  const configPath = join(dir, 'servers.json');
  writeFileSync(configPath, JSON.stringify({ servers: [] }), 'utf8');
  return { dir, configPath };
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
  'CC: gateway exposes exactly 5 meta-tools and dispatches status over HTTP (subprocess E2E)',
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

      // Surface unexpected early exits as test failures
      let procError: Error | undefined;
      proc.on('error', (e) => { procError = e; });

      await waitForHealth(port, 12_000);
      assert.ok(!procError, `gateway process errored: ${procError?.message}`);

      const transport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${port}/mcp`),
        { requestInit: { headers: { Authorization: `Bearer ${TEST_TOKEN}` } } },
      );
      const client = new Client({ name: 'cc-e2e', version: '1.0.0' }, { capabilities: {} });

      const deadline = Date.now() + 20_000;
      await client.connect(transport, { timeout: deadline - Date.now() });

      await t.test('tools/list returns exactly 5 meta-tools over HTTP', async () => {
        const { tools } = await client.listTools(undefined, { timeout: deadline - Date.now() });
        const names = tools.map((tool) => tool.name).sort();
        assert.deepEqual(names, EXPECTED_TOOL_NAMES);
      });

      await t.test('ch1tty/status returns valid gateway snapshot over HTTP', async () => {
        const result = await client.callTool(
          { name: 'ch1tty/status', arguments: {} },
          undefined,
          { timeout: Math.max(1000, deadline - Date.now()) },
        );
        assert.ok(!result.isError, `status returned isError: ${JSON.stringify(result.content)}`);
        const items = result.content as Array<{ type: string; text?: string }>;
        const data = JSON.parse(items[0]?.text ?? '{}') as Record<string, unknown>;
        assert.equal(data.gateway, 'ch1tty', `status.gateway expected "ch1tty", got ${data.gateway}`);
        assert.ok(typeof data.version === 'string' && data.version.length > 0, 'status.version missing');
        assert.equal(data.totalServers, 0, `expected totalServers 0, got ${data.totalServers}`);
        assert.equal(data.totalTools, 0, `expected totalTools 0, got ${data.totalTools}`);
        assert.ok(typeof data.uptime === 'number', 'status.uptime must be a number');
      });

      await client.close();
    } finally {
      if (proc && !proc.killed) proc.kill('SIGTERM');
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
