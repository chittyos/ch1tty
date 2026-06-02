/**
 * KKK batch — six untested branches in coordinator.ts stageSession + openclaw-facade.ts
 *
 * coordinator.ts stageSession() gaps:
 *   1. memories.results is NOT an array (string value) → Array.isArray("bad") = false
 *      → entity.recentMemories is never set (stays undefined), staging still completes
 *
 *   2. workstreams.results is NOT an array (null value) → Array.isArray(null) = false
 *      → entity.activeWorkstreams is never set, staging still completes
 *
 *   3. workstreams callEcosystem throws → inner catch {} swallows it (no log, no rethrow)
 *      → activeWorkstreams never set, staging still completes normally
 *
 *   4. memories parseResult returns null (isError:true) → null?.results = undefined
 *      → Array.isArray(undefined) = false → recentMemories not set, staging completes
 *
 * openclaw-facade.ts gaps:
 *   5. ch1tty-session skill with action='persist' → mapArgs branches to
 *      chittyos/chitty_memory_persist (not recall); the else-branch in mapArgs
 *      at openclaw-facade.ts:122 was never exercised
 *
 *   6. POST /openclaw/skills.json (non-GET) → skills manifest guard checks
 *      `req.method === 'GET'`; POST falls through to the catch-all 404
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
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
import { SessionCoordinator } from '../src/coordinator.js';
import { Aggregator } from '../src/aggregator.js';
import { HttpMcpServer } from '../src/http-server.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;
function dlqPath(): string {
  return join(tmpdir(), `ch1tty-kkk-${process.pid}-${++_seq}.dlq.jsonl`);
}

async function waitForStaging(
  coord: { isStagingComplete(id: string): boolean },
  sessionId: string,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!coord.isStagingComplete(sessionId)) {
    if (Date.now() > deadline) throw new Error(`Staging did not complete within ${timeoutMs}ms`);
    await new Promise<void>((r) => setImmediate(r));
  }
}

// ── Stub ecosystem with configurable per-tool handlers ───────────────────────

type ToolHandler = (args: Record<string, unknown>) => unknown;

class StubEco implements Backend {
  private handlers = new Map<string, ToolHandler>();

  setHandler(tool: string, h: ToolHandler): void { this.handlers.set(tool, h); }

  async callTool(_svc: string, toolName: string, args: Record<string, unknown> = {}): Promise<ToolCallResult> {
    const h = this.handlers.get(toolName);
    if (!h) return { content: [{ type: 'text', text: 'null' }] };
    const result = await h(args);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  registerServer(_: ServerConfig): void {}
  isRegistered(_: string): boolean { return true; }
  getStatus(_: string): BackendStatus { return { connected: true, toolCount: 0, toolCacheAge: null }; }
  async listTools(_: string): Promise<ToolEntry[]> { return []; }
  async listResources(_: string): Promise<{ resources: ResourceEntry[]; templates: ResourceTemplateEntry[] }> { return { resources: [], templates: [] }; }
  async readResource(_: string, _u: string): Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }> }> { return { contents: [] }; }
  async listPrompts(_: string): Promise<PromptEntry[]> { return []; }
  async getPrompt(_: string, _n: string): Promise<{ description?: string; messages: Array<{ role: 'user' | 'assistant'; content: ContentItem }> }> { return { messages: [] }; }
  async shutdown(): Promise<void> {}
}

/** Stub that returns a raw ToolCallResult directly (bypasses JSON.stringify wrapper). */
class RawStubEco implements Backend {
  private tools = new Map<string, () => ToolCallResult>();

  setRaw(toolName: string, fn: () => ToolCallResult): void { this.tools.set(toolName, fn); }

  async callTool(_svc: string, toolName: string, _args: Record<string, unknown> = {}): Promise<ToolCallResult> {
    const fn = this.tools.get(toolName);
    if (!fn) return { content: [{ type: 'text', text: 'null' }] };
    return fn();
  }

  registerServer(_: ServerConfig): void {}
  isRegistered(_: string): boolean { return true; }
  getStatus(_: string): BackendStatus { return { connected: true, toolCount: 0, toolCacheAge: null }; }
  async listTools(_: string): Promise<ToolEntry[]> { return []; }
  async listResources(_: string): Promise<{ resources: ResourceEntry[]; templates: ResourceTemplateEntry[] }> { return { resources: [], templates: [] }; }
  async readResource(_: string, _u: string): Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }> }> { return { contents: [] }; }
  async listPrompts(_: string): Promise<PromptEntry[]> { return []; }
  async getPrompt(_: string, _n: string): Promise<{ description?: string; messages: Array<{ role: 'user' | 'assistant'; content: ContentItem }> }> { return { messages: [] }; }
  async shutdown(): Promise<void> {}
}

// ── HTTP server helpers (for openclaw tests) ─────────────────────────────────

interface Ctx { agg: Aggregator; srv: HttpMcpServer; baseUrl: string; dlq: string }

