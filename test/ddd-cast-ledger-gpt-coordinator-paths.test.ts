/**
 * DDD: Aggregator cast allSettled fallbacks, ledger flush guard,
 *       gpt-actions non-JSON text, and coordinator parseResult non-text.
 *
 * Six previously untested branches:
 *
 *   1. gpt-actions POST → backend returns non-JSON text → JSON.parse catch →
 *      parsed = content.text  (gpt-actions.ts:113, `catch` arm).
 *      The gpt-actions parallel of CCC test 2 (openclaw-facade.ts:189).
 *
 *   2. gpt-actions POST → malformed request body → readBody catch → {} →
 *      mapArgs({}) → callTool called with default-empty args → 200 ok.
 *      (gpt-actions.ts:29 catch, then line 104).  Unlike CCC test 6, which
 *      covers openclaw returning 400 for missing `skill`, gpt-actions has no
 *      such guard — mapArgs works on the empty body and the call succeeds.
 *
 *   3. aggregator handleCast: listAllPrompts() itself rejects → allPrompts = []
 *      with a log.warn; cast still resolves via tools.
 *      (aggregator.ts:743-748 — the rejected-promise branch of promptsResult).
 *
 *   4. aggregator handleCast: listAllResources() itself rejects → allResources = []
 *      with a log.warn; cast still resolves via tools.
 *      (aggregator.ts:749-754 — the rejected-promise branch of resourcesResult).
 *
 *   5. LedgerClient.flush() concurrent guard: when this.flushing is already true
 *      a second call returns 0 without dispatching to the backend.
 *      (ledger.ts:180 — the `this.flushing` early-return).
 *
 *   6. SessionCoordinator.parseResult(): content[0].type !== 'text' → returns null
 *      → stageSession does not set entity on the context.
 *      (coordinator.ts:366 — the `text.type !== 'text'` guard).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { Aggregator } from '../src/aggregator.js';
import { HttpMcpServer } from '../src/http-server.js';
import { LedgerClient } from '../src/ledger.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;
function makeDlqPath(): string {
  return join(tmpdir(), `ch1tty-ddd-${process.pid}-${++_seq}.dlq.jsonl`);
}

interface Started {
  server: HttpMcpServer;
  aggregator: Aggregator;
  baseUrl: string;
  dlqPath: string;
}

async function startServer(configs: ServerConfig[] = []): Promise<Started> {
  const dlqPath = makeDlqPath();
  const aggregator = new Aggregator(configs, { ledgerDlqPath: dlqPath, embedEnabled: false });
  const server = new HttpMcpServer(aggregator, { port: 0, bindAddress: '127.0.0.1' });
  await server.start();
  return { server, aggregator, baseUrl: `http://127.0.0.1:${server.getPort()}`, dlqPath };
}

async function stop(s: Started): Promise<void> {
  await s.server.stop();
  await s.aggregator.shutdown();
  rmSync(s.dlqPath, { force: true });
}

/** Minimal in-process backend for direct Aggregator tests (no HTTP). */
function makeBackend(tools: ToolEntry[] = [], serverId = 'test'): Backend {
  return {
    registerServer: () => {},
    isRegistered: (id) => id === serverId,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: tools.length, toolCacheAge: 0 }),
    listTools: async () => tools,
    callTool: async (): Promise<ToolCallResult> => ({ content: [{ type: 'text', text: '{"ok":true}' }] }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

// ── 1. gpt-actions: non-JSON backend text → catch { parsed = content.text } ──

test('gpt-actions: non-JSON backend text → JSON.parse catch → result is plain string', async () => {
  const PLAIN = 'plain text result, not json at all';
  const s = await startServer();
  try {
    s.aggregator.callTool = async (): Promise<ToolCallResult> => ({
      content: [{ type: 'text', text: PLAIN }],
    });

    const res = await fetch(`${s.baseUrl}/gpt-actions/state/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: 'conv-1', current_summary: 'test' }),
    });
    assert.equal(res.status, 200, 'status is 200');
    const body = await res.json() as { ok: boolean; result: unknown };

    assert.equal(body.ok, true, 'ok:true');
    // JSON.parse(PLAIN) throws → catch arm → parsed = PLAIN (the raw string)
    assert.equal(body.result, PLAIN, 'non-JSON text returned as plain string result');
  } finally {
    await stop(s);
  }
});

// ── 2. gpt-actions: malformed JSON body → readBody catch → {} → mapArgs({}) → 200

test('gpt-actions: malformed JSON body → readBody catch → {} → mapArgs succeeds → 200', async () => {
  const s = await startServer();
  try {
    s.aggregator.callTool = async (): Promise<ToolCallResult> => ({
      content: [{ type: 'text', text: '{"ok":true}' }],
    });

    // Send bytes that are not valid JSON — triggers `catch { return {} }` in readBody.
    // Unlike openclaw (missing skill → 400), gpt-actions has no required-field guard:
    // mapArgs({}) still works and the call succeeds.
    const res = await fetch(`${s.baseUrl}/gpt-actions/session/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not { valid json at all !!!',
    });
    assert.equal(res.status, 200, 'malformed body still yields 200 — no required-field guard in gpt-actions');
    const body = await res.json() as { ok: boolean; result: unknown };

    assert.equal(body.ok, true, 'ok:true even with empty parsed body');
    assert.ok(body.result !== undefined, 'result present');
  } finally {
    await stop(s);
  }
});

// ── 3. handleCast: listAllPrompts() rejects → allPrompts = [] warning path ───

test('handleCast: listAllPrompts() rejects → allPrompts=[] warning path → cast still resolves', async () => {
  const tools: ToolEntry[] = [
    { name: 'list_items', description: 'list all items', inputSchema: { type: 'object', properties: {} } },
  ];
  const cfg: ServerConfig = {
    id: 'test', name: 'Test', type: 'remote', access: 'readwrite', category: 'code',
    endpoint: 'https://test.example/mcp',
  };
  const backend = makeBackend(tools);
  const dlqPath = makeDlqPath();
  const agg = new Aggregator([cfg], { backendFactory: () => backend, embedEnabled: false, ledgerDlqPath: dlqPath });

  try {
    // Force listAllPrompts to reject — exercises aggregator.ts:743-748
    agg.listAllPrompts = async (): Promise<{ prompts: never[] }> => {
      throw new Error('prompts listing boom');
    };

    const result = await agg.callTool('ch1tty/cast', { intent: 'list items' });
    const data = JSON.parse(result.content[0].text as string) as { cast: string; intent: string };

    // Cast must have found tools (not no_match) — prompts failure is non-fatal
    assert.ok(
      data.cast === 'executed' || data.cast === 'plan',
      `cast must have resolved a tool; got cast="${data.cast}"`,
    );
    assert.equal(data.intent, 'list items');
  } finally {
    await agg.shutdown();
    rmSync(dlqPath, { force: true });
  }
});

// ── 4. handleCast: listAllResources() rejects → allResources = [] warning path

test('handleCast: listAllResources() rejects → allResources=[] warning path → cast still resolves', async () => {
  const tools: ToolEntry[] = [
    { name: 'get_data', description: 'retrieve data from the store', inputSchema: { type: 'object', properties: {} } },
  ];
  const cfg: ServerConfig = {
    id: 'store', name: 'Store', type: 'remote', access: 'readwrite', category: 'ecosystem',
    endpoint: 'https://store.example/mcp',
  };
  const backend = makeBackend(tools, 'store');
  const dlqPath = makeDlqPath();
  const agg = new Aggregator([cfg], { backendFactory: () => backend, embedEnabled: false, ledgerDlqPath: dlqPath });

  try {
    // Force listAllResources to reject — exercises aggregator.ts:749-754
    agg.listAllResources = async (): Promise<{ resources: never[] }> => {
      throw new Error('resources listing kaboom');
    };

    const result = await agg.callTool('ch1tty/cast', { intent: 'retrieve data' });
    const data = JSON.parse(result.content[0].text as string) as { cast: string };

    assert.ok(
      data.cast === 'executed' || data.cast === 'plan',
      `cast must have resolved a tool; got cast="${data.cast}"`,
    );
  } finally {
    await agg.shutdown();
    rmSync(dlqPath, { force: true });
  }
});

// ── 5. LedgerClient.flush() concurrent guard: flushing=true → returns 0 ──────

test('LedgerClient.flush(): flushing=true guard returns 0 without dispatching', async () => {
  const dlqPath = makeDlqPath();
  const client = new LedgerClient(dlqPath);
  const callCount = { n: 0 };

  const backend: Backend = {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: 0, toolCacheAge: null }),
    listTools: async (): Promise<ToolEntry[]> => [],
    callTool: async (): Promise<ToolCallResult> => {
      callCount.n++;
      return { content: [{ type: 'text', text: 'ok' }] };
    },
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };

  try {
    client.bind(backend, 'test-server');
    client.record('sess-x', 'session_start', {});

    // Simulate a concurrent flush already in progress by setting the private flag.
    // This is the only way to reliably test the guard without a timing-sensitive race.
    (client as unknown as { flushing: boolean }).flushing = true;

    const guardedResult = await client.flush();

    assert.equal(guardedResult, 0, 'flush() returns 0 immediately when flushing=true');
    assert.equal(callCount.n, 0, 'backend callTool must not have been called (guard returned early)');

    // Reset and verify flush works normally once the guard is clear
    (client as unknown as { flushing: boolean }).flushing = false;
    const normalResult = await client.flush();
    assert.equal(normalResult, 1, 'flush works normally after guard is cleared');
    assert.equal(callCount.n, 1, 'backend callTool called once on normal flush');
  } finally {
    client.unbind();
    rmSync(dlqPath, { force: true });
  }
});

