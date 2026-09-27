/**
 * GCU drift guard: freeze ch1tty/search top-level `sessionId` echo conditional.
 *
 * Source: src-stdio/aggregator.ts — keyword-search return (line ~865):
 *
 *   ...(effectiveSessionId ? { sessionId: effectiveSessionId } : {}),
 *
 * where:
 *   effectiveSessionId = (typeof args.sessionId === 'string' && args.sessionId)
 *     ? args.sessionId
 *     : sessionId;       // callTool's third argument
 *
 * Existing coverage:
 *   - aaa-execute-status-orphan-search-sessionid.test.ts — test 6 verifies sessionId
 *     is PRESENT when callTool is invoked with a sessionId (the callTool path).
 *     It does not test the ABSENCE case, the args.sessionId path, args-vs-callTool
 *     priority, or the discovery path asymmetry.
 *   - gp-search-toplevel-value-types-drift-guard.test.ts — freezes numeric/string
 *     types for the fixed fields. sessionId is not a fixed field; it is conditional.
 *
 * GCU closes four gaps:
 *
 *   GCU-1  keyword search, no session → top-level `sessionId` KEY IS ABSENT
 *   GCU-2  keyword search + args.sessionId → `sessionId` === args value
 *   GCU-3  args.sessionId takes priority over callTool sessionId
 *   GCU-4  empty-string args.sessionId (falsy) → `sessionId` ABSENT
 *   GCU-5  discovery path (no query) with args.sessionId active → `sessionId` ABSENT
 *          (discovery path never echoes sessionId — only sessionContext when session active)
 *
 * Frozen 2026-09-27.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only)
 *   - buildCastExplanation metric freeze: not applicable (search, not cast)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gcu-${Date.now()}-${++dlqSeq}.jsonl`);
}

const BASE_CONFIGS: ServerConfig[] = [
  { id: 'neon', name: 'Neon DB', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true },
  { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true },
];

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

async function search(
  agg: Aggregator,
  args: Record<string, unknown>,
  sessionId?: string,
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/search', args, sessionId);
  assert.equal(result.isError, undefined, 'search must not error');
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

// ── GCU-1: keyword search, no session → sessionId ABSENT ─────────────────────

test('GCU-1: keyword search with no session → sessionId key absent from envelope', async () => {
  const agg = makeAgg();
  try {
    const body = await search(agg, { query: 'database' });
    assert.ok(
      !('sessionId' in body),
      `sessionId must be absent when no session is active; got: ${JSON.stringify(body['sessionId'])}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GCU-2: keyword search + args.sessionId → sessionId echoes args value ─────

test('GCU-2: keyword search with args.sessionId → sessionId echoes the args value', async () => {
  const agg = makeAgg();
  const sessionIdValue = 'gcu-args-session-42';
  try {
    const body = await search(agg, { query: 'database', sessionId: sessionIdValue });
    assert.ok(
      'sessionId' in body,
      'sessionId must be present when args.sessionId is provided',
    );
    assert.equal(
      body['sessionId'],
      sessionIdValue,
      `sessionId must echo the args value; expected "${sessionIdValue}", got "${body['sessionId']}"`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GCU-3: args.sessionId takes priority over callTool sessionId ─────────────

test('GCU-3: args.sessionId takes priority over the callTool sessionId parameter', async () => {
  const agg = makeAgg();
  const argsSessionId = 'gcu-args-wins';
  const callToolSessionId = 'gcu-calltool-loses';
  try {
    // Pass a different sessionId in args vs callTool third argument.
    // effectiveSessionId = args.sessionId when args.sessionId is a non-empty string.
    const body = await search(agg, { query: 'database', sessionId: argsSessionId }, callToolSessionId);
    assert.ok(
      'sessionId' in body,
      'sessionId must be present when args.sessionId is a non-empty string',
    );
    assert.equal(
      body['sessionId'],
      argsSessionId,
      `args.sessionId must win; expected "${argsSessionId}", got "${body['sessionId']}"`,
    );
    assert.notEqual(
      body['sessionId'],
      callToolSessionId,
      `callTool sessionId must NOT appear when args.sessionId is set`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GCU-4: empty-string args.sessionId (falsy) → sessionId ABSENT ────────────

test('GCU-4: empty-string args.sessionId → sessionId absent (empty string is falsy in effectiveSessionId)', async () => {
  const agg = makeAgg();
  try {
    // args.sessionId = '' → typeof '' === 'string' && '' is false → falls back to callTool
    // sessionId which is also not provided → effectiveSessionId = undefined → sessionId absent.
    const body = await search(agg, { query: 'database', sessionId: '' });
    assert.ok(
      !('sessionId' in body),
      `sessionId must be absent when args.sessionId is an empty string; got: ${JSON.stringify(body['sessionId'])}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GCU-4b: empty-string args.sessionId falls back to callTool sessionId ────────

test('GCU-4b: empty-string args.sessionId falls back to the callTool sessionId', async () => {
  const agg = makeAgg();
  const callToolSessionId = 'gcu-calltool-fallback';
  try {
    const body = await search(agg, { query: 'database', sessionId: '' }, callToolSessionId);
    assert.equal(
      body['sessionId'],
      callToolSessionId,
      `empty args.sessionId must fall back to callTool sessionId "${callToolSessionId}", got: ${JSON.stringify(body['sessionId'])}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GCU-5: discovery path (no query) + args.sessionId → sessionId ABSENT ─────

test('GCU-5: discovery path (no query) never echoes sessionId even when args.sessionId is active', async () => {
  const agg = makeAgg();
  try {
    // Discovery path returns: hint, latencyMs, servers, totalTools (+ optional focus/sessionContext).
    // It does NOT include sessionId. sessionContext may appear but sessionId never does.
    const body = await search(agg, { sessionId: 'gcu-discovery-session' });
    assert.ok(
      !('sessionId' in body),
      `sessionId must be absent in the discovery path; got: ${JSON.stringify(body['sessionId'])}`,
    );
    // Sanity-check we got the discovery path (has 'servers' not 'tools')
    assert.ok(
      'servers' in body,
      'discovery path response must contain a "servers" field',
    );
  } finally {
    await agg.shutdown();
  }
});
