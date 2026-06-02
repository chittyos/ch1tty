/**
 * KKK batch — five uncovered error-handling branches
 *
 * coordinator.ts stageSession() catch blocks (lines 317 and 335):
 *   1. chitty_memory_recall for "recent session context" throws → catch fires,
 *      entity still set, recentMemories undefined.
 *   2. chitty_memory_recall for "active workstreams" throws → silent catch fires,
 *      entity + recentMemories set, activeWorkstreams undefined.
 *
 * aggregator.ts listAll* backend error catches:
 *   3. listAllResourceTemplates: backend.listResources() throws → catch logs error,
 *      returns [] for that server; other servers still contribute.
 *   4. listAllPrompts: backend.listPrompts() throws → catch logs error,
 *      returns [] for that server; other servers still contribute.
 *
 * http-server.ts stop() rejection swallow (lines 267-268):
 *   5. session.transport.close() rejects during stop() → .catch() swallows the
 *      error (logs warn); stop() still resolves.
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

type ToolHandler = (args: Record<string, unknown>) => unknown;

class StubEcosystem implements Backend {
  private handlers = new Map<string, ToolHandler>();
  setHandler(tool: string, handler: ToolHandler): void { this.handlers.set(tool, handler); }

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
  async listResources(_: string): Promise<{ resources: ResourceEntry[]; templates: ResourceTemplateEntry[] }> {
    return { resources: [], templates: [] };
  }
  async readResource(_: string, _u: string) { return { contents: [] }; }
  async listPrompts(_: string): Promise<PromptEntry[]> { return []; }
  async getPrompt(_: string, _n: string): Promise<{ description?: string; messages: Array<{ role: 'user' | 'assistant'; content: ContentItem }> }> {
    return { messages: [] };
  }
  async shutdown(): Promise<void> {}
}

function cfg(id: string, name: string): ServerConfig {
  return { id, name, type: 'remote', access: 'read', category: 'search', endpoint: `https://${id}.invalid/mcp` };
}

// ── 1. coordinator.ts:317 — memory recall catch ───────────────────────────────

test('stageSession: chitty_memory_recall for recent-context throws → Memory recall unavailable catch fires, entity set, no memories', async () => {
  const dlq = dlqPath();
  const coord = new SessionCoordinator({}, { enabled: false }, dlq);
  const stub = new StubEcosystem();

  stub.setHandler('context_resolve', () => ({
    chitty_id: 'kkk-user-1',
    identity_class: 'developer',
  }));
  // chitty_memory_recall throws → triggers coordinator.ts:317-319 catch
  stub.setHandler('chitty_memory_recall', () => {
    throw new Error('memory service unavailable');
  });

  try {
    coord.bindEcosystem(stub, 'eco-kkk-1');
    const sid = 'kkk-staging-mem-throw';
    await coord.onSessionStart(sid, 'http');
    await waitForStaging(coord, sid);

    assert.ok(coord.isStagingComplete(sid), 'staging must complete despite memory recall throw');
    const entity = coord.getEntityContext(sid);
    assert.ok(entity, 'entity must be set from context_resolve');
    assert.equal(entity?.chittyId, 'kkk-user-1', 'chittyId must be set');
    assert.equal(entity?.recentMemories, undefined, 'recentMemories must be undefined when recall throws');
  } finally {
    await coord.onSessionEnd('kkk-staging-mem-throw');
    await coord.ledger.shutdown();
    rmSync(dlq, { force: true });
  }
});

// ── 2. coordinator.ts:335 — workstreams silent catch ─────────────────────────

test('stageSession: chitty_memory_recall for workstreams throws → silent catch fires, entity + memories set, no workstreams', async () => {
  const dlq = dlqPath();
  const coord = new SessionCoordinator({}, { enabled: false }, dlq);
  const stub = new StubEcosystem();

  stub.setHandler('context_resolve', () => ({
    chitty_id: 'kkk-user-2',
    identity_class: 'agent',
  }));

  stub.setHandler('chitty_memory_recall', (args) => {
    const q = (args as { query?: string }).query ?? '';
    if (q === 'recent session context') {
      return { results: [{ content: 'mem-alpha' }] };
    }
    // "active workstreams" throws → triggers coordinator.ts:335-337 silent catch
    throw new Error('workstreams service down');
  });

  try {
    coord.bindEcosystem(stub, 'eco-kkk-2');
    const sid = 'kkk-staging-ws-throw';
    await coord.onSessionStart(sid, 'http');
    await waitForStaging(coord, sid);

    assert.ok(coord.isStagingComplete(sid), 'staging must complete despite workstreams recall throw');
    const entity = coord.getEntityContext(sid);
    assert.ok(entity, 'entity must be set from context_resolve');
    assert.deepEqual(entity?.recentMemories, ['mem-alpha'], 'recentMemories populated from first recall');
    assert.equal(entity?.activeWorkstreams, undefined, 'activeWorkstreams must be undefined when workstreams recall throws');
  } finally {
    await coord.onSessionEnd('kkk-staging-ws-throw');
    await coord.ledger.shutdown();
    rmSync(dlq, { force: true });
  }
});

// ── 3. aggregator.ts:1108 — listAllResourceTemplates backend error catch ──────

test('listAllResourceTemplates: backend.listResources() throws → catch logs error, returns [], other servers contribute', async () => {
  const failBackend: Backend = {
    registerServer() {},
    isRegistered: () => true,
    getStatus: () => ({ connected: false, toolCount: 0, toolCacheAge: null }),
    listTools: async () => [],
    callTool: async (): Promise<ToolCallResult> => ({ content: [{ type: 'text', text: '' }] }),
    listResources: async () => { throw new Error('resource list explosion'); },
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async (): Promise<{ messages: Array<{ role: 'user' | 'assistant'; content: ContentItem }> }> => ({ messages: [] }),
    shutdown: async () => {},
  };

  const goodBackend: Backend = {
    registerServer() {},
    isRegistered: () => true,
    getStatus: () => ({ connected: true, toolCount: 0, toolCacheAge: null }),
    listTools: async () => [],
    callTool: async (): Promise<ToolCallResult> => ({ content: [{ type: 'text', text: '' }] }),
    listResources: async () => ({
      resources: [],
      templates: [{ uriTemplate: 'files/{path}', name: 'File Template' }],
    }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async (): Promise<{ messages: Array<{ role: 'user' | 'assistant'; content: ContentItem }> }> => ({ messages: [] }),
    shutdown: async () => {},
  };

  const backends = new Map<string, Backend>([['fail-srv', failBackend], ['good-srv', goodBackend]]);

  const agg = new Aggregator(
    [cfg('fail-srv', 'Failing'), cfg('good-srv', 'Good')],
    { backendFactory: (c) => backends.get(c.id)!, embedEnabled: false },
  );

  try {
    const { resourceTemplates } = await agg.listAllResourceTemplates();
    // fail-srv throws → caught → contributes 0; good-srv contributes 1
    assert.equal(resourceTemplates.length, 1, 'only good server contributes templates; failing server caught');
    assert.equal(resourceTemplates[0].uriTemplate, 'good-srv://files/{path}');
  } finally {
    await agg.shutdown();
  }
});

// ── 4. aggregator.ts:1157 — listAllPrompts backend error catch ────────────────

test('listAllPrompts: backend.listPrompts() throws → catch logs error, returns [], other servers contribute', async () => {
  const failBackend: Backend = {
    registerServer() {},
    isRegistered: () => true,
    getStatus: () => ({ connected: false, toolCount: 0, toolCacheAge: null }),
    listTools: async () => [],
    callTool: async (): Promise<ToolCallResult> => ({ content: [{ type: 'text', text: '' }] }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => { throw new Error('prompts RPC failed'); },
    getPrompt: async (): Promise<{ messages: Array<{ role: 'user' | 'assistant'; content: ContentItem }> }> => ({ messages: [] }),
    shutdown: async () => {},
  };

  const goodBackend: Backend = {
    registerServer() {},
    isRegistered: () => true,
    getStatus: () => ({ connected: true, toolCount: 0, toolCacheAge: null }),
    listTools: async () => [],
    callTool: async (): Promise<ToolCallResult> => ({ content: [{ type: 'text', text: '' }] }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async (): Promise<PromptEntry[]> => [
      { name: 'summarize', description: 'Summarize content', arguments: [] },
    ],
    getPrompt: async (): Promise<{ messages: Array<{ role: 'user' | 'assistant'; content: ContentItem }> }> => ({ messages: [] }),
    shutdown: async () => {},
  };

  const backends = new Map<string, Backend>([['fail-srv', failBackend], ['good-srv', goodBackend]]);

  const agg = new Aggregator(
    [cfg('fail-srv', 'Failing'), cfg('good-srv', 'Good')],
    { backendFactory: (c) => backends.get(c.id)!, embedEnabled: false },
  );

  try {
    const { prompts } = await agg.listAllPrompts();
    // fail-srv throws → caught → contributes 0; good-srv contributes 1
    assert.equal(prompts.length, 1, 'only good server contributes prompts; failing server caught');
    assert.equal(prompts[0].name, 'good-srv/summarize');
  } finally {
    await agg.shutdown();
  }
});

// ── 5. http-server.ts:267 — transport close rejection swallow in stop() ───────

const MCP_HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json, text/event-stream',
} as const;

test('HttpMcpServer.stop(): transport.close() rejects → .catch() swallows; stop() still resolves', async () => {
  const dlq = dlqPath();
  const aggregator = new Aggregator([], { ledgerDlqPath: dlq });
  const httpServer = new HttpMcpServer(aggregator, { port: 0, bindAddress: '127.0.0.1' });
  await httpServer.start();

  try {
    // Establish a real MCP session so sessions map has one entry
    const res = await fetch(`http://127.0.0.1:${httpServer.getPort()}/mcp`, {
      method: 'POST',
      headers: MCP_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'kkk-test', version: '1.0.0' },
        },
      }),
    });
    assert.equal(res.status, 200, 'MCP initialize must succeed');

    // Patch the session's transport.close to reject, exercising http-server.ts:267
    type RawSessions = Map<string, { server: { close: () => Promise<void> }; transport: { close: () => Promise<void> } }>;
    const sessions = (httpServer as unknown as { sessions: RawSessions }).sessions;
    assert.equal(sessions.size, 1, 'exactly one session must be active');
    for (const session of sessions.values()) {
      session.transport.close = async () => { throw new Error('simulated transport close failure'); };
    }

    // stop() must resolve even though transport.close() throws
    await assert.doesNotReject(
      httpServer.stop(),
      'stop() must resolve even when transport.close() rejects',
    );
  } finally {
    await aggregator.shutdown();
    rmSync(dlq, { force: true });
  }
});
