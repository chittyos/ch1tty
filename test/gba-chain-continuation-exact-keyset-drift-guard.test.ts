/**
 * GBA drift guard: freeze chainContinuation sub-object exact key set for
 * cast:executed.
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
 *         cast-chain-continuation.test.ts checks individual values but not
 *         the full keyset; a regression adding a key passes silently.
 *
 * cast:plan keyset + all three value types are already frozen by
 * eh-cast-alternatives-catalog-chain-shape.test.ts Suite 3 (EH lines
 * ~269-328). GBA covers only the cast:executed path which has no prior
 * Object.keys() guard.
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
