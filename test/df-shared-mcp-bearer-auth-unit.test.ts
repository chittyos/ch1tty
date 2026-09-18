/**
 * DF — direct unit tests for packages/shared-mcp/src/bearer-auth.ts
 *
 * checkBearerToken is the security-critical auth check used by every app that
 * exposes an HTTP MCP surface. It is currently only exercised indirectly via
 * integration tests; this suite verifies every branch directly.
 *
 * writeUnauthorized is the companion helper that emits the 401 response.
 * Both functions are exercised here without starting an HTTP server.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { checkBearerToken, writeUnauthorized } from '../packages/shared-mcp/dist/bearer-auth.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal IncomingMessage stub with a given Authorization header. */
function fakeReq(authorization?: string): IncomingMessage {
  return { headers: { authorization } } as unknown as IncomingMessage;
}

interface CapturedResponse {
  headers: Record<string, string>;
  statusCode: number | undefined;
  body: string;
}

/** Build a minimal ServerResponse stub that records the emitted data. */
function fakeRes(): { res: ServerResponse; captured: CapturedResponse } {
  const captured: CapturedResponse = { headers: {}, statusCode: undefined, body: '' };
  const res = {
    setHeader(name: string, value: string) { captured.headers[name.toLowerCase()] = value; },
    writeHead(code: number) { captured.statusCode = code; },
    end(data?: string) { captured.body = data ?? ''; },
  } as unknown as ServerResponse;
  return { res, captured };
}

// ── checkBearerToken — missing / empty header ─────────────────────────────────

test('checkBearerToken: no Authorization header → false', () => {
  assert.equal(checkBearerToken(fakeReq(), 'secret'), false);
});

test('checkBearerToken: undefined Authorization header → false', () => {
  assert.equal(checkBearerToken(fakeReq(undefined), 'secret'), false);
});

test('checkBearerToken: empty Authorization header → false', () => {
  assert.equal(checkBearerToken(fakeReq(''), 'secret'), false);
});

// ── checkBearerToken — wrong scheme ──────────────────────────────────────────

test('checkBearerToken: Basic scheme → false', () => {
  assert.equal(checkBearerToken(fakeReq('Basic dXNlcjpwYXNz'), 'secret'), false);
});

test('checkBearerToken: Token scheme → false', () => {
  assert.equal(checkBearerToken(fakeReq('Token secret'), 'secret'), false);
});

test('checkBearerToken: no space between scheme and token → false', () => {
  // "Bearersecret" has no space — regex requires one or more spaces
  assert.equal(checkBearerToken(fakeReq('Bearersecret'), 'secret'), false);
});

test('checkBearerToken: bare token with no scheme → false', () => {
  assert.equal(checkBearerToken(fakeReq('secret'), 'secret'), false);
});

// ── checkBearerToken — scheme case insensitivity ──────────────────────────────

test('checkBearerToken: lowercase "bearer" scheme → true', () => {
  assert.equal(checkBearerToken(fakeReq('bearer mysecret'), 'mysecret'), true);
});

test('checkBearerToken: uppercase "BEARER" scheme → true', () => {
  assert.equal(checkBearerToken(fakeReq('BEARER mysecret'), 'mysecret'), true);
});

test('checkBearerToken: mixed-case "Bearer" scheme → true', () => {
  assert.equal(checkBearerToken(fakeReq('Bearer mysecret'), 'mysecret'), true);
});

// ── checkBearerToken — token matching ────────────────────────────────────────

test('checkBearerToken: correct token → true', () => {
  assert.equal(checkBearerToken(fakeReq('Bearer correct'), 'correct'), true);
});

test('checkBearerToken: wrong token → false', () => {
  assert.equal(checkBearerToken(fakeReq('Bearer wrongtoken'), 'righttoken'), false);
});

test('checkBearerToken: empty expectedToken with empty supplied token → false', () => {
  // "Bearer " — trailing space with empty token: regex \S+ requires at least one char
  assert.equal(checkBearerToken(fakeReq('Bearer '), ''), false);
});

test('checkBearerToken: token with special characters → true', () => {
  const token = 'tok_abc123.def-456_XYZ';
  assert.equal(checkBearerToken(fakeReq(`Bearer ${token}`), token), true);
});

test('checkBearerToken: correct token with multiple leading spaces → true', () => {
  // Regex uses + (one or more spaces) so "Bearer  tok" (two spaces) is valid
  assert.equal(checkBearerToken(fakeReq('Bearer  multispc'), 'multispc'), true);
});

// ── checkBearerToken — same-length token mismatch ────────────────────────────

test('checkBearerToken: same-length wrong token → false', () => {
  assert.equal(checkBearerToken(fakeReq('Bearer aaaaaaaa'), 'bbbbbbbb'), false);
});

// ── writeUnauthorized ─────────────────────────────────────────────────────────

test('writeUnauthorized: sets Content-Type to application/json', () => {
  const { res, captured } = fakeRes();
  writeUnauthorized(res);
  assert.equal(captured.headers['content-type'], 'application/json');
});

test('writeUnauthorized: sets WWW-Authenticate to Bearer', () => {
  const { res, captured } = fakeRes();
  writeUnauthorized(res);
  assert.equal(captured.headers['www-authenticate'], 'Bearer');
});

test('writeUnauthorized: writes 401 status code', () => {
  const { res, captured } = fakeRes();
  writeUnauthorized(res);
  assert.equal(captured.statusCode, 401);
});

test('writeUnauthorized: body is {"error":"unauthorized"}', () => {
  const { res, captured } = fakeRes();
  writeUnauthorized(res);
  assert.deepEqual(JSON.parse(captured.body), { error: 'unauthorized' });
});
