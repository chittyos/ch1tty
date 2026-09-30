/**
 * GBE drift guard: freeze cast:resolved exact top-level key set.
 *
 * EG (eg-cast-no-unexpected-keys.test.ts) uses a 10-key RESOLVED_PERMITTED
 * superset and asserts actual keys are a SUBSET of it.  That check catches
 * NEW keys that appear outside the list but is blind to silent disappearance
 * of existing required keys.  GBE closes the complement gap by asserting the
 * EXACT sorted key set with deepEqual.
 *
 * Source: src-stdio/aggregator.ts lines ~1553–1581 (dryRun branch):
 *
 *   cast:resolved body literal:
 *     { cast, resolvedBy, intent, latencyMs }            ← always
 *     ...(focusName ? { focus } : {})                    ← only with active focus
 *     ...(scopeAnnotation ? { scope } : {})              ← only when scope arg passed
 *     ...(explanation ? { explanation } : {})             ← only with explain:true
 *     resolved: { tool, score }                          ← always, exactly 2 sub-fields
 *     ...(catalogCombo ? { catalogCombo } : {})          ← only when focusName truthy
 *     ...(resolvedSessionContext ? { sessionContext } : {})  ← only with active session
 *
 * scopeAnnotation = null when no args.scope is passed (line ~1349).
 * catalogCombo   = null when no focus profile is active (line ~1448).
 * Both conditions hold for all tests below (no CH1TTY_FOCUS / no focus arg / no scope arg).
 *
 * Base exact keyset: { cast, intent, latencyMs, resolved, resolvedBy }
 *
 *   GBE-1  base exact keyset (no session, no focus, no scope, no explain) is
 *          {cast, intent, latencyMs, resolved, resolvedBy}
 *          (EG checks keys ⊆ superset; GBE freezes exact equality)
 *
 *   GBE-2  adding sessionId adds ONLY sessionContext to the key set
 *          (a regression injecting extra session fields would fail EG too, but
 *           only GBE asserts the exact boundary before + after adding sessionId)
 *
 *   GBE-3  explanation is absent when explain is NOT passed (default path)
 *          (GBE-1 already covers this implicitly; GBE-3 makes the absence explicit
 *           so a future change that always injects explanation fails loudly here)
 *
 *   GBE-4  adding explain:true adds ONLY explanation to the key set
 *          (symmetrical to GBE-2; exact boundary before + after explain)
 *
 *   GBE-5  known-absent keys: latencyBreakdown, score (top-level), alternatives,
 *          args, hint, focus, scope, catalogCombo — individually asserted absent
 *          (EG checks no unexpected keys; GBE-5 names each one so a regression
 *           that adds one of them to resolved produces a diagnostic failure message)
 *
 * resolved sub-object: exact freeze of {score, tool} is already done by EG suite 3
 * (cast:resolved resolved sub-object has no unexpected keys + GI-1/GI-8 for types).
 * GBE does not duplicate that.
 *
 * Frozen 2026-09-30.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (latencyBreakdown absent from
 *     cast:resolved entirely; no explain metrics added)
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
  return join(tmpdir(), `ch1tty-gbe-${Date.now()}-${++_seq}.jsonl`);
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

const INTENT = 'list neon projects';
const SESSION = 'gbe-session-1';

/** Invoke cast with dryRun and return the parsed cast:resolved JSON body. */
async function resolved(
  agg: Aggregator,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, dryRun: true, ...extra });
  assert.equal(result.isError, undefined, 'cast must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'cast must return at least one content item');
  assert.equal(content[0]!.type, 'text', 'cast content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(body['cast'], 'resolved', `expected cast:resolved, got cast="${body['cast']}"`);
  return body;
}

// ── GBE-1: base exact keyset ──────────────────────────────────────────────────

const BASE_KEYS = ['cast', 'intent', 'latencyMs', 'resolved', 'resolvedBy'];

test('GBE-1 cast:resolved base exact keyset is {cast, intent, latencyMs, resolved, resolvedBy}', async () => {
  const agg = makeAgg();
  try {
    const body = await resolved(agg);
    const actual = Object.keys(body).sort();
    assert.deepEqual(
      actual,
      [...BASE_KEYS].sort(),
      `cast:resolved base keyset mismatch — got [${actual.join(', ')}], expected [${BASE_KEYS.join(', ')}]`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GBE-2: sessionId adds ONLY sessionContext ─────────────────────────────────

test('GBE-2 cast:resolved with sessionId adds ONLY sessionContext to key set', async () => {
  const agg = makeAgg();
  try {
    // Warm up session (sessionContext only appears once the coordinator has a session entry)
    await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: SESSION });

    const body = await resolved(agg, { sessionId: SESSION });
    const actual = Object.keys(body).sort();
    const expected = [...BASE_KEYS, 'sessionContext'].sort();
    assert.deepEqual(
      actual,
      expected,
      `cast:resolved + sessionId keyset mismatch — got [${actual.join(', ')}], expected [${expected.join(', ')}]`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GBE-3: explanation absent without explain ─────────────────────────────────

test('GBE-3 cast:resolved does NOT contain explanation without explain:true', async () => {
  const agg = makeAgg();
  try {
    const body = await resolved(agg);
    assert.ok(
      !('explanation' in body),
      `cast:resolved must NOT include explanation when explain is not set, but found explanation in keys: ${Object.keys(body).join(', ')}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GBE-4: explain:true adds ONLY explanation ─────────────────────────────────

test('GBE-4 cast:resolved with explain:true adds ONLY explanation to key set', async () => {
  const agg = makeAgg();
  try {
    const body = await resolved(agg, { explain: true });
    const actual = Object.keys(body).sort();
    const expected = [...BASE_KEYS, 'explanation'].sort();
    assert.deepEqual(
      actual,
      expected,
      `cast:resolved + explain:true keyset mismatch — got [${actual.join(', ')}], expected [${expected.join(', ')}]`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GBE-5: known-absent keys ──────────────────────────────────────────────────

const ABSENT_KEYS = [
  'latencyBreakdown', // executed only; resolved has latencyMs but no breakdown
  'score',            // score is inside resolved.score, NOT at top level
  'alternatives',     // plan/executed only; resolved is single-best, no alternatives list
  'args',             // plan only
  'hint',             // plan/no_match only
  'focus',            // only when a focus profile is active; not set in this test
  'scope',            // only when args.scope is passed; not passed in this test
  'catalogCombo',     // only when focusName truthy; no focus here
];

test('GBE-5 cast:resolved does NOT contain known-plan/executed-only keys', async () => {
  const agg = makeAgg();
  try {
    const body = await resolved(agg);
    for (const key of ABSENT_KEYS) {
      assert.ok(
        !(key in body),
        `cast:resolved must NOT contain "${key}" (plan/executed-only key or no focus active), got keys: ${Object.keys(body).join(', ')}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});
