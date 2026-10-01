/**
 * GEH drift guard: freeze cast:discovered exact top-level key set when BOTH
 * a focus profile is active (with a catalog entry) AND explain:true is set.
 *
 * Prior discovered exact-keyset coverage:
 *   GBC   : froze cast:discovered base key set (no scope, no session, no focus)
 *   GBH-2 : froze cast:discovered + explain:true — EXACTLY base + explanation
 *            (no focus, no catalog → 7 keys)
 *   GCI-1 : froze cast:discovered + focus (no catalog) → base 6 keys (focus absent)
 *   GCI-2 : froze cast:discovered + focus + catalog → base + resources + suggestions (8 keys)
 *
 * Gap: No test covers the three-way combination focus ∧ catalog ∧ explain.
 * A regression that:
 *   (a) drops `explanation` from discovered when focus+catalog are both active, or
 *   (b) drops `suggestions` from discovered when explain is also set,
 * would pass GBH-2 (no catalog/focus) and GCI-2 (no explain) silently.
 *
 * Actual body (src-stdio/aggregator.ts ~lines 1416–1444):
 *   { cast, resolvedBy, intent, latencyMs,
 *     ...(scopeAnnotation  ? { scope }       : {}),
 *     ...(explanation      ? { explanation } : {}),
 *     hint,
 *     ...related,               // prompts, resources
 *     ...(sessionContext   ? { sessionContext } : {}),
 *     ...(focusSuggestions ? { suggestions }   : {}),
 *   }
 *
 * Frozen key sets (keyword route, billing fixture, billing catalog, no session):
 *
 *   focus + catalog + explain (no session):
 *     {cast, explanation, hint, intent, latencyMs, prompts, resolvedBy,
 *      resources, suggestions}
 *     = base(6) + explanation + resources + suggestions = 9 keys
 *
 *   focus + catalog + explain + session:
 *     above + sessionContext = 10 keys
 *
 *   focus + no-catalog + explain (no session):
 *     base(6) + explanation = 7 keys (same as GBH-2; confirms no extra injection)
 *
 * Absence guards:
 *   `focus` key is never present in cast:discovered regardless of focus state
 *   `suggestions` absent when focus is active but no catalog entry exists
 *
 * Frozen 2026-09-30.
 *
 * CLAUDE.md compliance:
 *   - Public MCP surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level cast:discovered
 *     key set, not the explanation sub-object)
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

// ── Frozen exact key sets (sorted alphabetically) ─────────────────────────────

const DISCOVERED_BASE: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'prompts', 'resolvedBy',
];

// focus + catalog + explain, no session: base + explanation + resources + suggestions
const DISCOVERED_FOCUS_CATALOG_EXPLAIN: readonly string[] = [
  ...DISCOVERED_BASE, 'explanation', 'resources', 'suggestions',
].sort() as string[];

// focus + catalog + explain + session: above + sessionContext
const DISCOVERED_FOCUS_CATALOG_EXPLAIN_SESSION: readonly string[] = [
  ...DISCOVERED_BASE, 'explanation', 'resources', 'sessionContext', 'suggestions',
].sort() as string[];

// focus + no-catalog + explain: base + explanation only (no suggestions without catalog)
const DISCOVERED_FOCUS_NOCATALOG_EXPLAIN: readonly string[] = [
  ...DISCOVERED_BASE, 'explanation',
].sort() as string[];

// ── Inline fixtures ───────────────────────────────────────────────────────────

const BILLING_FOCUS_PROFILE: FocusProfile = {
  description: 'Billing and finance tools',
  categories: ['ecosystem'],
  servers: ['billing'],
  boost: 0.5,
};

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

// Intent that matches the prompt keyword but NOT the tool threshold.
const INTENT = 'find invoice pdf';

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-geh-${Date.now()}-${++_seq}.jsonl`);
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

async function castDiscovered(
  agg: Aggregator,
  sessionId: string | undefined,
  extras: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  if (sessionId) {
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

// ── GEH-1: focus + catalog + explain, no session → 9 keys ────────────────────

test('GEH-1: cast:discovered focus+catalog+explain (no session) → EXACTLY 9 keys', async () => {
  const agg = new Aggregator(BASE_CONFIGS, {
    backendFactory: () => makeBackend(),
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, dlq()),
    focus: 'billing',
    focusProfiles: { profiles: { billing: BILLING_FOCUS_PROFILE } },
    suggestionsCatalog: BILLING_SUGGESTIONS_CATALOG,
  });
  const body = await castDiscovered(agg, undefined, { explain: true });
  assertExactKeys(body, DISCOVERED_FOCUS_CATALOG_EXPLAIN, 'GEH-1 focus+catalog+explain, no session');
});

// ── GEH-2: focus + catalog + explain + session → 10 keys ─────────────────────

test('GEH-2: cast:discovered focus+catalog+explain+session → EXACTLY 10 keys', async () => {
  const agg = new Aggregator(BASE_CONFIGS, {
    backendFactory: () => makeBackend(),
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, dlq()),
    focus: 'billing',
    focusProfiles: { profiles: { billing: BILLING_FOCUS_PROFILE } },
    suggestionsCatalog: BILLING_SUGGESTIONS_CATALOG,
  });
  const SESSION = 'geh-2';
  const body = await castDiscovered(agg, SESSION, { explain: true });
  assertExactKeys(body, DISCOVERED_FOCUS_CATALOG_EXPLAIN_SESSION, 'GEH-2 focus+catalog+explain+session');
});

// ── GEH-3: focus + no-catalog + explain → 7 keys (same as GBH-2) ─────────────

test('GEH-3: cast:discovered focus+no-catalog+explain → EXACTLY 7 keys (base + explanation only)', async () => {
  const agg = new Aggregator(BASE_CONFIGS, {
    backendFactory: () => makeBackend(),
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, dlq()),
    focus: 'billing',
    focusProfiles: { profiles: { billing: BILLING_FOCUS_PROFILE } },
    suggestionsCatalog: {},  // empty catalog → no suggestions
  });
  const body = await castDiscovered(agg, undefined, { explain: true });
  assertExactKeys(body, DISCOVERED_FOCUS_NOCATALOG_EXPLAIN, 'GEH-3 focus+no-catalog+explain');
});

// ── GEH-4: absence guard — `focus` key never in discovered body ───────────────

test('GEH-4: absence guard — `focus` key is never in cast:discovered even with focus+catalog+explain', async () => {
  const agg = new Aggregator(BASE_CONFIGS, {
    backendFactory: () => makeBackend(),
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, dlq()),
    focus: 'billing',
    focusProfiles: { profiles: { billing: BILLING_FOCUS_PROFILE } },
    suggestionsCatalog: BILLING_SUGGESTIONS_CATALOG,
  });
  const body = await castDiscovered(agg, undefined, { explain: true });
  assert.ok(
    !Object.prototype.hasOwnProperty.call(body, 'focus'),
    '`focus` must be absent from cast:discovered even when focus profile is active and explain is set',
  );
});

// ── GEH-5: per-call focus also drops `focus` key; explanation still present ───

test('GEH-5: per-call focus+catalog+explain → no `focus` key; explanation present', async () => {
  const agg = new Aggregator(BASE_CONFIGS, {
    backendFactory: () => makeBackend(),
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, dlq()),
    // No constructor focus — use per-call focus param instead
    focusProfiles: { profiles: { billing: BILLING_FOCUS_PROFILE } },
    suggestionsCatalog: BILLING_SUGGESTIONS_CATALOG,
  });
  const body = await castDiscovered(agg, undefined, { focus: 'billing', explain: true });
  assertExactKeys(body, DISCOVERED_FOCUS_CATALOG_EXPLAIN, 'GEH-5 per-call focus+catalog+explain');
  assert.ok(
    !Object.prototype.hasOwnProperty.call(body, 'focus'),
    '`focus` must be absent from cast:discovered with per-call focus+explain',
  );
  assert.ok(
    Object.prototype.hasOwnProperty.call(body, 'explanation'),
    '`explanation` must be present when explain:true is set',
  );
});
