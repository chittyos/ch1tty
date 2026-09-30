/**
 * GDV drift guard: freeze the EXACT TOP-LEVEL KEY SET of ch1tty/search
 * responses in SEARCH mode (query supplied).
 *
 * GH (gh-search-entry-value-types-drift-guard.test.ts) and earlier EB freeze
 * the ENTRIES inside tools[] and servers[], but nothing asserts the ENVELOPE
 * itself. Silently adding a new top-level field (e.g. `cursor`, `version`,
 * `timing`) or silently removing one (e.g. `total`, `latencyMs`) would pass
 * every existing test. GDV closes that gap.
 *
 * Actual search-mode response shape (src-stdio/aggregator.ts handleSearch):
 *
 *   matches     — number: results.length (always present)
 *   total       — number: matches.length (always present)
 *   latencyMs   — number: wall-clock ms (always present)
 *   tools       — array  (always present)
 *   mode        — 'partial' only when AND-match returns 0 results (partialFallback)
 *   focus       — string only when focusName is active
 *   sessionId   — string only when effectiveSessionId is set
 *   sessionContext — object only when effectiveSessionId is set
 *   suggestions — object only when focus active AND query provided AND focus
 *                 has entries in focus-suggestions.json
 *   explanation — object only when explain: true (not tested here)
 *   offset      — number only when offset > 0 (not tested here)
 *   inFocusOnly — boolean only when inFocusOnly: true (not tested here)
 *   minScore    — number only when minScore > 0 (not tested here)
 *
 * Five code paths:
 *
 *   GDV-1  query with matches, no focus, no sessionId
 *          → exact top-level keys = {matches, total, latencyMs, tools}
 *
 *   GDV-2  multi-term query where AND-match is empty → partial-OR fallback
 *          → exact top-level keys = {matches, total, latencyMs, mode, tools}
 *          mode === 'partial'
 *
 *   GDV-3  query with focus 'code' active (has entries in focus-suggestions.json)
 *          → exact top-level keys = {matches, total, latencyMs, focus, suggestions, tools}
 *          suggestions is present because focus-suggestions.json has a 'code' profile
 *
 *   GDV-4  query with sessionId supplied, no focus
 *          → exact top-level keys = {matches, total, latencyMs, sessionId, sessionContext, tools}
 *          sessionContext is always present when effectiveSessionId is set
 *
 *   GDV-5  query with both focus active AND sessionId supplied
 *          → exact top-level keys = {matches, total, latencyMs, focus, sessionId, sessionContext, suggestions, tools}
 *
 * Frozen 2026-09-28.
 *
 * CLAUDE.md compliance:
 *   - Public MCP surface unchanged (5 meta-tools: search/execute/status/reload/cast).
 *   - buildCastExplanation metric freeze: not applicable (search, not cast explain).
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gdv-${Date.now()}-${++_seq}.jsonl`);
}

const BASE_CONFIGS: ServerConfig[] = [
  { id: 'neon', name: 'Neon DB', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true },
  { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true },
];

function makeAgg(opts: { focus?: string } = {}): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    ...(opts.focus
      ? {
          focus: opts.focus,
          focusProfiles: {
            profiles: {
              code: {
                description: 'Code tools',
                categories: ['code' as const],
                servers: [],
                boost: 0.5,
              },
            },
          },
        }
      : {}),
  });
}

async function search(
  agg: Aggregator,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/search', args);
  assert.equal(result.isError, undefined, 'search must not return isError');
  return JSON.parse(
    (result.content[0] as { text: string }).text,
  ) as Record<string, unknown>;
}

/**
 * Assert `obj` has EXACTLY the keys in `expected` — all present, none extra.
 */
function assertExactKeys(
  obj: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const EXACT = new Set(expected);
  const actual = new Set(Object.keys(obj));
  const missing = [...EXACT].filter((k) => !actual.has(k));
  const extra = [...actual].filter((k) => !EXACT.has(k));
  assert.deepEqual(missing, [], `${label}: missing required keys: ${missing.join(', ')}`);
  assert.deepEqual(extra, [], `${label}: unexpected extra keys: ${extra.join(', ')}`);
}

// ── GDV-1: query with matches, no focus, no sessionId ────────────────────────

