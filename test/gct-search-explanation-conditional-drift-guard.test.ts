/**
 * GCT drift guard: freeze ch1tty/search `explanation` conditional in the keyword-search path.
 *
 * Existing coverage:
 *   FB — freezes explanation PRESENCE and internal structure when explain:true (keyword path)
 *   FC-3 — freezes explanation ABSENCE when explain omitted (server-summary / discovery path)
 *   FD — freezes keyword search envelope key sets and value types; never references explanation
 *
 * Gap: no test asserts that `explanation` is ABSENT in the keyword-search path when `explain` is
 * not set. A regression that always attaches explanation (e.g. guard condition inverted,
 * default changed) would silently pass every existing test.  GCT closes this.
 *
 * GCT-1  keyword search WITHOUT `explain` param → `explanation` key ABSENT from envelope
 *         (baseline gap: FB tests presence, FC-3 tests server-summary path, nothing tests
 *          keyword-search absence)
 * GCT-2  keyword search WITH `explain: false` (explicit boolean false) → `explanation` ABSENT
 *         (explicit false must behave identically to omitted; no existing test checks this)
 * GCT-3  focus active + keyword search WITHOUT `explain` → `explanation` ABSENT
 *         (focus must not accidentally inject explanation; GCQ/GCO/GCS cover other focus
 *          conditionals but none assert explanation is still absent with focus active)
 * GCT-4  sessionId + keyword search WITHOUT `explain` → `explanation` ABSENT
 *         (session path adds sessionContext; must not also add explanation)
 * GCT-5  keyword search WITH `explain: true` → `explanation` PRESENT (symmetric guard)
 *         (completes the boolean conditional picture; no standalone test in the GC series
 *          asserts presence — this anchors the conditional from both ends)
 *
 * Source: src/aggregator.ts handleSearch — `...(explanation ? { explanation } : {})` spread
 * where `explanation` is `explain ? buildSearchExplanation(...) : null`.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (search, not cast)
 *
 * Frozen 2026-09-27.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

const BASE_CONFIGS: ServerConfig[] = [
  {
    id: 'neon',
    name: 'Neon DB',
    type: 'remote',
    access: 'readwrite',
    category: 'code',
    endpoint: 'https://neon.tech/mcp',
    lazy: true,
  },
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

const FOCUS_PROFILES = {
  profiles: {
    code: {
      description: 'Code-focused profile',
      categories: ['code'] as string[],
      servers: ['neon'] as string[],
      boost: 0.5,
    },
  },
};

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gct-${Date.now()}-${++_seq}.jsonl`);
}

function makeAgg(opts: { focus?: string } = {}): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    ...(opts.focus ? { focus: opts.focus, focusProfiles: FOCUS_PROFILES } : {}),
  });
}

async function search(
  agg: Aggregator,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/search', args);
  assert.equal(result.isError, undefined, 'search must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥ 1 content item');
  assert.equal(content[0]!.type, 'text', 'content[0] must be type:text');
  return JSON.parse(content[0]!.text!) as Record<string, unknown>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GCT-1: keyword search without explain param → explanation key ABSENT', async () => {
  const agg = makeAgg();
  try {
    const body = await search(agg, { query: 'list projects' });
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'explanation'),
      'explanation must be absent when explain param is not set (keyword-search path)',
    );
  } finally {
    await agg.shutdown();
  }
});

test('GCT-2: keyword search with explain:false (explicit) → explanation key ABSENT', async () => {
  const agg = makeAgg();
  try {
    const body = await search(agg, { query: 'list projects', explain: false });
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'explanation'),
      'explanation must be absent when explain:false is passed explicitly',
    );
  } finally {
    await agg.shutdown();
  }
});

test('GCT-3: focus active + keyword search without explain → explanation ABSENT', async () => {
  const agg = makeAgg({ focus: 'code' });
  try {
    const body = await search(agg, { query: 'list projects' });
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'explanation'),
      'explanation must be absent even when focus is active (focus must not inject explanation)',
    );
  } finally {
    await agg.shutdown();
  }
});

test('GCT-4: sessionId + keyword search without explain → explanation ABSENT', async () => {
  const agg = makeAgg();
  try {
    const body = await search(agg, { query: 'list projects', sessionId: 'gct-sess-4' });
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'explanation'),
      'explanation must be absent when only sessionId is present (session must not inject explanation)',
    );
  } finally {
    await agg.shutdown();
  }
});

test('GCT-5: keyword search with explain:true → explanation PRESENT (symmetric guard)', async () => {
  const agg = makeAgg();
  try {
    const body = await search(agg, { query: 'list projects', explain: true });
    assert.ok(
      Object.prototype.hasOwnProperty.call(body, 'explanation'),
      'explanation must be present when explain:true is set (keyword-search path)',
    );
    assert.ok(
      body['explanation'] !== null && typeof body['explanation'] === 'object' && !Array.isArray(body['explanation']),
      'explanation must be a non-null object when present',
    );
  } finally {
    await agg.shutdown();
  }
});
