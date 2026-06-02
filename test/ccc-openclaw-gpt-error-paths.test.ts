/**
 * CCC: OpenClaw + GPT-actions error-path and defensive-branch coverage.
 *
 * Six previously untested branches across src/openclaw-facade.ts and
 * src/gpt-actions.ts — all exercised through a real HttpMcpServer on an
 * ephemeral port with a monkey-patched or fixture-backed Aggregator.
 *
 * Paths covered:
 *
 *   1. openclaw GET /status → getStatusSnapshot throws → fallback {ok:true, channel:'openclaw'}
 *      Source: openclaw-facade.ts:156-158.  Normally the status endpoint wraps
 *      aggregator.getStatusSnapshot() in {ok:true, gateway:...}; if snapshot
 *      throws the catch returns a minimal ok:true body without a gateway key.
 *
 *   2. openclaw POST /invoke → backend returns non-JSON text → JSON.parse catch →
 *      parsed = content.text  (openclaw-facade.ts:189).  ch1tty-execute invokes a
 *      FixtureBackend tool that returns plain (non-JSON) text; JSON.parse fails
 *      silently and the raw string is returned as `result`.
 *
 *   3. openclaw POST /invoke → aggregator.callTool throws → 500 response
 *      Source: openclaw-facade.ts:201-203.  Unlike isError:true results, an actual
 *      throw from callTool propagates to the facade's outer catch and produces a
 *      real HTTP 500 with ok:false.
 *
 *   4. gpt-actions POST action → content array is empty → `else { parsed = result }`
 *      Source: gpt-actions.ts:114-116.  When result.content[0] is undefined, the
 *      `if (content && 'text' in content)` guard is false, and the entire result
 *      object is used as `parsed`.
 *
 *   5. gpt-actions POST action → aggregator.callTool throws → 500 envelope
 *      Source: gpt-actions.ts:119-122.  An actual throw reaches the outer catch and
 *      produces HTTP 500 + envelope(false, { error: msg }).
 *
 *   6. openclaw POST /invoke with malformed JSON body → readBody catch → {}  →
 *      skill field missing → 400  (openclaw-facade.ts:27-28, then 168-170).
 *      Sending bytes that are not valid JSON triggers `catch { return {}; }` in
 *      readBody; the resulting empty object has no `skill` key, so the 400 path
 *      fires.  Distinct from the existing "POST {} → 400" test which goes through
 *      JSON.parse success.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { Aggregator } from '../src/aggregator.js';
import { HttpMcpServer } from '../src/http-server.js';
import { FixtureBackend } from './fixture-backend.js';
import type { ServerConfig, ToolCallResult } from '../src/types.js';

// ── Setup helpers ─────────────────────────────────────────────────────────────

interface Started {
  server: HttpMcpServer;
  aggregator: Aggregator;
  baseUrl: string;
  dlqPath: string;
}

let _seq = 0;
function makeDlqPath(): string {
  return join(tmpdir(), `ch1tty-ccc-${process.pid}-${++_seq}.dlq.jsonl`);
}

async function startServer(configs: ServerConfig[] = [], fb?: FixtureBackend): Promise<Started> {
  const dlqPath = makeDlqPath();
  const aggregator = new Aggregator(configs, {
    ledgerDlqPath: dlqPath,
    embedEnabled: false,
    ...(fb ? { backendFactory: () => fb } : {}),
  });
  const server = new HttpMcpServer(aggregator, { port: 0, bindAddress: '127.0.0.1' });
  await server.start();
  return { server, aggregator, baseUrl: `http://127.0.0.1:${server.getPort()}`, dlqPath };
}

async function stop(s: Started): Promise<void> {
  await s.server.stop();
  await s.aggregator.shutdown();
  rmSync(s.dlqPath, { force: true });
}

// ── 1. openclaw GET /status → getStatusSnapshot throws → fallback ────────────

test('OpenClaw status: getStatusSnapshot throws → ok:true fallback without gateway key', async () => {
  const s = await startServer();
  try {
    // Monkey-patch to simulate an internal snapshot failure
    s.aggregator.getStatusSnapshot = () => { throw new Error('snapshot boom'); };

    const res = await fetch(`${s.baseUrl}/openclaw/status`);
    assert.equal(res.status, 200, 'status is always 200 on fallback (not 5xx)');
    const body = await res.json() as { ok: boolean; channel: string; gateway?: unknown };

    assert.equal(body.ok, true, 'ok:true even on snapshot failure');
    assert.equal(body.channel, 'openclaw', 'channel:openclaw present');
    assert.equal(body.gateway, undefined, 'gateway key absent when snapshot threw');
  } finally {
    await stop(s);
  }
});

// ── 2. openclaw POST /invoke → non-JSON text → JSON.parse catch → parsed = text

test('OpenClaw invoke: non-JSON backend text → JSON.parse catch → result is plain string', async () => {
  const fb = new FixtureBackend();
  const PLAIN_TEXT = 'plain text result, not json at all';

  // Register a server with a tool that returns non-JSON plain text
  fb.defineServer('textserver', {
    tools: [
      {
        name: 'ping',
        description: 'returns plain text',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: PLAIN_TEXT }] },
      },
    ],
  });

  const cfg: ServerConfig = {
    id: 'textserver',
    name: 'Text Server',
    type: 'remote',
    access: 'readwrite',
    category: 'ecosystem',
    endpoint: 'https://textserver.test/mcp',
  };

  const s = await startServer([cfg], fb);
  try {
    const res = await fetch(`${s.baseUrl}/openclaw/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // No top-level `args` key so mapArgs receives the whole body via the `?? body` fallback,
      // allowing b.tool = 'textserver/ping' to reach handleExecute correctly.
      body: JSON.stringify({ skill: 'ch1tty-execute', tool: 'textserver/ping' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { ok: boolean; result: unknown };

    assert.equal(body.ok, true);
    // JSON.parse(PLAIN_TEXT) throws → parsed = PLAIN_TEXT (the raw string)
    assert.equal(body.result, PLAIN_TEXT, 'non-JSON text returned as plain string result');
  } finally {
    await stop(s);
  }
});

// ── 3. openclaw POST /invoke → callTool throws → HTTP 500 ────────────────────

test('OpenClaw invoke: callTool throws → 500 response with ok:false', async () => {
  const s = await startServer();
  try {
    // Monkey-patch to simulate an unexpected callTool failure
    s.aggregator.callTool = async (): Promise<ToolCallResult> => {
      throw new Error('simulated callTool explosion');
    };

    const res = await fetch(`${s.baseUrl}/openclaw/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skill: 'ch1tty-status' }),
    });
    assert.equal(res.status, 500, 'actual throws produce HTTP 500 (not 200 isError)');
    const body = await res.json() as { ok: boolean; error: string };

    assert.equal(body.ok, false, 'ok:false on real throw');
    assert.ok(
      typeof body.error === 'string' && body.error.includes('simulated callTool explosion'),
      `error must contain the thrown message; got: ${body.error}`,
    );
  } finally {
    await stop(s);
  }
});

// ── 4. gpt-actions POST → empty content array → else { parsed = result } ─────

test('gpt-actions: empty content array → else branch → parsed = full result object', async () => {
  const s = await startServer();
  try {
    // Return a result with no content items; result.content[0] → undefined →
    // `if (content && 'text' in content)` is false → `else { parsed = result }`
    s.aggregator.callTool = async (): Promise<ToolCallResult> => ({
      content: [],
    });

    const res = await fetch(`${s.baseUrl}/gpt-actions/session/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: 'conv-test' }),
    });
    assert.equal(res.status, 200, 'handler returns 200 even with empty content');
    const body = await res.json() as { ok: boolean; result: unknown };

    assert.equal(body.ok, true);
    // parsed = the ToolCallResult object itself (the `else` branch)
    assert.ok(
      typeof body.result === 'object' && body.result !== null,
      'result must be the full result object, not undefined',
    );
    assert.ok(
      'content' in (body.result as object),
      'result object must have the content key from ToolCallResult',
    );
  } finally {
    await stop(s);
  }
});

// ── 5. gpt-actions POST → callTool throws → 500 envelope ─────────────────────

test('gpt-actions: callTool throws → HTTP 500 + envelope(false, { error: msg })', async () => {
  const s = await startServer();
  try {
    s.aggregator.callTool = async (): Promise<ToolCallResult> => {
      throw new Error('gpt-actions boom');
    };

    const res = await fetch(`${s.baseUrl}/gpt-actions/session/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: 'conv-1', summary: 'test session' }),
    });
    assert.equal(res.status, 500, 'actual throw → HTTP 500');
    const body = await res.json() as { ok: boolean; result: { error: string }; chitty_id: unknown; timestamp: string };

    assert.equal(body.ok, false, 'ok:false in 500 envelope');
    assert.ok(
      typeof body.result === 'object' && body.result !== null && 'error' in body.result,
      'result must be an error object',
    );
    assert.ok(
      (body.result as { error: string }).error.includes('gpt-actions boom'),
      `error must contain the thrown message; got: ${JSON.stringify(body.result)}`,
    );
    assert.ok(typeof body.timestamp === 'string', 'timestamp present in 500 envelope');
  } finally {
    await stop(s);
  }
});

// ── 6. openclaw POST /invoke with malformed JSON body → readBody catch → 400 ──

test('OpenClaw invoke: malformed JSON body → readBody catch → {} → missing skill → 400', async () => {
  const s = await startServer();
  try {
    // Send bytes that are not valid JSON — triggers `catch { return {} }` in readBody
    const res = await fetch(`${s.baseUrl}/openclaw/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not { valid json at all',
    });
    assert.equal(res.status, 400, 'malformed body produces 400 (missing skill after parse failure)');
    const body = await res.json() as { ok: boolean; error: string };

    assert.equal(body.ok, false);
    assert.ok(
      body.error.toLowerCase().includes('missing'),
      `error should mention missing skill; got: ${body.error}`,
    );
  } finally {
    await stop(s);
  }
});
