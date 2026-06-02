/**
 * QQQ batch — 6 tests covering genuinely untested branches:
 *
 * 1. CircuitBreaker.recordSuccess: failures > 0 but circuit still CLOSED
 *    (openUntil === 0, below threshold) → the `state.failures > 0` branch of
 *    the `if (state && (state.failures > 0 || state.openUntil > 0))` guard fires
 *    and resets failures to 0 without the circuit ever having been open.
 *    (circuit-breaker.ts:37–42)
 *
 * 2. RemoteProxy.getAuthToken: chitty-mcp-token binary exists and exits 0 but
 *    stdout is empty → `if (!token)` throws → caught → re-thrown as
 *    auth_token_unavailable.
 *    (remote-proxy.ts:67–83)
 *
 * 3. RemoteProxy.listResources outer catch: connectWithReconnect() itself throws
 *    (connect phase fails, e.g. ECONNREFUSED) → breaker.recordFailure + evict +
 *    return `{ resources: [], templates: [] }`. Distinct from the allSettled path
 *    (where the connect succeeds but the RPC calls fail).
 *    (remote-proxy.ts:278–283)
 *
 * 4. config.ts assertString: whitespace-only `id` field (`'   '`) — the
 *    `value.trim() === ''` branch → "must be a non-empty string".
 *    (config.ts:88–92)
 *
 * 5. config.ts assertString: non-string `id` field (number 42) — the
 *    `typeof value !== 'string'` branch → "must be a non-empty string".
 *    (config.ts:88–92)
 *
 * 6. focus.ts loadFocusProfilesFromPath: read fails with a non-ENOENT error
 *    (path is a directory — readFileSync throws EISDIR) → the
 *    `if (code !== 'ENOENT') throw err` branch re-throws instead of returning
 *    the empty-profile fallback.
 *    (focus.ts:131–133)
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CircuitBreaker } from '../src/circuit-breaker.js';
import { RemoteProxy } from '../src/remote-proxy.js';
import { validateServersConfig } from '../src/config.js';
import { loadFocusProfilesFromPath } from '../src/focus.js';

// ── 1. CircuitBreaker.recordSuccess — failures > 0, circuit still closed ─────

test('CircuitBreaker.recordSuccess: failures > 0 but circuit still closed → failures reset to 0', () => {
  const cb = new CircuitBreaker({ failureThreshold: 5, cooldownMs: 60_000 });

  // Record 2 failures — below threshold 5, so openUntil stays 0 (circuit closed).
  cb.recordFailure('srv');
  cb.recordFailure('srv');

  const before = cb.getState('srv');
  assert.equal(before.failures, 2, 'precondition: 2 failures recorded');
  assert.equal(before.open, false, 'precondition: circuit still closed');
  assert.equal(before.cooldownRemaining, 0, 'precondition: no cooldown running');

  // recordSuccess while closed but with failures > 0 → fires the state.failures > 0 branch.
  cb.recordSuccess('srv');

  const after = cb.getState('srv');
  assert.equal(after.failures, 0, 'failures must be reset to 0 after recordSuccess');
  assert.equal(after.open, false, 'circuit must remain closed');
  assert.equal(after.cooldownRemaining, 0, 'no cooldown after recordSuccess');

  // A subsequent isAllowed check must return true (clean state).
  assert.equal(cb.isAllowed('srv'), true, 'isAllowed must be true after recordSuccess resets state');
});

// ── 2. RemoteProxy.getAuthToken — binary returns empty stdout ─────────────────

test('RemoteProxy.getAuthToken: chitty-mcp-token exits 0 with empty output → auth_token_unavailable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-qqq-tok-'));
  const script = join(dir, 'chitty-mcp-token');
  writeFileSync(script, '#!/bin/sh\nexit 0\n', 'utf-8');
  chmodSync(script, 0o755);

  const origPath = process.env.PATH;
  process.env.PATH = `${dir}:${origPath ?? '/usr/bin'}`;

  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'qqq-empty-tok',
      name: 'QQQ Empty Token',
      type: 'remote',
      access: 'read',
      category: 'code',
      endpoint: 'http://127.0.0.1:1/mcp',
      authTokenKey: 'my-test-key',
    });

    const result = await proxy.callTool('qqq-empty-tok', 'any_tool', {});

    assert.equal(result.isError, true, 'empty token must surface as isError:true');
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    assert.match(text, /auth_token_unavailable/, `expected auth_token_unavailable; got: ${text}`);
    assert.equal(proxy.getStatus('qqq-empty-tok').connected, false, 'connection must not be established');
  } finally {
    if (origPath === undefined) delete process.env.PATH; else process.env.PATH = origPath;
    rmSync(dir, { recursive: true, force: true });
    await proxy.shutdown();
  }
});

// ── 3. RemoteProxy.listResources outer catch — connect phase fails ────────────

test('RemoteProxy.listResources: connectWithReconnect throws → recordFailure + return empty', async () => {
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'qqq-lr-catch',
      name: 'QQQ LR Catch',
      type: 'remote',
      access: 'read',
      category: 'storage',
      endpoint: 'http://127.0.0.1:1/mcp',
    });

    const result = await proxy.listResources('qqq-lr-catch');

    assert.deepEqual(result.resources, [], 'resources must be empty when connect fails');
    assert.deepEqual(result.templates, [], 'templates must be empty when connect fails');

    const state = (proxy as unknown as { breaker: CircuitBreaker }).breaker.getState('qqq-lr-catch');
    assert.ok(state.failures > 0, 'breaker must have recorded at least one failure');
  } finally {
    await proxy.shutdown();
  }
});

// ── 4. config.ts assertString — whitespace-only id ───────────────────────────

test('validateServersConfig: whitespace-only id → "must be a non-empty string"', () => {
  assert.throws(
    () => validateServersConfig({
      servers: [{
        id: '   ',
        name: 'A',
        type: 'local',
        access: 'readwrite',
        category: 'code',
        command: 'node',
      }],
    }),
    /must be a non-empty string/,
    'whitespace-only id must throw "must be a non-empty string"',
  );
});

// ── 5. config.ts assertString — non-string id (number) ───────────────────────

test('validateServersConfig: non-string id (number 42) → "must be a non-empty string"', () => {
  assert.throws(
    () => validateServersConfig({
      servers: [{
        id: 42,
        name: 'A',
        type: 'local',
        access: 'readwrite',
        category: 'code',
        command: 'node',
      }],
    }),
    /must be a non-empty string/,
    'numeric id must throw "must be a non-empty string"',
  );
});

// ── 6. focus.ts loadFocusProfilesFromPath — non-ENOENT error rethrows ─────────

test('loadFocusProfilesFromPath: read throws non-ENOENT error → rethrows (does not return empty profiles)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-qqq-focus-'));
  const dirAsFile = join(dir, 'focus.json');
  mkdirSync(dirAsFile);

  try {
    assert.throws(
      () => loadFocusProfilesFromPath(dirAsFile),
      (err: NodeJS.ErrnoException) => err.code !== 'ENOENT',
      'non-ENOENT error must be rethrown, not swallowed as empty profiles',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
