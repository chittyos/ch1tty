/**
 * GCI drift guard: freeze cast:discovered exact top-level key set when a focus
 * profile is active — with and without a session.
 *
 * Prior discovered exact-keyset coverage:
 *   GBC (PR #1500) : froze cast:discovered base key set (no scope, no session)
 *                    {cast, hint, intent, latencyMs, prompts, resolvedBy} (6 keys)
 *   GBH (PR #1509) : froze cast:discovered conditional keys for scope, explain,
 *                    and session individually.
 *   GBS (PR #1520) : froze cast:discovered when scope+session are both active.
 *
 * Gap: No test on main freezes what happens to cast:discovered when a focus
 * profile is active. Two distinct regressions are possible:
 *
 *   (a) Someone adds `focus: focusName` to the discovered response body
 *       (mirroring what plan/executed/resolved do). Currently absent from the
 *       discovered path (aggregator.ts ~line 1428–1443); a silent injection
 *       would pass all prior tests.
 *
 *   (b) `suggestions` is injected via `focusSuggestions` when focus is active
 *       and the suggestionsCatalog has an entry for that focus. A regression
 *       that drops or duplicates suggestions in this path would pass GBC/GBH/GBS.
 *
 * Source (src-stdio/aggregator.ts ~lines 1416–1444):
 *   cast:discovered body =
 *     { cast, resolvedBy, intent, latencyMs,
 *       ...(scopeAnnotation    ? { scope }       : {}),
 *       ...(explanation        ? { explanation } : {}),
 *       hint,
 *       ...related,                    // prompts and/or resources
 *       ...(discoveredSessionCtx ? { sessionContext } : {}),
 *       ...(focusSuggestions   ? { suggestions } : {}),
 *     }
 *
 * Notable: `focus: focusName` is NOT spread here (unlike plan/executed/resolved).
 *
 * GCI freezes:
 *
 *   GCI-1  focus active, no session, no catalog entry → base 6 keys exactly
 *           (same as no-focus baseline; confirms `focus` key is absent even
 *            when a focus profile is active, and `suggestions` absent without catalog)
 *
 *   GCI-2  focus active, WITH catalog entry, no session → base + resources + suggestions (8 keys)
 *           The suggestions catalog registers ch1tty://suggestions/* entries via
 *           listSuggestionResources(); these score against intent keywords and
 *           surface as `resources` alongside `suggestions`. `focus` still absent.
 *
 *   GCI-3  focus active, WITH catalog, session active → base + resources + sessionContext + suggestions (9 keys)
 *           (closes the three-way: focus ∧ catalog ∧ session; `resources` present for same reason as GCI-2)
 *
 *   GCI-4  focus active, no catalog, session active → base + sessionContext (7 keys)
 *           (confirms sessionContext composes with focus when catalog is missing)
 *
 *   GCI-5  absence guard: `focus` key is NEVER present in cast:discovered,
 *           regardless of whether focus is active (per-call or constructor)
 *
 * Catalog isolation: FocusSuggestions are injected inline — no dependency on
 * focus-suggestions.json or focus-profiles.json at CWD.
 *
 * cast:discovered is triggered by: intent matches a prompt but NO tool matches.
 * Fixture: one tool "manage_subscription" (ecosystem keywords), one prompt
 * "retrieve_invoice", intent "find invoice pdf" — no tool keyword overlap.
 *
 * Frozen 2026-09-27.
 *
 * CLAUDE.md compliance:
 *   - Public MCP surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level
 *     cast:discovered key set, not the explanation sub-object)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src-stdio/coordinator.js';
import type { FocusSuggestions } from '../src-stdio/suggestions.js';
import type { FocusProfile } from '../src-stdio/focus.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Frozen exact key sets ─────────────────────────────────────────────────────

// Base (GBC-1): prompts present because the intent matches the prompt.
const DISCOVERED_BASE: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'prompts', 'resolvedBy',
];

// + suggestions + resources (focus active with matching catalog).
// Note: the suggestions catalog registers its own ch1tty://suggestions/* entries
// via listSuggestionResources(); these score against intent keywords and appear
// as `resources` alongside `suggestions` when the catalog is non-empty.
const DISCOVERED_FOCUS_CATALOG: readonly string[] = [
  ...DISCOVERED_BASE, 'resources', 'suggestions',
];

// + sessionContext (session active, no catalog).
const DISCOVERED_FOCUS_SESSION: readonly string[] = [
  ...DISCOVERED_BASE, 'sessionContext',
];

// + sessionContext + resources + suggestions (focus + catalog + session).
const DISCOVERED_FOCUS_CATALOG_SESSION: readonly string[] = [
  ...DISCOVERED_BASE, 'resources', 'sessionContext', 'suggestions',
];

// ── Inline fixtures ───────────────────────────────────────────────────────────

const BILLING_FOCUS_PROFILE: FocusProfile = {
  description: 'Billing and finance tools',
  categories: ['ecosystem'],
  servers: ['billing'],
  boost: 0.5,
};

// A catalog entry for 'billing' focus with one combo and one prompt.
const BILLING_SUGGESTIONS_CATALOG: Record<string, FocusSuggestions> = {
  billing: {
    description: 'Billing tools for invoice and subscription management.',
    combos: [{
      name: 'billing-subscription-list',
      chain: ['billing/manage_subscription'],
      accomplishes: 'List or manage active billing subscriptions.',
      verified: false,
    }],
    prompts: [{
      text: 'Retrieve invoice history',
      resolves_to: 'billing/retrieve_invoice',
    }],
  },
};

const BASE_CONFIGS: ServerConfig[] = [{
  id: 'billing',
  name: 'Billing',
  type: 'remote',
  access: 'readwrite',
  category: 'ecosystem',
  endpoint: 'https://billing.test/mcp',
  lazy: true,
}];

// Intent that matches the prompt keyword but NOT the tool keyword.
const INTENT = 'find invoice pdf';

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gci-${Date.now()}-${++_seq}.jsonl`);
}

// Keyword-only coordinator — deterministic scoring, no brain route.
class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

function makeBackend(): FixtureBackend {
  const backend = new FixtureBackend();
  backend.defineServer('billing', {
    tools: [{
      name: 'manage_subscription',
      description: 'Manage billing subscriptions for the account',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: '{"subscriptions":[]}' }] },
    }],
    prompts: [{
      name: 'retrieve_invoice',
      description: 'Retrieve invoice history and details for a billing period',
    }],
    resources: [],
  });
  return backend;
}

/** Assert exact key set: sorted actual keys must deep-equal sorted expected. */
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

