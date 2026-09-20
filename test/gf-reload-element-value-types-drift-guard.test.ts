/**
 * GF drift guard: freeze ch1tty/reload response ELEMENT VALUE TYPES.
 *
 * EE froze the exact key sets for the reload response top level and catalog
 * sub-object, and performed coarse array/scalar checks on each field. Four
 * element-level type gaps remain:
 *
 *   1. added[] — EE confirms it is an array; element type (string) not frozen.
 *      A refactor emitting objects instead of raw ids would silently pass EE.
 *
 *   2. removed[] — same gap as added[].
 *
 *   3. missingEnvVars[] — EE confirms it is an array; the per-entry SHAPE
 *      ({ serverId: string, vars: string[] }) is never tested. An object
 *      key rename (e.g. serverId → id) would pass EE silently.
 *
 *   4. catalog.phantomServerIds[] — EE confirms it is an array; element type
 *      (string) not frozen.
 *
 * GF closes those gaps:
 *
 *   GF-1  added[] entries are non-empty strings (server ids) when servers are added
 *   GF-2  removed[] entries are non-empty strings (server ids) when servers are removed
 *   GF-3  added[] and removed[] are empty-but-string-typed arrays on a no-change reload
 *   GF-4  missingEnvVars[] entry shape: exactly keys {serverId, vars};
 *          serverId is a non-empty string; vars is a string[]
 *   GF-5  missingEnvVars[] entry vars[] elements are non-empty strings (env var names)
 *   GF-6  catalog.phantomServerIds[] entries are non-empty strings when phantom servers exist
 *
 * Frozen 2026-09-20.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only)
 *   - buildCastExplanation metric freeze: not applicable (reload, not cast)
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServersConfig, ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const testDirs: string[] = [];
after(() => {
  for (const d of testDirs) rmSync(d, { recursive: true, force: true });
});

function tempPaths(): { configPath: string; dlqPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-gf-'));
  testDirs.push(dir);
  return { configPath: join(dir, 'servers.json'), dlqPath: join(dir, 'ledger.dlq.jsonl') };
}

function writeConfig(path: string, servers: ServerConfig[]): void {
  const cfg: ServersConfig = { servers };
  writeFileSync(path, JSON.stringify(cfg), 'utf8');
}

function makeServer(id: string, extra: Partial<ServerConfig> = {}): ServerConfig {
  return {
    id,
    name: id,
    type: 'remote',
    access: 'readwrite',
    category: 'code',
    endpoint: `https://fixture.test/${id}`,
    ...extra,
  };
}

function makeAgg(
  initialServers: ServerConfig[],
  configPath: string,
  dlqPath: string,
  opts: { suggestionsCatalog?: Record<string, unknown> } = {},
): Aggregator {
  return new Aggregator(initialServers, {
    configPath,
    ledgerDlqPath: dlqPath,
    focusProfiles: { profiles: {} },
    suggestionsCatalog: opts.suggestionsCatalog ?? {},
    embedEnabled: false,
    backendFactory: () => new FixtureBackend(),
  });
}

async function reload(agg: Aggregator): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/reload', {});
  assert.equal(result.isError, undefined, `reload must not return isError, got: ${JSON.stringify(result.content)}`);
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

// ── GF-1: added[] entries are non-empty strings ──────────────────────────────

test('GF-1: added[] entries are non-empty strings when servers are added', async () => {
  const { configPath, dlqPath } = tempPaths();
  const initial = [makeServer('alpha')];
  writeConfig(configPath, initial);
  const agg = makeAgg(initial, configPath, dlqPath);
  try {
    writeConfig(configPath, [makeServer('alpha'), makeServer('beta')]);
    const body = await reload(agg);
    const added = body.added as unknown[];
    assert.ok(Array.isArray(added), 'added must be an array');
    assert.ok(added.length >= 1, 'added must be non-empty when servers are added');
    for (const entry of added) {
      assert.equal(typeof entry, 'string', `each added[] entry must be a string, got ${typeof entry}: ${JSON.stringify(entry)}`);
      assert.ok((entry as string).length > 0, `each added[] entry must be non-empty, got "${entry}"`);
    }
    assert.ok((added as string[]).includes('beta'), `added[] must contain 'beta', got ${JSON.stringify(added)}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GF-2: removed[] entries are non-empty strings ────────────────────────────

test('GF-2: removed[] entries are non-empty strings when servers are removed', async () => {
  const { configPath, dlqPath } = tempPaths();
  const initial = [makeServer('alpha'), makeServer('beta')];
  writeConfig(configPath, initial);
  const agg = makeAgg(initial, configPath, dlqPath);
  try {
    writeConfig(configPath, [makeServer('alpha')]);
    const body = await reload(agg);
    const removed = body.removed as unknown[];
    assert.ok(Array.isArray(removed), 'removed must be an array');
    assert.ok(removed.length >= 1, 'removed must be non-empty when servers are removed');
    for (const entry of removed) {
      assert.equal(typeof entry, 'string', `each removed[] entry must be a string, got ${typeof entry}: ${JSON.stringify(entry)}`);
      assert.ok((entry as string).length > 0, `each removed[] entry must be non-empty, got "${entry}"`);
    }
    assert.ok((removed as string[]).includes('beta'), `removed[] must contain 'beta', got ${JSON.stringify(removed)}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GF-3: added[] and removed[] are empty arrays on a no-change reload ────────

test('GF-3: added[] and removed[] are empty arrays on no-change reload', async () => {
  const { configPath, dlqPath } = tempPaths();
  const initial = [makeServer('alpha')];
  writeConfig(configPath, initial);
  const agg = makeAgg(initial, configPath, dlqPath);
  try {
    const body = await reload(agg);
    const added = body.added as unknown[];
    const removed = body.removed as unknown[];
    assert.ok(Array.isArray(added), 'added must be an array on no-change reload');
    assert.ok(Array.isArray(removed), 'removed must be an array on no-change reload');
    assert.equal(added.length, 0, `added must be empty on no-change reload, got ${JSON.stringify(added)}`);
    assert.equal(removed.length, 0, `removed must be empty on no-change reload, got ${JSON.stringify(removed)}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GF-4: missingEnvVars[] entry shape is {serverId, vars} ───────────────────

test('GF-4: missingEnvVars[] entry shape is { serverId: string, vars: string[] }', async () => {
  const MISSING_VAR = 'CH1TTY_GF_TEST_NEVER_SET_12345';
  // Ensure the env var is not set in this process.
  assert.equal(process.env[MISSING_VAR], undefined, `pre-condition: ${MISSING_VAR} must not be set in process.env`);

  const { configPath, dlqPath } = tempPaths();
  const serverWithMissingEnv = makeServer('ghost', { envHeaders: { 'X-Ghost-Header': MISSING_VAR } });
  const initial = [serverWithMissingEnv];
  writeConfig(configPath, initial);
  const agg = makeAgg(initial, configPath, dlqPath);
  try {
    const body = await reload(agg);
    const missingEnvVars = body.missingEnvVars as unknown[];
    assert.ok(Array.isArray(missingEnvVars), 'missingEnvVars must be an array');
    assert.ok(missingEnvVars.length >= 1, 'missingEnvVars must be non-empty when an env var is unset');

    for (const entry of missingEnvVars) {
      assert.ok(entry !== null && typeof entry === 'object' && !Array.isArray(entry),
        `each missingEnvVars[] entry must be an object, got ${typeof entry}: ${JSON.stringify(entry)}`);
      const e = entry as Record<string, unknown>;

      // Exactly 2 keys: serverId and vars
      const keys = Object.keys(e).sort();
      assert.deepEqual(keys, ['serverId', 'vars'],
        `missingEnvVars entry must have exactly keys {serverId, vars}, got ${JSON.stringify(keys)}`);

      // serverId is a non-empty string
      assert.equal(typeof e.serverId, 'string',
        `missingEnvVars entry.serverId must be a string, got ${typeof e.serverId}`);
      assert.ok((e.serverId as string).length > 0,
        `missingEnvVars entry.serverId must be non-empty, got "${e.serverId}"`);

      // vars is an array
      assert.ok(Array.isArray(e.vars),
        `missingEnvVars entry.vars must be an array, got ${typeof e.vars}`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GF-5: missingEnvVars[] entry vars[] elements are non-empty strings ────────

test('GF-5: missingEnvVars[] entry vars[] elements are non-empty strings (env var names)', async () => {
  const MISSING_VAR = 'CH1TTY_GF_TEST_NEVER_SET_99999';
  assert.equal(process.env[MISSING_VAR], undefined, `pre-condition: ${MISSING_VAR} must not be set in process.env`);

  const { configPath, dlqPath } = tempPaths();
  const serverWithMissingEnv = makeServer('ghost2', { envHeaders: { 'X-Ghost-Header': MISSING_VAR } });
  writeConfig(configPath, [serverWithMissingEnv]);
  const agg = makeAgg([serverWithMissingEnv], configPath, dlqPath);
  try {
    const body = await reload(agg);
    const missingEnvVars = body.missingEnvVars as Array<{ serverId: string; vars: unknown[] }>;
    assert.ok(missingEnvVars.length >= 1, 'missingEnvVars must be non-empty for this test to exercise vars[]');

    for (const entry of missingEnvVars) {
      for (const varName of entry.vars) {
        assert.equal(typeof varName, 'string',
          `each missingEnvVars entry.vars element must be a string, got ${typeof varName}: ${JSON.stringify(varName)}`);
        assert.ok((varName as string).length > 0,
          `each missingEnvVars entry.vars element must be non-empty, got "${varName}"`);
      }
      assert.ok(entry.vars.length >= 1,
        `missingEnvVars entry.vars must be non-empty when env var is unset (serverId=${entry.serverId})`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GF-6: catalog.phantomServerIds[] entries are non-empty strings ────────────

test('GF-6: catalog.phantomServerIds[] entries are non-empty strings when phantom servers exist', async () => {
  const { configPath, dlqPath } = tempPaths();
  const initial = [makeServer('real-server')];
  writeConfig(configPath, initial);

  // A suggestions catalog that references a server not in the config — creating a phantom.
  const suggestionsCatalog = {
    code: {
      description: 'Code combos',
      combos: [
        {
          name: 'ghost combo',
          chain: ['phantom-server/some_tool', 'real-server/another_tool'],
          accomplishes: 'tests phantom detection',
          verified: false,
        },
      ],
      prompts: [],
    },
  };

  const agg = makeAgg(initial, configPath, dlqPath, { suggestionsCatalog });
  try {
    const body = await reload(agg);
    const catalog = body.catalog as Record<string, unknown>;
    const phantomServerIds = catalog.phantomServerIds as unknown[];
    assert.ok(Array.isArray(phantomServerIds), 'catalog.phantomServerIds must be an array');
    assert.ok(phantomServerIds.length >= 1,
      `catalog.phantomServerIds must be non-empty when a combo chain references a missing server, got ${JSON.stringify(phantomServerIds)}`);
    for (const entry of phantomServerIds) {
      assert.equal(typeof entry, 'string',
        `each catalog.phantomServerIds entry must be a string, got ${typeof entry}: ${JSON.stringify(entry)}`);
      assert.ok((entry as string).length > 0,
        `each catalog.phantomServerIds entry must be non-empty, got "${entry}"`);
    }
    assert.ok((phantomServerIds as string[]).includes('phantom-server'),
      `catalog.phantomServerIds must contain 'phantom-server', got ${JSON.stringify(phantomServerIds)}`);
  } finally {
    await agg.shutdown();
  }
});
