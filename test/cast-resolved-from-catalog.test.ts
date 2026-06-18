/**
 * resolvedFromCatalog annotation on cast: executed and cast: plan.
 *
 * When cast resolves to a tool that is the first step of a curated catalog
 * combo in the active focus profile, the response includes a
 * `resolvedFromCatalog` field with the combo name, chain, and accomplishes.
 * This lets clients distinguish catalog-backed resolutions from raw keyword
 * matches and surface the suggested follow-up chain to users.
 *
 * Coverage:
 *  1. cast: executed + matching focus → resolvedFromCatalog present
 *  2. cast: executed + focus active, tool not in any chain[0] → absent
 *  3. cast: executed without focus → absent
 *  4. cast: plan + matching focus → resolvedFromCatalog present in plan
 *  5. findCatalogCombo returns null when catalog is empty
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import { findCatalogCombo } from '../src/suggestions.js';
import { FixtureBackend } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-rfc-${label}-${Date.now()}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

const CATALOG = {
  finance: {
    description: 'Finance focus',
    combos: [
      {
        name: 'invoice-to-ledger',
        chain: ['billing/list_invoices', 'notion/API-post-page'],
        accomplishes: 'Pull invoices and log them in Notion',
        verified: true,
      },
      {
        name: 'stripe-charge-report',
        chain: ['billing/list_charges', 'fs/write_file'],
        accomplishes: 'Export Stripe charges to a local file',
        verified: false,
      },
    ],
    prompts: [
      { text: 'List all unpaid invoices from Stripe', resolves_to: 'billing/list_invoices' },
    ],
  },
};

const TOOL_INVOICE = {
  name: 'list_invoices',
  description: 'list invoices from the billing system',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text', text: '[]' }] },
};

const TOOL_OTHER = {
  name: 'get_balance',
  description: 'get account balance for a given account identifier',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text', text: '0' }] },
};

function makeFinanceAgg(opts: { focus?: string; catalog?: typeof CATALOG | Record<string, never> } = {}) {
  const backend = new FixtureBackend();
  backend.defineServer('billing', {
    tools: [TOOL_INVOICE, TOOL_OTHER],
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
  const path = dlqPath('rfc');
  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: opts.catalog ?? CATALOG,
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
    ...(opts.focus ? { focus: opts.focus } : {}),
  });
  return agg;
}

// ── 1. cast: executed with matching focus → resolvedFromCatalog present ────────

test('cast: executed includes resolvedFromCatalog when resolved tool is chain[0] of a catalog combo', async () => {
  const agg = makeFinanceAgg({ focus: 'finance' });
  try {
    // "list invoices billing" → resolves to billing/list_invoices (chain[0] of invoice-to-ledger)
    const result = await agg.callTool('ch1tty/cast', { intent: 'list invoices billing' });
    assert.equal(result.isError, undefined);

    const meta = JSON.parse(result.content[0].text as string);
    assert.equal(meta.cast, 'executed');
    assert.equal(meta.resolved, 'billing/list_invoices');

    assert.ok(meta.resolvedFromCatalog, 'resolvedFromCatalog field present');
    assert.equal(meta.resolvedFromCatalog.name, 'invoice-to-ledger');
    assert.deepEqual(meta.resolvedFromCatalog.chain, ['billing/list_invoices', 'notion/API-post-page']);
    assert.equal(typeof meta.resolvedFromCatalog.accomplishes, 'string');
    assert.ok(meta.resolvedFromCatalog.accomplishes.length > 0, 'accomplishes non-empty');
  } finally {
    await agg.shutdown();
  }
});

// ── 2. cast: executed — focus active, tool not a chain[0] → absent ────────────

test('cast: executed omits resolvedFromCatalog when resolved tool is not chain[0] of any combo', async () => {
  const agg = makeFinanceAgg({ focus: 'finance' });
  try {
    // "account balance" → resolves to billing/get_balance (not chain[0] of any combo)
    const result = await agg.callTool('ch1tty/cast', { intent: 'account balance' });
    assert.equal(result.isError, undefined);

    const meta = JSON.parse(result.content[0].text as string);
    assert.equal(meta.cast, 'executed');
    assert.equal(meta.resolved, 'billing/get_balance');
    assert.equal(meta.resolvedFromCatalog, undefined, 'resolvedFromCatalog absent when no chain match');
  } finally {
    await agg.shutdown();
  }
});

// ── 3. cast: executed without focus → resolvedFromCatalog absent ──────────────

test('cast: executed omits resolvedFromCatalog when no focus is active', async () => {
  const agg = makeFinanceAgg(); // no focus
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list invoices billing' });
    assert.equal(result.isError, undefined);

    const meta = JSON.parse(result.content[0].text as string);
    assert.equal(meta.cast, 'executed');
    assert.equal(meta.resolvedFromCatalog, undefined, 'resolvedFromCatalog absent without focus');
  } finally {
    await agg.shutdown();
  }
});

// ── 4. cast: plan includes resolvedFromCatalog when focus matches ─────────────

test('cast: plan includes resolvedFromCatalog when resolved tool is chain[0] of a catalog combo', async () => {
  const agg = makeFinanceAgg({ focus: 'finance' });
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list invoices billing', confirm: true });
    assert.equal(result.isError, undefined);

    const meta = JSON.parse(result.content[0].text as string);
    assert.equal(meta.cast, 'plan');
    assert.equal(meta.resolved.tool, 'billing/list_invoices');

    assert.ok(meta.resolvedFromCatalog, 'resolvedFromCatalog present in plan response');
    assert.equal(meta.resolvedFromCatalog.name, 'invoice-to-ledger');
    assert.deepEqual(meta.resolvedFromCatalog.chain, ['billing/list_invoices', 'notion/API-post-page']);
  } finally {
    await agg.shutdown();
  }
});

// ── 5. findCatalogCombo returns null on empty / missing catalog ────────────────

test('findCatalogCombo returns null when catalog has no entry for the focus', () => {
  assert.equal(findCatalogCombo('billing/list_invoices', 'finance', {}), null);
});

test('findCatalogCombo returns null when no combo starts with the given tool', () => {
  assert.equal(
    findCatalogCombo('billing/unknown_tool', 'finance', CATALOG),
    null,
  );
});

test('findCatalogCombo returns the matching combo when chain[0] matches', () => {
  const combo = findCatalogCombo('billing/list_charges', 'finance', CATALOG);
  assert.ok(combo !== null);
  assert.equal(combo.name, 'stripe-charge-report');
});