async function startHttp(configs: ServerConfig[] = [], fb?: FixtureBackend): Promise<Ctx> {
  const dlq = dlqPath();
  const agg = new Aggregator(configs, {
    ledgerDlqPath: dlq,
    embedEnabled: false,
    ...(fb ? { backendFactory: () => fb } : {}),
  });
  const srv = new HttpMcpServer(agg, { port: 0, bindAddress: '127.0.0.1' });
  await srv.start();
  return { agg, srv, baseUrl: `http://127.0.0.1:${srv.getPort()}`, dlq };
}

async function stopHttp(ctx: Ctx): Promise<void> {
  await ctx.srv.stop();
  await ctx.agg.shutdown();
  rmSync(ctx.dlq, { force: true });
}

// ── 1. stageSession: memories.results is a string → Array.isArray(string) = false ──

test('stageSession: memories.results is a string → recentMemories not set, staging completes', async () => {
  const dlq = dlqPath();
  const coord = new SessionCoordinator({}, { enabled: false }, dlq);
  const stub = new StubEco();

  stub.setHandler('context_resolve', () => ({ chitty_id: 'kkk-user-1' }));
  stub.setHandler('chitty_memory_recall', (args) => {
    const { query } = args as { query?: string };
    if (query === 'recent session context') {
      return { results: 'this-is-a-string-not-array' };
    }
    return { results: [] };
  });

  try {
    coord.bindEcosystem(stub, 'chittyos');
    const sid = 'kkk-staging-1';
    await coord.onSessionStart(sid, 'http');
    await waitForStaging(coord, sid);

    assert.ok(coord.isStagingComplete(sid), 'staging must complete');
    const entity = coord.getEntityContext(sid);
    assert.ok(entity, 'entity should be resolved (chitty_id present)');
    assert.equal(entity.chittyId, 'kkk-user-1');
    assert.equal(entity.recentMemories, undefined, 'recentMemories must not be set when results is not array');
  } finally {
    await coord.onSessionEnd('kkk-staging-1');
    await coord.ledger.shutdown();
    rmSync(dlq, { force: true });
  }
});

// ── 2. stageSession: workstreams.results is null → Array.isArray(null) = false ──

test('stageSession: workstreams.results is null → activeWorkstreams not set, staging completes', async () => {
  const dlq = dlqPath();
  const coord = new SessionCoordinator({}, { enabled: false }, dlq);
  const stub = new StubEco();

  stub.setHandler('context_resolve', () => ({
    chitty_id: 'kkk-user-2',
    identity_class: 'engineer',
  }));
  stub.setHandler('chitty_memory_recall', (args) => {
    const { query } = args as { query?: string };
    if (query === 'recent session context') {
      return { results: [{ content: 'memory-entry' }] };
    }
    if (query === 'active workstreams') {
      // workstreams.results is null → Array.isArray(null) = false → guard is false
      return { results: null };
    }
    return { results: [] };
  });

  try {
    coord.bindEcosystem(stub, 'chittyos');
    const sid = 'kkk-staging-2';
    await coord.onSessionStart(sid, 'http');
    await waitForStaging(coord, sid);

    assert.ok(coord.isStagingComplete(sid), 'staging must complete');
    const entity = coord.getEntityContext(sid);
    assert.ok(entity, 'entity must be resolved');
    assert.ok(Array.isArray(entity.recentMemories), 'memories step should have succeeded');
    assert.equal(entity.activeWorkstreams, undefined, 'activeWorkstreams must not be set when results is null');
  } finally {
    await coord.onSessionEnd('kkk-staging-2');
    await coord.ledger.shutdown();
    rmSync(dlq, { force: true });
  }
});

// ── 3. stageSession: workstreams callEcosystem throws → catch {} swallows ────

test('stageSession: workstreams callEcosystem throws → catch{} swallows, staging still completes', async () => {
  const dlq = dlqPath();
  const coord = new SessionCoordinator({}, { enabled: false }, dlq);

  // Use a raw stub so we can throw from the second memory recall
  const stub = new RawStubEco();
  let recallCallCount = 0;

  stub.setRaw('context_resolve', () => ({
    content: [{ type: 'text', text: JSON.stringify({ chitty_id: 'kkk-user-3' }) }],
  }));
  stub.setRaw('chitty_memory_recall', () => {
    recallCallCount++;
    if (recallCallCount === 1) {
      // First call (recent session context) — return valid memories
      return { content: [{ type: 'text', text: JSON.stringify({ results: [{ content: 'mem-A' }] }) }] };
    }
    // Second call (active workstreams) — throw; coordinator's catch{} swallows it
    throw new Error('workstreams service unavailable');
  });

  try {
    coord.bindEcosystem(stub, 'chittyos');
    const sid = 'kkk-staging-3';
    await coord.onSessionStart(sid, 'http');
    await waitForStaging(coord, sid);

    assert.ok(coord.isStagingComplete(sid), 'staging must complete even when workstreams call throws');
    const entity = coord.getEntityContext(sid);
    assert.ok(entity, 'entity resolved despite workstreams error');
    assert.deepEqual(entity.recentMemories, ['mem-A'], 'memories loaded before workstreams failed');
    assert.equal(entity.activeWorkstreams, undefined, 'activeWorkstreams must be absent when call throws');
    assert.ok(recallCallCount >= 2, 'both recall calls were attempted');
  } finally {
    await coord.onSessionEnd('kkk-staging-3');
    await coord.ledger.shutdown();
    rmSync(dlq, { force: true });
  }
});

