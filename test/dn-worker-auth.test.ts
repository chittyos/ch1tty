/**
 * DN: Timing-safe bearer-auth helper (src/worker-auth.ts) — branch coverage.
 *
 * checkBearerAuth is the security-critical token guard for /mcp-api in the
 * Cloudflare Worker entry (index.ts). Previously untestable because it lived
 * as a local function inside a file with CF runtime imports (McpAgent,
 * OAuthProvider, Ch1ttyDO). Extracted to worker-auth.ts so it can be
 * exercised in plain Node.js tests with no mocking.
 *
 * Branches covered:
 *   1. No expectedToken (undefined / empty string) → true (open endpoint)
 *   2. Token configured, no Authorization header → false
 *   3. Token configured, non-Bearer scheme (Basic, Token, bare value) → false
 *   4. Token configured, Bearer with wrong value → false
 *   5. Token configured, Bearer with correct value → true
 *   6. Bearer scheme case-insensitive (BEARER, bearer, Bearer all accepted)
 *   7. value ?? '' fallback — "Bearer" alone splits to no value → '' vs token → false
 *   8. Constant-time path: wrong-length tokens still run the full comparison loop
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { checkBearerAuth } from '../src/worker-auth.js';

function makeRequest(authHeader?: string): Request {
  const headers = authHeader ? { authorization: authHeader } : {};
  return new Request('https://ch1tty.example/mcp-api', { headers });
}

describe('checkBearerAuth', () => {
  // ── Branch 1: no expectedToken → open ────────────────────────────────────────
  test('no expectedToken → true regardless of request headers', () => {
    assert.equal(checkBearerAuth(makeRequest()), true, 'undefined token → open');
    assert.equal(checkBearerAuth(makeRequest(), ''), true, 'empty string token → open');
    assert.equal(checkBearerAuth(makeRequest(), undefined), true, 'explicit undefined → open');
    assert.equal(checkBearerAuth(makeRequest('Bearer anything'), undefined), true, 'token present in req but no expected → still open');
  });

  // ── Branch 2: token set, no Authorization header → denied ────────────────────
  test('token configured, missing Authorization header → false', () => {
    assert.equal(checkBearerAuth(makeRequest(), 'secret123'), false);
  });

  // ── Branch 3: wrong scheme → false ──────────────────────────────────────────
  test('token configured, Basic scheme → false', () => {
    assert.equal(checkBearerAuth(makeRequest('Basic dXNlcjpwYXNz'), 'secret123'), false);
  });

  test('token configured, Token scheme → false', () => {
    assert.equal(checkBearerAuth(makeRequest('Token secret123'), 'secret123'), false);
  });

  test('token configured, bare value with no scheme → false', () => {
    assert.equal(checkBearerAuth(makeRequest('secret123'), 'secret123'), false);
  });

  // ── Branch 4: Bearer with wrong value → false ────────────────────────────────
  test('token configured, Bearer with wrong value → false', () => {
    assert.equal(checkBearerAuth(makeRequest('Bearer wrongtoken'), 'secret123'), false);
  });

  // ── Branch 5: correct value → true ──────────────────────────────────────────
  test('token configured, Bearer with correct value → true', () => {
    assert.equal(checkBearerAuth(makeRequest('Bearer secret123'), 'secret123'), true);
  });

  // ── Branch 6: case-insensitive scheme ───────────────────────────────────────
  test('bearer (lowercase) → true', () => {
    assert.equal(checkBearerAuth(makeRequest('bearer secret123'), 'secret123'), true);
  });

  test('BEARER (uppercase) → true', () => {
    assert.equal(checkBearerAuth(makeRequest('BEARER secret123'), 'secret123'), true);
  });

  test('Bearer (title-case) → true', () => {
    assert.equal(checkBearerAuth(makeRequest('Bearer secret123'), 'secret123'), true);
  });

  // ── Branch 7: value ?? '' fallback ("Bearer" alone) ─────────────────────────
  test('"Bearer" alone (no value part) → value coerces to "" → false vs non-empty token', () => {
    // auth.split(' ', 2) on "Bearer" → ["Bearer"], value is undefined → '' via ??
    assert.equal(checkBearerAuth(makeRequest('Bearer'), 'secret123'), false);
  });

  // ── Branch 8: constant-time loop with mismatched lengths ─────────────────────
  test('shorter token than expected → diff non-zero, returns false', () => {
    assert.equal(checkBearerAuth(makeRequest('Bearer short'), 'averylongsecrettoken'), false);
  });

  test('longer token than expected → diff non-zero, returns false', () => {
    assert.equal(checkBearerAuth(makeRequest('Bearer averylongsecrettoken_extra_suffix'), 'averylongsecrettoken'), false);
  });
});
