/**
 * RR coverage sweep — closes 5 remaining branch gaps across coordinator.ts and aggregator.ts.
 *
 * Gaps targeted:
 *  1. coordinator.ts:349  — `slash === -1` branch in getSnapshot().toolsByServer: tool name
 *     stored without a '/' separator uses the full name as the server key.
 *  2. aggregator.ts:1078  — `...(scopeCategories ? { scope_categories } : {})` inside the
 *     ledger record block (line 1070–1079): fires when scope.categories is set AND a
 *     sessionId is active (effectiveSessionId truthy).
 *  3. aggregator.ts:1246  — `JSON.stringify(r.content)` fallback in chain step error handling:
 *     fires when a step returns isError:true but content[0].text is not a string (e.g. an
 *     image content item has no text property).
 *  4. aggregator.ts:1280  — `...(explanation ? { explanation } : {})` truthy branch in
 *     chain_executed: fires when chain:true + explain:true produces an explanation object.
 *  5. aggregator.ts:1201-1202 — scope annotation + explanation in cast:discovered: fires when
 *     no tools match (possibly due to scope) but prompts/resources do, AND scope is set AND
 *     explain:true.
 *
 * Remote-proxy line 229 (options.timeoutMs branch) is covered in remote-proxy-timeout-paths.test.ts.
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
  return join(tmpdir(), `ch1tty-rrr-${label}-${Date.now()}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

// ── 1. coordinator.ts:349 — slash === -1 branch in getSnapshot().toolsByServer ──

test('rrr: coordinator.getSnapshot toolsByServer uses full name as key when tool has no slash', async () => {
  const coordinator = new KeywordOnlyCoordinator({}, { enabled: false }, dlqPath('coord-noslash'));
  await coordinator.onSessionStart('sid', 'http');
  coordinator.onToolCall('sid', 'noslash'); // no '/' separator
  const snap = coordinator.getSnapshot();
  assert.deepEqual(snap.toolsByServer, { noslash: 1 },
    'tool without slash: full name becomes the server key (slash === -1 branch)');
  coordinator.close();
});

// ── 2. aggregator.ts:1078 — scopeCategories truthy in ledger record (sessionId active) ──

test('rrr: cast scope.categories + explicit sessionId fires scopeCategories ledger branch', async () => {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [
      {
        name: 'list_projects',
        description: 'list neon database projects',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '[]' }] },
      },
    ],
  });

  const configs: ServerConfig[] = [
    { id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://neon.tech/mcp', lazy: true, enabled: true },
  ];
  const dlq = dlqPath('scope-cat');
  const coordinator = new KeywordOnlyCoordinator({}, { enabled: false }, dlq);
  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq,
    suggestionsCatalog: {},
    coordinator,
  });

  // scope.categories + explicit sessionId → effectiveSessionId is active → ledger record at
  // line 1070-1079 is entered → scopeCategories truthy branch at line 1078 fires.
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    scope: { categories: ['ecosystem'] },
    sessionId: 'sess-rrr-scope-cat',
    dryRun: true,
  });
  const data = JSON.parse(result.content[0].text as string) as Record<string, unknown>;
  // Scope annotation must reflect categories (confirms categories were parsed)
  assert.deepEqual(
    (data.scope as Record<string, unknown>)?.categories,
    ['ecosystem'],
    'scope.categories in response confirms scopeCategories was parsed and line 1078 fired',
  );
  await agg.shutdown();
});

// ── 3. aggregator.ts:1246 — JSON.stringify fallback for non-text error content ──

test('rrr: chain step isError with non-text content uses JSON.stringify fallback (line 1246)', async () => {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [
      {
        name: 'list_projects',
        description: 'list neon database projects',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '["proj-1"]' }] },
      },
      {
        name: 'create_project',
        description: 'create a new neon project',
        inputSchema: { type: 'object', properties: {} },
        // Error response with image content — no text field → triggers JSON.stringify branch
        response: {
          content: [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }] as never,
          isError: true,
        },
      },
    ],
  });

  const CATALOG = {
    code: {
      description: 'Code focus',
      combos: [
        {
          name: 'neon-setup',
          chain: ['neon/list_projects', 'neon/create_project'],
          accomplishes: 'List then create',
          verified: true,
        },
      ],
      prompts: [],
    },
  };

  const configs: ServerConfig[] = [
    { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true, enabled: true },
  ];
  const dlq = dlqPath('chain-imgErr');
  const coordinator = new KeywordOnlyCoordinator({}, { enabled: false }, dlq);
  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq,
    suggestionsCatalog: CATALOG,
    coordinator,
    focus: 'code',
  });

  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    chain: true,
  });
  const data = JSON.parse(result.content[0].text as string) as Record<string, unknown>;
  assert.equal(data.cast, 'chain_executed', 'chain_executed when at least step 0 runs');
  const steps = data.steps as Array<{ step: number; tool: string; ok: boolean; error?: string }>;
  const errStep = steps.find((s) => !s.ok);
  assert.ok(errStep !== undefined, 'one step must fail');
  // JSON.stringify of image content array — must contain "image" key from the content object
  assert.ok(
    typeof errStep.error === 'string' && errStep.error.includes('"type"'),
    'error string is JSON.stringify of content array (not content[0].text which is undefined)',
  );
  await agg.shutdown();
});

// ── 4. aggregator.ts:1280 — explanation truthy branch in chain_executed ──

test('rrr: chain_executed with explain:true includes explanation field (line 1280)', async () => {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [
      {
        name: 'list_projects',
        description: 'list neon database projects',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '["proj-1"]' }] },
      },
      {
        name: 'create_project',
        description: 'create a new neon project',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '{"id":"new"}' }] },
      },
    ],
  });

  const CATALOG = {
    code: {
      description: 'Code focus',
      combos: [
        {
          name: 'neon-setup',
          chain: ['neon/list_projects', 'neon/create_project'],
          accomplishes: 'List then create',
          verified: true,
        },
      ],
      prompts: [],
    },
  };

  const configs: ServerConfig[] = [
    { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true, enabled: true },
  ];
  const dlq = dlqPath('chain-explain');
  const coordinator = new KeywordOnlyCoordinator({}, { enabled: false }, dlq);
  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq,
    suggestionsCatalog: CATALOG,
    coordinator,
    focus: 'code',
  });

  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    chain: true,
    explain: true,   // <- triggers explanation truthy branch at line 1280
  });
  const data = JSON.parse(result.content[0].text as string) as Record<string, unknown>;
  assert.equal(data.cast, 'chain_executed', 'must be chain_executed');
  assert.ok(data.explanation !== undefined,
    'explanation field present when explain:true in chain_executed (line 1280 truthy branch)');
  assert.equal((data.explanation as Record<string, unknown>).method, 'keyword');
  await agg.shutdown();
});

// ── 5. aggregator.ts:1201-1202 — scope annotation + explanation in cast:discovered ──

test('rrr: cast:discovered with scope and explain:true covers lines 1201-1202', async () => {
  const backend = new FixtureBackend();
  // neon backend: tools about "projects" (won't match "guide queries"), prompt that WILL match
  backend.defineServer('neon', {
    tools: [
      {
        name: 'list_projects',
        description: 'list neon database projects',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '[]' }] },
      },
    ],
    prompts: [
      { name: 'neon-query-helper', description: 'Guide for writing efficient Neon SQL queries' },
    ],
  });

  const configs: ServerConfig[] = [
    { id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://neon.tech/mcp', lazy: true, enabled: true },
  ];
  const dlq = dlqPath('discovered-scope-explain');
  const coordinator = new KeywordOnlyCoordinator({}, { enabled: false }, dlq);
  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq,
    suggestionsCatalog: {},
    coordinator,
  });

  // Intent matches the prompt ("guide", "writing", "queries") but NOT the tool ("list", "projects")
  // scope.servers=['neon'] restricts tools to neon — none score above threshold
  // explain:true builds explanation — both branches at 1201 and 1202 fire
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'guide writing queries',
    scope: { servers: ['neon'] },
    explain: true,
  });
  const data = JSON.parse(result.content[0].text as string) as Record<string, unknown>;
  assert.equal(data.cast, 'discovered', 'prompt matches but no tools → cast:discovered');
  assert.deepEqual(
    (data.scope as Record<string, unknown>)?.servers,
    ['neon'],
    'scope annotation present in discovered response (line 1201 truthy branch)',
  );
  assert.ok(data.explanation !== undefined,
    'explanation present in discovered response when explain:true (line 1202 truthy branch)');
  await agg.shutdown();
});