test('GDV-1: search with query+matches, no focus, no sessionId — exact top-level keys = {matches, total, latencyMs, tools}', async () => {
  const agg = makeAgg();
  try {
    // "list" matches neon/list_projects and stripe/list_payments at minimum.
    const body = await search(agg, { query: 'list' });
    assert.ok(typeof body.matches === 'number', 'GDV-1: matches must be a number');
    assert.ok(typeof body.total === 'number', 'GDV-1: total must be a number');
    assert.ok(typeof body.latencyMs === 'number', 'GDV-1: latencyMs must be a number');
    assert.ok(Array.isArray(body.tools), 'GDV-1: tools must be an array');
    assertExactKeys(body, ['matches', 'total', 'latencyMs', 'tools'], 'GDV-1');
  } finally {
    await agg.shutdown();
  }
});

// ── GDV-2: multi-term no-AND-match → partial fallback adds mode: 'partial' ────

test('GDV-2: partial-fallback query — exact top-level keys = {matches, total, latencyMs, mode, tools}', async () => {
  const agg = makeAgg();
  try {
    // "projects payment": no single fixture tool has BOTH words in its haystack
    // (neon tools have "projects"; stripe tools have "payment"; none have both).
    // AND-match returns 0 → OR-fallback fires → partialFallback=true → mode:'partial'.
    const body = await search(agg, { query: 'projects payment' });
    assert.ok(Array.isArray(body.tools), 'GDV-2: tools must be an array');
    assert.ok((body.tools as unknown[]).length > 0, 'GDV-2: OR-fallback must yield at least one result');
    assert.equal(body.mode, 'partial', 'GDV-2: mode must equal the string "partial"');
    assertExactKeys(body, ['matches', 'total', 'latencyMs', 'mode', 'tools'], 'GDV-2');
  } finally {
    await agg.shutdown();
  }
});

// ── GDV-3: query with focus active — adds focus + suggestions ─────────────────

test('GDV-3: search with focus:code active — exact top-level keys = {matches, total, latencyMs, focus, suggestions, tools}', async () => {
  const agg = makeAgg({ focus: 'code' });
  try {
    // focus-suggestions.json has a 'code' profile, so getSuggestionsForFocus returns
    // non-null → suggestions field is present alongside focus.
    const body = await search(agg, { query: 'neon' });
    assert.ok(typeof body.focus === 'string', 'GDV-3: focus must be a string');
    assert.ok(body.suggestions !== null && typeof body.suggestions === 'object' && !Array.isArray(body.suggestions),
      'GDV-3: suggestions must be a non-null object');
    assertExactKeys(body, ['matches', 'total', 'latencyMs', 'focus', 'suggestions', 'tools'], 'GDV-3');
  } finally {
    await agg.shutdown();
  }
});

// ── GDV-4: query with sessionId — adds sessionId + sessionContext ─────────────

test('GDV-4: search with sessionId, no focus — exact top-level keys = {matches, total, latencyMs, sessionId, sessionContext, tools}', async () => {
  const agg = makeAgg();
  try {
    const sessionId = `gdv-4-${Date.now()}`;
    const body = await search(agg, { query: 'neon', sessionId });
    // sessionContext is always present when effectiveSessionId is set.
    assert.equal(body.sessionId, sessionId, 'GDV-4: sessionId must echo the supplied value');
    assert.ok(body.sessionContext !== null && typeof body.sessionContext === 'object' && !Array.isArray(body.sessionContext),
      'GDV-4: sessionContext must be a non-null object');
    assertExactKeys(body, ['matches', 'total', 'latencyMs', 'sessionId', 'sessionContext', 'tools'], 'GDV-4');
  } finally {
    await agg.shutdown();
  }
});

// ── GDV-5: query with both focus + sessionId ─────────────────────────────────

test('GDV-5: search with focus:code + sessionId — exact top-level keys = {matches, total, latencyMs, focus, sessionId, sessionContext, suggestions, tools}', async () => {
  const agg = makeAgg({ focus: 'code' });
  try {
    const sessionId = `gdv-5-${Date.now()}`;
    const body = await search(agg, { query: 'neon', sessionId });
    assert.ok(typeof body.focus === 'string', 'GDV-5: focus must be a string');
    assert.equal(body.sessionId, sessionId, 'GDV-5: sessionId must echo the supplied value');
    assert.ok(body.sessionContext !== null && typeof body.sessionContext === 'object' && !Array.isArray(body.sessionContext),
      'GDV-5: sessionContext must be a non-null object');
    assert.ok(body.suggestions !== null && typeof body.suggestions === 'object' && !Array.isArray(body.suggestions),
      'GDV-5: suggestions must be a non-null object');
    assertExactKeys(body, ['matches', 'total', 'latencyMs', 'focus', 'sessionId', 'sessionContext', 'suggestions', 'tools'], 'GDV-5');
  } finally {
    await agg.shutdown();
  }
});
