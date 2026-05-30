/**
 * Tests for the Aggregator's registry TTL expiry and coalescing behavior.
 *
 * The internal tool registry is cached for 5 minutes (REGISTRY_TTL). The key
 * invariants under test:
 *   1. Initial state: registryExpiresAt=0 → first search triggers a listTools fetch.
 *   2. Fresh cache: subsequent searches within TTL skip listTools entirely.
 *   3. Expired cache: after TTL, next search triggers a second listTools fetch.
 *   4. New tools visible: tools added to a backend become visible after expiry.
 *   5. Coalescing: N concurrent searches on a stale registry call listTools exactly once.
 *   6. TTL sentinel: registryExpiresAt is set to ≈5 min in the future after a refresh.
 */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { Aggregator } from '../src/aggregator.js';
import type {
  Backend,
  BackendStatus,
  ContentItem,
  PromptEntry,
  ResourceEntry,
  ResourceTemplateEntry,
  ServerConfig,
  ToolCallResult,
  ToolEntry,
} from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

const DLQ = join(tmpdir(), `ch1tty-registry-ttl-${process.pid}.dlq.jsonl`);
after(() => { rmSync(DLQ, { force: true }); });

const CONFIGS: ServerConfig[] = [
  {
    id: 'alpha',
    name: 'Alpha Server',
    type: 'remote',
    access: 'readwrite',
    category: 'code',
    endpoint: 'https://fake.alpha',
  },
];

/** Wraps a FixtureBackend and counts listTools() invocations. */
class CountingBackend implements Backend {
  listToolsCalls = 0;
  private readonly inner: FixtureBackend;
  constructor(inner: FixtureBackend) { this.inner = inner; }
  registerServer(config: ServerConfig): void { this.inner.registerServer(config); }
  isRegistered(serverId: string): boolean { return this.inner.isRegistered(serverId); }
  getStatus(serverId: string): BackendStatus { return this.inner.getStatus(serverId); }
  async listTools(serverId: string): Promise<ToolEntry[]> {
    this.listToolsCalls++;
    return this.inner.listTools(serverId);
  }
  async callTool(
    serverId: string,
    toolName: string,
    args?: Record<string, unknown>,
  ): Promise<ToolCallResult> {
    return this.inner.callTool(serverId, toolName, args);
  }
  async listResources(
    serverId: string,
  ): Promise<{ resources: ResourceEntry[]; templates: ResourceTemplateEntry[] }> {
    return this.inner.listResources(serverId);
  }
  async readResource(
    serverId: string,
    uri: string,
  ): Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }> }> {
    return this.inner.readResource(serverId, uri);
  }
  async listPrompts(serverId: string): Promise<PromptEntry[]> {
    return this.inner.listPrompts(serverId);
  }
  async getPrompt(
    serverId: string,
    name: string,
    args?: Record<string, string>,
  ): Promise<{ description?: string; messages: Array<{ role: 'user' | 'assistant'; content: ContentItem }> }> {
    return this.inner.getPrompt(serverId, name, args);
  }
  async shutdown(): Promise<void> { return this.inner.shutdown(); }
}

function makeTool(name: string, description: string): {
  name: string; description: string; inputSchema: Record<string, unknown>;
  response: ToolCallResult;
} {
  return {
    name,
    description,
    inputSchema: {},
    response: { content: [{ type: 'text' as const, text: 'ok' }] },
  };
}

function buildAgg(cb: CountingBackend): Aggregator {
  return new Aggregator(CONFIGS, {
    ledgerDlqPath: DLQ,
    backendFactory: () => cb,
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    embedEnabled: false,
  });
}

/** Expire the registry by zeroing the TTL sentinel. */
function expireRegistry(agg: Aggregator): void {
  (agg as unknown as { registryExpiresAt: number }).registryExpiresAt = 0;
}

/** Read the TTL sentinel directly. */
function expiresAt(agg: Aggregator): number {
  return (agg as unknown as { registryExpiresAt: number }).registryExpiresAt;
}

async function searchTools(agg: Aggregator, query: string): Promise<string[]> {
  const r = await agg.callTool('ch1tty/search', { query });
  const body = JSON.parse((r.content[0] as { text: string }).text) as {
    tools?: Array<{ tool: string }>;
  };
  return (body.tools ?? []).map((t) => t.tool);
}

