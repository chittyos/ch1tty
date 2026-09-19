/**
 * FG: Drift guard — /api/v1/sessions response body exact shapes.
 *
 * The CD e2e test verifies that /api/v1/sessions returns HTTP 200 with a
 * bearer token and that `body.sessions` is an array. It does NOT freeze:
 *   - The top-level response envelope (only `sessions`? what if `count` is added?)
 *   - The SessionInfo item key set (rename, addition, removal)
 *   - The ToolUseRecord item key set
 *   - Value types on session fields
 *
 * This guard freezes them:
 *
 *   FG-1  envelope has exactly 1 key: { sessions }
 *   FG-2  empty sessions list → sessions is [] (not null or object)
 *   FG-3  session item has exactly 6 keys: {id, lastActivityAt, recentTools,
 *          startedAt, toolCalls, transport}
 *   FG-4  session item value types: id=string, transport='stdio'|'http',
 *          startedAt=number, lastActivityAt=number, toolCalls=non-negative integer,
 *          recentTools=array
 *   FG-5  transport is one of 'stdio' | 'http' exactly (not 'ws' etc.)
 *   FG-6  recentTools item shape: exactly { tool: string, ts: number }
 *   FG-7  recentTools is capped at 10 (toInfo() slices last 10)
 *   FG-8  401 Unauthorized response has exactly { error } key set; error === 'unauthorized'
 *
 * Frozen 2026-09-19.
 */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { HttpMcpServer } from '../src/http-server.js';

// ── Canonical key sets (sorted alphabetically) ────────────────────────────────

const ENVELOPE_KEYS = ['sessions'];
const SESSION_ITEM_KEYS = ['id', 'lastActivityAt', 'recentTools', 'startedAt', 'toolCalls', 'transport'].sort();
const TOOL_RECORD_KEYS = ['tool', 'ts'].sort();
const UNAUTH_KEYS = ['error'];

const TEST_TOKEN = 'fg-test-token';

// ── Test infrastructure ───────────────────────────────────────────────────────

interface Started {
  server: HttpMcpServer;
  aggregator: Aggregator;
  baseUrl: string;
  dlqPath: string;
}

async function startServer(): Promise<Started> {
  const dlqPath = join(tmpdir(), `ch1tty-fg-${process.pid}-${Date.now()}.dlq.jsonl`);
  const aggregator = new Aggregator([], { ledgerDlqPath: dlqPath, embedEnabled: false });
  const server = new HttpMcpServer(aggregator, { port: 0, bindAddress: '127.0.0.1', mcpToken: TEST_TOKEN });
  await server.start();
  return { server, aggregator, baseUrl: `http://127.0.0.1:${server.getPort()}`, dlqPath };
}

async function stop(s: Started): Promise<void> {
  await s.server.stop();
  await s.aggregator.shutdown();
  rmSync(s.dlqPath, { force: true });
}

