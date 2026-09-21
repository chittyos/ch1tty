/**
 * GT drift guard: freeze cast:executed `latencyBreakdown` exact key sets.
 *
 * GJ froze latencyBreakdown VALUE TYPES (all present sub-fields are finite >= 0):
 *   - GJ-5: latencyBreakdown.registryMs is present and finite >= 0
 *   - GJ-6: all present sub-fields are finite >= 0 (iterates Object.keys)
 *
 * GJ does NOT assert:
 *   - latencyBreakdown.scoringMs is individually present (GJ only checks registryMs)
 *   - latencyBreakdown.executionMs is individually present (GJ only checks registryMs)
 *   - latencyBreakdown has no EXTRA keys beyond the declared three (no key-set freeze)
 *   - brainMs is absent when resolvedBy === 'keyword' (GJ-6 accepts any keys >= 0)
 *   - cast:plan does NOT expose latencyBreakdown at all (plan has latencyMs only;
 *     GK froze cast:plan top-level primitives but never asserts latencyBreakdown absent)
 *
 * GT closes those gaps (keyword route only — brain route requires a live Ollama/
 * WorkersAI brain; keyword is the only guaranteed path in test environments):
 *
 *   GT-1  latencyBreakdown.scoringMs is individually present in cast:executed
 *          (GJ-5 only asserts registryMs; scoringMs could silently disappear)
 *   GT-2  latencyBreakdown.executionMs is individually present in cast:executed
 *          (same gap — executionMs absence would pass GJ)
 *   GT-3  latencyBreakdown exact key set on keyword route is a subset of
 *          {scoringMs, executionMs, registryMs, brainMs} with no unrecognised keys
 *          (GJ-6 accepts any key name, so a renamed or added key silently passes)
 *   GT-4  latencyBreakdown does NOT contain brainMs on keyword route
 *          (brainMs is injected only for castRoute === 'brain';
 *           a regression adding it unconditionally would pass GJ-6)
 *   GT-5  cast:plan body does NOT expose a latencyBreakdown field
 *          (plan has latencyMs only; a latencyBreakdown accidental leak would
 *           pass every prior plan test since none assert key absence)
 *
 * Source: src-stdio/aggregator.ts
 *   cast:executed latencyBreakdown built at line ~1657:
 *     { scoringMs: execScoringMs, executionMs, registryMs,
 *       ...(castRoute === 'brain' ? { brainMs: brainRouteMs } : {}) }
 *   cast:plan: no latencyBreakdown field in the JSON.stringify at line ~1599.
 *
 * Frozen 2026-09-21.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (latencyBreakdown, not explain)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gt-${Date.now()}-${++_seq}.jsonl`);
}

const BASE_CONFIGS: ServerConfig[] = [
  { id: 'neon',   name: 'Neon DB', type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.tech/mcp',  lazy: true },
  { id: 'stripe', name: 'Stripe',  type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true },
];

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon',   FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
}

/** Invoke cast without confirm and return the parsed cast:executed JSON body. */
async function castExecuted(agg: Aggregator): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects' });
  assert.equal(result.isError, undefined, 'cast must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'cast must return at least one content item');
  assert.equal(content[0]!.type, 'text', 'cast content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(body['cast'], 'executed', `expected cast:executed, got cast="${body['cast']}"`);
  return body;
}

/** Invoke cast with confirm:true and return the parsed cast:plan JSON body. */
async function castPlan(agg: Aggregator): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', confirm: true });
  assert.equal(result.isError, undefined, 'cast must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'cast:plan must return at least one content item');
  assert.equal(content[0]!.type, 'text', 'cast:plan content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(body['cast'], 'plan', `expected cast:plan, got cast="${body['cast']}"`);
  return body;
}

// ── GT-1: latencyBreakdown.scoringMs is individually present ─────────────────

test('GT-1 cast:executed latencyBreakdown.scoringMs is present', async () => {
  const agg = makeAgg();
  try {
    const body = await castExecuted(agg);
    const breakdown = body['latencyBreakdown'] as Record<string, unknown> | undefined;
    assert.ok(
      breakdown !== null && breakdown !== undefined && typeof breakdown === 'object',
      'latencyBreakdown must be a non-null object',
    );
    assert.ok(
      'scoringMs' in breakdown,
      'latencyBreakdown must contain scoringMs',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GT-2: latencyBreakdown.executionMs is individually present ───────────────

test('GT-2 cast:executed latencyBreakdown.executionMs is present', async () => {
  const agg = makeAgg();
  try {
    const body = await castExecuted(agg);
    const breakdown = body['latencyBreakdown'] as Record<string, unknown>;
    assert.ok(
      'executionMs' in breakdown,
      'latencyBreakdown must contain executionMs',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GT-3: latencyBreakdown has no unrecognised keys ───────────────────────────

const KNOWN_BREAKDOWN_KEYS = new Set(['scoringMs', 'executionMs', 'registryMs', 'brainMs']);

test('GT-3 cast:executed latencyBreakdown contains no unrecognised keys', async () => {
  const agg = makeAgg();
  try {
    const body = await castExecuted(agg);
    const breakdown = body['latencyBreakdown'] as Record<string, unknown>;
    for (const key of Object.keys(breakdown)) {
      assert.ok(
        KNOWN_BREAKDOWN_KEYS.has(key),
        `latencyBreakdown has unexpected key "${key}" — only {scoringMs, executionMs, registryMs, brainMs?} are declared`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GT-4: brainMs is absent when resolvedBy === 'keyword' ────────────────────

test('GT-4 cast:executed latencyBreakdown does NOT contain brainMs on keyword route', async () => {
  const agg = makeAgg();
  try {
    const body = await castExecuted(agg);
    assert.equal(
      body['resolvedBy'],
      'keyword',
      `expected resolvedBy=keyword on keyword route (embedEnabled:false), got "${body['resolvedBy']}"`,
    );
    const breakdown = body['latencyBreakdown'] as Record<string, unknown>;
    assert.ok(
      !('brainMs' in breakdown),
      `latencyBreakdown must NOT contain brainMs when resolvedBy=keyword, got keys: ${Object.keys(breakdown).join(', ')}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GT-5: cast:plan does NOT expose a latencyBreakdown field ─────────────────

test('GT-5 cast:plan body does NOT contain a latencyBreakdown field', async () => {
  const agg = makeAgg();
  try {
    const body = await castPlan(agg);
    assert.ok(
      !('latencyBreakdown' in body),
      `cast:plan must NOT include latencyBreakdown (plan has latencyMs only), but found latencyBreakdown in response keys: ${Object.keys(body).join(', ')}`,
    );
  } finally {
    await agg.shutdown();
  }
});
