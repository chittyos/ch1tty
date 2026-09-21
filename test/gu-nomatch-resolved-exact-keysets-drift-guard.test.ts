/**
 * GU drift guard: freeze cast:no_match and cast:resolved exact top-level key sets.
 *
 * EA froze required key PRESENCE for both modes — checking that each expected
 * key exists but NOT that no extra keys were added. GJ froze VALUE TYPES for
 * specific fields in cast:no_match. Neither EA nor GJ freezes the exact set,
 * so a regression adding a new top-level field (or accidentally injecting a
 * field only valid in another cast mode) would pass all prior tests silently.
 *
 * The conditional sessionContext field is also unfrozen for both modes: no test
 * currently asserts that sessionContext IS present when a sessionId is given,
 * or that it is ABSENT when no sessionId is provided.
 *
 * Actual shapes (probed 2026-09-21):
 *
 *   cast:no_match  (no sessionId)  → {cast, hint, intent, latencyMs, resolvedBy}
 *   cast:no_match  (with sessionId) → {cast, hint, intent, latencyMs, resolvedBy, sessionContext}
 *
 *   cast:resolved  (no sessionId)  → {cast, intent, latencyMs, resolved, resolvedBy}
 *   cast:resolved  (with sessionId) → {cast, intent, latencyMs, resolved, resolvedBy, sessionContext}
 *
 * GU freezes:
 *
 *   GU-1  cast:no_match WITHOUT sessionId has EXACTLY {cast, hint, intent, latencyMs, resolvedBy}
 *          (EA: checks presence of each — never asserts no extra keys)
 *   GU-2  cast:no_match WITH sessionId has EXACTLY the GU-1 set PLUS sessionContext
 *          (sessionContext is conditionally present; no prior test asserts its presence in no_match
 *           when sessionId is given, or its absence when sessionId is omitted)
 *   GU-3  cast:resolved WITHOUT sessionId has EXACTLY {cast, intent, latencyMs, resolved, resolvedBy}
 *          (EA: required-presence check only; no exact freeze)
 *   GU-4  cast:resolved WITH sessionId has EXACTLY the GU-3 set PLUS sessionContext
 *          (same conditional-presence gap as GU-2 for the resolved mode)
 *   GU-5  cast:no_match WITHOUT sessionId does NOT contain sessionContext
 *          (isolated absence guard — a regression injecting sessionContext regardless of session
 *           would pass GU-1 only if also caught by strict deepEqual; this makes the guard explicit)
 *
 * Source: src-stdio/aggregator.ts
 *   cast:no_match body built at line ~1368:
 *     { cast: 'no_match', resolvedBy, intent, latencyMs, hint, ...sessionContext? }
 *   cast:resolved body built at line ~1600 (dryRun path):
 *     { cast: 'resolved', resolvedBy, intent, latencyMs, resolved, ...sessionContext? }
 *
 * Frozen 2026-09-21.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level cast response fields,
 *     not explanation sub-object)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Frozen exact key sets ──────────────────────────────────────────────────────

const NO_MATCH_KEYS_NO_SESSION: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'resolvedBy',
];

const NO_MATCH_KEYS_WITH_SESSION: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'resolvedBy', 'sessionContext',
];

const RESOLVED_KEYS_NO_SESSION: readonly string[] = [
  'cast', 'intent', 'latencyMs', 'resolved', 'resolvedBy',
];

const RESOLVED_KEYS_WITH_SESSION: readonly string[] = [
  'cast', 'intent', 'latencyMs', 'resolved', 'resolvedBy', 'sessionContext',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_CONFIGS: ServerConfig[] = [
  {
    id: 'neon',
    name: 'Neon DB',
    type: 'remote',
    access: 'readwrite',
    category: 'code',
    endpoint: 'https://neon.tech/mcp',
    lazy: true,
  },
  {
    id: 'stripe',
    name: 'Stripe',
    type: 'remote',
    access: 'readwrite',
    category: 'ecosystem',
    endpoint: 'https://stripe.com/mcp',
    lazy: true,
  },
];

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gu-${Date.now()}-${++_seq}.jsonl`);
}

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
}

/** Exact key-set assertion: sorted actual keys must deep-equal sorted expected keys. */
function assertExactKeys(
  body: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(body).sort();
  const exp = [...expected].sort();
  assert.deepEqual(actual, exp,
    `${label}: exact key set mismatch.\n  expected: ${JSON.stringify(exp)}\n  actual:   ${JSON.stringify(actual)}`);
}

