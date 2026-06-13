/**
 * Tests for the catalog freshness check added to ch1tty/reload.
 *
 * After each reload, the response includes a `catalog` field that reports:
 *   - totalCombos: total combo count across all focus profiles in the catalog
 *   - phantomServerIds: server IDs referenced in combo chains but absent from
 *     the active servers.json config after the reload
 *
 * Uses an in-memory suggestionsCatalog so no disk catalog file is needed.
 */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { Aggregator } from '../src/aggregator.js';
import type { ServersConfig, ServerConfig } from '../src/types.js';
import type { FocusSuggestions } from '../src/suggestions.js';
import { FixtureBackend } from './fixture-backend.js';

const testDirs: string[] = [];

function tempFiles(): { configPath: string; dlqPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-freshness-'));
  testDirs.push(dir);
  return {
    configPath: join(dir, 'servers.json'),
    dlqPath: join(dir, 'ledger.dlq.jsonl'),
  };
}

after(() => {
  for (const dir of testDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeConfig(path: string, servers: ServerConfig[]): void {
  const cfg: ServersConfig = { servers };
  writeFileSync(path, JSON.stringify(cfg, null, 2), 'utf8');
}

function makeServer(id: string): ServerConfig {
  return { id, name: id, type: 'remote', access: 'readwrite', category: 'code', endpoint: `https://fixture.test/${id}` };
}

function makeCombo(chain: string[]) {
  return { name: `test-${chain[0]}`, chain, accomplishes: 'test', verified: true };
}

function makePrompt(text: string) {
  return { text, resolves_to: 'test/tool' };
}

function buildAgg(
  servers: ServerConfig[],
  configPath: string,
  dlqPath: string,
  catalog: Record<string, FocusSuggestions>,
): Aggregator {
  const fb = new FixtureBackend();
  return new Aggregator(servers, {
    configPath,
    ledgerDlqPath: dlqPath,
    focusProfiles: { profiles: {} },
    suggestionsCatalog: catalog,
    backendFactory: () => fb,
  });
}

// ── 1. empty catalog → totalCombos 0, phantomServerIds [] ────────────────────

test('reload with empty catalog reports totalCombos:0 and phantomServerIds:[]', async () => {
  const { configPath, dlqPath } = tempFiles();
  const servers = [makeServer('alpha')];
  writeConfig(configPath, servers);

  const agg = buildAgg(servers, configPath, dlqPath, {});
  const result = await agg.callTool('ch1tty/reload');

  assert.equal(result.isError, undefined);
  const data = JSON.parse((result.content[0] as { text: string }).text);
  assert.ok('catalog' in data, 'reload response has catalog field');
  assert.equal(data.catalog.totalCombos, 0);
  assert.deepEqual(data.catalog.phantomServerIds, []);
});

// ── 2. catalog references only configured servers → no phantoms ───────────────

test('reload with catalog referencing only configured server IDs reports no phantoms', async () => {
  const { configPath, dlqPath } = tempFiles();
  const servers = [makeServer('alpha'), makeServer('beta')];
  writeConfig(configPath, servers);

  const catalog: Record<string, FocusSuggestions> = {
    finance: {
      description: 'finance',
      combos: [makeCombo(['alpha/list', 'beta/query'])],
      prompts: [makePrompt('list alpha records')],
    },
  };

  const agg = buildAgg(servers, configPath, dlqPath, catalog);
  const result = await agg.callTool('ch1tty/reload');

  assert.equal(result.isError, undefined);
  const data = JSON.parse((result.content[0] as { text: string }).text);
  assert.deepEqual(data.catalog.phantomServerIds, []);
  assert.equal(data.catalog.totalCombos, 1);
});

// ── 3. catalog references an unknown server → phantom reported ────────────────

test('reload reports phantom server ID from catalog combo chain', async () => {
  const { configPath, dlqPath } = tempFiles();
  const servers = [makeServer('alpha')];
  writeConfig(configPath, servers);

  const catalog: Record<string, FocusSuggestions> = {
    finance: {
      description: 'finance',
      combos: [makeCombo(['alpha/list', 'ghost-server/query'])],
      prompts: [],
    },
  };

  const agg = buildAgg(servers, configPath, dlqPath, catalog);
  const result = await agg.callTool('ch1tty/reload');

  assert.equal(result.isError, undefined);
  const data = JSON.parse((result.content[0] as { text: string }).text);
  assert.ok(
    data.catalog.phantomServerIds.includes('ghost-server'),
    'ghost-server should be in phantomServerIds',
  );
});

// ── 4. totalCombos sums across all focus profiles ─────────────────────────────

test('catalog.totalCombos is the sum of combos across all focus profiles', async () => {
  const { configPath, dlqPath } = tempFiles();
  const servers = [makeServer('svc')];
  writeConfig(configPath, servers);

  const catalog: Record<string, FocusSuggestions> = {
    finance: {
      description: 'finance',
      combos: [makeCombo(['svc/a']), makeCombo(['svc/b'])],
      prompts: [],
    },
    code: {
      description: 'code',
      combos: [makeCombo(['svc/c'])],
      prompts: [],
    },
  };

  const agg = buildAgg(servers, configPath, dlqPath, catalog);
  const result = await agg.callTool('ch1tty/reload');

  const data = JSON.parse((result.content[0] as { text: string }).text);
  assert.equal(data.catalog.totalCombos, 3);
});

// ── 5. phantomServerIds is sorted alphabetically ─────────────────────────────

test('catalog.phantomServerIds is sorted alphabetically', async () => {
  const { configPath, dlqPath } = tempFiles();
  const servers = [makeServer('real')];
  writeConfig(configPath, servers);

  const catalog: Record<string, FocusSuggestions> = {
    finance: {
      description: 'finance',
      combos: [makeCombo(['zebra-svc/x', 'apple-svc/y', 'mango-svc/z'])],
      prompts: [],
    },
  };

  const agg = buildAgg(servers, configPath, dlqPath, catalog);
  const result = await agg.callTool('ch1tty/reload');

  const data = JSON.parse((result.content[0] as { text: string }).text);
  assert.deepEqual(data.catalog.phantomServerIds, ['apple-svc', 'mango-svc', 'zebra-svc']);
});

// ── 6. multiple phantom server IDs all reported (deduplicated) ────────────────

test('multiple phantom server IDs are deduplicated and all reported', async () => {
  const { configPath, dlqPath } = tempFiles();
  const servers = [makeServer('real')];
  writeConfig(configPath, servers);

  // ghost-a appears in two combos; should appear once in phantomServerIds
  const catalog: Record<string, FocusSuggestions> = {
    finance: {
      description: 'finance',
      combos: [
        makeCombo(['ghost-a/tool1', 'real/query']),
        makeCombo(['ghost-a/tool2', 'ghost-b/exec']),
      ],
      prompts: [],
    },
  };

  const agg = buildAgg(servers, configPath, dlqPath, catalog);
  const result = await agg.callTool('ch1tty/reload');

  const data = JSON.parse((result.content[0] as { text: string }).text);
  assert.deepEqual(data.catalog.phantomServerIds, ['ghost-a', 'ghost-b']);
  assert.equal(data.catalog.totalCombos, 2);
});

// ── 7. catalog key present even when config is unchanged ─────────────────────

test('reload response always includes catalog key regardless of config changes', async () => {
  const { configPath, dlqPath } = tempFiles();
  const servers = [makeServer('svc')];
  writeConfig(configPath, servers);

  const catalog: Record<string, FocusSuggestions> = {
    ops: {
      description: 'ops',
      combos: [makeCombo(['svc/deploy'])],
      prompts: [makePrompt('deploy service')],
    },
  };

  const agg = buildAgg(servers, configPath, dlqPath, catalog);
  // Re-write same config to disk (identical reload)
  writeConfig(configPath, servers);
  const result = await agg.callTool('ch1tty/reload');

  assert.equal(result.isError, undefined);
  const data = JSON.parse((result.content[0] as { text: string }).text);
  assert.equal(data.reloaded, true);
  assert.ok('catalog' in data, 'catalog key present on unchanged reload');
  assert.equal(data.catalog.totalCombos, 1);
  assert.deepEqual(data.catalog.phantomServerIds, []);
});
