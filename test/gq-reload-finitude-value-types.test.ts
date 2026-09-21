/**
 * GQ drift guard: freeze ch1tty/reload VALUE-TYPE constraints missed by EE.
 *
 * EE froze the reload response SHAPE (key sets, field presence, Array.isArray,
 * typeof checks) and some basic range checks (>= 0, Number.isInteger for totalServers).
 * GF (pending) froze the array-element value types (added/removed items are non-empty
 * strings, missingEnvVars entry shape, phantomServerIds items).
 *
 * Neither EE nor GF freezes the FINITUDE of floating-point fields.  A latencyMs of
 * Infinity or NaN, or a catalog.totalCombos of Infinity or NaN, satisfies both
 * `typeof === 'number'` and `>= 0` — they would slip through the existing guards.
 *
 * GQ closes those gaps:
 *
 *   GQ-1  latencyMs is a finite non-NaN number (Number.isFinite, rules out Infinity / NaN)
 *   GQ-2  catalog.totalCombos is a finite non-NaN number (Number.isFinite)
 *   GQ-3  catalog.totalCombos is a non-negative integer (Number.isInteger && >= 0)
 *          — a float like 1.5 or a truncated float like 0.9 would pass EE's >= 0 check
 *   GQ-4  catalog.totalCombos is 0 when the suggestions catalog is explicitly empty
 *          — confirms the zero path: an empty catalog ({}) produces exactly 0, not a
 *            stale/cached value from a previous run
 *   GQ-5  catalog.totalCombos is positive when the default suggestions catalog is loaded
 *          — confirms the non-zero path: the default catalog file loads real combos;
 *            a stuck-at-zero counter would silently suppress cross-server cast suggestions
 *
 * Frozen 2026-09-21.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (reload, not cast explain)
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Aggregator } from '../src/aggregator.js';
import { FixtureBackend } from './fixture-backend.js';
import type { ServersConfig, ServerConfig } from '../src/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const testDirs: string[] = [];

after(() => {
  for (const dir of testDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempPaths(): { configPath: string; dlqPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-gq-'));
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
    lazy: true,
  };
}

function buildAgg(
  initialServers: ServerConfig[],
  configPath: string,
  dlqPath: string,
  opts: { emptyCatalog?: boolean } = {},
): Aggregator {
  const backend = new FixtureBackend();
  return new Aggregator(initialServers, {
    backendFactory: () => backend,
    embedEnabled: false,
    configPath,
    ledgerDlqPath: dlqPath,
    ...(opts.emptyCatalog ? { suggestionsCatalog: {} } : {}),
  });
}

async function reload(agg: Aggregator): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/reload', {});
  assert.equal(result.isError, undefined, `reload must not return isError, got: ${JSON.stringify(result)}`);
  const text = (result.content[0] as { text: string }).text;
  return JSON.parse(text) as Record<string, unknown>;
}

// ── GQ-1: latencyMs is finite ─────────────────────────────────────────────────

test('GQ-1: reload latencyMs is a finite non-NaN number', async () => {
  const { configPath, dlqPath } = tempPaths();
  const servers = [makeServer('alpha')];
  writeConfig(configPath, servers);
  const agg = buildAgg(servers, configPath, dlqPath, { emptyCatalog: true });
  try {
    const body = await reload(agg);
    const latencyMs = body['latencyMs'];
    assert.equal(
      typeof latencyMs,
      'number',
      `latencyMs must be a number, got ${typeof latencyMs}`,
    );
    assert.ok(
      Number.isFinite(latencyMs as number),
      `latencyMs must be finite (not Infinity or NaN), got ${latencyMs}`,
    );
    assert.ok(
      (latencyMs as number) >= 0,
      `latencyMs must be non-negative, got ${latencyMs}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GQ-2: catalog.totalCombos is finite ───────────────────────────────────────

test('GQ-2: reload catalog.totalCombos is a finite non-NaN number', async () => {
  const { configPath, dlqPath } = tempPaths();
  const servers = [makeServer('alpha'), makeServer('beta')];
  writeConfig(configPath, servers);
  const agg = buildAgg(servers, configPath, dlqPath, { emptyCatalog: true });
  try {
    const body = await reload(agg);
    const catalog = body['catalog'] as Record<string, unknown>;
    const totalCombos = catalog['totalCombos'];
    assert.equal(
      typeof totalCombos,
      'number',
      `catalog.totalCombos must be a number, got ${typeof totalCombos}`,
    );
    assert.ok(
      Number.isFinite(totalCombos as number),
      `catalog.totalCombos must be finite (not Infinity or NaN), got ${totalCombos}`,
    );
    assert.ok(
      (totalCombos as number) >= 0,
      `catalog.totalCombos must be non-negative, got ${totalCombos}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GQ-3: catalog.totalCombos is an integer ───────────────────────────────────

test('GQ-3: reload catalog.totalCombos is a non-negative integer (not a float)', async () => {
  const { configPath, dlqPath } = tempPaths();
  const servers = [makeServer('alpha'), makeServer('beta')];
  writeConfig(configPath, servers);
  const agg = buildAgg(servers, configPath, dlqPath, { emptyCatalog: true });
  try {
    const body = await reload(agg);
    const catalog = body['catalog'] as Record<string, unknown>;
    const totalCombos = catalog['totalCombos'];
    assert.ok(
      Number.isInteger(totalCombos),
      `catalog.totalCombos must be an integer (no floats like 1.5), got ${totalCombos}`,
    );
    assert.ok(
      (totalCombos as number) >= 0,
      `catalog.totalCombos must be non-negative, got ${totalCombos}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GQ-4: catalog.totalCombos is 0 when catalog is explicitly empty ───────────

test('GQ-4: catalog.totalCombos is 0 when suggestions catalog is explicitly empty', async () => {
  const { configPath, dlqPath } = tempPaths();
  const servers = [makeServer('alpha'), makeServer('beta')];
  writeConfig(configPath, servers);
  const agg = buildAgg(servers, configPath, dlqPath, { emptyCatalog: true });
  try {
    const body = await reload(agg);
    const catalog = body['catalog'] as Record<string, unknown>;
    const totalCombos = catalog['totalCombos'];
    assert.equal(
      totalCombos,
      0,
      `catalog.totalCombos must be 0 when suggestions catalog is empty ({}), got ${totalCombos}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GQ-5: catalog.totalCombos is positive when default catalog is loaded ──────

test('GQ-5: catalog.totalCombos is positive when default suggestions catalog is loaded', async () => {
  const { configPath, dlqPath } = tempPaths();
  const servers = [makeServer('alpha'), makeServer('beta')];
  writeConfig(configPath, servers);
  // no emptyCatalog: loads the default suggestions-catalog.json which has real combos
  const agg = buildAgg(servers, configPath, dlqPath);
  try {
    const body = await reload(agg);
    const catalog = body['catalog'] as Record<string, unknown>;
    const totalCombos = catalog['totalCombos'];
    assert.ok(
      (totalCombos as number) > 0,
      `catalog.totalCombos must be positive when default catalog is loaded (file has real combos), got ${totalCombos}`,
    );
  } finally {
    await agg.shutdown();
  }
});