test('initial state — first search triggers listTools', async () => {
  const fb = new FixtureBackend();
  fb.defineServer('alpha', { tools: [makeTool('run_query', 'Execute a SQL query')] });
  const cb = new CountingBackend(fb);
  const agg = buildAgg(cb);
  assert.equal(cb.listToolsCalls, 0, 'no fetch before first search');
  await searchTools(agg, 'query');
  assert.equal(cb.listToolsCalls, 1, 'exactly one fetch on first search');
});

test('fresh cache — second search skips listTools', async () => {
  const fb = new FixtureBackend();
  fb.defineServer('alpha', { tools: [makeTool('run_query', 'Execute a SQL query')] });
  const cb = new CountingBackend(fb);
  const agg = buildAgg(cb);
  await searchTools(agg, 'query');
  const after1 = cb.listToolsCalls;
  await searchTools(agg, 'query');
  assert.equal(cb.listToolsCalls, after1, 'no second fetch within TTL');
});

test('expired cache — search triggers re-fetch', async () => {
  const fb = new FixtureBackend();
  fb.defineServer('alpha', { tools: [makeTool('run_query', 'Execute a SQL query')] });
  const cb = new CountingBackend(fb);
  const agg = buildAgg(cb);
  await searchTools(agg, 'query');
  assert.equal(cb.listToolsCalls, 1);
  expireRegistry(agg);
  await searchTools(agg, 'query');
  assert.equal(cb.listToolsCalls, 2, 'second fetch triggered by expiry');
});

test('new tools visible after TTL expiry', async () => {
  const fb = new FixtureBackend();
  fb.defineServer('alpha', { tools: [makeTool('run_query', 'Execute a SQL query')] });
  const cb = new CountingBackend(fb);
  const agg = buildAgg(cb);
  const before = await searchTools(agg, 'run_query');
  assert.ok(before.some((t) => t.includes('run_query')), 'initial tool visible');
  // Add a second tool to the backend after the first fetch
  fb.defineServer('alpha', {
    tools: [
      makeTool('run_query', 'Execute a SQL query'),
      makeTool('migrate_db', 'Run a database migration'),
    ],
  });
  expireRegistry(agg);
  const after = await searchTools(agg, 'migrate');
  assert.ok(after.some((t) => t.includes('migrate_db')), 'new tool visible after re-fetch');
});

test('coalescing — concurrent expired searches call listTools exactly once', async () => {
  // latencyMs forces the first refresh to stay in-flight when the others arrive,
  // which exercises the `if (this.registryRefreshing) return this.registryRefreshing` path.
  const fb = new FixtureBackend();
  fb.defineServer('alpha', {
    latencyMs: 15,
    tools: [makeTool('run_query', 'Execute a SQL query')],
  });
  const cb = new CountingBackend(fb);
  const agg = buildAgg(cb);
  // Prime the cache (listToolsCalls → 1)
  await searchTools(agg, 'query');
  assert.equal(cb.listToolsCalls, 1, 'one fetch for priming');
  // Expire, then fire 5 concurrent searches — only one refresh should fire
  expireRegistry(agg);
  const results = await Promise.all([
    searchTools(agg, 'query'),
    searchTools(agg, 'query'),
    searchTools(agg, 'query'),
    searchTools(agg, 'query'),
    searchTools(agg, 'query'),
  ]);
  results.forEach((r) =>
    assert.ok(r.some((t) => t.includes('run_query')), 'all concurrent results include tool'),
  );
  assert.equal(
    cb.listToolsCalls,
    2,
    `expected 2 total (1 prime + 1 coalesced), got ${cb.listToolsCalls}`,
  );
});

test('TTL sentinel is set to ≈5 min in the future after refresh', async () => {
  const fb = new FixtureBackend();
  fb.defineServer('alpha', { tools: [makeTool('run_query', 'Execute a SQL query')] });
  const cb = new CountingBackend(fb);
  const agg = buildAgg(cb);
  assert.equal(expiresAt(agg), 0, 'starts at 0');
  const before = Date.now();
  await searchTools(agg, 'query');
  const exp = expiresAt(agg);
  assert.ok(exp > before + 4 * 60 * 1000, 'TTL sentinel at least 4 min ahead');
  assert.ok(exp <= before + 6 * 60 * 1000, 'TTL sentinel at most 6 min ahead');
});
