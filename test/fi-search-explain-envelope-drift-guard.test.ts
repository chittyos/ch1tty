/**
 * FI drift guard: freeze ch1tty/search top-level response envelope key sets
 * when explain:true is present, and freeze conditional keys (mode, sessionId).
 *
 * FD froze the keyword-search envelope for non-explain paths.
 * FC froze the server-summary EXPLANATION sub-object contents.
 * Neither test froze the top-level envelope for the server-summary path, nor the
 * keyword path when explain:true is requested. A field addition or rename at the
 * envelope level (e.g. `explanation` → `explain`, or new `diagnostics` key) would
 * silently break API clients without this guard.
 *
 * ── Suites ───────────────────────────────────────────────────────────────────
 *
 * Suite 1 — Keyword path: explain presence/absence in envelope (3 tests)
 *   FI-1  explain:true, no focus  → exactly ['explanation','latencyMs','matches','total','tools']
 *   FI-2  explain:true, focus     → exactly ['explanation','focus','latencyMs','matches','total','tools']
 *   FI-3  explain:false/omitted   → exactly ['latencyMs','matches','total','tools'] (no 'explanation')
 *
 * Suite 2 — Server-summary path envelope (3 tests)
 *   FI-4  no explain, no focus    → exactly ['hint','latencyMs','servers','totalTools']
 *   FI-5  explain:true, no focus  → exactly ['explanation','hint','latencyMs','servers','totalTools']
 *   FI-6  explain:true, focus     → exactly ['explanation','focus','hint','latencyMs','servers','totalTools']
 *
 * Suite 3 — Conditional keyword envelope keys absent from FD (3 tests)
 *   FI-7  partialFallback path    → 'mode' key is present; value is exactly 'partial'
 *   FI-8  sessionId in args       → 'sessionId' key present in envelope
 *   FI-9  no sessionId in args    → 'sessionId' key absent from envelope
 *
 * Suite 4 — explanation value types in both paths (3 tests)
 *   FI-10 keyword explanation is a non-null object (not a string/array/null)
 *   FI-11 server-summary explanation is a non-null object
 *   FI-12 keyword explanation method field is always a string
 *
 * CLAUDE.md compliance:
 *   - Public surface unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (search explain)
 *
 * Frozen 2026-09-19.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { FixtureBackend } from './fixture-backend.js';
import type { FixtureToolDef } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

// ── Frozen key-set constants (sorted both sides via .sort() at assertion time) ──

/** Keyword path: base envelope (no explain, no focus, no session extras) */
const KW_BASE: readonly string[] = ['latencyMs', 'matches', 'total', 'tools'];
/** Keyword path: explain:true, no focus */
const KW_EXPLAIN: readonly string[] = ['explanation', 'latencyMs', 'matches', 'total', 'tools'];
/** Keyword path: explain:true + focus */
const KW_EXPLAIN_FOCUS: readonly string[] = ['explanation', 'focus', 'latencyMs', 'matches', 'total', 'tools'];
/** Server-summary: no explain, no focus */
const SS_BASE: readonly string[] = ['hint', 'latencyMs', 'servers', 'totalTools'];
/** Server-summary: explain:true, no focus */
const SS_EXPLAIN: readonly string[] = ['explanation', 'hint', 'latencyMs', 'servers', 'totalTools'];
/** Server-summary: explain:true + focus */
const SS_EXPLAIN_FOCUS: readonly string[] = ['explanation', 'focus', 'hint', 'latencyMs', 'servers', 'totalTools'];

// ── Helpers ───────────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-fi-${Date.now()}-${++dlqSeq}.jsonl`);
}

function tool(name: string, description: string): FixtureToolDef {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties: {} },
    response: { content: [{ type: 'text', text: 'ok' }] },
  };
}

const ALPHA_TOOLS: FixtureToolDef[] = [
  tool('list_databases', 'List all databases in the code project environment'),
  tool('create_database', 'Create a new database for code development work'),
];
const BETA_TOOLS: FixtureToolDef[] = [
  tool('list_invoices', 'List invoices for billing and accounting records'),
  tool('process_payment', 'Process a payment for a billing invoice'),
];

const ALPHA_CFG: ServerConfig = {
  id: 'alpha', name: 'Alpha', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://alpha.test/mcp', lazy: true,
};
const BETA_CFG: ServerConfig = {
  id: 'beta', name: 'Beta', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://beta.test/mcp', lazy: true,
};

