/**
 * Export-surface drift guard for @ch1tty/shared-mcp.
 *
 * These tests verify that the package's runtime exports and public API
 * match what apps/*-mcp depend on. A rename or removal of any symbol here
 * is caught before apps break at build time. Add a test when you add a
 * new public symbol that callers depend on.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as SharedMcp from '../src/index.js';
import { McpSessionManager } from '../src/session-manager.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

// ── Runtime export surface ────────────────────────────────────────────────────

test('package has exactly 3 runtime exports: McpSessionManager, checkBearerToken, writeUnauthorized', () => {
  const keys = Object.keys(SharedMcp).sort();
  assert.deepEqual(keys, ['McpSessionManager', 'checkBearerToken', 'writeUnauthorized']);
});

test('checkBearerToken is exported as a function', () => {
  assert.equal(typeof SharedMcp.checkBearerToken, 'function');
});

test('writeUnauthorized is exported as a function', () => {
  assert.equal(typeof SharedMcp.writeUnauthorized, 'function');
});

test('McpSessionManager is exported as a constructor function', () => {
  assert.equal(typeof SharedMcp.McpSessionManager, 'function');
});

test('McpSessionManager re-export is the same identity as the direct import', () => {
  assert.equal(SharedMcp.McpSessionManager, McpSessionManager);
});

// ── McpSessionManager prototype API ──────────────────────────────────────────
// Apps use: new McpSessionManager(factory), .handleRequest(req, res),
// .onSessionStart hook, .onSessionEnd hook, .sessionCount, .closeAll()

test('McpSessionManager.prototype.handleRequest is a method', () => {
  assert.equal(typeof McpSessionManager.prototype.handleRequest, 'function');
});

test('McpSessionManager.prototype.closeAll is a method', () => {
  assert.equal(typeof McpSessionManager.prototype.closeAll, 'function');
});

// ── McpSessionManager instance API ───────────────────────────────────────────

function makeFactory() {
  return () => new Server({ name: 'drift-test', version: '0.0.1' }, { capabilities: {} });
}

test('McpSessionManager instance: sessionCount starts at 0', () => {
  const mgr = new McpSessionManager(makeFactory());
  assert.equal(mgr.sessionCount, 0);
});

test('McpSessionManager instance: onSessionStart is undefined by default', () => {
  const mgr = new McpSessionManager(makeFactory());
  assert.equal(mgr.onSessionStart, undefined);
});

test('McpSessionManager instance: onSessionEnd is undefined by default', () => {
  const mgr = new McpSessionManager(makeFactory());
  assert.equal(mgr.onSessionEnd, undefined);
});

test('McpSessionManager instance: onSessionStart hook is assignable', () => {
  const mgr = new McpSessionManager(makeFactory());
  const cb = (_id: string) => {};
  mgr.onSessionStart = cb;
  assert.equal(mgr.onSessionStart, cb);
});

test('McpSessionManager instance: onSessionEnd hook is assignable', () => {
  const mgr = new McpSessionManager(makeFactory());
  const cb = (_id: string) => {};
  mgr.onSessionEnd = cb;
  assert.equal(mgr.onSessionEnd, cb);
});