/** Warm a session with one cast call, then cast again with extras. Returns cast:discovered body. */
async function castDiscovered(
  agg: Aggregator,
  sessionId: string | undefined,
  extras: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  if (sessionId) {
    // Warm so coordinator has session state.
    await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId });
  }
  const result = await agg.callTool('ch1tty/cast', {
    intent: INTENT,
    ...(sessionId ? { sessionId } : {}),
    ...extras,
  });
  assert.equal((result as { isError?: unknown }).isError, undefined, 'cast must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥1 content item');
  assert.equal(content[0]!.type, 'text', 'content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(
    body['cast'],
    'discovered',
    `expected cast:discovered, got cast="${String(body['cast'])}" (intent may have matched a tool)`,
  );
  return body;
}

// ── GCI-1: focus active, no session, no catalog → base keys (no `focus`, no `suggestions`) ──

test('GCI-1: cast:discovered focus active (no catalog, no session) → base 6 keys; `focus` absent', async () => {
  const backend = makeBackend();
  const agg = new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, dlq()),
    focus: 'billing',
    focusProfiles: { profiles: { billing: BILLING_FOCUS_PROFILE } },
    suggestionsCatalog: {},  // empty catalog → no suggestions
  });
  try {
    const body = await castDiscovered(agg, undefined);
    assertExactKeys(body, DISCOVERED_BASE, 'GCI-1 focus-active, no-catalog, no-session');
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'focus'),
      false,
      'GCI-1: `focus` key must be absent from cast:discovered even when focus is active',
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'suggestions'),
      false,
      'GCI-1: `suggestions` must be absent when suggestionsCatalog has no entry for active focus',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GCI-2: focus active, WITH catalog, no session → base + suggestions (7 keys) ──

