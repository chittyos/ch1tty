/**
 * CI assertion: orchestrator endpoint canonicalization (issue #1066).
 *
 * Enforces that:
 *   - servers.json and src/config-data.ts both use the canonical route
 *     https://agent.chitty.cc/orchestrator/mcp
 *   - Neither the legacy direct route (https://orchestrator.chitty.cc/mcp)
 *     nor any workers.dev URL appears in either catalog.
 *
 * The test reads files as text/JSON so it catches drift even if TypeScript
 * import resolution would otherwise silently succeed.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const CANONICAL = 'https://agent.chitty.cc/orchestrator/mcp';
const FORBIDDEN = [
  'https://orchestrator.chitty.cc/mcp',
  // Catches any *.workers.dev MCP endpoint — not just the named orchestrator one.
  '.workers.dev/mcp',
];

describe('orchestrator endpoint — catalog drift prevention', () => {
  test('servers.json orchestrator entry uses the canonical endpoint', () => {
    const raw = readFileSync(join(ROOT, 'servers.json'), 'utf-8');
    const config = JSON.parse(raw) as { servers: Array<Record<string, unknown>> };
    const servers = Array.isArray(config.servers) ? config.servers : [];
    const entry = servers.find((s) => typeof s === 'object' && s !== null && s.id === 'orchestrator');
    assert.ok(entry, 'orchestrator server entry not found in servers.json');
    assert.strictEqual(
      entry.endpoint,
      CANONICAL,
      `servers.json orchestrator.endpoint must be "${CANONICAL}", got "${entry.endpoint}"`,
    );
  });

  test('servers.json contains no forbidden orchestrator endpoint strings', () => {
    const raw = readFileSync(join(ROOT, 'servers.json'), 'utf-8');
    for (const forbidden of FORBIDDEN) {
      assert.ok(
        !raw.includes(forbidden),
        `servers.json must not contain obsolete endpoint "${forbidden}"`,
      );
    }
  });

  test('src/config-data.ts orchestrator entry uses the canonical endpoint', async () => {
    const { REMOTE_SERVERS } = await import('../src/config-data.js');
    const entry = REMOTE_SERVERS.find((s) => s.id === 'orchestrator');
    assert.ok(entry, 'orchestrator entry not found in REMOTE_SERVERS (src/config-data.ts)');
    assert.strictEqual(
      entry.endpoint,
      CANONICAL,
      `config-data.ts orchestrator endpoint must be "${CANONICAL}", got "${entry.endpoint}"`,
    );
  });

  test('src/config-data.ts contains no forbidden orchestrator endpoint strings', () => {
    const raw = readFileSync(join(ROOT, 'src', 'config-data.ts'), 'utf-8');
    for (const forbidden of FORBIDDEN) {
      assert.ok(
        !raw.includes(forbidden),
        `src/config-data.ts must not contain obsolete endpoint "${forbidden}"`,
      );
    }
  });

  test('servers.json and config-data.ts agree on the orchestrator endpoint', async () => {
    const raw = readFileSync(join(ROOT, 'servers.json'), 'utf-8');
    const config = JSON.parse(raw) as { servers: Array<Record<string, unknown>> };
    const servers = Array.isArray(config.servers) ? config.servers : [];
    const jsonEntry = servers.find((s) => typeof s === 'object' && s !== null && s.id === 'orchestrator');
    assert.ok(jsonEntry, 'orchestrator entry missing in servers.json');

    const { REMOTE_SERVERS } = await import('../src/config-data.js');
    const tsEntry = REMOTE_SERVERS.find((s) => s.id === 'orchestrator');
    assert.ok(tsEntry, 'orchestrator entry missing in config-data.ts REMOTE_SERVERS');

    assert.strictEqual(
      jsonEntry.endpoint,
      tsEntry.endpoint,
      'servers.json and config-data.ts orchestrator endpoints must match',
    );
  });
});
