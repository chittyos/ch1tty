/**
 * chainContinuation on cast: executed and cast: plan.
 *
 * When cast resolves to a tool that is the first step (chain[0]) of a curated
 * multi-step catalog combo in the active focus, the response includes a
 * `chainContinuation` field with the immediate next tool, the full remaining
 * chain, and a human-readable hint. This lets clients drive sequential
 * workflows without parsing the full resolvedFromCatalog chain themselves.
 *
 * Coverage:
 *  1. cast: executed + multi-step combo → chainContinuation present with correct shape
 *  2. cast: executed + single-step combo (chain.length === 1) → chainContinuation absent
 *  3. cast: executed without focus → chainContinuation absent
 *  4. cast: plan + multi-step combo → chainContinuation present
 *  5. chainContinuation.nextTool === chain[1]
 *  6. chainContinuation.remainingChain === chain.slice(1) (multi-step chain)
 *  7. chainContinuation.hint references the combo name and next tools
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import { FixtureBackend } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-cc-${label}-${Date.now()}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

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

const CATALOG_SINGLE = {
  finance: {
    description: 'Finance focus',
    combos: [
      {
        name: 'balance-check',
        chain: ['billing/get_balance'],
        accomplishes: 'Check the current account balance',
        verified: true,
      },
    ],
    prompts: [],
  },
};

const TOOL_INVOICE = {
  name: 'list_invoices',
  description: 'list invoices from the billing system',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text', text: '[]' }] },
};

const TOOL_BALANCE = {
  name: 'get_balance',
  description: 'get account balance',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text', text: '0' }] },
};

function makeAgg(opts: {
  focus?: string;
  catalog?: Record<string, unknown>;
  tools?: typeof TOOL_INVOICE[];
} = {}) {
  const backend = new FixtureBackend();
  const tools = opts.tools ?? [TOOL_INVOICE, TOOL_BALANCE];
  backend.defineServer('billing', { tools });
  const configs: ServerConfig[] = [{
    id: 'billing',
    name: 'Billing',
    type: 'remote',
    access: 'readwrite',
    category: 'ecosystem',
    endpoint: 'https://billing.test/mcp',
    lazy: true,
  }];
  const path = dlqPath('cc');
  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: (opts.catalog as Record<string, { description: string; combos: { name: string; chain: string[]; accomplishes: string; verified: boolean }[]; prompts: { text: string; resolves_to: string }[] }>) ?? CATALOG_MULTI,
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
    ...(opts.focus ? { focus: opts.focus } : {}),
  });
  return agg;
}

// ── 1. cast: executed + multi-step → chainContinuation present ────────────────

test('cast: executed includes chainContinuation when combo has multiple steps', async () => {
  const agg = makeAgg({ focus: 'finance', catalog: CATALOG_MULTI });
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list invoices billing' });
    assert.equal(result.isError, undefined);

    const meta = JSON.parse(result.content[0].text as string);
    assert.equal(meta.cast, 'executed');
    assert.equal(meta.resolved, 'billing/list_invoices');

    assert.ok(meta.chainContinuation, 'chainContinuation field present');
    assert.equal(meta.chainContinuation.nextTool, 'notion/API-post-page');
    assert.deepEqual(meta.chainContinuation.remainingChain, ['notion/API-post-page', 'fs/write_file']);
    assert.equal(typeof meta.chainContinuation.hint, 'string');
    assert.ok(meta.chainContinuation.hint.length > 0, 'hint is non-empty');
  } finally {
    await agg.shutdown();
  }
});

// ── 2. cast: executed + single-step combo → chainContinuation absent ──────────

test('cast: executed omits chainContinuation when combo chain has only one step', async () => {
  const agg = makeAgg({ focus: 'finance', catalog: CATALOG_SINGLE, tools: [TOOL_BALANCE] });
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'account balance' });
    assert.equal(result.isError, undefined);

    const meta = JSON.parse(result.content[0].text as string);
    assert.equal(meta.cast, 'executed');
    assert.equal(meta.resolved, 'billing/get_balance');
    assert.equal(meta.chainContinuation, undefined, 'chainContinuation absent for single-step combo');
  } finally {
    await agg.shutdown();
  }
});

// ── 3. cast: executed without focus → chainContinuation absent ───────────────

test('cast: executed omits chainContinuation when no focus is active', async () => {
  const agg = makeAgg(); // no focus
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list invoices billing' });
    assert.equal(result.isError, undefined);

    const meta = JSON.parse(result.content[0].text as string);
    assert.equal(meta.cast, 'executed');
    assert.equal(meta.chainContinuation, undefined, 'chainContinuation absent without focus');
  } finally {
    await agg.shutdown();
  }
});

// ── 4. cast: plan + multi-step → chainContinuation present ───────────────────

test('cast: plan includes chainContinuation when combo has multiple steps', async () => {
  const agg = makeAgg({ focus: 'finance', catalog: CATALOG_MULTI });
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list invoices billing', confirm: true });
    assert.equal(result.isError, undefined);

    const meta = JSON.parse(result.content[0].text as string);
    assert.equal(meta.cast, 'plan');
    assert.equal(meta.resolved.tool, 'billing/list_invoices');

    assert.ok(meta.chainContinuation, 'chainContinuation present in plan response');
    assert.equal(meta.chainContinuation.nextTool, 'notion/API-post-page');
    assert.deepEqual(meta.chainContinuation.remainingChain, ['notion/API-post-page', 'fs/write_file']);
  } finally {
    await agg.shutdown();
  }
});

// ── 5. chainContinuation.nextTool is chain[1] ────────────────────────────────

test('chainContinuation.nextTool equals chain[1] of the matched catalog combo', async () => {
  const catalog = {
    ops: {
      description: 'Ops focus',
      combos: [{
        name: 'deploy-and-report',
        chain: ['cloudflare/deploy_worker', 'github/create_issue', 'notion/API-post-page'],
        accomplishes: 'Deploy, then open issue, then log in Notion',
        verified: false,
      }],
      prompts: [],
    },
  };
  const backend = new FixtureBackend();
  backend.defineServer('cloudflare', {
    tools: [{
      name: 'deploy_worker',
      description: 'deploy a cloudflare worker',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: 'ok' }] },
    }],
  });
  const configs: ServerConfig[] = [{
    id: 'cloudflare',
    name: 'Cloudflare',
    type: 'remote',
    access: 'readwrite',
    category: 'ecosystem',
    endpoint: 'https://cf.test/mcp',
    lazy: true,
  }];
  const path = dlqPath('cc5');
  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: catalog as Parameters<typeof Aggregator>[1]['suggestionsCatalog'],
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
    focus: 'ops',
  });
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'deploy cloudflare worker' });
    const meta = JSON.parse(result.content[0].text as string);
    assert.equal(meta.cast, 'executed');
    assert.ok(meta.chainContinuation, 'chainContinuation present');
    assert.equal(meta.chainContinuation.nextTool, 'github/create_issue');
  } finally {
    await agg.shutdown();
  }
});

// ── 6. chainContinuation.remainingChain === chain.slice(1) ───────────────────

test('chainContinuation.remainingChain equals chain.slice(1) of the matched combo', async () => {
  const agg = makeAgg({ focus: 'finance', catalog: CATALOG_MULTI });
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list invoices billing' });
    const meta = JSON.parse(result.content[0].text as string);
    assert.equal(meta.cast, 'executed');
    assert.deepEqual(
      meta.chainContinuation.remainingChain,
      CATALOG_MULTI.finance.combos[0].chain.slice(1),
    );
  } finally {
    await agg.shutdown();
  }
});

// ── 7. chainContinuation.hint references combo name and next tools ────────────

test('chainContinuation.hint contains the combo name and next tool names', async () => {
  const agg = makeAgg({ focus: 'finance', catalog: CATALOG_MULTI });
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list invoices billing' });
    const meta = JSON.parse(result.content[0].text as string);
    assert.equal(meta.cast, 'executed');
    const { hint } = meta.chainContinuation as { hint: string };
    assert.ok(hint.includes('invoice-to-ledger'), `hint includes combo name: ${hint}`);
    assert.ok(hint.includes('notion/API-post-page'), `hint includes chain[1]: ${hint}`);
  } finally {
    await agg.shutdown();
  }
});
