/**
 * FJ drift guard: freeze the presence/absence of `mode` in ch1tty/search envelopes.
 *
 * FI-7 confirms `mode: 'partial'` is present on partial fallback. This file
 * closes the complementary gap: no prior test confirms `mode` is ABSENT on
 * full (non-partial) results or on the server-summary path. A refactor that
 * unconditionally adds `mode` or removes it from partial results would pass FI
 * silently.
 *
 * Semantics of `mode: 'partial'`:
 *   Set by handleSearch (src/core.ts:590) iff:
 *     - a query is present AND
 *     - the query has > 1 term AND
 *     - AND-match yields 0 results (falls back to OR-match)
 *   Absent in all other cases: single-term queries, full AND matches,
 *   server-summary path (no query), and zero-result single-term queries.
 *
 * Suites:
 *   Suite 1 — mode absent on non-partial keyword results (FJ-1..4)
 *     FJ-1  single-term query full match → mode absent
 *     FJ-2  multi-term query full AND match → mode absent
 *     FJ-3  single-term query no match → mode absent (single term never partial)
 *     FJ-4  multi-term with full AND match + focus → mode still absent
 *
 *   Suite 2 — mode:partial presence and value on fallback (FJ-5..8)
 *     FJ-5  multi-term AND=0, OR>0 → mode present, value exactly 'partial'
 *     FJ-6  mode value type is string (not boolean or number) when present
 *     FJ-7  partial + sessionId → both mode and sessionId in envelope
 *     FJ-8  partial + explain:true → mode coexists with explanation key
 *
 *   Suite 3 — mode absent on server-summary and focus-only paths (FJ-9..12)
 *     FJ-9   server-summary (no query) → mode absent
 *     FJ-10  server-summary + explain:true → mode still absent
 *     FJ-11  full match + focus active → mode absent
 *     FJ-12  partial fallback + focus → mode still present (focus doesn't suppress it)
 *
 * Frozen 2026-09-20.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';
import type { FixtureToolDef } from './fixture-backend.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-fj-${Date.now()}-${++dlqSeq}.jsonl`);
}

function tool(name: string, description: string): FixtureToolDef {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties: {} },
    response: { content: [{ type: 'text', text: 'ok' }] },
  };
}

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
  // alpha: tools with 'database' + 'code' terms in description
  backend.defineServer('alpha', {
    tools: [
      tool('list_databases', 'List all databases in the code development environment'),
      tool('create_database', 'Create a new code database project'),
    ],
  });
  // beta: tools with 'payment' + 'invoice' terms in description
  backend.defineServer('beta', {
    tools: [
      tool('list_invoices', 'List payment invoices for billing'),
      tool('send_payment', 'Send a payment to an invoice recipient'),
    ],
  });
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

// ── Suite 1: mode absent on non-partial keyword results ───────────────────────

describe('FJ-1..4: mode key absent on full matches and single-term queries', () => {
  test('FJ-1: single-term query full match — mode absent from envelope', async () => {
    const agg = makeAgg();
    // 'database' appears in alpha tool descriptions — AND match succeeds, no partial
    const result = await agg.callTool('ch1tty/search', { query: 'database' });
    assert.equal(result.isError, undefined);
    const body = parseBody(result);
    assert.ok(!('mode' in body),
      `mode must be absent on full single-term match; got mode=${JSON.stringify(body.mode)}`);
  });

  test('FJ-2: multi-term query full AND match — mode absent from envelope', async () => {
    const agg = makeAgg();
    // 'database code' — both terms appear in alpha tool descriptions → AND match > 0
    const result = await agg.callTool('ch1tty/search', { query: 'database code' });
    assert.equal(result.isError, undefined);
    const body = parseBody(result);
    assert.ok(!('mode' in body),
      `mode must be absent when AND match succeeds; got mode=${JSON.stringify(body.mode)}`);
  });

  test('FJ-3: single-term query no match — mode absent (single term never triggers partial)', async () => {
    const agg = makeAgg();
    // 'zzznomatch' — zero AND results, but only one term so no partial fallback
    const result = await agg.callTool('ch1tty/search', { query: 'zzznomatch' });
    assert.equal(result.isError, undefined);
    const body = parseBody(result);
    assert.ok(!('mode' in body),
      `mode must be absent for single-term no-match query; got mode=${JSON.stringify(body.mode)}`);
  });

  test('FJ-4: multi-term full AND match with focus active — mode still absent', async () => {
    const agg = makeAgg({ withFocus: true });
    // 'database code' still AND-matches → no partial fallback regardless of focus
    const result = await agg.callTool('ch1tty/search', { query: 'database code' });
    assert.equal(result.isError, undefined);
    const body = parseBody(result);
    assert.ok(!('mode' in body),
      `mode must be absent on full match even with focus active; got mode=${JSON.stringify(body.mode)}`);
  });
});

// ── Suite 2: mode:partial presence and value on fallback ─────────────────────

describe('FJ-5..8: mode:partial present with correct type and coexistence', () => {
  test('FJ-5: multi-term AND=0 OR>0 — mode present with value exactly "partial"', async () => {
    const agg = makeAgg();
    // 'database payment' — 'database' hits alpha, 'payment' hits beta → AND=0, OR>0 → partial
    const result = await agg.callTool('ch1tty/search', { query: 'database payment' });
    assert.equal(result.isError, undefined);
    const body = parseBody(result);
    assert.ok('mode' in body,
      'mode key must be present for partial fallback');
    assert.equal(body.mode, 'partial',
      `mode value must be exactly string "partial"; got ${JSON.stringify(body.mode)}`);
  });

  test('FJ-6: mode value is a string (not boolean or number) when present', async () => {
    const agg = makeAgg();
    const result = await agg.callTool('ch1tty/search', { query: 'database payment' });
    assert.equal(result.isError, undefined);
    const body = parseBody(result);
    assert.ok('mode' in body, 'mode must be present on partial fallback for type check');
    assert.equal(typeof body.mode, 'string',
      `mode must be typeof string; got typeof=${typeof body.mode} value=${JSON.stringify(body.mode)}`);
  });

  test('FJ-7: partial fallback + sessionId — both mode and sessionId present in envelope', async () => {
    const agg = makeAgg();
    const result = await agg.callTool('ch1tty/search', {
      query: 'database payment',
      sessionId: 'test-session-fj-7',
    });
    assert.equal(result.isError, undefined);
    const body = parseBody(result);
    assert.ok('mode' in body, 'mode must be present on partial fallback');
    assert.equal(body.mode, 'partial');
    assert.ok('sessionId' in body, 'sessionId must be present when sessionId arg provided');
    assert.equal(body.sessionId, 'test-session-fj-7');
  });

  test('FJ-8: partial fallback + explain:true — mode coexists with explanation in envelope', async () => {
    const agg = makeAgg();
    const result = await agg.callTool('ch1tty/search', {
      query: 'database payment',
      explain: true,
    });
    assert.equal(result.isError, undefined);
    const body = parseBody(result);
    assert.ok('mode' in body, 'mode must be present on partial fallback');
    assert.equal(body.mode, 'partial');
    assert.ok('explanation' in body,
      'explanation must be present when explain:true — mode must not suppress it');
  });
});

// ── Suite 3: mode absent from server-summary and focus-only paths ─────────────

describe('FJ-9..12: mode absent from server-summary path and full-focus matches', () => {
  test('FJ-9: server-summary (no query) — mode absent from envelope', async () => {
    const agg = makeAgg();
    // No query → server-summary path, mode is keyword-path-only
    const result = await agg.callTool('ch1tty/search', {});
    assert.equal(result.isError, undefined);
    const body = parseBody(result);
    assert.ok(!('mode' in body),
      `mode must be absent on server-summary path; got mode=${JSON.stringify(body.mode)}`);
  });

  test('FJ-10: server-summary + explain:true — mode still absent', async () => {
    const agg = makeAgg();
    // explain:true on server-summary path must not inject mode
    const result = await agg.callTool('ch1tty/search', { explain: true });
    assert.equal(result.isError, undefined);
    const body = parseBody(result);
    assert.ok(!('mode' in body),
      `mode must be absent on server-summary even with explain:true; got mode=${JSON.stringify(body.mode)}`);
  });

  test('FJ-11: full AND match with focus active — mode absent (focus does not inject mode)', async () => {
    const agg = makeAgg({ withFocus: true });
    // 'list' appears in both alpha tools → AND match succeeds, no partial even with focus
    const result = await agg.callTool('ch1tty/search', { query: 'list' });
    assert.equal(result.isError, undefined);
    const body = parseBody(result);
    assert.ok(!('mode' in body),
      `mode must be absent on full match with focus; got mode=${JSON.stringify(body.mode)}`);
  });

  test('FJ-12: partial fallback + focus — mode still present (focus does not suppress partial)', async () => {
    const agg = makeAgg({ withFocus: true });
    // 'database payment' still triggers partial regardless of focus
    const result = await agg.callTool('ch1tty/search', {
      query: 'database payment',
    });
    assert.equal(result.isError, undefined);
    const body = parseBody(result);
    assert.ok('mode' in body,
      'mode must be present on partial fallback even when focus is active');
    assert.equal(body.mode, 'partial',
      `mode value must be "partial" regardless of focus; got ${JSON.stringify(body.mode)}`);
  });
});
