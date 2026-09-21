/**
 * EE: Drift guard — ch1tty/reload response shape.
 *
 * ch1tty/reload has two code paths:
 *
 * ── Path A: Success (configPath set) ────────────────────────────────────────
 * Top-level always-present: reloaded, added, removed, totalServers, catalog,
 *                           missingEnvVars, latencyMs
 * catalog always-present:   totalCombos, phantomServerIds
 *
 * ── Path B: Error (no configPath, or parse failure) ──────────────────────
 * isError: true, single text content item
 *
 * No test previously froze the complete reload response shape; individual tests
 * only checked specific fields (added/removed counts, catalog fields). A rename
 * like latencyMs → elapsedMs or missingEnvVars → envWarnings would silently
 * break API clients. This guard catches renames and removals of top-level and
 * catalog fields.
 *
 * Frozen 2026-09-19.
 */
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Aggregator } from '../src/aggregator.js';
import { FixtureBackend } from './fixture-backend.js';
import type { ServersConfig, ServerConfig } from '../src/types.js';

// ── Canonical field sets (sorted alphabetically) ──────────────────────────────

const RELOAD_REQUIRED: readonly string[] = [
  'added',
  'catalog',
  'latencyMs',
  'missingEnvVars',
  'reloaded',
  'removed',
  'totalServers',
];

const CATALOG_FRESHNESS_FIELDS: readonly string[] = ['phantomServerIds', 'totalCombos'];

// ── Helpers ───────────────────────────────────────────────────────────────────

const testDirs: string[] = [];

