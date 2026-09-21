/**
 * GR drift guard: freeze coordinator.brain and coordinator.embeddingBrain key sets
 * and value types, plus coordinator primitive field value types.
 *
 * GG froze the coordinator key set ({brain, embeddingBrain, …}).
 * GA froze coordinator.ledger value types.
 * GC froze coordinator.sessions[] entry key set.
 * No test has frozen:
 *   - coordinator.brain  exact key set or value types  (OllamaBrainStats)
 *   - coordinator.embeddingBrain  exact key set or value types (EmbeddingBrainStats)
 *   - coordinator.activeSessions  as non-negative integer
 *   - coordinator.boundEntity  as exactly a boolean
 *   - coordinator.evictedSessions  as non-negative integer
 *   - coordinator.sessionTtlMs  as a positive number
 *
 * GR closes those gaps:
 *
 *   GR-1  coordinator.brain exact key set is
 *          {avgLatencyMs, calls, circuitCooldownRemainingMs, circuitOpen,
 *           emptyResults, errors, successes, timeouts}  (8 keys, alphabetical)
 *   GR-2  coordinator.brain value types:
 *           calls/successes/timeouts/errors/emptyResults → non-negative integers;
 *           avgLatencyMs → finite non-negative number;
 *           circuitOpen → exactly boolean;
 *           circuitCooldownRemainingMs → non-negative number
 *   GR-3  coordinator.embeddingBrain exact key set is
 *          {avgLatencyMs, cacheHits, cacheMisses, cacheSize, calls,
 *           circuitCooldownRemainingMs, circuitOpen, emptyResults, errors,
 *           successes, timeouts}  (11 keys, alphabetical)
 *   GR-4  coordinator.embeddingBrain value types:
 *           calls/successes/timeouts/errors/emptyResults/cacheSize/cacheHits/cacheMisses
 *             → non-negative integers;
 *           avgLatencyMs → finite non-negative number;
 *           circuitOpen → exactly boolean;
 *           circuitCooldownRemainingMs → non-negative number
 *   GR-5  coordinator.activeSessions is a non-negative integer (0 on a fresh Aggregator)
 *   GR-6  coordinator.boundEntity is exactly a boolean primitive (not 0/1/"true")
 *   GR-7  coordinator.evictedSessions is a non-negative integer
 *   GR-8  coordinator.sessionTtlMs is a finite positive number (> 0)
 *
 * Frozen 2026-09-21.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only)
 *   - buildCastExplanation metric freeze: not applicable (status, not cast)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Frozen key sets ───────────────────────────────────────────────────────────

const BRAIN_KEYS = [
  'avgLatencyMs',
  'calls',
  'circuitCooldownRemainingMs',
  'circuitOpen',
  'emptyResults',
  'errors',
  'successes',
  'timeouts',
].sort();

const EMBEDDING_BRAIN_KEYS = [
  'avgLatencyMs',
  'cacheHits',
  'cacheMisses',
  'cacheSize',
  'calls',
  'circuitCooldownRemainingMs',
  'circuitOpen',
  'emptyResults',
  'errors',
  'successes',
  'timeouts',
].sort();

// ── Helpers ───────────────────────────────────────────────────────────────────

const CONFIGS: ServerConfig[] = [
  { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true },
];

let _seq = 0;
function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  return new Aggregator(CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: join(tmpdir(), `ch1tty-gr-${Date.now()}-${++_seq}.jsonl`),
  } as Parameters<typeof Aggregator.prototype.callTool>[1]);
}

async function getCoord(agg: Aggregator): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined, 'status must not error');
  const snap = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  const coord = snap.coordinator as Record<string, unknown>;
  assert.ok(coord !== null && typeof coord === 'object' && !Array.isArray(coord),
    'coordinator must be a plain object');
  return coord;
}

// ── GR-1: coordinator.brain exact key set ────────────────────────────────────

test('GR-1: coordinator.brain exact key set matches OllamaBrainStats (8 keys)', async () => {
  const agg = makeAgg();
  try {
    const coord = await getCoord(agg);
    const brain = coord.brain as Record<string, unknown>;
    assert.ok(brain !== null && typeof brain === 'object' && !Array.isArray(brain),
      'coordinator.brain must be a plain object');
    const actual = Object.keys(brain).sort();
    assert.deepEqual(actual, BRAIN_KEYS,
      `coordinator.brain key set must equal frozen 8-key list — got [${actual.join(', ')}]`);
  } finally {
    await agg.shutdown();
  }
});

// ── GR-2: coordinator.brain value types ──────────────────────────────────────

test('GR-2: coordinator.brain value types — integer counters, finite avgLatencyMs, boolean circuitOpen, non-negative cooldown', async () => {
  const agg = makeAgg();
  try {
    const coord = await getCoord(agg);
    const brain = coord.brain as Record<string, unknown>;

    for (const field of ['calls', 'successes', 'timeouts', 'errors', 'emptyResults'] as const) {
      const v = brain[field];
      assert.equal(typeof v, 'number', `brain.${field} must be a number`);
      assert.ok(Number.isInteger(v as number), `brain.${field} must be an integer, got ${v}`);
      assert.ok((v as number) >= 0, `brain.${field} must be non-negative, got ${v}`);
    }

    const avgLatencyMs = brain['avgLatencyMs'];
    assert.equal(typeof avgLatencyMs, 'number', 'brain.avgLatencyMs must be a number');
    assert.ok(Number.isFinite(avgLatencyMs as number), `brain.avgLatencyMs must be finite, got ${avgLatencyMs}`);
    assert.ok((avgLatencyMs as number) >= 0, `brain.avgLatencyMs must be non-negative, got ${avgLatencyMs}`);

    const circuitOpen = brain['circuitOpen'];
    assert.equal(typeof circuitOpen, 'boolean', `brain.circuitOpen must be exactly boolean, got ${typeof circuitOpen} (${circuitOpen})`);

    const cooldown = brain['circuitCooldownRemainingMs'];
    assert.equal(typeof cooldown, 'number', 'brain.circuitCooldownRemainingMs must be a number');
    assert.ok((cooldown as number) >= 0, `brain.circuitCooldownRemainingMs must be non-negative, got ${cooldown}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GR-3: coordinator.embeddingBrain exact key set ───────────────────────────

test('GR-3: coordinator.embeddingBrain exact key set matches EmbeddingBrainStats (11 keys)', async () => {
  const agg = makeAgg();
  try {
    const coord = await getCoord(agg);
    const eb = coord.embeddingBrain as Record<string, unknown>;
    assert.ok(eb !== null && typeof eb === 'object' && !Array.isArray(eb),
      'coordinator.embeddingBrain must be a plain object');
    const actual = Object.keys(eb).sort();
    assert.deepEqual(actual, EMBEDDING_BRAIN_KEYS,
      `coordinator.embeddingBrain key set must equal frozen 11-key list — got [${actual.join(', ')}]`);
  } finally {
    await agg.shutdown();
  }
});

// ── GR-4: coordinator.embeddingBrain value types ─────────────────────────────

test('GR-4: coordinator.embeddingBrain value types — integer counters/cache fields, finite avgLatencyMs, boolean circuitOpen, non-negative cooldown', async () => {
  const agg = makeAgg();
  try {
    const coord = await getCoord(agg);
    const eb = coord.embeddingBrain as Record<string, unknown>;

    for (const field of [
      'calls', 'successes', 'timeouts', 'errors', 'emptyResults',
      'cacheSize', 'cacheHits', 'cacheMisses',
    ] as const) {
      const v = eb[field];
      assert.equal(typeof v, 'number', `embeddingBrain.${field} must be a number`);
      assert.ok(Number.isInteger(v as number), `embeddingBrain.${field} must be an integer, got ${v}`);
      assert.ok((v as number) >= 0, `embeddingBrain.${field} must be non-negative, got ${v}`);
    }

    const avgLatencyMs = eb['avgLatencyMs'];
    assert.equal(typeof avgLatencyMs, 'number', 'embeddingBrain.avgLatencyMs must be a number');
    assert.ok(Number.isFinite(avgLatencyMs as number), `embeddingBrain.avgLatencyMs must be finite, got ${avgLatencyMs}`);
    assert.ok((avgLatencyMs as number) >= 0, `embeddingBrain.avgLatencyMs must be non-negative, got ${avgLatencyMs}`);

    const circuitOpen = eb['circuitOpen'];
    assert.equal(typeof circuitOpen, 'boolean', `embeddingBrain.circuitOpen must be exactly boolean, got ${typeof circuitOpen} (${circuitOpen})`);

    const cooldown = eb['circuitCooldownRemainingMs'];
    assert.equal(typeof cooldown, 'number', 'embeddingBrain.circuitCooldownRemainingMs must be a number');
    assert.ok((cooldown as number) >= 0, `embeddingBrain.circuitCooldownRemainingMs must be non-negative, got ${cooldown}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GR-5: coordinator.activeSessions is a non-negative integer ───────────────

test('GR-5: coordinator.activeSessions is a non-negative integer (0 on fresh Aggregator)', async () => {
  const agg = makeAgg();
  try {
    const coord = await getCoord(agg);
    const v = coord.activeSessions;
    assert.equal(typeof v, 'number', `activeSessions must be a number, got ${typeof v}`);
    assert.ok(Number.isInteger(v as number), `activeSessions must be an integer, got ${v}`);
    assert.ok((v as number) >= 0, `activeSessions must be non-negative, got ${v}`);
    assert.equal(v, 0, `fresh Aggregator must have activeSessions === 0, got ${v}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GR-6: coordinator.boundEntity is exactly a boolean ───────────────────────

test('GR-6: coordinator.boundEntity is exactly a boolean primitive (not 0/1/"true")', async () => {
  const agg = makeAgg();
  try {
    const coord = await getCoord(agg);
    const v = coord.boundEntity;
    assert.equal(typeof v, 'boolean',
      `boundEntity must be exactly boolean, got ${typeof v} (${JSON.stringify(v)})`);
  } finally {
    await agg.shutdown();
  }
});

// ── GR-7: coordinator.evictedSessions is a non-negative integer ───────────────

test('GR-7: coordinator.evictedSessions is a non-negative integer', async () => {
  const agg = makeAgg();
  try {
    const coord = await getCoord(agg);
    const v = coord.evictedSessions;
    assert.equal(typeof v, 'number', `evictedSessions must be a number, got ${typeof v}`);
    assert.ok(Number.isInteger(v as number), `evictedSessions must be an integer, got ${v}`);
    assert.ok((v as number) >= 0, `evictedSessions must be non-negative, got ${v}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GR-8: coordinator.sessionTtlMs is a finite positive number ────────────────

test('GR-8: coordinator.sessionTtlMs is a finite positive number (> 0)', async () => {
  const agg = makeAgg();
  try {
    const coord = await getCoord(agg);
    const v = coord.sessionTtlMs;
    assert.equal(typeof v, 'number', `sessionTtlMs must be a number, got ${typeof v}`);
    assert.ok(Number.isFinite(v as number), `sessionTtlMs must be finite, got ${v}`);
    assert.ok((v as number) > 0, `sessionTtlMs must be positive (> 0), got ${v}`);
  } finally {
    await agg.shutdown();
  }
});