/** Invoke cast with an intent that produces cast:no_match. */
async function castNoMatch(
  agg: Aggregator,
  opts: { sessionId?: string } = {},
): Promise<Record<string, unknown>> {
  const args: Record<string, unknown> = { intent: 'zzzzzzzzz_gu_no_match_unique_88888' };
  if (opts.sessionId !== undefined) args.sessionId = opts.sessionId;
  const result = await agg.callTool('ch1tty/cast', args);
  assert.equal(result.isError, undefined, 'cast:no_match must not return isError');
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(body.cast, 'no_match',
    `expected cast:no_match but got cast:${body.cast}; intent may have matched unexpectedly`);
  return body;
}

/** Invoke cast with dryRun:true and assert the response is cast:resolved. */
async function castResolved(
  agg: Aggregator,
  opts: { sessionId?: string } = {},
): Promise<Record<string, unknown>> {
  const args: Record<string, unknown> = { intent: 'list neon projects', dryRun: true };
  if (opts.sessionId !== undefined) args.sessionId = opts.sessionId;
  const result = await agg.callTool('ch1tty/cast', args);
  assert.equal(result.isError, undefined, 'cast:resolved must not return isError');
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(body.cast, 'resolved',
    `expected cast:resolved but got cast:${body.cast}`);
  return body;
}

// ── GU-1: cast:no_match exact key set WITHOUT sessionId ──────────────────────

test('GU-1: cast:no_match (no sessionId) has exactly {cast, hint, intent, latencyMs, resolvedBy}', async () => {
  const agg = makeAgg();
  try {
    const body = await castNoMatch(agg);
    assertExactKeys(body, NO_MATCH_KEYS_NO_SESSION, 'cast:no_match without sessionId');
  } finally {
    await agg.shutdown();
  }
});

// ── GU-2: cast:no_match exact key set WITH sessionId ─────────────────────────

test('GU-2: cast:no_match (with sessionId) has exactly {cast, hint, intent, latencyMs, resolvedBy, sessionContext}', async () => {
  const agg = makeAgg();
  try {
    const body = await castNoMatch(agg, { sessionId: 'gu-session-no-match' });
    assertExactKeys(body, NO_MATCH_KEYS_WITH_SESSION, 'cast:no_match with sessionId');
  } finally {
    await agg.shutdown();
  }
});

// ── GU-3: cast:resolved exact key set WITHOUT sessionId ──────────────────────

test('GU-3: cast:resolved (no sessionId) has exactly {cast, intent, latencyMs, resolved, resolvedBy}', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg);
    assertExactKeys(body, RESOLVED_KEYS_NO_SESSION, 'cast:resolved without sessionId');
  } finally {
    await agg.shutdown();
  }
});

// ── GU-4: cast:resolved exact key set WITH sessionId ─────────────────────────

test('GU-4: cast:resolved (with sessionId) has exactly {cast, intent, latencyMs, resolved, resolvedBy, sessionContext}', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg, { sessionId: 'gu-session-resolved' });
    assertExactKeys(body, RESOLVED_KEYS_WITH_SESSION, 'cast:resolved with sessionId');
  } finally {
    await agg.shutdown();
  }
});

// ── GU-5: cast:no_match does NOT inject sessionContext when sessionId is absent ──

test('GU-5: cast:no_match without sessionId does not contain sessionContext', async () => {
  const agg = makeAgg();
  try {
    const body = await castNoMatch(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'sessionContext'),
      false,
      'cast:no_match without sessionId must not include sessionContext; ' +
      'a regression injecting it unconditionally would silently pass GU-1\'s presence checks',
    );
  } finally {
    await agg.shutdown();
  }
});
