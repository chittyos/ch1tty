/**
 * GCH drift guard: freeze cast:resolved exact top-level key set when focus
 * is active — both with and without a session.
 *
 * GU froze cast:resolved for the no-focus, no-scope baseline:
 *   GU-3  no session → {cast, intent, latencyMs, resolved, resolvedBy}
 *   GU-4  with session → GU-3 + sessionContext
 *
 * GBM/GBN froze cast:resolved when scope is set (with and without session).
 *
 * The symmetric gap: no test freezes the EXACT top-level key set for
 * cast:resolved when a focus profile is active. A regression that silently
 * drops `focus` from the resolved response, or injects a stray annotation
 * (e.g. `activeProfile`, `focusBoost`) when focus is active, would pass all
 * prior tests undetected.
 *
 * Actual shape (from aggregator.ts ~line 1564):
 *   {
 *     cast: 'resolved',
 *     resolvedBy,
 *     intent,
 *     latencyMs,
 *     ...(focusName   ? { focus }       : {}),
 *     ...(scopeAnnot  ? { scope }       : {}),
 *     ...(explanation ? { explanation } : {}),
 *     resolved: { tool, score },
 *     ...(catalogCombo     ? { catalogCombo }     : {}),
 *     ...(resolvedCtx      ? { sessionContext }   : {}),
 *   }
 *
 * GCH freezes:
 *
 *   GCH-1  focus active, no session → EXACTLY {cast, focus, intent, latencyMs,
 *           resolved, resolvedBy}
 *           (GU-3 base + focus; confirms focus is present when active and
 *            sessionContext is absent when no sessionId is provided)
 *
 *   GCH-2  focus + session active → EXACTLY GCH-1 set + sessionContext
 *           (confirms both focus AND sessionContext are injected; a regression
 *            dropping either while adding no extra key would fail this freeze)
 *
 *   GCH-3  focus + session + scope → GCH-2 set + scope
 *           (GBN froze resolved+scope+session without focus; this closes the
 *            three-way composition gap: focus ∧ session ∧ scope)
 *
 *   GCH-4  focus + session + explain → GCH-2 set + explanation
 *           (confirms explanation composes cleanly with focus+session on the
 *            resolved path; no prior test freezes this triple)
 *
 *   GCH-5  sessionContext sub-keys on resolved path when focus from constructor
 *           have EXACTLY {callCount, recentTools} — no activeSessionFocus
 *           (mirrors GCG-5 for the dryRun/resolved path)
 *
 * cast:resolved is triggered via dryRun: true (no execution, no schema fetch).
 * Intent "list neon projects" reliably resolves to neon/list_projects via the
 * fixture backend (same as GU).
 *
 * Frozen 2026-09-26.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level cast key
 *     set, not explanation sub-object fields)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Frozen exact key sets ─────────────────────────────────────────────────────

// GCH-1: focus active, no session.
const RESOLVED_FOCUS_NO_SESSION: readonly string[] = [
  'cast', 'focus', 'intent', 'latencyMs', 'resolved', 'resolvedBy',
];

// GCH-2: focus + session.
const RESOLVED_FOCUS_SESSION: readonly string[] = [
  'cast', 'focus', 'intent', 'latencyMs', 'resolved', 'resolvedBy', 'sessionContext',
];

// GCH-3: focus + session + scope.
const RESOLVED_FOCUS_SESSION_SCOPE: readonly string[] = [
  ...RESOLVED_FOCUS_SESSION, 'scope',
];

// GCH-4: focus + session + explain.
const RESOLVED_FOCUS_SESSION_EXPLAIN: readonly string[] = [
  ...RESOLVED_FOCUS_SESSION, 'explanation',
];

// GCH-5: sessionContext sub-keys when focus is from constructor.
const SESSION_CONTEXT_KEYS: readonly string[] = ['callCount', 'recentTools'];

// ── Config fixtures ───────────────────────────────────────────────────────────

const NEON_CONFIG: ServerConfig = {
  id: 'neon',
  name: 'Neon DB',
  type: 'remote',
  access: 'readwrite',
  category: 'code',
  endpoint: 'https://neon.tech/mcp',
  lazy: true,
};

const FOCUS_PROFILES = {
  profiles: {
    code: { categories: ['code'], servers: [], boost: 0.5 },
  },
};

const INTENT = 'list neon projects';

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gch-${Date.now()}-${++_seq}.jsonl`);
}

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  return new Aggregator([NEON_CONFIG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    focus: 'code',
    focusProfiles: FOCUS_PROFILES,
    suggestionsCatalog: {},
  });
}

function assertExactKeys(
  body: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(body).sort();
  const exp = [...expected].sort();
  assert.deepEqual(
    actual,
    exp,
    `${label}: exact key set mismatch.\n  expected: ${JSON.stringify(exp)}\n  actual:   ${JSON.stringify(actual)}`,
  );
}

async function warmSession(agg: Aggregator, sessionId: string): Promise<void> {
  await agg.callTool('ch1tty/status', { sessionId });
}

async function castResolved(
  agg: Aggregator,
  extras: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', {
    intent: INTENT,
    dryRun: true,
    ...extras,
  });
  assert.equal(result.isError, undefined, 'cast must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥ 1 content item');
  assert.equal(content[0]!.type, 'text', 'content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(
    body['cast'],
    'resolved',
    `expected cast:resolved, got cast="${String(body['cast'])}"`,
  );
  return body;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GCH-1: cast:resolved with focus active (no session) has exactly base+focus, no sessionContext', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg);
    assertExactKeys(body, RESOLVED_FOCUS_NO_SESSION, 'cast:resolved focus (no session)');
    assert.equal(body['focus'], 'code', 'focus value must equal active profile name');
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'sessionContext'),
      false,
      'sessionContext must be absent when no sessionId provided',
    );
  } finally {
    await agg.shutdown();
  }
});

test('GCH-2: cast:resolved with focus + session has exactly base+focus+sessionContext', async () => {
  const agg = makeAgg();
  const sessionId = 'gch-session-2';
  try {
    await warmSession(agg, sessionId);
    const body = await castResolved(agg, { sessionId });
    assertExactKeys(body, RESOLVED_FOCUS_SESSION, 'cast:resolved focus+session');
    assert.equal(body['focus'], 'code', 'focus value must equal active profile name');
    assert.equal(typeof body['sessionContext'], 'object', 'sessionContext must be an object');
    assert.notEqual(body['sessionContext'], null, 'sessionContext must not be null');
  } finally {
    await agg.shutdown();
  }
});

test('GCH-3: cast:resolved with focus + session + scope has exactly base+focus+sessionContext+scope', async () => {
  const agg = makeAgg();
  const sessionId = 'gch-session-3';
  try {
    await warmSession(agg, sessionId);
    const body = await castResolved(agg, {
      sessionId,
      scope: { servers: ['neon'] },
    });
    assertExactKeys(body, RESOLVED_FOCUS_SESSION_SCOPE, 'cast:resolved focus+session+scope');
    assert.equal(body['focus'], 'code', 'focus value must equal active profile name');
    assert.equal(typeof body['scope'], 'object', 'scope must be an object');
    assert.notEqual(body['scope'], null, 'scope must not be null');
  } finally {
    await agg.shutdown();
  }
});

test('GCH-4: cast:resolved with focus + session + explain has exactly base+focus+sessionContext+explanation', async () => {
  const agg = makeAgg();
  const sessionId = 'gch-session-4';
  try {
    await warmSession(agg, sessionId);
    const body = await castResolved(agg, { sessionId, explain: true });
    assertExactKeys(body, RESOLVED_FOCUS_SESSION_EXPLAIN, 'cast:resolved focus+session+explain');
    assert.equal(body['focus'], 'code', 'focus value must equal active profile name');
    assert.equal(typeof body['explanation'], 'object', 'explanation must be an object');
    assert.notEqual(body['explanation'], null, 'explanation must not be null');
  } finally {
    await agg.shutdown();
  }
});

test('GCH-5: cast:resolved sessionContext has exactly {recentTools, callCount} when focus is from constructor', async () => {
  const agg = makeAgg();
  const sessionId = 'gch-session-5';
  try {
    await warmSession(agg, sessionId);
    const body = await castResolved(agg, { sessionId });
    const ctx = body['sessionContext'] as Record<string, unknown>;
    assert.ok(ctx !== null && typeof ctx === 'object', 'sessionContext must be an object');
    const ctxKeys = Object.keys(ctx).sort();
    assert.deepEqual(
      ctxKeys,
      [...SESSION_CONTEXT_KEYS].sort(),
      `sessionContext keys must be exactly ${JSON.stringify(SESSION_CONTEXT_KEYS)} ` +
        `when focus is set via constructor (no setSessionFocus); got ${JSON.stringify(ctxKeys)}`,
    );
    assert.ok(Array.isArray(ctx['recentTools']), 'sessionContext.recentTools must be an array');
    assert.equal(typeof ctx['callCount'], 'number', 'sessionContext.callCount must be a number');
    assert.equal(
      Object.prototype.hasOwnProperty.call(ctx, 'activeSessionFocus'),
      false,
      'activeSessionFocus must be absent when focus is set via constructor, not setSessionFocus',
    );
  } finally {
    await agg.shutdown();
  }
});
