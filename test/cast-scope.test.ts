/**
 * cast `scope` parameter — hard-filter the registry before intent resolution.
 *
 * scope is applied BEFORE focus boosting: only tools from the specified servers
 * or categories are candidates. Focus (soft lens) then applies on the reduced set.
 *
 * Coverage:
 *  1. scope.servers limits resolution to tools from those server ids
 *  2. scope.categories limits resolution to tools in those categories
 *  3. scope.servers + scope.categories are ANDed (tool must match both)
 *  4. scope that excludes all tools → cast: no_match (with scope annotation)
 *  5. scope surfaced in dryRun (cast: resolved) response
 *  6. scope surfaced in confirm (cast: plan) response
 *  7. scope surfaced in executed (cast: executed) response
 *  8. scope surfaced in no_match response
 *  9. empty scope object {} → no filter applied
 * 10. scope restricts: tool outside scope → no_match even if it would otherwise win
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
  return join(tmpdir(), `ch1tty-scope-${label}-${Date.now()}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

function makeAgg(opts: { focus?: string } = {}) {
  const dlq = dlqPath('coord');
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [
      { name: 'list_projects', description: 'list neon database projects', inputSchema: { type: 'object', properties: {} }, response: { content: [{ type: 'text', text: '[]' }] } },
      { name: 'create_project', description: 'create a neon database project', inputSchema: { type: 'object', properties: {} }, response: { content: [{ type: 'text', text: '{}' }] } },
    ],
  });
  backend.defineServer('fs', {
    tools: [
      { name: 'read_text_file', description: 'read a file from the filesystem', inputSchema: { type: 'object', properties: {} }, response: { content: [{ type: 'text', text: 'file content' }] } },
    ],
  });

  const configs: ServerConfig[] = [
    { id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://neon.tech/mcp', lazy: true, enabled: true },
    { id: 'fs', name: 'Filesystem', type: 'remote', access: 'readwrite', category: 'desktop', endpoint: 'https://fs.local/mcp', lazy: true, enabled: true },
  ];

  const coordinator = new KeywordOnlyCoordinator({}, { enabled: false }, dlq);
  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq,
    suggestionsCatalog: {},
    coordinator,
    ...(opts.focus ? { focus: opts.focus } : {}),
  });
  return agg;
}

function parseResult(result: { content: Array<{ type: string; text?: string }> }) {
  const text = result.content.find((c) => c.type === 'text')?.text ?? '';
  return JSON.parse(text) as Record<string, unknown>;
}

// ── 1. scope.servers limits to matching server ────────────────────────────────

test('scope.servers restricts resolution to tools from those server ids', async () => {
  const agg = makeAgg();
  // 'read file filesystem' would normally hit fs/read_text_file
  // With scope: { servers: ['neon'] }, fs is excluded → no_match
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'read file from filesystem',
    scope: { servers: ['neon'] },
    dryRun: true,
  });
  const parsed = parseResult(result);
  assert.equal(parsed.cast, 'no_match', 'fs excluded by server scope → no_match');
  assert.deepEqual((parsed.scope as Record<string, unknown>)?.servers, ['neon']);
  await agg.shutdown();
});

// ── 2. scope.servers allows matching server to resolve ────────────────────────

test('scope.servers allows matching server tools to be found', async () => {
  const agg = makeAgg();
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects database',
    scope: { servers: ['neon'] },
    dryRun: true,
  });
  const parsed = parseResult(result);
  assert.equal(parsed.cast, 'resolved', 'neon in scope → resolves');
  assert.ok((parsed.resolved as Record<string, unknown>)?.tool?.toString().startsWith('neon/'));
  assert.deepEqual((parsed.scope as Record<string, unknown>)?.servers, ['neon']);
  await agg.shutdown();
});

// ── 3. scope.categories restricts to matching category ───────────────────────

test('scope.categories restricts to tools in those categories', async () => {
  const agg = makeAgg();
  // neon is ecosystem, fs is desktop. Scoping to desktop excludes neon.
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon database projects',
    scope: { categories: ['desktop'] },
    dryRun: true,
  });
  const parsed = parseResult(result);
  assert.equal(parsed.cast, 'no_match', 'neon excluded by category scope → no_match');
  assert.deepEqual((parsed.scope as Record<string, unknown>)?.categories, ['desktop']);
  await agg.shutdown();
});

// ── 4. scope.servers + scope.categories are ANDed ────────────────────────────

test('scope.servers + scope.categories must both match (AND)', async () => {
  const agg = makeAgg();
  // neon server + ecosystem category: neon qualifies (ecosystem). Should resolve.
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    scope: { servers: ['neon'], categories: ['ecosystem'] },
    dryRun: true,
  });
  const parsed = parseResult(result);
  assert.equal(parsed.cast, 'resolved');
  const sc = parsed.scope as Record<string, unknown>;
  assert.deepEqual(sc?.servers, ['neon']);
  assert.deepEqual(sc?.categories, ['ecosystem']);
  await agg.shutdown();
});

test('scope AND excludes server that mismatches category', async () => {
  const agg = makeAgg();
  // neon server + desktop category: neon is ecosystem, not desktop → 0 tools
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list projects',
    scope: { servers: ['neon'], categories: ['desktop'] },
    dryRun: true,
  });
  const parsed = parseResult(result);
  assert.equal(parsed.cast, 'no_match', 'neon is ecosystem not desktop → no tools after AND');
  await agg.shutdown();
});

// ── 5. empty scope object → no filter ────────────────────────────────────────

test('empty scope object {} applies no filter', async () => {
  const agg = makeAgg();
  // scope: {} has no servers/categories → all tools visible
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'read file',
    scope: {},
    dryRun: true,
  });
  const parsed = parseResult(result);
  // fs/read_text_file should match 'read file' without restriction
  assert.equal(parsed.cast, 'resolved');
  // No scope annotation because no filters were actually set
  assert.equal(parsed.scope, undefined);
  await agg.shutdown();
});

// ── 6. scope surfaced in no_match response ────────────────────────────────────

test('scope annotation present in no_match response', async () => {
  const agg = makeAgg();
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'nonexistent quantum widget xyzzy',
    scope: { servers: ['neon'] },
  });
  const parsed = parseResult(result);
  assert.equal(parsed.cast, 'no_match');
  assert.deepEqual((parsed.scope as Record<string, unknown>)?.servers, ['neon']);
  await agg.shutdown();
});

// ── 7. scope surfaced in confirm (plan) response ──────────────────────────────

test('scope annotation present in confirm (plan) response', async () => {
  const agg = makeAgg();
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    scope: { servers: ['neon'] },
    confirm: true,
  });
  const parsed = parseResult(result);
  assert.equal(parsed.cast, 'plan');
  assert.deepEqual((parsed.scope as Record<string, unknown>)?.servers, ['neon']);
  await agg.shutdown();
});

// ── 8. scope surfaced in executed response ────────────────────────────────────

test('scope annotation present in executed response', async () => {
  const agg = makeAgg();
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    scope: { servers: ['neon'] },
  });
  const parsed = parseResult(result);
  assert.equal(parsed.cast, 'executed');
  assert.deepEqual((parsed.scope as Record<string, unknown>)?.servers, ['neon']);
  await agg.shutdown();
});

// ── 9. scope restricts: outside-scope winner → no_match ──────────────────────

test('scope excludes best match: outside-scope tool returns no_match', async () => {
  const agg = makeAgg();
  // Without scope, 'read file' resolves to fs/read_text_file
  const withoutScope = await agg.callTool('ch1tty/cast', { intent: 'read file', dryRun: true });
  const pw = parseResult(withoutScope);
  assert.equal(pw.cast, 'resolved');
  assert.ok((pw.resolved as Record<string, unknown>)?.tool?.toString().includes('fs/'));

  // With scope: { servers: ['neon'] }, fs is excluded → no_match
  const withScope = await agg.callTool('ch1tty/cast', {
    intent: 'read file',
    scope: { servers: ['neon'] },
    dryRun: true,
  });
  const ps = parseResult(withScope);
  assert.equal(ps.cast, 'no_match');
  await agg.shutdown();
});
