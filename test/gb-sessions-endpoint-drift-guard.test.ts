/**
 * GB: /api/v1/sessions response key-set and value-type drift guard.
 *
 * Existing http-server.test.ts only checks that `body.sessions` is an array.
 * No test freezes the COMPLETE response body key set, the session entry key
 * set, or the value types of any session fields.
 *
 * This guard freezes:
 *   GB-1  Response body key set (no sessions): exactly { sessions }
 *   GB-2  Response body key set (active session): exactly { sessions }
 *   GB-3  Session entry key set: { id, lastActivityAt, recentTools, startedAt, toolCalls, transport }
 *   GB-4  Session entry value types: id string, transport 'http', startedAt/lastActivityAt finite ≥ 0,
 *          toolCalls non-negative integer, recentTools array
 *   GB-5  recentTools entry key set: { tool, ts }
 *   GB-6  recentTools entry value types: tool non-empty string, ts finite number ≥ 0
 *   GB-7  After a tool call: toolCalls = 1, recentTools length = 1, entry matches tool name
 *
 * Frozen 2026-09-20.
 */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { HttpMcpServer } from '../src/http-server.js';

// ── Frozen key sets (sorted alphabetically) ───────────────────────────────────

const RESPONSE_KEYS = ['sessions'];
const SESSION_ENTRY_KEYS = ['id', 'lastActivityAt', 'recentTools', 'startedAt', 'toolCalls', 'transport'];
const RECENT_TOOL_KEYS = ['tool', 'ts'];

// ── Helpers ────────────────────────────────────────────────────────────────────

interface Started {
  server: HttpMcpServer;
  aggregator: Aggregator;
  baseUrl: string;
  dlqPath: string;
}

