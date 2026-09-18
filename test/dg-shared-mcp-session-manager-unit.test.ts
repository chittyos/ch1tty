/**
 * DG — direct unit tests for packages/shared-mcp/src/session-manager.ts
 *
 * McpSessionManager is the shared HTTP-session lifecycle manager used by every
 * app that exposes a Streamable HTTP MCP surface. It has no direct unit tests
 * yet — only incidental coverage via integration tests.
 *
 * Tests here exercise every branch that can be reached without a live HTTP
 * server: the 400/404 error paths, the existing-session routing shortcut, the
 * factory-throws → 500 catch path, the lifecycle hooks, sessionCount getter,
 * and closeAll() on an empty map.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpSessionManager } from '../packages/shared-mcp/dist/session-manager.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fakeReq(method: string, sessionId?: string): IncomingMessage {
  const headers: Record<string, string> = {};
  if (sessionId !== undefined) headers['mcp-session-id'] = sessionId;
  return { method, headers } as unknown as IncomingMessage;
}

interface CapturedResponse {
  headers: Record<string, string>;
  statusCode: number | undefined;
  body: string;
}

function fakeRes(): { res: ServerResponse; captured: CapturedResponse } {
  const captured: CapturedResponse = { headers: {}, statusCode: undefined, body: '' };
  const res = {
    headersSent: false,
    writableEnded: false,
    setHeader(name: string, value: string) { captured.headers[name.toLowerCase()] = value; },
    writeHead(code: number) { captured.statusCode = code; (this as unknown as { headersSent: boolean }).headersSent = true; },
    end(data?: string) { captured.body = data ?? ''; (this as unknown as { writableEnded: boolean }).writableEnded = true; },
  } as unknown as ServerResponse;
  return { res, captured };
}

// ── sessionCount getter ───────────────────────────────────────────────────────

test('McpSessionManager: sessionCount is 0 on new instance', () => {
  const mgr = new McpSessionManager(() => { throw new Error('factory must not be called'); });
  assert.equal(mgr.sessionCount, 0);
});

// ── closeAll on empty map ────────────────────────────────────────────────────

test('McpSessionManager: closeAll on empty map resolves without error', async () => {
  const mgr = new McpSessionManager(() => { throw new Error('factory must not be called'); });
  await assert.doesNotReject(() => mgr.closeAll());
  assert.equal(mgr.sessionCount, 0);
});

// ── lifecycle hooks are optional by default ───────────────────────────────────

test('McpSessionManager: onSessionStart and onSessionEnd are undefined by default', () => {
  const mgr = new McpSessionManager(() => { throw new Error(); });
  assert.equal(mgr.onSessionStart, undefined);
  assert.equal(mgr.onSessionEnd, undefined);
});

// ── handleRequest — 400 bad request (no sessionId, non-POST) ─────────────────

test('McpSessionManager: GET with no sessionId → 400 bad request', async () => {
  const mgr = new McpSessionManager(() => { throw new Error('factory must not be called'); });
  const { res, captured } = fakeRes();
  await mgr.handleRequest(fakeReq('GET'), res);
  assert.equal(captured.statusCode, 400);
  assert.deepEqual(JSON.parse(captured.body), { error: 'bad request', message: 'Missing or invalid session' });
});

test('McpSessionManager: DELETE with no sessionId → 400 bad request', async () => {
  const mgr = new McpSessionManager(() => { throw new Error('factory must not be called'); });
  const { res, captured } = fakeRes();
  await mgr.handleRequest(fakeReq('DELETE'), res);
  assert.equal(captured.statusCode, 400);
  assert.deepEqual(JSON.parse(captured.body), { error: 'bad request', message: 'Missing or invalid session' });
});

test('McpSessionManager: 400 response sets Content-Type: application/json', async () => {
  const mgr = new McpSessionManager(() => { throw new Error(); });
  const { res, captured } = fakeRes();
  await mgr.handleRequest(fakeReq('GET'), res);
  assert.equal(captured.headers['content-type'], 'application/json');
});

// ── handleRequest — 404 session not found (sessionId present but unknown) ────

test('McpSessionManager: GET with unknown sessionId → 404 session not found', async () => {
  const mgr = new McpSessionManager(() => { throw new Error('factory must not be called'); });
  const { res, captured } = fakeRes();
  await mgr.handleRequest(fakeReq('GET', 'unknown-sid'), res);
  assert.equal(captured.statusCode, 404);
  assert.deepEqual(JSON.parse(captured.body), { error: 'session not found', message: 'Missing or invalid session' });
});

test('McpSessionManager: DELETE with unknown sessionId → 404 session not found', async () => {
  const mgr = new McpSessionManager(() => { throw new Error('factory must not be called'); });
  const { res, captured } = fakeRes();
  await mgr.handleRequest(fakeReq('DELETE', 'nonexistent-sid'), res);
  assert.equal(captured.statusCode, 404);
  assert.deepEqual(JSON.parse(captured.body), { error: 'session not found', message: 'Missing or invalid session' });
});

test('McpSessionManager: POST with sessionId not in map → 404 session not found', async () => {
  const mgr = new McpSessionManager(() => { throw new Error('factory must not be called'); });
  const { res, captured } = fakeRes();
  await mgr.handleRequest(fakeReq('POST', 'missing-sid'), res);
  assert.equal(captured.statusCode, 404);
  assert.deepEqual(JSON.parse(captured.body), { error: 'session not found', message: 'Missing or invalid session' });
});

test('McpSessionManager: 404 response sets Content-Type: application/json', async () => {
  const mgr = new McpSessionManager(() => { throw new Error(); });
  const { res, captured } = fakeRes();
  await mgr.handleRequest(fakeReq('GET', 'ghost-sid'), res);
  assert.equal(captured.headers['content-type'], 'application/json');
});

// ── handleRequest — existing session routing ──────────────────────────────────

test('McpSessionManager: known sessionId → routes to transport.handleRequest', async () => {
  const mgr = new McpSessionManager(() => { throw new Error('factory must not be called'); });

  let transportCalled = false;
  const fakeTransport = {
    handleRequest: async (_req: unknown, _res: unknown) => { transportCalled = true; },
  };
  // sessions is a public Map; inject directly to avoid starting an HTTP server
  (mgr as unknown as { sessions: Map<string, unknown> }).sessions.set('live-sid', { server: null, transport: fakeTransport });
  assert.equal(mgr.sessionCount, 1);

  const { res } = fakeRes();
  await mgr.handleRequest(fakeReq('GET', 'live-sid'), res);
  assert.equal(transportCalled, true, 'transport.handleRequest must be called for known session');
});

test('McpSessionManager: sessionCount reflects injected sessions', () => {
  const mgr = new McpSessionManager(() => { throw new Error(); });
  assert.equal(mgr.sessionCount, 0);
  (mgr as unknown as { sessions: Map<string, unknown> }).sessions.set('a', {});
  assert.equal(mgr.sessionCount, 1);
  (mgr as unknown as { sessions: Map<string, unknown> }).sessions.set('b', {});
  assert.equal(mgr.sessionCount, 2);
});

// ── handleRequest — factory throws → 500 (headers not yet sent) ──────────────

test('McpSessionManager: createServer throws on POST without sessionId → 500 internal', async () => {
  const mgr = new McpSessionManager(() => { throw new Error('factory error'); });
  const { res, captured } = fakeRes();
  await mgr.handleRequest(fakeReq('POST'), res);
  assert.equal(captured.statusCode, 500);
  assert.deepEqual(JSON.parse(captured.body), { error: 'internal' });
});