test('GCI-2: cast:discovered focus active WITH catalog (no session) → base + suggestions; `focus` absent', async () => {
  const backend = makeBackend();
  const agg = new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, dlq()),
    focus: 'billing',
    focusProfiles: { profiles: { billing: BILLING_FOCUS_PROFILE } },
    suggestionsCatalog: BILLING_SUGGESTIONS_CATALOG,
  });
  try {
    const body = await castDiscovered(agg, undefined);
    assertExactKeys(body, DISCOVERED_FOCUS_CATALOG, 'GCI-2 focus-active, with-catalog, no-session');
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'focus'),
      false,
      'GCI-2: `focus` key must be absent from cast:discovered even with catalog present',
    );
    assert.equal(typeof body['suggestions'], 'object', 'suggestions must be an object');
    assert.notEqual(body['suggestions'], null, 'suggestions must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GCI-3: focus active, WITH catalog, session active → base + sessionContext + suggestions (8 keys) ──

test('GCI-3: cast:discovered focus + catalog + session → base + sessionContext + suggestions (8 keys)', async () => {
  const backend = makeBackend();
  const agg = new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, dlq()),
    focus: 'billing',
    focusProfiles: { profiles: { billing: BILLING_FOCUS_PROFILE } },
    suggestionsCatalog: BILLING_SUGGESTIONS_CATALOG,
  });
  try {
    const body = await castDiscovered(agg, 'gci-session-3');
    assertExactKeys(body, DISCOVERED_FOCUS_CATALOG_SESSION, 'GCI-3 focus+catalog+session');
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'focus'),
      false,
      'GCI-3: `focus` key must remain absent even when focus + session + catalog are all active',
    );
    assert.equal(typeof body['sessionContext'], 'object', 'sessionContext must be an object');
    assert.notEqual(body['sessionContext'], null, 'sessionContext must not be null');
    assert.equal(typeof body['suggestions'], 'object', 'suggestions must be an object');
    assert.notEqual(body['suggestions'], null, 'suggestions must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GCI-4: focus active, no catalog, session active → base + sessionContext (7 keys) ──

test('GCI-4: cast:discovered focus (no catalog) + session → base + sessionContext only (7 keys)', async () => {
  const backend = makeBackend();
  const agg = new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, dlq()),
    focus: 'billing',
    focusProfiles: { profiles: { billing: BILLING_FOCUS_PROFILE } },
    suggestionsCatalog: {},  // no catalog entry
  });
  try {
    const body = await castDiscovered(agg, 'gci-session-4');
    assertExactKeys(body, DISCOVERED_FOCUS_SESSION, 'GCI-4 focus+session, no-catalog');
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'focus'),
      false,
      'GCI-4: `focus` key must be absent even with focus active and session present',
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'suggestions'),
      false,
      'GCI-4: `suggestions` must be absent when catalog has no entry for active focus',
    );
    assert.equal(typeof body['sessionContext'], 'object', 'sessionContext must be an object');
    assert.notEqual(body['sessionContext'], null, 'sessionContext must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GCI-5: absence guard — `focus` never present, even via per-call focus arg ──

test('GCI-5: cast:discovered never includes `focus` key regardless of focus source (constructor or per-call)', async () => {
  // Test 1: constructor focus.
  const backendA = makeBackend();
  const aggConstructor = new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backendA,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, dlq()),
    focus: 'billing',
    focusProfiles: { profiles: { billing: BILLING_FOCUS_PROFILE } },
    suggestionsCatalog: BILLING_SUGGESTIONS_CATALOG,
  });
  try {
    const body = await castDiscovered(aggConstructor, undefined);
    assert.equal(body['cast'], 'discovered', 'GCI-5 constructor: must be cast:discovered');
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'focus'),
      false,
      'GCI-5 (constructor focus): `focus` key must be absent from cast:discovered',
    );
  } finally {
    await aggConstructor.shutdown();
  }

  // Test 2: per-call focus arg.
  const backendB = makeBackend();
  const aggPerCall = new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backendB,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, dlq()),
    focusProfiles: { profiles: { billing: BILLING_FOCUS_PROFILE } },
    suggestionsCatalog: BILLING_SUGGESTIONS_CATALOG,
  });
  try {
    const body = await castDiscovered(aggPerCall, undefined, { focus: 'billing' });
    assert.equal(body['cast'], 'discovered', 'GCI-5 per-call: must be cast:discovered');
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'focus'),
      false,
      'GCI-5 (per-call focus): `focus` key must be absent from cast:discovered even with per-call focus arg',
    );
  } finally {
    await aggPerCall.shutdown();
  }
});
