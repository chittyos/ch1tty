/**
 * test(AH): gpt-actions HTTP 500 error path — callTool throws
 *
 * Covers the catch branch in handleGptAction (src/gpt-actions.ts:120-123) that
 * produces a 500 response when aggregator.callTool() throws instead of returning
 * a graceful isError result:
 *
 *   catch (err) {
 *     const msg = err instanceof Error ? err.message : String(err);
 *     jsonResponse(res, 500, envelope(false, { error: msg }));
 *   }
 *
 * Two branches:
 *   1. err instanceof Error  → msg = err.message
 *   2. err is a string       → msg = String(err)
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
  const dlqPath = join(tmpdir(), `ch1tty-ah-${process.pid}-${++_pid}.dlq.jsonl`);
  const aggregator = new Aggregator([], { ledgerDlqPath: dlqPath });
  const server = new HttpMcpServer(aggregator, { port: 0, bindAddress: '127.0.0.1' });
  await server.start();
  const baseUrl = `http://127.0.0.1:${server.getPort()}`;
  return { server, aggregator, baseUrl, dlqPath };
}

async function stop(s: Started): Promise<void> {
  await s.server.stop();
  await s.aggregator.shutdown();
  rmSync(s.dlqPath, { force: true });
}

interface Envelope {
  ok: boolean;
  result: unknown;
  chitty_id: string | null;
  timestamp: string;
}

test('gpt-actions callTool throws Error → HTTP 500, ok:false, result.error = err.message', async () => {
  const s = await startServer();
  try {
    // Monkey-patch callTool to throw an Error instance
    (s.aggregator as unknown as { callTool: unknown }).callTool = async () => {
      throw new Error('upstream connection refused');
    };

    const res = await fetch(`${s.baseUrl}/gpt-actions/session/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: 'conv-err-1' }),
    });

    assert.equal(res.status, 500, 'should return HTTP 500 when callTool throws');
    const body = await res.json() as Envelope;
    assert.equal(body.ok, false, 'ok must be false on error');
    assert.equal(typeof body.timestamp, 'string', 'timestamp must be present');
    assert.equal(body.chitty_id, null, 'chitty_id must be null when no chittyId');
    const result = body.result as { error: string };
    assert.equal(result.error, 'upstream connection refused', 'error must be err.message');
  } finally {
    await stop(s);
  }
});

test('gpt-actions callTool throws string → HTTP 500, ok:false, result.error = String(thrown)', async () => {
  const s = await startServer();
  try {
    // Monkey-patch callTool to throw a plain string (not an Error instance)
    (s.aggregator as unknown as { callTool: unknown }).callTool = async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'timeout exceeded';
    };

    const res = await fetch(`${s.baseUrl}/gpt-actions/tasks/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: 'proj-x' }),
    });

    assert.equal(res.status, 500, 'should return HTTP 500 when callTool throws a string');
    const body = await res.json() as Envelope;
    assert.equal(body.ok, false, 'ok must be false on error');
    const result = body.result as { error: string };
    assert.equal(result.error, 'timeout exceeded', 'error must be String(thrown) for non-Error throws');
  } finally {
    await stop(s);
  }
});