async function startServer(): Promise<Started> {
  const dlqPath = join(tmpdir(), `ch1tty-gb-${process.pid}-${Date.now()}.dlq.jsonl`);
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

async function getSessions(baseUrl: string): Promise<{ sessions: unknown[] }> {
  const res = await fetch(`${baseUrl}/api/v1/sessions`);
  assert.equal(res.status, 200);
  return res.json() as Promise<{ sessions: unknown[] }>;
}

function sortedKeys(obj: object): string[] {
  return Object.keys(obj).sort();
}

// ── GB-1: Response body key set — no sessions ──────────────────────────────────

test('GB-1: /api/v1/sessions response body key set (no sessions) is exactly {sessions}', async () => {
  const s = await startServer();
  try {
    const body = await getSessions(s.baseUrl);
    assert.deepEqual(sortedKeys(body as object), RESPONSE_KEYS,
      `expected keys ${JSON.stringify(RESPONSE_KEYS)}, got ${JSON.stringify(sortedKeys(body as object))}`);
    assert.ok(Array.isArray(body.sessions), 'sessions field is an array');
    assert.equal(body.sessions.length, 0, 'no sessions active');
  } finally {
    await stop(s);
  }
});

// ── GB-2: Response body key set — with active session ──────────────────────────

test('GB-2: /api/v1/sessions response body key set (active session) is exactly {sessions}', async () => {
  const s = await startServer();
  try {
    s.aggregator.sessions.getOrCreate('test-sess-gb2', 'http');
    const body = await getSessions(s.baseUrl);
    assert.deepEqual(sortedKeys(body as object), RESPONSE_KEYS,
      `response body must only have 'sessions' key even with active sessions`);
    assert.equal(body.sessions.length, 1, 'one active session');
  } finally {
    await stop(s);
  }
});

// ── GB-3: Session entry key set ───────────────────────────────────────────────

test('GB-3: session entry key set is exactly {id, lastActivityAt, recentTools, startedAt, toolCalls, transport}', async () => {
  const s = await startServer();
  try {
    s.aggregator.sessions.getOrCreate('test-sess-gb3', 'http');
    const body = await getSessions(s.baseUrl);
    assert.equal(body.sessions.length, 1, 'one session present');
    const entry = body.sessions[0] as object;
    assert.deepEqual(sortedKeys(entry), SESSION_ENTRY_KEYS,
      `session entry keys: expected ${JSON.stringify(SESSION_ENTRY_KEYS)}, got ${JSON.stringify(sortedKeys(entry))}`);
  } finally {
    await stop(s);
  }
});

// ── GB-4: Session entry value types ──────────────────────────────────────────

test('GB-4: session entry value types are correct', async () => {
  const s = await startServer();
  try {
    s.aggregator.sessions.getOrCreate('test-sess-gb4', 'http');
    const body = await getSessions(s.baseUrl);
    const entry = body.sessions[0] as {
      id: unknown;
      transport: unknown;
      startedAt: unknown;
      lastActivityAt: unknown;
      toolCalls: unknown;
      recentTools: unknown;
    };

    assert.equal(typeof entry.id, 'string', 'id is string');
    assert.equal(typeof entry.transport, 'string', 'transport is string');
    assert.ok(
      entry.transport === 'stdio' || entry.transport === 'http',
      `transport must be 'stdio' or 'http', got ${String(entry.transport)}`,
    );

    assert.equal(typeof entry.startedAt, 'number', 'startedAt is number');
    assert.ok(Number.isFinite(entry.startedAt as number), 'startedAt is finite');
    assert.ok((entry.startedAt as number) >= 0, 'startedAt >= 0');

    assert.equal(typeof entry.lastActivityAt, 'number', 'lastActivityAt is number');
    assert.ok(Number.isFinite(entry.lastActivityAt as number), 'lastActivityAt is finite');
    assert.ok((entry.lastActivityAt as number) >= 0, 'lastActivityAt >= 0');

    assert.equal(typeof entry.toolCalls, 'number', 'toolCalls is number');
    assert.ok(Number.isInteger(entry.toolCalls as number), 'toolCalls is integer');
    assert.ok((entry.toolCalls as number) >= 0, 'toolCalls >= 0');

    assert.ok(Array.isArray(entry.recentTools), 'recentTools is array');
  } finally {
    await stop(s);
  }
});

// ── GB-5: recentTools entry key set ──────────────────────────────────────────

test('GB-5: recentTools entry key set is exactly {tool, ts}', async () => {
  const s = await startServer();
  try {
    s.aggregator.sessions.getOrCreate('test-sess-gb5', 'http');
    s.aggregator.sessions.recordToolCall('test-sess-gb5', 'neon/list_projects');
    const body = await getSessions(s.baseUrl);
    const entry = body.sessions[0] as { recentTools: unknown[] };
    assert.equal(entry.recentTools.length, 1, 'one recentTools entry');
    const rec = entry.recentTools[0] as object;
    assert.deepEqual(sortedKeys(rec), RECENT_TOOL_KEYS,
      `recentTools entry keys: expected ${JSON.stringify(RECENT_TOOL_KEYS)}, got ${JSON.stringify(sortedKeys(rec))}`);
  } finally {
    await stop(s);
  }
});

// ── GB-6: recentTools entry value types ─────────────────────────────────────

test('GB-6: recentTools entry value types are correct (tool: string, ts: finite number)', async () => {
  const s = await startServer();
  try {
    s.aggregator.sessions.getOrCreate('test-sess-gb6', 'http');
    s.aggregator.sessions.recordToolCall('test-sess-gb6', 'evidence/search_documents');
    const body = await getSessions(s.baseUrl);
    const entry = body.sessions[0] as { recentTools: { tool: unknown; ts: unknown }[] };
    const rec = entry.recentTools[0];

    assert.equal(typeof rec.tool, 'string', 'recentTools[0].tool is string');
    assert.ok((rec.tool as string).length > 0, 'tool is non-empty');

    assert.equal(typeof rec.ts, 'number', 'recentTools[0].ts is number');
    assert.ok(Number.isFinite(rec.ts as number), 'ts is finite');
    assert.ok((rec.ts as number) >= 0, 'ts >= 0');
  } finally {
    await stop(s);
  }
});

// ── GB-7: After tool call, toolCalls and recentTools update correctly ─────────

test('GB-7: after a tool call, toolCalls = 1 and recentTools reflects the call', async () => {
  const s = await startServer();
  try {
    const TOOL = 'neon/run_sql';
    s.aggregator.sessions.getOrCreate('test-sess-gb7', 'http');
    s.aggregator.sessions.recordToolCall('test-sess-gb7', TOOL);

    const body = await getSessions(s.baseUrl);
    const entry = body.sessions[0] as { toolCalls: number; recentTools: { tool: string; ts: number }[] };

    assert.equal(entry.toolCalls, 1, 'toolCalls incremented to 1');
    assert.equal(entry.recentTools.length, 1, 'one entry in recentTools');
    assert.equal(entry.recentTools[0].tool, TOOL, `recentTools[0].tool === ${TOOL}`);
  } finally {
    await stop(s);
  }
});
