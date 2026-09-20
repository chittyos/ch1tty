/**
 * FZ drift guard: freeze coordinator sub-object VALUE TYPES in ch1tty/status.
 *
 * DZ froze the exact key sets for the status response top level and first-tier
 * sub-objects. ED froze the nested coordinator/brain/ledger key shapes. FY added
 * value-type guards for every non-coordinator primitive in the status envelope.
 * No existing guard asserts the VALUE TYPES and CONSTRAINTS of the coordinator
 * sub-object itself — fields such as activeSessions could change from number to
 * string without failing any prior guard.
 *
 * FZ closes that gap:
 *
 *   FZ-1  coordinator top-level primitives (activeSessions, boundEntity,
 *          evictedSessions, sessionTtlMs types and constraints)
 *   FZ-2  coordinator.topTools is a string[]
 *   FZ-3  coordinator.toolsByServer is Record<string, finite non-negative number>
 *   FZ-4  coordinator.brain value types (OllamaBrainStats: counts >= 0,
 *          circuitOpen boolean, circuitCooldownRemainingMs >= 0)
 *   FZ-5  coordinator.embeddingBrain value types (EmbeddingBrainStats: same
 *          as brain plus cacheSize/cacheHits/cacheMisses >= 0)
 *   FZ-6  coordinator.sessions[] entry primitive types (sessionId string,
 *          toolPatterns >= 0, stagingComplete boolean, topTools string[];
 *          entity and sessionFocus are optional strings when present)
 *   FZ-7  short mode: coordinator present without sessions field, same
 *          primitive value types for the retained fields
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
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

const CONFIGS: ServerConfig[] = [
  { id: 'neon',   name: 'Neon',   type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.tech/mcp',  lazy: true },
  { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true },
];

let _seq = 0;
function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon',   FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator(CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: join(tmpdir(), `ch1tty-fz-${Date.now()}-${++_seq}.jsonl`),
  } as Parameters<typeof Aggregator.prototype.callTool>[1]);
}

async function getStatus(
  agg: Aggregator,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/status', args);
  assert.equal(result.isError, undefined, 'status must not error');
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

function assertFiniteNonNeg(v: unknown, label: string): void {
  assert.equal(typeof v, 'number', `${label} must be a number`);
  assert.ok(Number.isFinite(v as number), `${label} must be finite`);
  assert.ok((v as number) >= 0, `${label} must be >= 0`);
}

// ── FZ-1: coordinator top-level primitive types ───────────────────────────────

test('FZ-1: coordinator top-level primitive types and constraints', async () => {
  const agg = makeAgg();
  try {
    const snap = await getStatus(agg);
    const coord = snap.coordinator as Record<string, unknown>;

    assertFiniteNonNeg(coord.activeSessions, 'coordinator.activeSessions');
    assert.equal(typeof coord.boundEntity, 'boolean', 'coordinator.boundEntity must be boolean');
    assertFiniteNonNeg(coord.evictedSessions, 'coordinator.evictedSessions');
    assertFiniteNonNeg(coord.sessionTtlMs, 'coordinator.sessionTtlMs');
  } finally {
    await agg.shutdown?.();
  }
});

// ── FZ-2: coordinator.topTools ────────────────────────────────────────────────

test('FZ-2: coordinator.topTools is a string[]', async () => {
  const agg = makeAgg();
  try {
    const snap = await getStatus(agg);
    const coord = snap.coordinator as Record<string, unknown>;

    assert.ok(Array.isArray(coord.topTools), 'coordinator.topTools must be an array');
    for (const entry of (coord.topTools as unknown[])) {
      assert.equal(typeof entry, 'string', 'each coordinator.topTools entry must be a string');
    }
  } finally {
    await agg.shutdown?.();
  }
});

// ── FZ-3: coordinator.toolsByServer ──────────────────────────────────────────

test('FZ-3: coordinator.toolsByServer is Record<string, finite non-negative number>', async () => {
  const agg = makeAgg();
  try {
    const snap = await getStatus(agg);
    const coord = snap.coordinator as Record<string, unknown>;

    assert.equal(typeof coord.toolsByServer, 'object', 'coordinator.toolsByServer must be an object');
    assert.ok(coord.toolsByServer !== null && !Array.isArray(coord.toolsByServer), 'coordinator.toolsByServer must be a plain object');
    for (const [key, val] of Object.entries(coord.toolsByServer as Record<string, unknown>)) {
      assert.equal(typeof key, 'string', 'each toolsByServer key must be a string');
      assertFiniteNonNeg(val, `coordinator.toolsByServer[${key}]`);
    }
  } finally {
    await agg.shutdown?.();
  }
});

// ── FZ-4: coordinator.brain value types ──────────────────────────────────────

test('FZ-4: coordinator.brain value types (OllamaBrainStats)', async () => {
  const agg = makeAgg();
  try {
    const snap = await getStatus(agg);
    const brain = (snap.coordinator as Record<string, unknown>).brain as Record<string, unknown>;

    assertFiniteNonNeg(brain.calls, 'brain.calls');
    assertFiniteNonNeg(brain.successes, 'brain.successes');
    assertFiniteNonNeg(brain.timeouts, 'brain.timeouts');
    assertFiniteNonNeg(brain.errors, 'brain.errors');
    assertFiniteNonNeg(brain.emptyResults, 'brain.emptyResults');
    assertFiniteNonNeg(brain.avgLatencyMs, 'brain.avgLatencyMs');
    assert.equal(typeof brain.circuitOpen, 'boolean', 'brain.circuitOpen must be boolean');
    assertFiniteNonNeg(brain.circuitCooldownRemainingMs, 'brain.circuitCooldownRemainingMs');
  } finally {
    await agg.shutdown?.();
  }
});

// ── FZ-5: coordinator.embeddingBrain value types ──────────────────────────────

test('FZ-5: coordinator.embeddingBrain value types (EmbeddingBrainStats)', async () => {
  const agg = makeAgg();
  try {
    const snap = await getStatus(agg);
    const eb = (snap.coordinator as Record<string, unknown>).embeddingBrain as Record<string, unknown>;

    assertFiniteNonNeg(eb.calls, 'embeddingBrain.calls');
    assertFiniteNonNeg(eb.successes, 'embeddingBrain.successes');
    assertFiniteNonNeg(eb.timeouts, 'embeddingBrain.timeouts');
    assertFiniteNonNeg(eb.errors, 'embeddingBrain.errors');
    assertFiniteNonNeg(eb.emptyResults, 'embeddingBrain.emptyResults');
    assertFiniteNonNeg(eb.avgLatencyMs, 'embeddingBrain.avgLatencyMs');
    assert.equal(typeof eb.circuitOpen, 'boolean', 'embeddingBrain.circuitOpen must be boolean');
    assertFiniteNonNeg(eb.circuitCooldownRemainingMs, 'embeddingBrain.circuitCooldownRemainingMs');
    assertFiniteNonNeg(eb.cacheSize, 'embeddingBrain.cacheSize');
    assertFiniteNonNeg(eb.cacheHits, 'embeddingBrain.cacheHits');
    assertFiniteNonNeg(eb.cacheMisses, 'embeddingBrain.cacheMisses');
  } finally {
    await agg.shutdown?.();
  }
});

// ── FZ-6: coordinator.sessions[] entry types ─────────────────────────────────

test('FZ-6: coordinator.sessions[] entry primitive types', async () => {
  const agg = makeAgg();
  try {
    // Seed one session with a focus so the loop executes and sessionFocus is exercised.
    // callTool with sessionId creates the coordinator context; focus sets sessionFocus.
    await agg.callTool('ch1tty/search', { query: 'neon', focus: 'code', sessionId: 'fz6-seed' });
    const snap = await getStatus(agg, { sessionId: 'fz6-seed' });
    const sessions = (snap.coordinator as Record<string, unknown>).sessions as unknown[];

    assert.ok(Array.isArray(sessions), 'coordinator.sessions must be an array');
    assert.ok(sessions.length >= 1, 'at least one session must exist for type assertions to execute (fz6-seed)');
    for (const entry of sessions) {
      const s = entry as Record<string, unknown>;
      assert.equal(typeof s.sessionId, 'string', 'session.sessionId must be a string');
      assertFiniteNonNeg(s.toolPatterns, 'session.toolPatterns');
      assert.equal(typeof s.stagingComplete, 'boolean', 'session.stagingComplete must be boolean');
      assert.ok(Array.isArray(s.topTools), 'session.topTools must be an array');
      for (const tool of (s.topTools as unknown[])) {
        assert.equal(typeof tool, 'string', 'each session.topTools entry must be a string');
      }
      if ('entity' in s && s.entity !== undefined) {
        assert.equal(typeof s.entity, 'string', 'session.entity must be a string when present');
      }
      if ('sessionFocus' in s && s.sessionFocus !== undefined) {
        assert.equal(typeof s.sessionFocus, 'string', 'session.sessionFocus must be a string when present');
      }
    }
    // Verify the seeded session carries the expected focus value (not just the type).
    const seeded = sessions.find(
      (e) => (e as Record<string, unknown>).sessionId === 'fz6-seed',
    ) as Record<string, unknown> | undefined;
    assert.ok(seeded !== undefined, 'fz6-seed session must appear in coordinator sessions');
    assert.equal(seeded.sessionFocus, 'code', 'fz6-seed sessionFocus must equal "code"');
  } finally {
    await agg.shutdown?.();
  }
});

// ── FZ-7: short mode — coordinator present without sessions, same types ───────

test('FZ-7: short mode — coordinator present without sessions; primitives retain types', async () => {
  const agg = makeAgg();
  try {
    const snap = await getStatus(agg, { short: true });
    const coord = snap.coordinator as Record<string, unknown>;

    assert.ok(!('sessions' in coord), 'short mode coordinator must omit sessions');
    assert.ok(!('servers' in snap), 'short mode must omit top-level servers');

    assertFiniteNonNeg(coord.activeSessions, 'short.coordinator.activeSessions');
    assert.equal(typeof coord.boundEntity, 'boolean', 'short.coordinator.boundEntity must be boolean');
    assertFiniteNonNeg(coord.evictedSessions, 'short.coordinator.evictedSessions');
    assertFiniteNonNeg(coord.sessionTtlMs, 'short.coordinator.sessionTtlMs');
    assert.ok(Array.isArray(coord.topTools), 'short.coordinator.topTools must be an array');
    for (const entry of (coord.topTools as unknown[])) {
      assert.equal(typeof entry, 'string', 'short.coordinator.topTools entries must be strings');
    }

    const brain = coord.brain as Record<string, unknown>;
    assertFiniteNonNeg(brain.calls, 'short.brain.calls');
    assertFiniteNonNeg(brain.successes, 'short.brain.successes');
    assertFiniteNonNeg(brain.timeouts, 'short.brain.timeouts');
    assertFiniteNonNeg(brain.errors, 'short.brain.errors');
    assertFiniteNonNeg(brain.emptyResults, 'short.brain.emptyResults');
    assertFiniteNonNeg(brain.avgLatencyMs, 'short.brain.avgLatencyMs');
    assert.equal(typeof brain.circuitOpen, 'boolean', 'short.brain.circuitOpen must be boolean');
    assertFiniteNonNeg(brain.circuitCooldownRemainingMs, 'short.brain.circuitCooldownRemainingMs');

    const eb = coord.embeddingBrain as Record<string, unknown>;
    assertFiniteNonNeg(eb.calls, 'short.embeddingBrain.calls');
    assertFiniteNonNeg(eb.successes, 'short.embeddingBrain.successes');
    assertFiniteNonNeg(eb.timeouts, 'short.embeddingBrain.timeouts');
    assertFiniteNonNeg(eb.errors, 'short.embeddingBrain.errors');
    assertFiniteNonNeg(eb.emptyResults, 'short.embeddingBrain.emptyResults');
    assertFiniteNonNeg(eb.avgLatencyMs, 'short.embeddingBrain.avgLatencyMs');
    assert.equal(typeof eb.circuitOpen, 'boolean', 'short.embeddingBrain.circuitOpen must be boolean');
    assertFiniteNonNeg(eb.circuitCooldownRemainingMs, 'short.embeddingBrain.circuitCooldownRemainingMs');
    assertFiniteNonNeg(eb.cacheSize, 'short.embeddingBrain.cacheSize');
    assertFiniteNonNeg(eb.cacheHits, 'short.embeddingBrain.cacheHits');
    assertFiniteNonNeg(eb.cacheMisses, 'short.embeddingBrain.cacheMisses');
  } finally {
    await agg.shutdown?.();
  }
});
