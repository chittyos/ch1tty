/**
 * JJJ batch — two uncovered branches
 *
 * coordinator.ts parseResult() JSON catch (line 369):
 *   1. context_resolve returns type:'text' but text is invalid JSON
 *      → JSON.parse throws → catch returns null → no entity resolved,
 *        staging still completes normally.
 *
 * http-server.ts handleMcp() catch block (lines 174-182):
 *   2. mcpServer.connect(transport) throws during new-session setup
 *      → catch fires → HTTP 500 with {error:'internal', message:'MCP handler failed'}
 *        (only when headers have not yet been sent, which is the case here since
 *         connect() throws before handleRequest() writes anything).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import type { Backend, BackendStatus, ContentItem, PromptEntry, ResourceEntry, ResourceTemplateEntry, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';
import { SessionCoordinator } from '../src/coordinator.js';
import { Aggregator } from '../src/aggregator.js';
import { HttpMcpServer } from '../src/http-server.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;
function dlqPath(): string {
  return join(tmpdir(), `ch1tty-jjj-${process.pid}-${++_seq}.dlq.jsonl`);
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

/** Minimal Backend stub — callTool is overridden per-test. */
function makeBackend(callFn: (svc: string, tool: string, args: Record<string, unknown>) => Promise<ToolCallResult>): Backend {
  return {
    registerServer(_: ServerConfig) {},
    isRegistered(_: string) { return true; },
    getStatus(_: string): BackendStatus { return { connected: true, toolCount: 1, toolCacheAge: null }; },
    async listTools(_: string): Promise<ToolEntry[]> { return []; },
    async callTool(svc: string, tool: string, args: Record<string, unknown> = {}): Promise<ToolCallResult> {
      return callFn(svc, tool, args);
    },
    async listResources(_: string): Promise<{ resources: ResourceEntry[]; templates: ResourceTemplateEntry[] }> {
      return { resources: [], templates: [] };
    },
    async readResource(_: string, _u: string) { return { contents: [] }; },
    async listPrompts(_: string): Promise<PromptEntry[]> { return []; },
    async getPrompt(_: string, _n: string): Promise<{ description?: string; messages: Array<{ role: 'user' | 'assistant'; content: ContentItem }> }> {
      return { messages: [] };
    },
    async shutdown(): Promise<void> {},
  };
}

// ── 1. coordinator.ts parseResult JSON catch ──────────────────────────────────

test('coordinator parseResult: context_resolve returns text with invalid JSON → catch returns null → no entity', async () => {
  const dlq = dlqPath();
  const coord = new SessionCoordinator({}, { enabled: false }, dlq);

  // Backend returns type:'text' with syntactically invalid JSON for context_resolve.
  // parseResult hits: JSON.parse(text.text) throws → catch { return null }
  // stageSession then sees resolved?.chitty_id == null → skips entity assignment.
  const eco = makeBackend(async (_svc, toolName) => {
    if (toolName === 'context_resolve') {
      return { content: [{ type: 'text', text: '{not valid json!!!' }] };
    }
    return { content: [{ type: 'text', text: 'null' }] };
  });

  try {
    coord.bindEcosystem(eco, 'eco-jjj');

    const sid = 'jjj-parseresult-invalid-json';
    await coord.onSessionStart(sid, 'http');
    await waitForStaging(coord, sid);

    assert.ok(coord.isStagingComplete(sid), 'staging must complete despite JSON parse failure');
    assert.equal(
      coord.getEntityContext(sid),
      undefined,
      'entity must be undefined when context_resolve text is invalid JSON (parseResult → null)',
    );
  } finally {
    await coord.onSessionEnd('jjj-parseresult-invalid-json');
    await coord.ledger.shutdown();
    rmSync(dlq, { force: true });
  }
});

// ── 2. http-server.ts handleMcp catch block ───────────────────────────────────

test('http handleMcp: mcpServer.connect() throws → 500 {error:internal, message:MCP handler failed}', async () => {
  const dlq = dlqPath();
  const aggregator = new Aggregator([], { ledgerDlqPath: dlq });
  const httpServer = new HttpMcpServer(aggregator, { port: 0, bindAddress: '127.0.0.1' });

  // Monkey-patch createMcpServer (private) to return a fake whose connect() throws.
  // The real Server.connect() is replaced with a synchronous throw so no headers
  // can be sent before the catch block runs, exercising the res.writeHead(500) arm.
  (httpServer as unknown as { createMcpServer: unknown }).createMcpServer = () => ({
    setRequestHandler: () => {},
    connect: async () => { throw new Error('simulated connect failure'); },
    close: async () => {},
  });

  await httpServer.start();
  try {
    const baseUrl = `http://127.0.0.1:${httpServer.getPort()}`;
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'jjj-test', version: '1.0.0' },
        },
      }),
    });

    assert.equal(res.status, 500, 'must return 500 when mcpServer.connect() throws');
    const body = await res.json() as { error: string; message: string };
    assert.equal(body.error, 'internal', 'error field must be "internal"');
    assert.equal(body.message, 'MCP handler failed', 'message field must be "MCP handler failed"');
  } finally {
    await httpServer.stop();
    await aggregator.shutdown();
    rmSync(dlq, { force: true });
  }
});
