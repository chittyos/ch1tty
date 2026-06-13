/**
 * NNN: search sort tiebreakers, cast:discovered with both surfaces, and
 *      related-context completeness tests.
 *
 * Gaps addressed:
 *  1. cast:discovered when BOTH a prompt AND a resource match (not just one)
 *  2. handleSearch OR-fallback (mode: partial) with focus active → both fields present
 *  3. handleSearch sort: focus tiebreaker — equal relevance, in-focus sorts first
 *  4. handleSearch sort: recency tiebreaker — equal relevance + equal focus, recently-used first
 *  5. cast:executed with BOTH matching prompt AND matching resource → metadata has both arrays
 *  6. handleSearch server-summary: no focus active → inFocus key absent from all entries
 *  7. cast:plan with focus + resource in related → focus, resources, suggestions all present
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { validateFocusProfiles } from '../src/focus.js';
import { SessionCoordinator } from '../src/coordinator.js';
import { FixtureBackend } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

let dlqSeq = 0;
function dlqPath(): string {
  return join(tmpdir(), `ch1tty-nnn-${Date.now()}-${++dlqSeq}.jsonl`);
}

// Coordinator that never routes via brain so keyword scoring is always used.
class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

function makeAgg(
  configs: ServerConfig[],
  setupBackend: (b: FixtureBackend) => void,
  opts: Partial<ConstructorParameters<typeof Aggregator>[1]> = {},
): { agg: Aggregator; backend: FixtureBackend } {
  const backend = new FixtureBackend();
  setupBackend(backend);
  const path = dlqPath();
  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: {},
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
    ...opts,
  });
  return { agg, backend };
}

// ── 1. cast:discovered — prompt AND resource both match ───────────────────────

test('cast:discovered when both a prompt and a resource match but no tools score above threshold', async () => {
  // The tool description has no overlap with the intent so scoreIntent returns [].
  // The prompt and resource both contain "invoice" and fire the discovered branch.
  const { agg } = makeAgg(
    [{ id: 'billing', name: 'Billing', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://billing.test/mcp', lazy: true }],
    (b) => b.defineServer('billing', {
      tools: [
        { name: 'create_subscription', description: 'create a new recurring subscription plan', inputSchema: { type: 'object' }, response: { content: [{ type: 'text', text: 'ok' }] } },
      ],
      prompts: [
        { name: 'retrieve_invoice', description: 'retrieve and format an invoice for a customer' },
      ],
      resources: [
        { uri: 'billing://invoice-template', name: 'Invoice Template', description: 'standard invoice template for billing' },
      ],
    }),
  );

  try {
    // Intent must not contain "billing" (which would give nameBonus to create_subscription via serverId match).
    // "retrieve customer invoice document" has no term overlap with create_subscription description.
    const result = await agg.callTool('ch1tty/cast', { intent: 'retrieve customer invoice document' });
    assert.equal(result.isError, undefined);
    const body = JSON.parse((result.content[0] as { type: string; text: string }).text);

    assert.equal(body.cast, 'discovered', `expected discovered, got: ${JSON.stringify(body)}`);
    assert.ok(Array.isArray(body.prompts), 'discovered response must include prompts array');
    assert.ok(Array.isArray(body.resources), 'discovered response must include resources array');
    assert.ok(body.prompts.length > 0, 'at least one prompt must match');
    assert.ok(body.resources.length > 0, 'at least one resource must match');
    assert.ok(
      body.prompts.some((p: { name: string }) => p.name.includes('retrieve_invoice')),
      'retrieve_invoice prompt must appear in discovered.prompts',
    );
    assert.ok(
      body.resources.some((r: { uri: string }) => r.uri.includes('invoice')),
      'invoice resource must appear in discovered.resources',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── 2. handleSearch OR-fallback + focus active → mode:partial AND focus ───────

test('handleSearch OR-fallback (mode:partial) + focus active → both mode:partial and focus in response', async () => {
  const profiles = validateFocusProfiles({
    profiles: { ops: { categories: ['ecosystem'], servers: ['payments'], boost: 0.5 } },
  });

  // "invoice xyzzy" — AND fails (no tool has "xyzzy"); OR fallback fires via "invoice" match.
  const { agg } = makeAgg(
    [{ id: 'payments', name: 'Payments', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://payments.test/mcp', lazy: true }],
    (b) => b.defineServer('payments', {
      tools: [
        { name: 'list_invoices', description: 'list all payment invoices for an account', inputSchema: { type: 'object' }, response: { content: [{ type: 'text', text: '[]' }] } },
      ],
    }),
    { focus: 'ops', focusProfiles: profiles },
  );

  try {
    const result = await agg.callTool('ch1tty/search', { query: 'invoice xyzzy' });
    assert.equal(result.isError, undefined);
    const data = JSON.parse((result.content[0] as { type: string; text: string }).text);

    assert.equal(data.mode, 'partial', 'OR fallback must set mode: partial');
    assert.equal(data.focus, 'ops', 'active focus must appear alongside mode:partial');
    assert.ok(data.tools.length > 0, 'OR fallback must return at least one matching tool');
  } finally {
    await agg.shutdown();
  }
});

// ── 3. handleSearch sort: focus tiebreaker ────────────────────────────────────

test('handleSearch sort: equal relevance → in-focus tool ranks above out-of-focus tool', async () => {
  // Both tools have identical descriptions and tool names so they score equally.
  // alpha is in-focus (ecosystem), beta is out-of-focus (code).
  const profiles = validateFocusProfiles({
    profiles: { ops: { categories: ['ecosystem'], boost: 0.5 } },
  });

  const backend = new FixtureBackend();
  const tDef = { name: 'transfer_funds', description: 'transfer funds between accounts', inputSchema: { type: 'object' }, response: { content: [{ type: 'text', text: 'ok' }] } };
  backend.defineServer('alpha', { tools: [tDef] });
  backend.defineServer('beta', { tools: [tDef] });

  const configs: ServerConfig[] = [
    { id: 'alpha', name: 'Alpha Service', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://alpha.test/mcp', lazy: true },
    { id: 'beta', name: 'Beta Service', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://beta.test/mcp', lazy: true },
  ];
  const path = dlqPath();
  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: {},
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
    focus: 'ops',
    focusProfiles: profiles,
  });

  try {
    const result = await agg.callTool('ch1tty/search', { query: 'transfer funds' });
    const data = JSON.parse((result.content[0] as { type: string; text: string }).text);

    assert.ok(data.tools.length >= 2, 'both tools must appear in results');
    // Both have the same relevance score (1.0); in-focus alpha must sort first.
    assert.equal(data.tools[0].server, 'alpha', 'in-focus tool must rank above out-of-focus at equal relevance');
    assert.equal(data.tools[0].inFocus, true, 'in-focus winner must be marked inFocus:true');
    // Out-of-focus beta still present (lens, not gate).
    assert.ok(data.tools.some((t: { server: string }) => t.server === 'beta'), 'out-of-focus beta must still appear');
  } finally {
    await agg.shutdown();
  }
});

// ── 4. handleSearch sort: recency tiebreaker ─────────────────────────────────

test('handleSearch sort: equal relevance + equal focus → recently-used server ranks first', async () => {
  // Both servers are same category (ecosystem), no focus active.
  // After a tool call on beta, beta is recent and must sort above alpha.
  const backend = new FixtureBackend();
  const tDef = { name: 'transfer_funds', description: 'transfer funds between accounts', inputSchema: { type: 'object' }, response: { content: [{ type: 'text', text: 'ok' }] } };
  backend.defineServer('alpha', { tools: [tDef] });
  backend.defineServer('beta', { tools: [tDef] });

  const configs: ServerConfig[] = [
    { id: 'alpha', name: 'Alpha Service', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://alpha.test/mcp', lazy: true },
    { id: 'beta', name: 'Beta Service', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://beta.test/mcp', lazy: true },
  ];
  const path = dlqPath();
  const coordinator = new KeywordOnlyCoordinator({}, { enabled: false }, path);
  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: {},
    coordinator,
  });

  const sessionId = 'nnn-recency-session';
  await coordinator.onSessionStart(sessionId, 'stdio');
  // Record a call on beta to make it the recently-used server.
  coordinator.onToolCall(sessionId, 'beta/transfer_funds');

  try {
    const result = await agg.callTool('ch1tty/search', { query: 'transfer funds' }, sessionId);
    const data = JSON.parse((result.content[0] as { type: string; text: string }).text);

    assert.ok(data.tools.length >= 2, 'both tools must appear in results');
    // beta is recent, alpha is not; both have equal relevance + no focus → beta first.
    assert.equal(data.tools[0].server, 'beta', 'recently-used server must rank above non-recent at equal relevance+focus');
    assert.ok(!!data.tools[0].recentlyUsed, 'recent winner must have a truthy recentlyUsed (bool or {callCount,lastUsedMs})');
    // alpha still present (recency is a tiebreaker, not a filter).
    assert.ok(data.tools.some((t: { server: string }) => t.server === 'alpha'), 'non-recent alpha must still appear');
  } finally {
    await agg.shutdown();
  }
});

// ── 5. cast:executed with BOTH matching prompt AND resource ───────────────────

test('cast:executed metadata includes both prompts and resources when both match intent', async () => {
  // Register a tool that wins (executes), a prompt that matches, and a resource that matches.
  const { agg, backend } = makeAgg(
    [{ id: 'finance', name: 'Finance', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://finance.test/mcp', lazy: true }],
    (b) => b.defineServer('finance', {
      tools: [
        { name: 'list_payments', description: 'list recent payment transactions', inputSchema: { type: 'object' }, response: { content: [{ type: 'text', text: '[]' }] } },
      ],
      prompts: [
        { name: 'payment_summary', description: 'generate a payment transaction summary report' },
      ],
      resources: [
        { uri: 'finance://payment-schema', name: 'Payment Schema', description: 'schema for payment transaction records' },
      ],
    }),
  );

  try {
    // Intent matches tool (list_payments), prompt (payment_summary), and resource (payment-schema)
    const result = await agg.callTool('ch1tty/cast', { intent: 'list payment transactions' });
    assert.equal(result.isError, undefined);

    // First content item is the cast metadata JSON
    const meta = JSON.parse((result.content[0] as { type: string; text: string }).text);
    assert.equal(meta.cast, 'executed', `expected executed, got: ${JSON.stringify(meta)}`);
    assert.ok(Array.isArray(meta.prompts), 'executed metadata must include prompts array');
    assert.ok(Array.isArray(meta.resources), 'executed metadata must include resources array');
    assert.ok(meta.prompts.length > 0, 'at least one prompt must match');
    assert.ok(meta.resources.length > 0, 'at least one resource must match');
    // Backend was actually called (not confirm mode)
    assert.ok(backend.getCallLog().length > 0, 'backend must have been called in executed mode');
  } finally {
    await agg.shutdown();
  }
});

// ── 6. handleSearch server-summary: no focus → inFocus absent ────────────────

test('handleSearch server-summary: no focus active → inFocus key absent from all server entries', async () => {
  // No focus configured; the server summary spread uses `...(focus ? { inFocus } : {})`.
  // When focus is falsy, no inFocus key should appear on any entry.
  const backend = new FixtureBackend();
  backend.defineServer('alpha', { tools: [{ name: 't1', description: 'tool one', inputSchema: { type: 'object' }, response: { content: [{ type: 'text', text: 'ok' }] } }] });
  backend.defineServer('beta', { tools: [{ name: 't2', description: 'tool two', inputSchema: { type: 'object' }, response: { content: [{ type: 'text', text: 'ok' }] } }] });

  const configs: ServerConfig[] = [
    { id: 'alpha', name: 'Alpha', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://alpha.test/mcp', lazy: true },
    { id: 'beta', name: 'Beta', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://beta.test/mcp', lazy: true },
  ];
  const path = dlqPath();
  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: {},
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
    // No focus set
  });

  try {
    // No query → server-summary path
    const result = await agg.callTool('ch1tty/search', {});
    const data = JSON.parse((result.content[0] as { type: string; text: string }).text);

    assert.ok(Array.isArray(data.servers), 'server summary must include servers array');
    assert.equal(data.focus, undefined, 'focus key must be absent from response when no focus active');
    for (const s of data.servers as Array<{ server: string; inFocus?: boolean }>) {
      assert.equal(
        s.inFocus,
        undefined,
        `server ${s.server} must not have inFocus key when no focus is active`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── 7. cast:plan with focus + resource + suggestions all present ──────────────

test('cast:plan with focus active + matching resource → focus, resources, and suggestions all in plan', async () => {
  const profiles = validateFocusProfiles({
    profiles: { finance: { categories: ['ecosystem'], servers: ['payments'], boost: 0.5 } },
  });
  const catalog = {
    finance: {
      description: 'Finance tools',
      combos: [{ name: 'payment-reconcile', chain: ['payments/list_payments', 'payments/export_report'], accomplishes: 'reconcile payments', verified: false }],
      prompts: [{ text: 'List recent payments', resolves_to: 'payment-reconcile' }],
    },
  };

  const { agg } = makeAgg(
    [{ id: 'payments', name: 'Payments', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://payments.test/mcp', lazy: true }],
    (b) => b.defineServer('payments', {
      tools: [
        { name: 'list_payments', description: 'list recent payment transactions', inputSchema: { type: 'object' }, response: { content: [{ type: 'text', text: '[]' }] } },
      ],
      resources: [
        { uri: 'payments://payment-schema', name: 'Payment Schema', description: 'schema for payment transaction records' },
      ],
    }),
    { focus: 'finance', focusProfiles: profiles, suggestionsCatalog: catalog },
  );

  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list payment transactions',
      confirm: true,
    });
    assert.equal(result.isError, undefined);
    const body = JSON.parse((result.content[0] as { type: string; text: string }).text);

    assert.equal(body.cast, 'plan', `expected plan, got: ${JSON.stringify(body)}`);
    assert.equal(body.focus, 'finance', 'focus must appear in plan when active');
    assert.ok(Array.isArray(body.resources), 'resources must appear in plan when matching resource exists');
    assert.ok(body.resources.length > 0, 'at least one resource must be in plan.resources');
    assert.ok(body.suggestions, 'suggestions must appear in plan when focus has catalog entries');
    assert.ok(Array.isArray(body.suggestions.combos), 'suggestions.combos must be an array');
    assert.ok(Array.isArray(body.suggestions.prompts), 'suggestions.prompts must be an array');
  } finally {
    await agg.shutdown();
  }
});
