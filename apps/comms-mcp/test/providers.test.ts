/**
 * Workstream AW: unit tests for comms-mcp/src/providers.ts
 *
 * Validates provider descriptor contracts (channel, mcpServerId, tool names,
 * supports flags) and defaultBoundProviders() registry shape. These are
 * regression guards: if a provider config drifts the binding breaks silently
 * at runtime; tests here make it loud at build time.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  quoProvider,
  gmailProvider,
  imessageProviderUnbound,
  defaultBoundProviders,
} from '../src/providers.ts';

// ── defaultBoundProviders ──────────────────────────────────────────────────────

test('defaultBoundProviders: returns Map with exactly 2 entries', () => {
  const m = defaultBoundProviders();
  assert.strictEqual(m.size, 2);
});

test('defaultBoundProviders: contains quo and email keys', () => {
  const m = defaultBoundProviders();
  assert.ok(m.has('quo'), 'should have quo key');
  assert.ok(m.has('email'), 'should have email key');
});

test('defaultBoundProviders: quo entry is quoProvider', () => {
  const m = defaultBoundProviders();
  assert.strictEqual(m.get('quo'), quoProvider);
});

test('defaultBoundProviders: email entry is gmailProvider', () => {
  const m = defaultBoundProviders();
  assert.strictEqual(m.get('email'), gmailProvider);
});

// ── quoProvider ──────────────────────────────────────────────────────────────

test('quoProvider: channel is quo', () => {
  assert.strictEqual(quoProvider.channel, 'quo');
});

test('quoProvider: provider is openphone', () => {
  assert.strictEqual(quoProvider.provider, 'openphone');
});

test('quoProvider: binding.mcpServerId is chittyagent-quo', () => {
  assert.strictEqual(quoProvider.binding.mcpServerId, 'chittyagent-quo');
});

test('quoProvider: binding.tools resolveContact → quo_lookup_contact_context', () => {
  assert.strictEqual(quoProvider.binding.tools.resolveContact, 'quo_lookup_contact_context');
});

test('quoProvider: binding.tools listMessages → quo_recent_messages_local (local-cache path)', () => {
  assert.strictEqual(quoProvider.binding.tools.listMessages, 'quo_recent_messages_local');
});

test('quoProvider: binding.tools getMessage → quo_get_message', () => {
  assert.strictEqual(quoProvider.binding.tools.getMessage, 'quo_get_message');
});

test('quoProvider: supports.localCache is true', () => {
  assert.strictEqual(quoProvider.supports.localCache, true);
});

test('quoProvider: supports.nativeDirection is true', () => {
  assert.strictEqual(quoProvider.supports.nativeDirection, true);
});

// ── gmailProvider ─────────────────────────────────────────────────────────────

test('gmailProvider: channel is email', () => {
  assert.strictEqual(gmailProvider.channel, 'email');
});

test('gmailProvider: provider is gmail', () => {
  assert.strictEqual(gmailProvider.provider, 'gmail');
});

test('gmailProvider: binding.mcpServerId is chittyagent-google', () => {
  assert.strictEqual(gmailProvider.binding.mcpServerId, 'chittyagent-google');
});

test('gmailProvider: binding.tools resolveContact → search_threads', () => {
  assert.strictEqual(gmailProvider.binding.tools.resolveContact, 'search_threads');
});

test('gmailProvider: binding.tools listMessages → search_threads', () => {
  assert.strictEqual(gmailProvider.binding.tools.listMessages, 'search_threads');
});

test('gmailProvider: binding.tools getMessage → get_thread', () => {
  assert.strictEqual(gmailProvider.binding.tools.getMessage, 'get_thread');
});

test('gmailProvider: supports.localCache is false', () => {
  assert.strictEqual(gmailProvider.supports.localCache, false);
});

test('gmailProvider: supports.nativeDirection is false (direction derived from owner bundle)', () => {
  assert.strictEqual(gmailProvider.supports.nativeDirection, false);
});

// ── imessageProviderUnbound ───────────────────────────────────────────────────

test('imessageProviderUnbound: bound is false', () => {
  assert.strictEqual(imessageProviderUnbound.bound, false);
});

test('imessageProviderUnbound: reason is non-empty string', () => {
  assert.ok(
    typeof imessageProviderUnbound.reason === 'string' && imessageProviderUnbound.reason.length > 0,
    'reason should be a non-empty string',
  );
});

test('imessageProviderUnbound: channel is imessage', () => {
  assert.strictEqual(imessageProviderUnbound.channel, 'imessage');
});