const FOCUS_PROFILES = {
  profiles: {
    dev: { categories: ['code'] as string[], servers: ['alpha'] as string[], boost: 0.5 },
  },
};

function makeAgg(opts: { withFocus?: boolean } = {}): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('alpha', { tools: ALPHA_TOOLS });
  backend.defineServer('beta', { tools: BETA_TOOLS });
  return new Aggregator([ALPHA_CFG, BETA_CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    ...(opts.withFocus ? { focus: 'dev', focusProfiles: FOCUS_PROFILES } : {}),
  });
}

function parseBody(result: { content: Array<{ type: string; text: string }> }): Record<string, unknown> {
  assert.ok(result.content.length >= 1, 'result must have at least one content item');
  const item = result.content[0];
  assert.ok(item && item.type === 'text', 'first content item must be text');
  return JSON.parse(item.text) as Record<string, unknown>;
}

// ── Suite 1: Keyword path — explain in envelope ───────────────────────────────

describe('FI-1..3: keyword path explain:true/false envelope key sets', () => {
  // FI-1
  test('FI-1: explain:true no-focus — envelope is exactly 5 keys (adds explanation)', async () => {
    const agg = makeAgg();
    const result = await agg.callTool('ch1tty/search', { query: 'list databases', explain: true });
    assert.equal(result.isError, undefined);
    const body = parseBody(result);
    const keys = Object.keys(body).sort();
    assert.deepEqual(keys, [...KW_EXPLAIN].sort(),
      `expected exactly ${KW_EXPLAIN.length} keys; got ${JSON.stringify(keys)}`);
  });

  // FI-2
  test('FI-2: explain:true focus active — envelope is exactly 6 keys (explanation + focus)', async () => {
    const agg = makeAgg({ withFocus: true });
    const result = await agg.callTool('ch1tty/search', { query: 'list databases', explain: true });
    assert.equal(result.isError, undefined);
    const body = parseBody(result);
    const keys = Object.keys(body).sort();
    assert.deepEqual(keys, [...KW_EXPLAIN_FOCUS].sort(),
      `expected exactly ${KW_EXPLAIN_FOCUS.length} keys; got ${JSON.stringify(keys)}`);
  });

  // FI-3
  test('FI-3: explain omitted — envelope is exactly 4 keys (no explanation)', async () => {
    const agg = makeAgg();
    const result = await agg.callTool('ch1tty/search', { query: 'list databases' });
    assert.equal(result.isError, undefined);
    const body = parseBody(result);
    assert.ok(!('explanation' in body), 'explanation must be absent when explain is not requested');
    const keys = Object.keys(body).sort();
    assert.deepEqual(keys, [...KW_BASE].sort(),
      `expected exactly ${KW_BASE.length} keys; got ${JSON.stringify(keys)}`);
  });
});

// ── Suite 2: Server-summary path envelope ─────────────────────────────────────

describe('FI-4..6: server-summary path envelope key sets', () => {
  // FI-4
  test('FI-4: server-summary no explain no focus — envelope is exactly 4 keys', async () => {
    const agg = makeAgg();
    // No query → server-summary path
    const result = await agg.callTool('ch1tty/search', {});
    assert.equal(result.isError, undefined);
    const body = parseBody(result);
    const keys = Object.keys(body).sort();
    assert.deepEqual(keys, [...SS_BASE].sort(),
      `expected exactly ${SS_BASE.length} keys; got ${JSON.stringify(keys)}`);
  });

  // FI-5
  test('FI-5: server-summary explain:true no focus — envelope is exactly 5 keys (adds explanation)', async () => {
    const agg = makeAgg();
    const result = await agg.callTool('ch1tty/search', { explain: true });
    assert.equal(result.isError, undefined);
    const body = parseBody(result);
    const keys = Object.keys(body).sort();
    assert.deepEqual(keys, [...SS_EXPLAIN].sort(),
      `expected exactly ${SS_EXPLAIN.length} keys; got ${JSON.stringify(keys)}`);
  });

  // FI-6
  test('FI-6: server-summary explain:true focus active — envelope is exactly 6 keys', async () => {
    const agg = makeAgg({ withFocus: true });
    const result = await agg.callTool('ch1tty/search', { explain: true });
    assert.equal(result.isError, undefined);
    const body = parseBody(result);
    const keys = Object.keys(body).sort();
    assert.deepEqual(keys, [...SS_EXPLAIN_FOCUS].sort(),
      `expected exactly ${SS_EXPLAIN_FOCUS.length} keys; got ${JSON.stringify(keys)}`);
  });
});