after(() => {
  for (const dir of testDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempPaths(): { configPath: string; dlqPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-ee-'));
  testDirs.push(dir);
  return {
    configPath: join(dir, 'servers.json'),
    dlqPath: join(dir, 'ledger.dlq.jsonl'),
  };
}

function writeConfig(path: string, servers: ServerConfig[]): void {
  const cfg: ServersConfig = { servers };
  writeFileSync(path, JSON.stringify(cfg), 'utf8');
}

function makeServer(id: string): ServerConfig {
  return {
    id,
    name: id,
    type: 'remote',
    access: 'readwrite',
    category: 'code',
    endpoint: `https://fixture.test/${id}`,
  };
}

function buildAgg(initialServers: ServerConfig[], configPath: string, dlqPath: string): Aggregator {
  return new Aggregator(initialServers, {
    configPath,
    ledgerDlqPath: dlqPath,
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    backendFactory: () => new FixtureBackend(),
  });
}

async function reload(agg: Aggregator): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/reload', {});
  assert.equal(result.isError, undefined, `ch1tty/reload must not return isError on success, got: ${JSON.stringify(result.content)}`);
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

// ── Suite 1: Structural invariants ────────────────────────────────────────────

describe('EE — ch1tty/reload structural invariants', () => {
  test('content is an array', async () => {
    const { configPath, dlqPath } = tempPaths();
    const servers = [makeServer('alpha')];
    writeConfig(configPath, servers);
    const agg = buildAgg(servers, configPath, dlqPath);
    try {
      const result = await agg.callTool('ch1tty/reload', {});
      assert.ok(Array.isArray(result.content), 'content must be an array');
    } finally {
      await agg.shutdown();
    }
  });

  test('success response has exactly one content item', async () => {
    const { configPath, dlqPath } = tempPaths();
    const servers = [makeServer('alpha')];
    writeConfig(configPath, servers);
    const agg = buildAgg(servers, configPath, dlqPath);
    try {
      const result = await agg.callTool('ch1tty/reload', {});
      assert.equal(result.content.length, 1, 'success reload must have exactly one content item');
    } finally {
      await agg.shutdown();
    }
  });

  test('success response content item has type:text', async () => {
    const { configPath, dlqPath } = tempPaths();
    const servers = [makeServer('alpha')];
    writeConfig(configPath, servers);
    const agg = buildAgg(servers, configPath, dlqPath);
    try {
      const result = await agg.callTool('ch1tty/reload', {});
      const item = result.content[0] as Record<string, unknown>;
      assert.equal(item['type'], 'text', 'content item must have type:text');
    } finally {
      await agg.shutdown();
    }
  });

  test('success response text is valid JSON', async () => {
    const { configPath, dlqPath } = tempPaths();
    const servers = [makeServer('alpha')];
    writeConfig(configPath, servers);
    const agg = buildAgg(servers, configPath, dlqPath);
    try {
      const result = await agg.callTool('ch1tty/reload', {});
      const text = (result.content[0] as { text: string }).text;
      assert.doesNotThrow(() => JSON.parse(text), 'success reload text must be valid JSON');
    } finally {
      await agg.shutdown();
    }
  });

  test('isError absent on success', async () => {
    const { configPath, dlqPath } = tempPaths();
    const servers = [makeServer('alpha')];
    writeConfig(configPath, servers);
    const agg = buildAgg(servers, configPath, dlqPath);
    try {
      const result = await agg.callTool('ch1tty/reload', {});
      assert.equal(result.isError, undefined, 'isError must be absent on successful reload');
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 2: Success response top-level shape ─────────────────────────────────

describe('EE — ch1tty/reload success response top-level shape', () => {
  test('all required top-level keys present', async () => {
    const { configPath, dlqPath } = tempPaths();
    const servers = [makeServer('alpha')];
    writeConfig(configPath, servers);
    const agg = buildAgg(servers, configPath, dlqPath);
    try {
      const body = await reload(agg);
      const actual = Object.keys(body).sort();
      const missing = RELOAD_REQUIRED.filter((k) => !actual.includes(k));
      assert.deepEqual(missing, [], `Missing required reload keys: ${missing.join(', ')}`);
    } finally {
      await agg.shutdown();
    }
  });

  test('no unexpected top-level keys in reload response', async () => {
    const { configPath, dlqPath } = tempPaths();
    const servers = [makeServer('alpha')];
    writeConfig(configPath, servers);
    const agg = buildAgg(servers, configPath, dlqPath);
    try {
      const body = await reload(agg);
      const actual = Object.keys(body).sort();
      const unexpected = actual.filter((k) => !RELOAD_REQUIRED.includes(k));
      assert.deepEqual(
        unexpected,
        [],
        `Unexpected keys in reload response (shape drift): ${unexpected.join(', ')}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('reloaded is boolean true on success', async () => {
    const { configPath, dlqPath } = tempPaths();
    const servers = [makeServer('alpha')];
    writeConfig(configPath, servers);
    const agg = buildAgg(servers, configPath, dlqPath);
    try {
      const body = await reload(agg);
      assert.strictEqual(body['reloaded'], true, 'reloaded must be boolean true on success');
    } finally {
      await agg.shutdown();
    }
  });

  test('added is an array', async () => {
    const { configPath, dlqPath } = tempPaths();
    const servers = [makeServer('alpha')];
    writeConfig(configPath, servers);
    const agg = buildAgg(servers, configPath, dlqPath);
    try {
      const body = await reload(agg);
      assert.ok(Array.isArray(body['added']), 'added must be an array');
    } finally {
      await agg.shutdown();
    }
  });

  test('removed is an array', async () => {
    const { configPath, dlqPath } = tempPaths();
    const servers = [makeServer('alpha')];
    writeConfig(configPath, servers);
    const agg = buildAgg(servers, configPath, dlqPath);
    try {
      const body = await reload(agg);
      assert.ok(Array.isArray(body['removed']), 'removed must be an array');
    } finally {
      await agg.shutdown();
    }
  });

  test('totalServers is a non-negative integer', async () => {
    const { configPath, dlqPath } = tempPaths();
    const servers = [makeServer('alpha')];
    writeConfig(configPath, servers);
    const agg = buildAgg(servers, configPath, dlqPath);
    try {
      const body = await reload(agg);
      assert.ok(
        typeof body['totalServers'] === 'number' &&
          Number.isInteger(body['totalServers']) &&
          (body['totalServers'] as number) >= 0,
        `totalServers must be a non-negative integer, got ${body['totalServers']}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('missingEnvVars is an array', async () => {
    const { configPath, dlqPath } = tempPaths();
    const servers = [makeServer('alpha')];
    writeConfig(configPath, servers);
    const agg = buildAgg(servers, configPath, dlqPath);
    try {
      const body = await reload(agg);
      assert.ok(Array.isArray(body['missingEnvVars']), 'missingEnvVars must be an array');
    } finally {
      await agg.shutdown();
    }
  });

  test('latencyMs is a non-negative number', async () => {
    const { configPath, dlqPath } = tempPaths();
    const servers = [makeServer('alpha')];
    writeConfig(configPath, servers);
    const agg = buildAgg(servers, configPath, dlqPath);
    try {
      const body = await reload(agg);
      assert.ok(
        typeof body['latencyMs'] === 'number' && (body['latencyMs'] as number) >= 0,
        `latencyMs must be a non-negative number, got ${body['latencyMs']}`,
      );
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 3: catalog sub-object shape ─────────────────────────────────────────

describe('EE — ch1tty/reload catalog sub-object shape', () => {
  test('catalog has exactly 2 fields: totalCombos and phantomServerIds', async () => {
    const { configPath, dlqPath } = tempPaths();
    const servers = [makeServer('alpha')];
    writeConfig(configPath, servers);
    const agg = buildAgg(servers, configPath, dlqPath);
    try {
      const body = await reload(agg);
      const catalog = body['catalog'] as Record<string, unknown>;
      assert.ok(catalog && typeof catalog === 'object' && !Array.isArray(catalog), 'catalog must be an object');
      const actual = Object.keys(catalog).sort();
      assert.deepEqual(
        actual,
        CATALOG_FRESHNESS_FIELDS,
        `catalog fields have drifted.\nAdded: ${actual.filter((k) => !CATALOG_FRESHNESS_FIELDS.includes(k)).join(', ') || 'none'}\nRemoved: ${CATALOG_FRESHNESS_FIELDS.filter((k) => !actual.includes(k)).join(', ') || 'none'}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('catalog.totalCombos is a non-negative number', async () => {
    const { configPath, dlqPath } = tempPaths();
    const servers = [makeServer('alpha')];
    writeConfig(configPath, servers);
    const agg = buildAgg(servers, configPath, dlqPath);
    try {
      const body = await reload(agg);
      const catalog = body['catalog'] as Record<string, unknown>;
      assert.ok(
        typeof catalog['totalCombos'] === 'number' && (catalog['totalCombos'] as number) >= 0,
        `catalog.totalCombos must be a non-negative number, got ${catalog['totalCombos']}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('catalog.phantomServerIds is an array', async () => {
    const { configPath, dlqPath } = tempPaths();
    const servers = [makeServer('alpha')];
    writeConfig(configPath, servers);
    const agg = buildAgg(servers, configPath, dlqPath);
    try {
      const body = await reload(agg);
      const catalog = body['catalog'] as Record<string, unknown>;
      assert.ok(Array.isArray(catalog['phantomServerIds']), 'catalog.phantomServerIds must be an array');
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 4: Semantic correctness (added/removed) ─────────────────────────────

describe('EE — ch1tty/reload added/removed semantics', () => {
  test('added and removed are empty arrays when config is unchanged', async () => {
    const { configPath, dlqPath } = tempPaths();
    const servers = [makeServer('alpha')];
    writeConfig(configPath, servers);
    const agg = buildAgg(servers, configPath, dlqPath);
    try {
      const body = await reload(agg);
      assert.deepEqual(body['added'], [], 'added must be empty when config is unchanged');
      assert.deepEqual(body['removed'], [], 'removed must be empty when config is unchanged');
    } finally {
      await agg.shutdown();
    }
  });

  test('added contains new server id when config gains a server', async () => {
    const { configPath, dlqPath } = tempPaths();
    const initial = [makeServer('alpha')];
    writeConfig(configPath, initial);
    const agg = buildAgg(initial, configPath, dlqPath);
    try {
      writeConfig(configPath, [makeServer('alpha'), makeServer('beta')]);
      const body = await reload(agg);
      assert.ok(
        Array.isArray(body['added']) && (body['added'] as string[]).includes('beta'),
        `added must contain 'beta' when it is added to config, got ${JSON.stringify(body['added'])}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('removed contains dropped server id when config loses a server', async () => {
    const { configPath, dlqPath } = tempPaths();
    const initial = [makeServer('alpha'), makeServer('beta')];
    writeConfig(configPath, initial);
    const agg = buildAgg(initial, configPath, dlqPath);
    try {
      writeConfig(configPath, [makeServer('alpha')]);
      const body = await reload(agg);
      assert.ok(
        Array.isArray(body['removed']) && (body['removed'] as string[]).includes('beta'),
        `removed must contain 'beta' when it is removed from config, got ${JSON.stringify(body['removed'])}`,
      );
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 5: Error path shape ─────────────────────────────────────────────────

describe('EE — ch1tty/reload error path shape', () => {
  test('returns isError:true when no configPath is set', async () => {
    const agg = new Aggregator([], {
      embedEnabled: false,
      ledgerDlqPath: join(tmpdir(), `ch1tty-ee-err-${process.pid}-${Date.now()}.jsonl`),
      focusProfiles: { profiles: {} },
      suggestionsCatalog: {},
    });
    try {
      const result = await agg.callTool('ch1tty/reload', {});
      assert.equal(result.isError, true, 'reload without configPath must return isError:true');
    } finally {
      await agg.shutdown();
    }
  });

  test('error response has exactly one content item', async () => {
    const agg = new Aggregator([], {
      embedEnabled: false,
      ledgerDlqPath: join(tmpdir(), `ch1tty-ee-err2-${process.pid}-${Date.now()}.jsonl`),
      focusProfiles: { profiles: {} },
      suggestionsCatalog: {},
    });
    try {
      const result = await agg.callTool('ch1tty/reload', {});
      assert.equal(result.content.length, 1, 'error reload response must have exactly one content item');
    } finally {
      await agg.shutdown();
    }
  });

  test('error response content item has type:text', async () => {
    const agg = new Aggregator([], {
      embedEnabled: false,
      ledgerDlqPath: join(tmpdir(), `ch1tty-ee-err3-${process.pid}-${Date.now()}.jsonl`),
      focusProfiles: { profiles: {} },
      suggestionsCatalog: {},
    });
    try {
      const result = await agg.callTool('ch1tty/reload', {});
      const item = result.content[0] as Record<string, unknown>;
      assert.equal(item['type'], 'text', 'error reload content item must have type:text');
    } finally {
      await agg.shutdown();
    }
  });
});
