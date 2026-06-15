/**
 * WWWW: latencyMs in ch1tty/status and ch1tty/reload responses.
 *
 * Completes latency observability across all 5 meta-tools: search (RRRR),
 * execute (QQQQ), cast (LLLL) already have latencyMs; WWWW adds it to
 * status and reload.
 *
 * For ch1tty/status: latencyMs is the wall-clock time of getStatusSnapshot()
 * in ms — present in both full mode and short: true mode.
 * For ch1tty/reload: latencyMs covers the full reload operation (config parse
 * + backend rebuild + old-backend shutdown) — present in successful reloads.
 * Error responses (no configPath, invalid JSON) do not include latencyMs.
 *
 * Covered:
 *   WWWW-1: ch1tty/status full mode includes latencyMs as a number ≥ 0
 *   WWWW-2: ch1tty/status short: true mode includes latencyMs as a number ≥ 0
 *   WWWW-3: ch1tty/status latencyMs is at the top level of the JSON (not nested)
 *   WWWW-4: ch1tty/reload success response includes latencyMs as a number ≥ 0
 *   WWWW-5: ch1tty/reload latencyMs is present alongside all other reload fields
 *   WWWW-6: ch1tty/status tool description mentions latencyMs
 *   WWWW-7: ch1tty/reload tool description mentions latencyMs
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import test, { after } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig, ServersConfig } from '../src/types.js';

const testDirs: string[] = [];

function tempFiles(): { configPath: string; dlqPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-wwww-'));
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

function makeServer(id: string): ServerConfig {
  return { id, name: id, type: 'remote', access: 'readwrite', category: 'code', endpoint: `https://fixture.test/${id}` };
}

function writeConfig(path: string, servers: ServerConfig[]): void {
  const cfg: ServersConfig = { servers };
  writeFileSync(path, JSON.stringify(cfg, null, 2), 'utf8');
}

function makeSimpleAgg(dlqPath: string): Aggregator {
  const servers: ServerConfig[] = [makeServer('alpha'), makeServer('beta')];
  return new Aggregator(servers, { ledgerDlqPath: dlqPath });
}

function parseText(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  const item = result.content.find((c) => c.type === 'text');
  assert.ok(item?.text, 'Expected text content');
  return JSON.parse(item.text) as Record<string, unknown>;
}

// ── WWWW-1: ch1tty/status full mode latencyMs ────────────────────────────────

test('WWWW-1: ch1tty/status full mode includes latencyMs as a number >= 0', async () => {
  const { dlqPath } = tempFiles();
  const agg = makeSimpleAgg(dlqPath);
  try {
    const result = await agg.callTool('ch1tty/status', {});
    const snap = parseText(result);
    assert.ok('latencyMs' in snap, 'latencyMs must be present in full-mode status response');
    assert.equal(typeof snap.latencyMs, 'number', 'latencyMs must be a number');
    assert.ok((snap.latencyMs as number) >= 0, 'latencyMs must be >= 0');
  } finally {
    await agg.shutdown();
  }
});

// ── WWWW-2: ch1tty/status short mode latencyMs ───────────────────────────────

test('WWWW-2: ch1tty/status short: true mode includes latencyMs as a number >= 0', async () => {
  const { dlqPath } = tempFiles();
  const agg = makeSimpleAgg(dlqPath);
  try {
    const result = await agg.callTool('ch1tty/status', { short: true });
    const snap = parseText(result);
    assert.ok('latencyMs' in snap, 'latencyMs must be present in short-mode status response');
    assert.equal(typeof snap.latencyMs, 'number', 'latencyMs must be a number');
    assert.ok((snap.latencyMs as number) >= 0, 'latencyMs must be >= 0');
  } finally {
    await agg.shutdown();
  }
});

// ── WWWW-3: ch1tty/status latencyMs at top level ─────────────────────────────

test('WWWW-3: ch1tty/status latencyMs is at the top level of the JSON response', async () => {
  const { dlqPath } = tempFiles();
  const agg = makeSimpleAgg(dlqPath);
  try {
    const fullResult = await agg.callTool('ch1tty/status', {});
    const fullSnap = parseText(fullResult);
    assert.ok('latencyMs' in fullSnap, 'latencyMs at top level in full mode');
    assert.ok('systemHealth' in fullSnap, 'systemHealth also present (latencyMs is additive)');
    assert.ok(!('latencyMs' in (fullSnap.systemHealth as Record<string, unknown>)), 'latencyMs is not nested inside systemHealth');

    const shortResult = await agg.callTool('ch1tty/status', { short: true });
    const shortSnap = parseText(shortResult);
    assert.ok('latencyMs' in shortSnap, 'latencyMs at top level in short mode');
    assert.equal('servers' in shortSnap, false, 'servers still omitted in short mode');
  } finally {
    await agg.shutdown();
  }
});

// ── WWWW-4: ch1tty/reload success latencyMs ──────────────────────────────────

test('WWWW-4: ch1tty/reload success response includes latencyMs as a number >= 0', async () => {
  const { configPath, dlqPath } = tempFiles();
  const servers = [makeServer('alpha')];
  writeConfig(configPath, servers);
  const agg = new Aggregator(servers, { configPath, ledgerDlqPath: dlqPath });
  try {
    const result = await agg.callTool('ch1tty/reload');
    const data = parseText(result);
    assert.ok('latencyMs' in data, 'latencyMs must be present in reload success response');
    assert.equal(typeof data.latencyMs, 'number', 'latencyMs must be a number');
    assert.ok((data.latencyMs as number) >= 0, 'latencyMs must be >= 0');
  } finally {
    await agg.shutdown();
  }
});

// ── WWWW-5: ch1tty/reload latencyMs alongside all other reload fields ─────────

test('WWWW-5: ch1tty/reload latencyMs is present alongside reloaded, added, removed, totalServers, catalog', async () => {
  const { configPath, dlqPath } = tempFiles();
  const servers = [makeServer('alpha'), makeServer('beta')];
  writeConfig(configPath, servers);
  const agg = new Aggregator(servers, { configPath, ledgerDlqPath: dlqPath });
  try {
    // Add a third server on disk before reloading
    writeConfig(configPath, [...servers, makeServer('gamma')]);
    const result = await agg.callTool('ch1tty/reload');
    const data = parseText(result);
    assert.equal(data.reloaded, true, 'reloaded field present');
    assert.ok(Array.isArray(data.added), 'added field present');
    assert.ok(Array.isArray(data.removed), 'removed field present');
    assert.equal(typeof data.totalServers, 'number', 'totalServers field present');
    assert.ok('catalog' in data, 'catalog field present');
    assert.ok('latencyMs' in data, 'latencyMs field present alongside all other fields');
    assert.ok((data.latencyMs as number) >= 0, 'latencyMs is a valid non-negative number');
  } finally {
    await agg.shutdown();
  }
});

// ── WWWW-6: ch1tty/status description mentions latencyMs ─────────────────────

test('WWWW-6: ch1tty/status tool description mentions latencyMs', async () => {
  const { dlqPath } = tempFiles();
  const agg = makeSimpleAgg(dlqPath);
  try {
    const { tools } = await agg.listAllTools();
    const statusTool = tools.find((t) => t.name === 'ch1tty/status');
    assert.ok(statusTool, 'ch1tty/status tool must be present in meta-tool list');
    assert.ok(
      statusTool.description?.includes('latencyMs'),
      `ch1tty/status description must mention latencyMs; got: "${statusTool.description}"`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── WWWW-7: ch1tty/reload description mentions latencyMs ─────────────────────

test('WWWW-7: ch1tty/reload tool description mentions latencyMs', async () => {
  const { dlqPath } = tempFiles();
  const agg = makeSimpleAgg(dlqPath);
  try {
    const { tools } = await agg.listAllTools();
    const reloadTool = tools.find((t) => t.name === 'ch1tty/reload');
    assert.ok(reloadTool, 'ch1tty/reload tool must be present in meta-tool list');
    assert.ok(
      reloadTool.description?.includes('latencyMs'),
      `ch1tty/reload description must mention latencyMs; got: "${reloadTool.description}"`,
    );
  } finally {
    await agg.shutdown();
  }
});