// ── 6. coordinator.parseResult: content[0].type !== 'text' → null → no entity ─

test('coordinator.parseResult: non-text content type → null → stageSession sets no entity', async () => {
  const dlqPath = makeDlqPath();
  const coord = new SessionCoordinator({}, { enabled: false }, dlqPath);

  // Ecosystem backend returns image content (not text) from context_resolve.
  // parseResult checks `text.type !== 'text'` and returns null — no entity resolved.
  const ecosystemBackend: Backend = {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: 1, toolCacheAge: null }),
    listTools: async (): Promise<ToolEntry[]> => [],
    callTool: async (_serverId, toolName): Promise<ToolCallResult> => {
      if (toolName === 'context_resolve') {
        // Return a non-text content type — triggers the `text.type !== 'text'` branch
        return {
          content: [{ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' } as unknown as { type: 'text'; text: string }],
        };
      }
      return { content: [{ type: 'text', text: 'null' }] };
    },
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };

  try {
    coord.bindEcosystem(ecosystemBackend, 'ecosystem-test');

    const sessionId = 'ddd-test-session-parseresult';
    await coord.onSessionStart(sessionId, 'http');

    // Wait for background staging to complete (poll with timeout)
    const deadline = Date.now() + 3000;
    while (!coord.isStagingComplete(sessionId) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }

    assert.ok(coord.isStagingComplete(sessionId), 'staging must complete even with non-text content');
    // parseResult returned null for the non-text content → no entity set
    assert.equal(
      coord.getEntityContext(sessionId),
      undefined,
      'entity must be undefined when context_resolve returns non-text content',
    );
  } finally {
    await coord.onSessionEnd('ddd-test-session-parseresult');
    await coord.ledger.shutdown();
    rmSync(dlqPath, { force: true });
  }
});
