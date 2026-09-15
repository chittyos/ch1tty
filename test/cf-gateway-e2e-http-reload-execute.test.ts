/**
 * CF: Subprocess E2E — reload and execute dispatch over HTTP transport.
 *
 * Complements CB (which covered the same meta-tools over stdio) and CE (search/cast
 * over HTTP). CF is the HTTP-transport equivalent of CB, exercising the two remaining
 * meta-tools via the Streamable HTTP endpoint:
 *
 *   - ch1tty/reload  → re-reads the config and returns a reload snapshot
 *                       (reloaded, added, removed, totalServers, latencyMs)
 *   - ch1tty/execute → missing-tool-arg error path
 *                    → invalid tool-name format (no slash) error path
 *                    → unknown server error path (valid format, unregistered server)
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
const TEST_TOKEN = 'test-cf-e2e';

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
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-cf-e2e-'));
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
  'CF: gateway E2E — reload and execute dispatch over HTTP transport (subprocess)',
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
      const client = new Client({ name: 'cf-e2e', version: '1.0.0' }, { capabilities: {} });

      const deadline = Date.now() + 20_000;
      await client.connect(transport, { timeout: deadline - Date.now() });

      await t.test('reload returns a reload snapshot with zero servers over HTTP', async () => {
        const data = parseResult(
          await client.callTool({ name: 'ch1tty/reload', arguments: {} }, undefined, {
            timeout: Math.max(1000, deadline - Date.now()),
          }),
        ) as Record<string, unknown>;
        assert.equal(data.reloaded, true, 'reload result must have reloaded: true');
        assert.equal(data.totalServers, 0, `expected totalServers 0, got ${data.totalServers}`);
        assert.ok(Array.isArray(data.added), 'reload result must include "added" array');
        assert.ok(Array.isArray(data.removed), 'reload result must include "removed" array');
        assert.equal((data.added as unknown[]).length, 0, 'expected empty added array');
        assert.equal((data.removed as unknown[]).length, 0, 'expected empty removed array');
        assert.ok(typeof data.latencyMs === 'number', 'reload result must include numeric latencyMs');
      });

      await t.test('execute — missing tool arg returns isError over HTTP', async () => {
        const result = await client.callTool(
          { name: 'ch1tty/execute', arguments: {} },
          undefined,
          { timeout: Math.max(1000, deadline - Date.now()) },
        );
        assert.ok(result.isError, 'execute with no tool arg must return isError');
        const items = result.content as Array<{ type: string; text?: string }>;
        const text = items[0]?.text ?? '';
        assert.ok(
          text.includes('Missing') && text.includes('tool'),
          `expected missing-tool message, got: ${text}`,
        );
      });

      await t.test('execute — invalid tool name format (no slash) returns isError over HTTP', async () => {
        const result = await client.callTool(
          { name: 'ch1tty/execute', arguments: { tool: 'noseparator' } },
          undefined,
          { timeout: Math.max(1000, deadline - Date.now()) },
        );
        assert.ok(result.isError, 'execute with invalid format must return isError');
        const items = result.content as Array<{ type: string; text?: string }>;
        const text = items[0]?.text ?? '';
        assert.ok(
          text.includes('noseparator') && (text.includes('Invalid') || text.includes('format')),
          `expected invalid-format message, got: ${text}`,
        );
      });

      await t.test('execute — unknown server returns isError with known-servers list over HTTP', async () => {
        const result = await client.callTool(
          { name: 'ch1tty/execute', arguments: { tool: 'ghost-server/some-tool' } },
          undefined,
          { timeout: Math.max(1000, deadline - Date.now()) },
        );
        assert.ok(result.isError, 'execute with unknown server must return isError');
        const items = result.content as Array<{ type: string; text?: string }>;
        const text = items[0]?.text ?? '';
        assert.ok(
          text.includes('ghost-server') && text.includes('Unknown'),
          `expected unknown-server message, got: ${text}`,
        );
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
