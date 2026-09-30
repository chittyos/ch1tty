/**
 * GAU drift guard: freeze cast:plan always-present vs cast:executed conditional
 * `alternatives` key asymmetry.
 *
 * Source observation (aggregator.ts ~line 1589–1675):
 *
 *   cast:plan body (line ~1616):  alternatives,
 *     → unconditional spread — alternatives key is ALWAYS present, even when [].
 *
 *   cast:executed body (line ~1665):  ...(alternatives.length > 0 ? { alternatives } : {})
 *     → conditional spread — alternatives key is ABSENT when the array is empty.
 *
 * Prior tests:
 *   GO freezes value types of alternatives[] items.
 *   GAS freezes the exact key set of each alternatives[] item.
 *   GV freezes the cast:executed top-level key set (with stripe 3-tool fixture —
 *     alternatives is always non-empty there; single-tool edge case not covered).
 *   GBD (open PR) freezes cast:plan top-level key set (stripe fixture — same caveat).
 *
 * No test freezes the ASYMMETRY: that cast:plan always includes `alternatives` (even
 * as an empty array) while cast:executed omits the key entirely when empty. A future
 * refactor making cast:plan also conditional, or making cast:executed always-include,
 * would silently pass every prior drift guard.
 *
 * GAU freezes:
 *
 *   GAU-1  cast:plan with a SINGLE-tool backend includes `alternatives` as an empty
 *          array (always-present, zero-length).
 *          (No prior test checks the single-tool edge case.)
 *
 *   GAU-2  cast:plan with a MULTI-tool backend includes `alternatives` as a
 *          non-empty array.
 *          (Sanity-checks that the always-present property holds in both edge cases.)
 *
 *   GAU-3  cast:executed with a SINGLE-tool backend does NOT include `alternatives`
 *          — the key is absent when the array would be empty.
 *          (The conditional spread is load-bearing; no prior test exercises it.)
 *
 *   GAU-4  cast:executed with a MULTI-tool backend includes `alternatives` as a
 *          non-empty array.
 *          (Symmetric to GAU-3 — confirms the conditional fires correctly.)
 *
 *   GAU-5  cast:plan `alternatives` is always a proper Array (never null, never an
 *          object) regardless of tool count. Guards against type regression.
 *
 * Source: src-stdio/aggregator.ts lines ~1389, ~1616, ~1665.
 *
 * Frozen 2026-09-25.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (alternatives key presence,
 *     not explanation sub-object)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SINGLE_TOOL_SERVER_CONFIG: ServerConfig[] = [
  {
    id: 'solo',
    name: 'Solo',
    type: 'remote',
    access: 'readwrite',
    category: 'ecosystem',
    endpoint: 'https://solo.example.com/mcp',
    lazy: true,
  },
];

const MULTI_TOOL_SERVER_CONFIG: ServerConfig[] = [
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

// Intent that reliably matches the single tool (stripe payments intent also maps well).
const SINGLE_INTENT = 'retrieve solo payment data';
const MULTI_INTENT = 'list stripe payments';

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gau-${Date.now()}-${++_seq}.jsonl`);
}

function makeSingleAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('solo', {
    tools: [
      {
        name: 'get_solo_payment',
        description: 'Retrieve the solo payment record',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '{"id":"pay-1"}' }] },
      },
    ],
  });
  return new Aggregator(SINGLE_TOOL_SERVER_CONFIG, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
}

function makeMultiAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator(MULTI_TOOL_SERVER_CONFIG, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
}

// ── GAU-1: single-tool cast:plan always includes alternatives (empty array) ───

test('GAU-1: cast:plan with single-tool backend includes alternatives as empty array', async () => {
  const agg = makeSingleAgg();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: SINGLE_INTENT, confirm: true });
    assert.equal(result.isError, undefined, 'cast must not return isError');
    const body = JSON.parse(
      (result.content[0] as { type: string; text: string }).text,
    ) as Record<string, unknown>;
    assert.equal(body['cast'], 'plan', `expected cast:plan, got cast="${String(body['cast'])}"`);
    assert.ok(
      Object.prototype.hasOwnProperty.call(body, 'alternatives'),
      'cast:plan must always include the alternatives key, even with a single-tool registry',
    );
    const alts = body['alternatives'];
    assert.ok(Array.isArray(alts), `alternatives must be an Array, got ${typeof alts}`);
    assert.equal(
      (alts as unknown[]).length,
      0,
      `with a single-tool backend, alternatives must be empty (got length ${(alts as unknown[]).length})`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GAU-2: multi-tool cast:plan includes non-empty alternatives ───────────────

test('GAU-2: cast:plan with multi-tool backend includes alternatives as non-empty array', async () => {
  const agg = makeMultiAgg();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: MULTI_INTENT, confirm: true });
    assert.equal(result.isError, undefined, 'cast must not return isError');
    const body = JSON.parse(
      (result.content[0] as { type: string; text: string }).text,
    ) as Record<string, unknown>;
    assert.equal(body['cast'], 'plan', `expected cast:plan, got cast="${String(body['cast'])}"`);
    assert.ok(
      Object.prototype.hasOwnProperty.call(body, 'alternatives'),
      'cast:plan must always include the alternatives key',
    );
    const alts = body['alternatives'] as unknown[];
    assert.ok(alts.length > 0, `cast:plan alternatives must be non-empty with 3 stripe tools (got length ${alts.length})`);
  } finally {
    await agg.shutdown();
  }
});

// ── GAU-3: single-tool cast:executed omits alternatives key ───────────────────

test('GAU-3: cast:executed with single-tool backend does NOT include alternatives', async () => {
  const agg = makeSingleAgg();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: SINGLE_INTENT });
    assert.equal(result.isError, undefined, 'cast must not return isError');
    const body = JSON.parse(
      (result.content[0] as { type: string; text: string }).text,
    ) as Record<string, unknown>;
    assert.equal(body['cast'], 'executed', `expected cast:executed, got cast="${String(body['cast'])}"`);
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'alternatives'),
      'cast:executed must NOT include alternatives when the array would be empty (single-tool backend)',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GAU-4: multi-tool cast:executed includes alternatives key ─────────────────

test('GAU-4: cast:executed with multi-tool backend includes alternatives as non-empty array', async () => {
  const agg = makeMultiAgg();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: MULTI_INTENT });
    assert.equal(result.isError, undefined, 'cast must not return isError');
    const body = JSON.parse(
      (result.content[0] as { type: string; text: string }).text,
    ) as Record<string, unknown>;
    assert.equal(body['cast'], 'executed', `expected cast:executed, got cast="${String(body['cast'])}"`);
    assert.ok(
      Object.prototype.hasOwnProperty.call(body, 'alternatives'),
      'cast:executed must include alternatives when the array is non-empty (3 stripe tools)',
    );
    const alts = body['alternatives'] as unknown[];
    assert.ok(alts.length > 0, `cast:executed alternatives must be non-empty with 3 stripe tools (got length ${alts.length})`);
  } finally {
    await agg.shutdown();
  }
});

// ── GAU-5: cast:plan alternatives is always a proper Array ────────────────────

test('GAU-5: cast:plan alternatives is always Array.isArray regardless of tool count', async () => {
  const aggSingle = makeSingleAgg();
  const aggMulti = makeMultiAgg();
  try {
    for (const [label, agg, intent] of [
      ['single-tool', aggSingle, SINGLE_INTENT] as const,
      ['multi-tool', aggMulti, MULTI_INTENT] as const,
    ]) {
      const result = await agg.callTool('ch1tty/cast', { intent, confirm: true });
      assert.equal(result.isError, undefined, `${label}: cast must not error`);
      const body = JSON.parse(
        (result.content[0] as { type: string; text: string }).text,
      ) as Record<string, unknown>;
      assert.equal(body['cast'], 'plan', `${label}: expected cast:plan`);
      const alts = body['alternatives'];
      assert.ok(
        Array.isArray(alts),
        `${label}: alternatives must be Array.isArray, got ${Object.prototype.toString.call(alts)}`,
      );
    }
  } finally {
    await aggSingle.shutdown();
    await aggMulti.shutdown();
  }
});
