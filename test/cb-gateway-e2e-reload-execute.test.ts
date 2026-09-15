/**
 * CB: Subprocess E2E — reload and execute meta-tool dispatch.
 *
 * Complements BZ (tools/list invariant) and CA (status/search/cast dispatch).
 * CB extends the subprocess harness to cover the remaining two meta-tools:
 *
 *   - ch1tty/reload  → re-reads the config file and returns a reload snapshot
 *                       (reloaded, added, removed, totalServers, latencyMs)
 *   - ch1tty/execute → missing-tool-arg error path
 *                    → invalid tool-name format (no slash) error path
 *                    → unknown server error path (valid format, unregistered server)
 *
 * All assertions target the JSON shape returned by the real aggregator.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const GATEWAY_ENTRY = join(REPO_ROOT, 'dist', 'index.js');

function makeTempConfig(): { dir: string; configPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-cb-e2e-'));
  const configPath = join(dir, 'servers.json');
  writeFileSync(configPath, JSON.stringify({ servers: [] }), 'utf8');
  return { dir, configPath };
}

/** Extract and parse the JSON text payload from an MCP callTool result. */
function parseResult(result: Awaited<ReturnType<Client['callTool']>>): unknown {
  const items = result.content as Array<{ type: string; text?: string }>;
  const text = items[0]?.text ?? '';
  try { return JSON.parse(text); } catch { return text; }
}

test(
  'CB: gateway E2E — reload and execute dispatch over stdio MCP (subprocess)',
  { timeout: 30_000 },
  async (t) => {
    const { dir, configPath } = makeTempConfig();
    const transport = new StdioClientTransport({
      command: 'node',
      args: [GATEWAY_ENTRY],
      env: {
        ...process.env,
        CH1TTY_PORT: '',
        CH1TTY_CONFIG: configPath,
        CH1TTY_SPAWN_TIMEOUT_MS: '2000',
        CH1TTY_REMOTE_TIMEOUT_MS: '2000',
      },
    });
    const client = new Client({ name: 'cb-e2e', version: '1.0.0' }, { capabilities: {} });

    const deadline = Date.now() + 25_000;
    try {
      await client.connect(transport, { timeout: deadline - Date.now() });

      await t.test('reload returns a reload snapshot with zero servers', async () => {
        const result = await client.callTool(
          { name: 'ch1tty/reload', arguments: {} },
          undefined,
          { timeout: Math.max(1000, deadline - Date.now()) },
        );
        assert.ok(!result.isError, `reload returned isError: ${JSON.stringify(result.content)}`);
        const data = parseResult(result) as Record<string, unknown>;
        assert.equal(data.reloaded, true, 'reload result must have reloaded: true');
        assert.equal(data.totalServers, 0, `expected totalServers 0, got ${data.totalServers}`);
        assert.ok(Array.isArray(data.added), 'reload result must include "added" array');
        assert.ok(Array.isArray(data.removed), 'reload result must include "removed" array');
        assert.equal((data.added as unknown[]).length, 0, 'expected empty added array');
        assert.equal((data.removed as unknown[]).length, 0, 'expected empty removed array');
        assert.ok(typeof data.latencyMs === 'number', 'reload result must include numeric latencyMs');
      });

      await t.test('execute — missing tool arg returns isError', async () => {
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

      await t.test('execute — invalid tool name format (no slash) returns isError', async () => {
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

      await t.test('execute — unknown server returns isError with known-servers list', async () => {
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
    } finally {
      await client.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