// ── 4. stageSession: memories parseResult returns null (isError:true) ─────────

test('stageSession: memories callTool returns isError:true → parseResult null → recentMemories not set', async () => {
  const dlq = dlqPath();
  const coord = new SessionCoordinator({}, { enabled: false }, dlq);

  const stub = new RawStubEco();

  stub.setRaw('context_resolve', () => ({
    content: [{ type: 'text', text: JSON.stringify({ chitty_id: 'kkk-user-4' }) }],
  }));
  stub.setRaw('chitty_memory_recall', () => ({
    // isError: true → parseResult returns null → null?.results = undefined
    // → Array.isArray(undefined) = false → recentMemories guard is false
    content: [{ type: 'text', text: 'memory service down' }],
    isError: true,
  }));

  try {
    coord.bindEcosystem(stub, 'chittyos');
    const sid = 'kkk-staging-4';
    await coord.onSessionStart(sid, 'http');
    await waitForStaging(coord, sid);

    assert.ok(coord.isStagingComplete(sid), 'staging must complete when parseResult returns null');
    const entity = coord.getEntityContext(sid);
    assert.ok(entity, 'entity resolved via context_resolve');
    assert.equal(entity.recentMemories, undefined, 'recentMemories must be absent when parseResult returns null');
    assert.equal(entity.activeWorkstreams, undefined, 'activeWorkstreams must also be absent');
  } finally {
    await coord.onSessionEnd('kkk-staging-4');
    await coord.ledger.shutdown();
    rmSync(dlq, { force: true });
  }
});

// ── 5. openclaw: ch1tty-session action='persist' → mapArgs → chitty_memory_persist ──

test('openclaw ch1tty-session action=persist → mapArgs routes to chittyos/chitty_memory_persist', async () => {
  const fb = new FixtureBackend();
  fb.defineServer('chittyos', {
    tools: [
      {
        name: 'chitty_memory_persist',
        description: 'Persist a memory entry',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: JSON.stringify({ persisted: true, key: 'my-key' }) }] },
      },
    ],
  });

  const cfg: ServerConfig = {
    id: 'chittyos',
    name: 'ChittyOS',
    type: 'remote',
    access: 'readwrite',
    category: 'ecosystem',
    endpoint: 'https://unused.invalid/mcp',
  };

  const ctx = await startHttp([cfg], fb);
  try {
    const res = await fetch(`${ctx.baseUrl}/openclaw/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skill: 'ch1tty-session',
        args: {
          action: 'persist',
          query: 'my-key',
          value: 'my-value',
          scope: 'entity',
        },
      }),
    });

    assert.equal(res.status, 200, 'openclaw invoke must return 200');
    const body = await res.json() as { ok: boolean; skill: string; result: unknown };
    assert.equal(body.ok, true, 'response must be ok:true');
    assert.equal(body.skill, 'ch1tty-session', 'skill name echoed back');

    // Verify the FixtureBackend received a call to chitty_memory_persist (not recall)
    const calls = fb.getCallLog();
    assert.ok(
      calls.some((c) => c.serverId === 'chittyos' && c.tool === 'chitty_memory_persist'),
      `expected chitty_memory_persist call; got: ${JSON.stringify(calls.map((c) => `${c.serverId}/${c.tool}`))}`,
    );
    assert.ok(
      !calls.some((c) => c.tool === 'chitty_memory_recall'),
      'chitty_memory_recall must NOT be called when action=persist',
    );
  } finally {
    await stopHttp(ctx);
  }
});

// ── 6. openclaw: POST /openclaw/skills.json (non-GET) → 404 catch-all ────────

test('openclaw POST /skills.json (non-GET) → 404 unknown route', async () => {
  const ctx = await startHttp();
  try {
    // The skills manifest handler checks `req.method === 'GET'`.
    // A POST request does NOT match, falls through to the catch-all 404.
    const res = await fetch(`${ctx.baseUrl}/openclaw/skills.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.equal(res.status, 404, 'POST to /skills.json must return 404 (not matched by GET guard)');
    const body = await res.json() as { ok: boolean; error: string; path: string };
    assert.equal(body.ok, false, 'body.ok must be false');
    assert.ok(
      typeof body.error === 'string' && body.error.length > 0,
      'error field must be present',
    );
  } finally {
    await stopHttp(ctx);
  }
});
