/**
 * BZ: Subprocess E2E — spawn gateway via `node dist/index.js`, connect via
 * stdio MCP, assert exactly 5 meta-tools register.
 *
 * This is the only test that exercises the complete startup → tools/list path
 * from the outside, as a real MCP client sees it. It guards the architectural
 * invariant: the public surface is ALWAYS exactly 5 meta-tools.
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

const EXPECTED_TOOL_NAMES = [
  'ch1tty/cast',
  'ch1tty/execute',
  'ch1tty/reload',
  'ch1tty/search',
  'ch1tty/status',
];

function makeTempConfig(): { dir: string; configPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-bz-e2e-'));
  const configPath = join(dir, 'servers.json');
  writeFileSync(configPath, JSON.stringify({ servers: [] }), 'utf8');
  return { dir, configPath };
}

test(
  'BZ: gateway exposes exactly 5 meta-tools over stdio MCP (subprocess E2E)',
  { timeout: 20_000 },
  async () => {
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
    const client = new Client({ name: 'bz-e2e', version: '1.0.0' }, { capabilities: {} });

    // Sub-20s deadline shared by both MCP requests so neither outlasts the
    // node:test 20s timeout and leaves subprocess/temp-dir cleanup pending.
    const deadline = Date.now() + 15_000;
    try {
      await client.connect(transport, { timeout: deadline - Date.now() });
      const { tools } = await client.listTools(undefined, { timeout: deadline - Date.now() });
      const names = tools.map((t) => t.name).sort();
      assert.equal(
        tools.length,
        5,
        `Expected exactly 5 meta-tools but gateway registered ${tools.length}: ${names.join(', ')}`,
      );
      assert.deepEqual(
        names,
        EXPECTED_TOOL_NAMES,
        `Tool names mismatch — got: ${names.join(', ')}`,
      );
    } finally {
      await client.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
