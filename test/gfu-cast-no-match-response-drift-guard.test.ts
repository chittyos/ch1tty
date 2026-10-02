/**
 * GFU drift guard: freeze cast:no_match response structure invariants.
 *
 * Background
 * ----------
 * When all of cast's search surfaces (tools, prompts, resources) score ≤ 0.1
 * against the given intent, cast returns the 'no_match' path:
 *
 *   Source: src/core.ts
 *   line ~934–937:
 *     if (scoredTools.length === 0 && scoredPrompts.length === 0 && scoredResources.length === 0) {
 *       return {
 *         content: [{ type: 'text', text: JSON.stringify({
 *           cast: 'no_match', resolvedBy, intent,
 *           hint: 'No tools, prompts, or resources matched. Try ch1tty/search with different keywords.'
 *         }, null, 2) }],
 *       };
 *     }
 *
 * Why this matters
 * ----------------
 * GFQ froze cast mode values for 'plan' and 'executed' — but not 'no_match'.
 * GFO froze cast:plan hint — but not the no_match hint.
 * cast-no-match.test.ts covers the path at a higher level but not per-invariant.
 * No GF* test has frozen:
 *
 *   (a) body.cast === 'no_match' exactly (no_match not covered by GFQ)
 *   (b) The hint text is the exact string (changing wording is a silent regression)
 *   (c) result.isError is undefined (no_match is informational, not an error)
 *   (d) body.intent echoes the caller's intent (not covered for no_match path)
 *   (e) body has exactly 5 keys: cast/resolvedBy/intent/latencyMs/hint — no extras injected
 *       (latencyMs is always present in the stdio Aggregator; GFU-5 freezes the exact set)
 *
 * A refactor that sets isError: true on no_match (treating it as a failure),
 * changes the hint wording, injects a 'score' field, or omits the intent echo
 * would pass all prior GF* tests silently.
 *
 * GFU closes those gaps:
 *
 *   GFU-1  cast:no_match → body.cast === 'no_match' (exact string, not 'plan'/'executed')
 *   GFU-2  cast:no_match hint is the exact expected string
 *   GFU-3  cast:no_match result.isError is undefined (informational, not an error)
 *   GFU-4  cast:no_match body.intent echoes the caller's intent string exactly
 *   GFU-5  cast:no_match body has exactly 5 keys: cast, resolvedBy, intent, latencyMs, hint
 *
 * Frozen 2026-10-02.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (no_match path, not explain)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gfu-${Date.now()}-${++dlqSeq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

// Payment tools — none of their vocabulary overlaps with the ML-deployment intent below.
const TOOL_CHARGE = {
  name: 'create_charge',
  description: 'Create a stripe charge for billing and invoicing',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text' as const, text: '{"id":"ch_1"}' }] },
};

const TOOL_REFUND = {
  name: 'create_refund',
  description: 'Issue a refund for a stripe payment transaction',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text' as const, text: '{"id":"re_1"}' }] },
};

// Intent: deliberately uses vocabulary that does NOT appear in tool names/descriptions/categories.
const NO_MATCH_INTENT = 'deploy tensorflow model to kubernetes cluster';

const NO_MATCH_HINT =
  'No tools, prompts, or resources matched your intent. Try ch1tty/search with different keywords.';

const CFG: ServerConfig = {
  id: 'stripe',
  name: 'Stripe',
  type: 'remote',
  access: 'readwrite',
  category: 'ecosystem',
  endpoint: 'https://stripe.com/mcp',
  lazy: true,
};

function makeAgg(suffix: string): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', { tools: [TOOL_CHARGE, TOOL_REFUND], prompts: [], resources: [] });
  const path = dlq();
  return new Aggregator([CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
    // Empty catalog: prevents disk-loaded focus-suggestions.json from injecting
    // suggestion resources that can match the test intent and trigger 'discovered'
    // instead of 'no_match'.
    suggestionsCatalog: {},
  });
}

async function castNoMatch(agg: Aggregator): Promise<{
  result: Awaited<ReturnType<Aggregator['callTool']>>;
  body: Record<string, unknown>;
}> {
  const result = await agg.callTool('ch1tty/cast', { intent: NO_MATCH_INTENT });
  const metaItem = result.content[0];
  assert.ok(metaItem && 'text' in metaItem, 'content[0] must have text property');
  const body = JSON.parse((metaItem as { text: string }).text) as Record<string, unknown>;
  return { result, body };
}

// ── GFU-1: body.cast === 'no_match' exactly ──────────────────────────────────

test('GFU-1: cast:no_match → body.cast === \'no_match\' (exact string, not plan/executed)', async () => {
  const agg = makeAgg('gfu-1');
  try {
    const { body } = await castNoMatch(agg);
    assert.equal(
      body['cast'],
      'no_match',
      `GFU-1: body.cast must === 'no_match', got ${JSON.stringify(body['cast'])}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFU-2: hint is the exact expected string ──────────────────────────────────

test('GFU-2: cast:no_match hint is the exact expected string', async () => {
  const agg = makeAgg('gfu-2');
  try {
    const { body } = await castNoMatch(agg);
    assert.equal(
      body['hint'],
      NO_MATCH_HINT,
      `GFU-2: cast:no_match hint must equal the expected string exactly, got ${JSON.stringify(body['hint'])}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFU-3: result.isError is undefined (informational, not an error) ──────────

test('GFU-3: cast:no_match result.isError is undefined (not an error response)', async () => {
  const agg = makeAgg('gfu-3');
  try {
    const { result } = await castNoMatch(agg);
    assert.equal(
      result.isError,
      undefined,
      `GFU-3: cast:no_match must not set isError; got ${JSON.stringify(result.isError)}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFU-4: body.intent echoes the caller's intent string exactly ──────────────

test('GFU-4: cast:no_match body.intent echoes the caller\'s intent string exactly', async () => {
  const agg = makeAgg('gfu-4');
  try {
    const { body } = await castNoMatch(agg);
    assert.equal(
      body['intent'],
      NO_MATCH_INTENT,
      `GFU-4: body.intent must echo input intent exactly, got ${JSON.stringify(body['intent'])}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFU-5: body has exactly 4 keys: cast, resolvedBy, intent, hint ────────────

test('GFU-5: cast:no_match body has exactly 5 keys — cast, resolvedBy, intent, latencyMs, hint', async () => {
  const agg = makeAgg('gfu-5');
  try {
    const { body } = await castNoMatch(agg);
    const keys = Object.keys(body).sort();
    assert.deepEqual(
      keys,
      ['cast', 'hint', 'intent', 'latencyMs', 'resolvedBy'],
      `GFU-5: cast:no_match body must have exactly 5 keys [cast, hint, intent, latencyMs, resolvedBy], got ${JSON.stringify(keys)}`,
    );
  } finally { await agg.shutdown(); }
});
