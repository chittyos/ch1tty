/**
 * CA: Subprocess E2E — meta-tool invocations (status, search, cast).
 *
 * Complements BZ (which asserts tools/list returns exactly 5 meta-tools).
 * CA extends the subprocess harness to verify the dispatch path of the three
 * most commonly called meta-tools against a gateway with empty servers config:
 *
 *   - ch1tty/status  → returns valid snapshot with zero servers/tools
 *   - ch1tty/search  → with no query: registry-summary path; with query: zero-match path
 *   - ch1tty/cast    → confirm:true with no backends → no_match response
 *
 * Each assertion targets the JSON shape returned by the real aggregator, not
 * a mock — if the aggregator changes the response format, these tests fail.
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
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-ca-e2e-'));
  const configPath = join(dir, 'servers.json');
  writeFileSync(configPath, JSON.stringify({ servers: [] }), 'utf8');
  return { dir, configPath };
}

/** Extract and parse the JSON text payload from an MCP callTool result. */
function parseResult(result: Awaited<ReturnType<Client['callTool']>>): unknown {
  assert.ok(!result.isError, `tool returned isError: ${JSON.stringify(result.content)}`);
  const items = result.content as Array<{ type: string; text?: string }>;
  const text = items[0]?.text ?? '';
  return JSON.parse(text);
}

test(
  'CA: gateway E2E — status/search/cast dispatch over stdio MCP (subprocess)',
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
    const client = new Client({ name: 'ca-e2e', version: '1.0.0' }, { capabilities: {} });

    const deadline = Date.now() + 25_000;
    try {
      await client.connect(transport, { timeout: deadline - Date.now() });

      await t.test('status returns gateway snapshot with zero servers and tools', async () => {
        const data = parseResult(
          await client.callTool({ name: 'ch1tty/status', arguments: {} }, undefined, {
            timeout: Math.max(1000, deadline - Date.now()),
          }),
        ) as Record<string, unknown>;
        assert.equal(data.gateway, 'ch1tty', `status.gateway expected "ch1tty", got ${data.gateway}`);
        assert.ok(typeof data.version === 'string' && data.version.length > 0, 'status.version missing or empty');
        assert.equal(data.totalServers, 0, `expected totalServers 0, got ${data.totalServers}`);
        assert.equal(data.totalTools, 0, `expected totalTools 0, got ${data.totalTools}`);
        assert.ok(typeof data.uptime === 'number', 'status.uptime must be a number');
        assert.ok(data.systemHealth !== null && typeof data.systemHealth === 'object', 'status.systemHealth missing');
      });

      await t.test('search with no query returns registry summary (servers/totalTools fields)', async () => {
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

      await t.test('cast confirm:true returns a non-executing response when no tools registered', async () => {
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
        // With an empty servers config, the registry has no tools. Cast returns either:
        //   'no_match'   — no tools, prompts, or resources found at all
        //   'discovered' — no executable tools, but suggestion resources from the
        //                  loaded focus-suggestions.json catalog were found
        // Both represent the "nothing to execute" code path; either is correct.
        assert.ok(
          data.cast === 'no_match' || data.cast === 'discovered',
          `expected cast "no_match" or "discovered" (no executable tools), got ${JSON.stringify(data.cast)}`,
        );
        assert.equal(
          data.intent,
          'list all database tables',
          `cast.intent mismatch: ${data.intent}`,
        );
        assert.ok(typeof data.latencyMs === 'number', 'cast.latencyMs must be a number');
        assert.ok(typeof data.hint === 'string' && data.hint.length > 0, 'cast.hint missing');
      });
    } finally {
      await client.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
