/**
 * test(DJ): gpt-actions readBody uncovered branches
 *
 * Covers two branches in readBody() (src-stdio/gpt-actions.ts:29-30)
 * that are distinct from the same-named function in openclaw-facade.ts:
 *
 *   Line 29: if (!raw) return {};          — empty request body
 *   Line 30: catch { return {}; }          — malformed JSON body
 *
 * Both branches feed mapArgs({}) for the matched action, which still
 * produces a valid (if empty-args) tool call. No real MCP backend is
 * needed — we monkey-patch aggregator.callTool to return a graceful
 * isError result so the response is always HTTP 200.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { Aggregator } from '../src/aggregator.js';
import { HttpMcpServer } from '../src/http-server.js';

interface Started {
  server: HttpMcpServer;
  aggregator: Aggregator;
  baseUrl: string;
  dlqPath: string;
}

let _pid = 0;
async function startServer(): Promise<Started> {
  const dlqPath = join(tmpdir(), `ch1tty-dj-${process.pid}-${++_pid}.dlq.jsonl`);
  const aggregator = new Aggregator([], { ledgerDlqPath: dlqPath });
  const server = new HttpMcpServer(aggregator, { port: 0, bindAddress: '127.0.0.1' });
  await server.start();
  const baseUrl = `http://127.0.0.1:${server.getPort()}`;
  return { server, aggregator, baseUrl, dlqPath };
}

interface CapturedCall { tool: string; args: Record<string, unknown> }

function patchCallTool(s: Started, captured: CapturedCall[]): void {
  (s.aggregator as unknown as { callTool: unknown }).callTool = async (
    tool: string,
    args: Record<string, unknown>,
    _sessionId?: string,
  ) => {
    captured.push({ tool, args });
    return { content: [{ type: 'text', text: 'ok' }], isError: false };
  };
}

async function stop(s: Started): Promise<void> {
  await s.server.stop();
  await s.aggregator.shutdown();
  rmSync(s.dlqPath, { force: true });
}

// Line 29: `if (!raw) return {}` — empty body path
test('readBody empty body → {} args → 200 with ok envelope', async () => {
  const s = await startServer();
  const calls: CapturedCall[] = [];
  patchCallTool(s, calls);
  try {
    const res = await fetch(`${s.baseUrl}/gpt-actions/session/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // No body — Content-Length will be 0, raw will be ''
    });

    assert.equal(res.status, 200, 'should return HTTP 200 for empty body');
    const body = await res.json() as { ok: boolean; chitty_id: unknown; timestamp: string };
    assert.equal(body.ok, true, 'ok must be true when callTool succeeds');
    assert.equal(typeof body.timestamp, 'string', 'timestamp must be present');
    assert.equal(body.chitty_id, null, 'chitty_id must be null when no chittyId');
    // Verify mapArgs({}) produces the expected fallback arguments
    assert.equal(calls.length, 1, 'callTool must be called exactly once');
    assert.equal(calls[0].tool, 'chitty_memory_recall', 'tool must be chitty_memory_recall');
    assert.equal(calls[0].args['query'], 'session context', 'query must default to "session context"');
    assert.equal(calls[0].args['scope'], 'session', 'scope must be "session"');
    assert.equal(calls[0].args['conversation_id'], undefined, 'conversation_id must be undefined when absent');
  } finally {
    await stop(s);
  }
});

// Line 30: `catch { return {} }` — malformed JSON body path
test('readBody malformed JSON → {} args → 200 with ok envelope', async () => {
  const s = await startServer();
  const calls: CapturedCall[] = [];
  patchCallTool(s, calls);
  try {
    const res = await fetch(`${s.baseUrl}/gpt-actions/session/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-valid-json{{{',
    });

    assert.equal(res.status, 200, 'should return HTTP 200 for malformed JSON body');
    const body = await res.json() as { ok: boolean; chitty_id: unknown; timestamp: string };
    assert.equal(body.ok, true, 'ok must be true when callTool succeeds');
    assert.equal(typeof body.timestamp, 'string', 'timestamp must be present');
    assert.equal(body.chitty_id, null, 'chitty_id must be null when no chittyId');
    // Verify mapArgs({}) produces the expected fallback arguments
    assert.equal(calls.length, 1, 'callTool must be called exactly once');
    assert.equal(calls[0].tool, 'chitty_memory_recall', 'tool must be chitty_memory_recall');
    assert.equal(calls[0].args['query'], 'session context', 'query must default to "session context"');
    assert.equal(calls[0].args['scope'], 'session', 'scope must be "session"');
    assert.equal(calls[0].args['conversation_id'], undefined, 'conversation_id must be undefined when absent');
  } finally {
    await stop(s);
  }
});
