/**
 * GBA drift guard: freeze chainContinuation sub-object exact key set.
 *
 * `cast-chain-continuation.test.ts` confirms that chainContinuation is
 * present with the correct values for nextTool, remainingChain, and hint,
 * but it never asserts Object.keys(chainContinuation). A regression that
 * adds a new top-level key (e.g. "previousTool", "stepIndex", "comboId")
 * or renames an existing one would pass every existing test silently.
 *
 * chainContinuation is built at aggregator line ~1454:
 *   {
 *     nextTool:       catalogCombo.chain[1],           // string
 *     remainingChain: catalogCombo.chain.slice(1),     // string[]
 *     hint:           `Continue the '${name}' …`,     // non-empty string
 *   }
 *
 * ── Frozen key set ───────────────────────────────────────────────────────────
 *   EXACTLY { hint, nextTool, remainingChain } — 3 keys, no more, no less.
 *
 * GBA-1  cast:executed multi-step — Object.keys(chainContinuation).sort()
 *         === ['hint', 'nextTool', 'remainingChain'].
 *         Complementary to cast-chain-continuation #1 which checks individual
 *         values but not the full keyset.
 *
 * GBA-2  cast:plan (confirm:true) multi-step — same exact key set.
 *         cast-chain-continuation #4 checks presence and cast mode but not
 *         the keyset.
 *
 * GBA-3  nextTool is a string, not an object or array.
 *         Freezes the primitive type so a regression wrapping it in
 *         { tool, server } would fail here before the integration tests.
 *
 * GBA-4  remainingChain is an Array and every element is a string.
 *         Freezes that the chain slice is flat strings, not tool-descriptor
 *         objects.
 *
 * GBA-5  hint is a non-empty string (typeof === 'string' && .length > 0).
 *         Symmetric to GBA-3/GBA-4 for the hint field.
 *
 * Frozen 2026-09-25.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import { FixtureBackend } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

// ── Frozen key set ───────────────────────────────────────────────────────────

const CHAIN_CONTINUATION_KEYS: readonly string[] = ['hint', 'nextTool', 'remainingChain'];

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CATALOG_MULTI = {
  finance: {
    description: 'Finance focus',
    combos: [
      {
        name: 'invoice-to-ledger',
        chain: ['billing/list_invoices', 'notion/API-post-page', 'fs/write_file'],
        accomplishes: 'Pull invoices, log them in Notion, then write a local report',
        verified: true,
      },
    ],
    prompts: [
      { text: 'List all unpaid invoices', resolves_to: 'billing/list_invoices' },
    ],
  },
};

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-gba-${label}-${Date.now()}.jsonl`);
}

function makeAgg(opts: { focus?: string; catalog?: object } = {}) {
  const backend = new FixtureBackend();
  backend.defineServer('billing', {
    tools: [{
      name: 'list_invoices',
      description: 'list invoices from the billing system',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: '[]' }] },
    }],
  });
  const configs: ServerConfig[] = [{
    id: 'billing',
    name: 'Billing',
    type: 'remote',
    access: 'readwrite',
    category: 'ecosystem',
    endpoint: 'https://billing.test/mcp',
    lazy: true,
  }];
  const path = dlqPath('agg');
  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: (opts.catalog as Parameters<typeof Aggregator>[1]['suggestionsCatalog']) ?? CATALOG_MULTI,
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
    ...(opts.focus ? { focus: opts.focus } : {}),
  });
  return agg;
}

// ── GBA-1: cast:executed exact keyset ────────────────────────────────────────

test('GBA-1: cast:executed chainContinuation has EXACTLY {hint, nextTool, remainingChain}', async () => {
  const agg = makeAgg({ focus: 'finance' });
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list invoices billing' });
    assert.equal(result.isError, undefined, 'cast should not error');

    const meta = JSON.parse(result.content[0].text as string);
    assert.equal(meta.cast, 'executed', 'expected cast:executed mode');

    const cc = meta.chainContinuation as Record<string, unknown>;
    assert.ok(cc != null, 'chainContinuation must be present for multi-step combo');

    const actualKeys = Object.keys(cc).sort();
    assert.deepEqual(
      actualKeys,
      [...CHAIN_CONTINUATION_KEYS].sort(),
      `chainContinuation key set must be exactly ${JSON.stringify(CHAIN_CONTINUATION_KEYS)} — got ${JSON.stringify(actualKeys)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GBA-2: cast:plan exact keyset ────────────────────────────────────────────

test('GBA-2: cast:plan chainContinuation has EXACTLY {hint, nextTool, remainingChain}', async () => {
  const agg = makeAgg({ focus: 'finance' });
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list invoices billing', confirm: true });
    assert.equal(result.isError, undefined, 'cast should not error');

    const meta = JSON.parse(result.content[0].text as string);
    assert.equal(meta.cast, 'plan', 'expected cast:plan mode');

    const cc = meta.chainContinuation as Record<string, unknown>;
    assert.ok(cc != null, 'chainContinuation must be present in cast:plan for multi-step combo');

    const actualKeys = Object.keys(cc).sort();
    assert.deepEqual(
      actualKeys,
      [...CHAIN_CONTINUATION_KEYS].sort(),
      `chainContinuation key set must be exactly ${JSON.stringify(CHAIN_CONTINUATION_KEYS)} — got ${JSON.stringify(actualKeys)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GBA-3: nextTool is a string ───────────────────────────────────────────────

test('GBA-3: chainContinuation.nextTool is a string, not an object or array', async () => {
  const agg = makeAgg({ focus: 'finance' });
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list invoices billing' });
    assert.equal(result.isError, undefined);

    const meta = JSON.parse(result.content[0].text as string);
    const cc = meta.chainContinuation as Record<string, unknown>;
    assert.ok(cc != null, 'chainContinuation must be present');

    assert.equal(
      typeof cc['nextTool'],
      'string',
      `nextTool must be typeof string — got ${typeof cc['nextTool']}`,
    );
    assert.ok(
      !Array.isArray(cc['nextTool']),
      'nextTool must not be an array',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GBA-4: remainingChain is Array<string> ────────────────────────────────────

test('GBA-4: chainContinuation.remainingChain is an Array and every element is a string', async () => {
  const agg = makeAgg({ focus: 'finance' });
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list invoices billing' });
    assert.equal(result.isError, undefined);

    const meta = JSON.parse(result.content[0].text as string);
    const cc = meta.chainContinuation as Record<string, unknown>;
    assert.ok(cc != null, 'chainContinuation must be present');

    const rc = cc['remainingChain'];
    assert.ok(Array.isArray(rc), `remainingChain must be an Array — got ${typeof rc}`);

    const chain = rc as unknown[];
    assert.ok(chain.length > 0, 'remainingChain must have at least one element for a multi-step combo');
    for (let i = 0; i < chain.length; i++) {
      assert.equal(
        typeof chain[i],
        'string',
        `remainingChain[${i}] must be a string — got ${typeof chain[i]}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GBA-5: hint is a non-empty string ─────────────────────────────────────────

test('GBA-5: chainContinuation.hint is a non-empty string', async () => {
  const agg = makeAgg({ focus: 'finance' });
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list invoices billing' });
    assert.equal(result.isError, undefined);

    const meta = JSON.parse(result.content[0].text as string);
    const cc = meta.chainContinuation as Record<string, unknown>;
    assert.ok(cc != null, 'chainContinuation must be present');

    assert.equal(
      typeof cc['hint'],
      'string',
      `hint must be typeof string — got ${typeof cc['hint']}`,
    );
    assert.ok(
      (cc['hint'] as string).length > 0,
      'hint must be non-empty',
    );
  } finally {
    await agg.shutdown();
  }
});
