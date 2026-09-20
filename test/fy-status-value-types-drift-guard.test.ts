/**
 * FY drift guard: freeze ch1tty/status top-level and sub-object VALUE TYPES.
 *
 * DZ froze the exact KEY SETS for the status response at top level and all
 * first-tier sub-objects. ED froze the nested coordinator/brain/ledger shapes.
 * Neither DZ nor ED asserts VALUE TYPES or CONSTRAINTS — a field could change
 * from number to string, from boolean to 0/1, or a status enum could accept
 * an unrecognised value without failing either DZ or ED.
 *
 * FY closes that gap by asserting type and constraint for every primitive in
 * the status envelope, across two call paths:
 *
 *   FY-1  no-focus status — top-level primitive types and constraints
 *   FY-2  no-focus status — systemHealth field value types
 *   FY-3  no-focus status — brainHealth field value types
 *   FY-4  no-focus status — ledgerHealth field value types and constraints
 *   FY-5  no-focus status — ledgerDlq field value types
 *   FY-6  no-focus status — catalog field value types
 *   FY-7  no-focus status — focus field is null when no focus active
 *   FY-8  active-focus status — focus field is object with expected types
 *   FY-9  active-focus status — catalog.activeFocusSuggestions non-null, typed
 *   FY-10 no-focus status — servers[] entry primitive value types
 *   FY-11 no-focus status — latencyMs present and non-negative
 *   FY-12 no-focus status — availableFocusProfiles is a string array
 *
 * Frozen 2026-09-20.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only)
 *   - buildCastExplanation metric freeze: not applicable (status, not cast)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import type { FocusProfiles } from '../src-stdio/focus.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

const CONFIGS: ServerConfig[] = [
  { id: 'neon',   name: 'Neon',   type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.tech/mcp',       lazy: true },
  { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp',       lazy: true },
];

const FOCUS_PROFILES: FocusProfiles = {
  profiles: {
    code: { description: 'Code tools', categories: ['code' as const], servers: ['neon'], boost: 0.5 },
  },
};

let _seq = 0;
function makeAgg(withFocus: boolean): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon',   FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  const opts: Record<string, unknown> = {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: join(tmpdir(), `ch1tty-fy-${Date.now()}-${++_seq}.jsonl`),
    focusProfiles: FOCUS_PROFILES,
  };
  if (withFocus) {
    opts.focus = 'code';
  }
  return new Aggregator(CONFIGS, opts as Parameters<typeof Aggregator.prototype.callTool>[1]);
}

async function getStatus(agg: Aggregator, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/status', args);
  assert.equal(result.isError, undefined, 'status must not error');
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

// ── FY-1: top-level primitive types ──────────────────────────────────────────

test('FY-1: ch1tty/status no-focus — top-level primitive types and constraints', async () => {
  const agg = makeAgg(false);
  try {
    const snap = await getStatus(agg);
    assert.equal(snap.gateway, 'ch1tty', 'gateway must equal "ch1tty"');
    assert.equal(typeof snap.version, 'string', 'version must be a string');
    assert.ok((snap.version as string).length > 0, 'version must be non-empty');
    assert.equal(typeof snap.uptime, 'number', 'uptime must be a number');
    assert.ok(Number.isFinite(snap.uptime as number), 'uptime must be finite');
    assert.ok((snap.uptime as number) >= 0, 'uptime must be >= 0');
    for (const k of ['totalServers', 'connectedServers', 'totalTools', 'activeSessions']) {
      assert.equal(typeof snap[k], 'number', `${k} must be a number`);
      assert.ok(Number.isFinite(snap[k] as number), `${k} must be finite`);
      assert.ok((snap[k] as number) >= 0, `${k} must be >= 0`);
    }
    assert.equal(typeof snap.registryCached, 'boolean', 'registryCached must be a boolean');
  } finally {
    await agg.shutdown();
  }
});

// ── FY-2: systemHealth value types ───────────────────────────────────────────

test('FY-2: ch1tty/status no-focus — systemHealth field value types', async () => {
  const agg = makeAgg(false);
  try {
    const snap = await getStatus(agg);
    const sh = snap.systemHealth as Record<string, unknown>;
    assert.ok(['ok', 'warn', 'degraded'].includes(sh.status as string),
      `systemHealth.status must be ok|warn|degraded, got "${sh.status}"`);
    assert.equal(typeof sh.brainDegraded, 'boolean', 'systemHealth.brainDegraded must be boolean');
    assert.ok(['ok', 'warn', 'degraded'].includes(sh.ledgerStatus as string),
      `systemHealth.ledgerStatus must be ok|warn|degraded, got "${sh.ledgerStatus}"`);
  } finally {
    await agg.shutdown();
  }
});

// ── FY-3: brainHealth value types ────────────────────────────────────────────

test('FY-3: ch1tty/status no-focus — brainHealth field value types', async () => {
  const agg = makeAgg(false);
  try {
    const snap = await getStatus(agg);
    const bh = snap.brainHealth as Record<string, unknown>;
    assert.ok(['ok', 'degraded'].includes(bh.status as string),
      `brainHealth.status must be ok|degraded, got "${bh.status}"`);
    assert.equal(typeof bh.embeddingCircuitOpen, 'boolean', 'brainHealth.embeddingCircuitOpen must be boolean');
    assert.equal(typeof bh.ollamaCircuitOpen, 'boolean', 'brainHealth.ollamaCircuitOpen must be boolean');
  } finally {
    await agg.shutdown();
  }
});

// ── FY-4: ledgerHealth value types ───────────────────────────────────────────

test('FY-4: ch1tty/status no-focus — ledgerHealth field value types and constraints', async () => {
  const agg = makeAgg(false);
  try {
    const snap = await getStatus(agg);
    const lh = snap.ledgerHealth as Record<string, unknown>;
    assert.ok(['ok', 'warn', 'degraded'].includes(lh.status as string),
      `ledgerHealth.status must be ok|warn|degraded, got "${lh.status}"`);
    for (const k of ['dropped', 'buffered', 'flushErrors', 'dlqEntries']) {
      assert.equal(typeof lh[k], 'number', `ledgerHealth.${k} must be a number`);
      assert.ok(Number.isFinite(lh[k] as number), `ledgerHealth.${k} must be finite`);
      assert.ok((lh[k] as number) >= 0, `ledgerHealth.${k} must be >= 0`);
    }
    assert.equal(typeof lh.dlqPath, 'string', 'ledgerHealth.dlqPath must be a string');
  } finally {
    await agg.shutdown();
  }
});

// ── FY-5: ledgerDlq value types ──────────────────────────────────────────────

test('FY-5: ch1tty/status no-focus — ledgerDlq field value types', async () => {
  const agg = makeAgg(false);
  try {
    const snap = await getStatus(agg);
    const dlq = snap.ledgerDlq as Record<string, unknown>;
    assert.equal(typeof dlq.path, 'string', 'ledgerDlq.path must be a string');
    assert.equal(typeof dlq.entryCount, 'number', 'ledgerDlq.entryCount must be a number');
    assert.ok(Number.isFinite(dlq.entryCount as number), 'ledgerDlq.entryCount must be finite');
    assert.ok((dlq.entryCount as number) >= 0, 'ledgerDlq.entryCount must be >= 0');
    assert.ok(Array.isArray(dlq.entries), 'ledgerDlq.entries must be an array');
  } finally {
    await agg.shutdown();
  }
});

// ── FY-6: catalog value types ─────────────────────────────────────────────────

test('FY-6: ch1tty/status no-focus — catalog field value types', async () => {
  const agg = makeAgg(false);
  try {
    const snap = await getStatus(agg);
    const cat = snap.catalog as Record<string, unknown>;
    assert.equal(typeof cat.loaded, 'boolean', 'catalog.loaded must be boolean');
    assert.equal(typeof cat.totalCombos, 'number', 'catalog.totalCombos must be a number');
    assert.ok(Number.isFinite(cat.totalCombos as number), 'catalog.totalCombos must be finite');
    assert.ok((cat.totalCombos as number) >= 0, 'catalog.totalCombos must be >= 0');
    assert.ok(cat.byFocus !== null && typeof cat.byFocus === 'object' && !Array.isArray(cat.byFocus),
      'catalog.byFocus must be an object');
    for (const v of Object.values(cat.byFocus as Record<string, unknown>)) {
      assert.equal(typeof v, 'number', 'each catalog.byFocus value must be a number');
      assert.ok((v as number) >= 0, 'each catalog.byFocus value must be >= 0');
    }
  } finally {
    await agg.shutdown();
  }
});

// ── FY-7: focus field is null when no focus active ────────────────────────────

test('FY-7: ch1tty/status no-focus — focus field is null', async () => {
  const agg = makeAgg(false);
  try {
    const snap = await getStatus(agg);
    assert.equal(snap.focus, null, 'focus must be null when no focus is active');
  } finally {
    await agg.shutdown();
  }
});

// ── FY-8: active-focus status — focus field is object with typed fields ────────

test('FY-8: ch1tty/status focus:code — focus field is object with expected types', async () => {
  const agg = makeAgg(true);
  try {
    const snap = await getStatus(agg);
    assert.ok(snap.focus !== null, 'focus must be non-null when focus is active');
    const foc = snap.focus as Record<string, unknown>;
    assert.equal(typeof foc.active, 'string', 'focus.active must be a string');
    assert.ok((foc.active as string).length > 0, 'focus.active must be non-empty');
    assert.ok(Array.isArray(foc.categories), 'focus.categories must be an array');
    assert.ok(Array.isArray(foc.servers), 'focus.servers must be an array');
    for (const s of (foc.servers as unknown[])) {
      assert.equal(typeof s, 'string', 'each focus.servers entry must be a string');
    }
    assert.equal(typeof foc.boost, 'number', 'focus.boost must be a number');
    assert.ok(Number.isFinite(foc.boost as number), 'focus.boost must be finite');
    assert.ok((foc.boost as number) > 0, 'focus.boost must be > 0');
  } finally {
    await agg.shutdown();
  }
});

// ── FY-9: active-focus — catalog.activeFocusSuggestions non-null and typed ────

test('FY-9: ch1tty/status focus:code — catalog.activeFocusSuggestions type when focus active', async () => {
  const agg = makeAgg(true);
  try {
    const snap = await getStatus(agg);
    const cat = snap.catalog as Record<string, unknown>;
    // activeFocusSuggestions may be null (empty catalog) or an object with combos/prompts
    if (cat.activeFocusSuggestions !== null) {
      const afs = cat.activeFocusSuggestions as Record<string, unknown>;
      assert.ok(Array.isArray(afs.combos), 'activeFocusSuggestions.combos must be an array');
      assert.ok(Array.isArray(afs.prompts), 'activeFocusSuggestions.prompts must be an array');
    }
    // Either null or the typed object is valid — this test verifies it's never some other type.
    const isNullOrObject =
      cat.activeFocusSuggestions === null ||
      (cat.activeFocusSuggestions !== null && typeof cat.activeFocusSuggestions === 'object');
    assert.ok(isNullOrObject, 'catalog.activeFocusSuggestions must be null or object');
  } finally {
    await agg.shutdown();
  }
});

// ── FY-10: servers[] entry value types ────────────────────────────────────────

test('FY-10: ch1tty/status no-focus — servers[] entry primitive value types', async () => {
  const agg = makeAgg(false);
  try {
    const snap = await getStatus(agg);
    const servers = snap.servers as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(servers), 'servers must be an array');
    for (const s of servers) {
      assert.equal(typeof s.id, 'string', 'server.id must be a string');
      assert.equal(typeof s.name, 'string', 'server.name must be a string');
      assert.ok(['local', 'remote'].includes(s.type as string),
        `server.type must be local|remote, got "${s.type}"`);
      assert.equal(typeof s.enabled, 'boolean', 'server.enabled must be boolean');
      assert.equal(typeof s.connected, 'boolean', 'server.connected must be boolean');
      assert.equal(typeof s.toolCount, 'number', 'server.toolCount must be a number');
      assert.ok((s.toolCount as number) >= 0, 'server.toolCount must be >= 0');
    }
  } finally {
    await agg.shutdown();
  }
});

// ── FY-11: latencyMs present and non-negative ─────────────────────────────────

test('FY-11: ch1tty/status — latencyMs present and non-negative', async () => {
  const agg = makeAgg(false);
  try {
    const snap = await getStatus(agg);
    assert.equal(typeof snap.latencyMs, 'number', 'latencyMs must be a number');
    assert.ok(Number.isFinite(snap.latencyMs as number), 'latencyMs must be finite');
    assert.ok((snap.latencyMs as number) >= 0, 'latencyMs must be >= 0');
  } finally {
    await agg.shutdown();
  }
});

// ── FY-12: availableFocusProfiles is a string array ───────────────────────────

test('FY-12: ch1tty/status — availableFocusProfiles is a non-empty string array', async () => {
  const agg = makeAgg(false);
  try {
    const snap = await getStatus(agg);
    assert.ok(Array.isArray(snap.availableFocusProfiles),
      'availableFocusProfiles must be an array');
    for (const p of (snap.availableFocusProfiles as unknown[])) {
      assert.equal(typeof p, 'string', 'each availableFocusProfiles entry must be a string');
      assert.ok((p as string).length > 0, 'each focus profile name must be non-empty');
    }
    assert.ok((snap.availableFocusProfiles as string[]).length > 0,
      'availableFocusProfiles must be non-empty (at least one profile loaded)');
  } finally {
    await agg.shutdown();
  }
});