// ── Suite 3: Conditional keyword envelope keys (mode, sessionId) ──────────────

describe('FI-7..9: conditional keyword envelope keys', () => {
  // FI-7: partial fallback path — query words match separately but not together
  // Two tools: 'list_databases' and 'process_payment'. A query of 'list payment'
  // matches neither tool exactly via AND (no tool has both terms in description),
  // triggering partial fallback which produces 'mode: partial' in the envelope.
  test('FI-7: partial fallback — mode:partial present in envelope', async () => {
    const backend = new FixtureBackend();
    backend.defineServer('alpha', {
      tools: [
        tool('list_databases', 'List databases for development work'),
      ],
    });
    backend.defineServer('beta', {
      tools: [
        tool('send_payment', 'Send a payment to a recipient account'),
      ],
    });
    const agg = new Aggregator([ALPHA_CFG, BETA_CFG], {
      backendFactory: () => backend,
      embedEnabled: false,
      ledgerDlqPath: dlq(),
    });
    // 'archive notifications' — neither word appears in any tool description,
    // but partial mode should find partial matches if available, else empty.
    // We use a query guaranteed to trigger partial fallback by having tools
    // where keywords overlap partially but not all at once.
    const result = await agg.callTool('ch1tty/search', {
      query: 'list payment',  // 'list' matches alpha, 'payment' matches beta → AND yields 0
    });
    assert.equal(result.isError, undefined);
    const body = parseBody(result);
    assert.ok('mode' in body, 'mode key must be present for partial fallback');
    assert.equal(body.mode, 'partial', 'mode value must be exactly "partial"');
  });

  // FI-8
  test('FI-8: sessionId in args — sessionId key present in keyword envelope', async () => {
    const agg = makeAgg();
    const result = await agg.callTool('ch1tty/search', {
      query: 'list databases',
      sessionId: 'test-session-fi-8',
    });
    assert.equal(result.isError, undefined);
    const body = parseBody(result);
    assert.ok('sessionId' in body, 'sessionId key must be present in envelope when sessionId arg provided');
    assert.equal(body.sessionId, 'test-session-fi-8', 'sessionId must equal the provided arg value');
  });

  // FI-9
  test('FI-9: no sessionId in args — sessionId key absent from keyword envelope', async () => {
    const agg = makeAgg();
    const result = await agg.callTool('ch1tty/search', { query: 'list databases' });
    assert.equal(result.isError, undefined);
    const body = parseBody(result);
    assert.ok(!('sessionId' in body), 'sessionId key must be absent when no sessionId arg provided');
  });
});

// ── Suite 4: explanation value types ─────────────────────────────────────────

describe('FI-10..12: explanation value types in keyword and server-summary paths', () => {
  // FI-10
  test('FI-10: keyword explanation is a non-null object (not string/array/null)', async () => {
    const agg = makeAgg();
    const result = await agg.callTool('ch1tty/search', { query: 'list databases', explain: true });
    assert.equal(result.isError, undefined);
    const body = parseBody(result);
    const explanation = body.explanation;
    assert.ok(explanation !== null && typeof explanation === 'object' && !Array.isArray(explanation),
      `explanation must be a non-null object; got ${JSON.stringify(explanation)}`);
  });

  // FI-11
  test('FI-11: server-summary explanation is a non-null object', async () => {
    const agg = makeAgg();
    const result = await agg.callTool('ch1tty/search', { explain: true });
    assert.equal(result.isError, undefined);
    const body = parseBody(result);
    const explanation = body.explanation;
    assert.ok(explanation !== null && typeof explanation === 'object' && !Array.isArray(explanation),
      `server-summary explanation must be a non-null object; got ${JSON.stringify(explanation)}`);
  });

  // FI-12
  test('FI-12: keyword explanation.method is a non-empty string', async () => {
    const agg = makeAgg();
    const result = await agg.callTool('ch1tty/search', { query: 'list databases', explain: true });
    assert.equal(result.isError, undefined);
    const body = parseBody(result);
    const explanation = body.explanation as Record<string, unknown>;
    assert.ok(typeof explanation.method === 'string' && explanation.method.length > 0,
      `explanation.method must be a non-empty string; got ${JSON.stringify(explanation.method)}`);
  });
});