async function fetchSessions(
  s: Started,
  opts: { token?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = {};
  if (opts.token !== undefined) headers['Authorization'] = `Bearer ${opts.token}`;
  const res = await fetch(`${s.baseUrl}/api/v1/sessions`, { headers });
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

// ── Envelope key set freeze ───────────────────────────────────────────────────

describe('FG: /api/v1/sessions response envelope key set', () => {
  test('FG-1: response body has exactly 1 top-level key: { sessions }', async () => {
    const s = await startServer();
    try {
      const { status, body } = await fetchSessions(s, { token: TEST_TOKEN });
      assert.equal(status, 200, 'expected HTTP 200 with valid token');
      assert.deepEqual(
        Object.keys(body).sort(),
        ENVELOPE_KEYS,
        `sessions envelope keys mismatch: got ${JSON.stringify(Object.keys(body).sort())}`,
      );
    } finally { await stop(s); }
  });

  test('FG-2: empty sessions list → sessions is [] not null or object', async () => {
    const s = await startServer();
    try {
      const { body } = await fetchSessions(s, { token: TEST_TOKEN });
      assert.ok(Array.isArray(body.sessions), 'sessions must be an array');
      assert.equal((body.sessions as unknown[]).length, 0, 'no sessions should be active yet');
    } finally { await stop(s); }
  });
});

// ── Session item key set freeze ───────────────────────────────────────────────

describe('FG: SessionInfo item exact key set', () => {
  test('FG-3: session item has exactly 6 keys: {id, lastActivityAt, recentTools, startedAt, toolCalls, transport}', async () => {
    const s = await startServer();
    try {
      s.aggregator.sessions.getOrCreate('fg-session-1', 'http');
      const { body } = await fetchSessions(s, { token: TEST_TOKEN });
      const sessions = body.sessions as Record<string, unknown>[];
      assert.equal(sessions.length, 1, 'expected 1 session');
      const item = sessions[0]!;
      assert.deepEqual(
        Object.keys(item).sort(),
        SESSION_ITEM_KEYS,
        `session item keys mismatch: got ${JSON.stringify(Object.keys(item).sort())}`,
      );
    } finally { await stop(s); }
  });

  test('FG-4: session item value types', async () => {
    const s = await startServer();
    try {
      s.aggregator.sessions.getOrCreate('fg-session-2', 'stdio');
      const { body } = await fetchSessions(s, { token: TEST_TOKEN });
      const item = (body.sessions as Record<string, unknown>[])[0]!;
      assert.ok(typeof item.id === 'string' && item.id.length > 0, 'id must be a non-empty string');
      assert.ok(['stdio', 'http'].includes(item.transport as string), `transport must be 'stdio'|'http', got ${item.transport}`);
      assert.ok(typeof item.startedAt === 'number', 'startedAt must be a number');
      assert.ok(typeof item.lastActivityAt === 'number', 'lastActivityAt must be a number');
      assert.ok(typeof item.toolCalls === 'number', 'toolCalls must be a number');
      assert.ok(Number.isInteger(item.toolCalls), 'toolCalls must be an integer');
      assert.ok((item.toolCalls as number) >= 0, 'toolCalls must be non-negative');
      assert.ok(Array.isArray(item.recentTools), 'recentTools must be an array');
    } finally { await stop(s); }
  });

  test('FG-5: transport is exactly "stdio" or "http" — not "ws" or other', async () => {
    const s = await startServer();
    try {
      s.aggregator.sessions.getOrCreate('fg-http-session', 'http');
      s.aggregator.sessions.getOrCreate('fg-stdio-session', 'stdio');
      const { body } = await fetchSessions(s, { token: TEST_TOKEN });
      const sessions = body.sessions as Record<string, unknown>[];
      assert.equal(sessions.length, 2, 'expected 2 sessions');
      const transports = sessions.map((s) => s.transport).sort();
      assert.deepEqual(transports, ['http', 'stdio'], `transports must be ['http','stdio'], got ${JSON.stringify(transports)}`);
    } finally { await stop(s); }
  });
});

// ── ToolUseRecord item key set freeze ─────────────────────────────────────────

describe('FG: ToolUseRecord item exact key set', () => {
  test('FG-6: recentTools item has exactly 2 keys: { tool, ts }', async () => {
    const s = await startServer();
    try {
      s.aggregator.sessions.getOrCreate('fg-tool-session', 'http');
      s.aggregator.sessions.recordToolCall('fg-tool-session', 'ch1tty/search');
      const { body } = await fetchSessions(s, { token: TEST_TOKEN });
      const item = (body.sessions as Record<string, unknown>[])[0]!;
      const recentTools = item.recentTools as Record<string, unknown>[];
      assert.equal(recentTools.length, 1, 'expected 1 recentTools entry');
      const record = recentTools[0]!;
      assert.deepEqual(
        Object.keys(record).sort(),
        TOOL_RECORD_KEYS,
        `ToolUseRecord keys mismatch: got ${JSON.stringify(Object.keys(record).sort())}`,
      );
      assert.ok(typeof record.tool === 'string', 'record.tool must be a string');
      assert.ok(typeof record.ts === 'number', 'record.ts must be a number');
      assert.equal(record.tool, 'ch1tty/search', 'record.tool must match recorded tool name');
    } finally { await stop(s); }
  });

  test('FG-7: recentTools is capped at 10 (toInfo slices last 10)', async () => {
    const s = await startServer();
    try {
      s.aggregator.sessions.getOrCreate('fg-cap-session', 'http');
      for (let i = 0; i < 15; i++) {
        s.aggregator.sessions.recordToolCall('fg-cap-session', `ch1tty/tool-${i}`);
      }
      const { body } = await fetchSessions(s, { token: TEST_TOKEN });
      const item = (body.sessions as Record<string, unknown>[])[0]!;
      const recentTools = item.recentTools as Record<string, unknown>[];
      assert.equal(recentTools.length, 10, `recentTools must be capped at 10, got ${recentTools.length}`);
      // Verify it's the LAST 10 in order (tools 5–14, not 0–9 or shuffled)
      const expectedTools = Array.from({ length: 10 }, (_, i) => `ch1tty/tool-${i + 5}`);
      const actualTools = recentTools.map((r) => (r as Record<string, unknown>).tool as string);
      assert.deepEqual(actualTools, expectedTools, `recentTools must be last 10 (tool-5…tool-14 in order), got ${JSON.stringify(actualTools)}`);
    } finally { await stop(s); }
  });
});

// ── 401 Unauthorized shape freeze ────────────────────────────────────────────

describe('FG: /api/v1/sessions 401 response key set', () => {
  test('FG-8: 401 response has exactly 1 key: { error } with value "unauthorized"', async () => {
    const s = await startServer();
    try {
      const { status, body } = await fetchSessions(s);  // no token
      assert.equal(status, 401, 'no-token request must return HTTP 401');
      assert.deepEqual(
        Object.keys(body).sort(),
        UNAUTH_KEYS,
        `401 body keys mismatch: got ${JSON.stringify(Object.keys(body).sort())}`,
      );
      assert.equal(body.error, 'unauthorized', `error field must be 'unauthorized', got ${body.error}`);
    } finally { await stop(s); }
  });
});
