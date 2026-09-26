/**
 * Workstream R: freeze comms-mcp tool response required key presence and value types.
 *
 * These tests verify that comms.recentLog always returns the correct container
 * shape with all required keys at the expected types. Optional fields (entries
 * items, totalBeforeLimit, truncated, resolvedContact sub-fields) are not
 * asserted here — only the required structural shell is frozen.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createCommsMcpServer } from '../src/server.ts';
import type { CommsDispatch, OwnerIdentity, RecentLogOutput, RecentLogMetadata, ChannelQueried } from '../src/types.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const OWNER: OwnerIdentity = {
  identifiers: ['nick@nevershitty.com', '+13125550100'],
  displayName: 'Nick',
  chittyId: null,
};

function stubDispatch(): CommsDispatch {
  return { async call() { return []; } };
}

function throwingDispatch(): CommsDispatch {
  return { async call() { throw new Error('backend unavailable'); } };
}

async function setup(dispatch: CommsDispatch): Promise<{ client: Client; cleanup: () => Promise<void> }> {
  const server = createCommsMcpServer(dispatch, OWNER);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: 'test-r-freeze', version: '1.0.0' }, { capabilities: {} });
  await server.connect(serverTransport);
  await mcpClient.connect(clientTransport);
  return { client: mcpClient, cleanup: async () => { await mcpClient.close(); } };
}

function parseText<T>(result: Awaited<ReturnType<Client['callTool']>>): T {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text) as T;
}

const CALL_ARGS = { identifier: '+13125550199', channels: ['quo'] };

// ── R-1: top-level required keys ──────────────────────────────────────────────

test('R-1: comms.recentLog output has required top-level keys {entries, metadata}', async () => {
  const { client, cleanup } = await setup(stubDispatch());
  try {
    const result = await client.callTool({ name: 'comms.recentLog', arguments: CALL_ARGS });
    assert.ok(!result.isError, 'expected success');
    const body = parseText<RecentLogOutput>(result);
    assert.ok(Object.prototype.hasOwnProperty.call(body, 'entries'), 'output missing required key: entries');
    assert.ok(Object.prototype.hasOwnProperty.call(body, 'metadata'), 'output missing required key: metadata');
  } finally {
    await cleanup();
  }
});

// ── R-2: top-level value types ────────────────────────────────────────────────

test('R-2: comms.recentLog output value types: entries is array, metadata is object', async () => {
  const { client, cleanup } = await setup(stubDispatch());
  try {
    const result = await client.callTool({ name: 'comms.recentLog', arguments: CALL_ARGS });
    assert.ok(!result.isError, 'expected success');
    const body = parseText<RecentLogOutput>(result);
    assert.ok(Array.isArray(body.entries), 'entries must be an array');
    assert.ok(body.metadata !== null && typeof body.metadata === 'object' && !Array.isArray(body.metadata), 'metadata must be a non-null object');
  } finally {
    await cleanup();
  }
});

// ── R-3: metadata required keys ───────────────────────────────────────────────

test('R-3: metadata has required keys {resolvedContact, channelsQueried, window}', async () => {
  const { client, cleanup } = await setup(stubDispatch());
  try {
    const result = await client.callTool({ name: 'comms.recentLog', arguments: CALL_ARGS });
    assert.ok(!result.isError, 'expected success');
    const { metadata } = parseText<RecentLogOutput>(result);
    const requiredKeys: (keyof RecentLogMetadata)[] = ['resolvedContact', 'channelsQueried', 'window'];
    for (const k of requiredKeys) {
      assert.ok(Object.prototype.hasOwnProperty.call(metadata, k), `metadata missing required key: ${k}`);
    }
  } finally {
    await cleanup();
  }
});

// ── R-4: metadata.window required keys + types ────────────────────────────────

test('R-4: metadata.window has required keys {since, until} both strings', async () => {
  const { client, cleanup } = await setup(stubDispatch());
  try {
    const result = await client.callTool({ name: 'comms.recentLog', arguments: CALL_ARGS });
    assert.ok(!result.isError, 'expected success');
    const { metadata } = parseText<RecentLogOutput>(result);
    assert.ok(Object.prototype.hasOwnProperty.call(metadata.window, 'since'), 'window missing key: since');
    assert.ok(Object.prototype.hasOwnProperty.call(metadata.window, 'until'), 'window missing key: until');
    assert.equal(typeof metadata.window.since, 'string', 'window.since must be string');
    assert.equal(typeof metadata.window.until, 'string', 'window.until must be string');
  } finally {
    await cleanup();
  }
});

// ── R-5: channelsQueried item required keys + types ───────────────────────────

test('R-5: metadata.channelsQueried items have required keys {channel, ok, count} with correct types', async () => {
  const { client, cleanup } = await setup(stubDispatch());
  try {
    const result = await client.callTool({ name: 'comms.recentLog', arguments: CALL_ARGS });
    assert.ok(!result.isError, 'expected success');
    const { metadata } = parseText<RecentLogOutput>(result);
    assert.ok(Array.isArray(metadata.channelsQueried), 'channelsQueried must be an array');
    assert.ok(metadata.channelsQueried.length > 0, 'channelsQueried must have at least one item for requested channel');
    const item = metadata.channelsQueried[0] as ChannelQueried;
    const requiredKeys: (keyof ChannelQueried)[] = ['channel', 'ok', 'count'];
    for (const k of requiredKeys) {
      assert.ok(Object.prototype.hasOwnProperty.call(item, k), `channelsQueried item missing required key: ${k}`);
    }
    assert.equal(typeof item.channel, 'string', 'channel must be string');
    assert.equal(typeof item.ok, 'boolean', 'ok must be boolean');
    assert.equal(typeof item.count, 'number', 'count must be number');
  } finally {
    await cleanup();
  }
});

// ── R-6: degraded channel still has required keys ────────────────────────────

test('R-6: on dispatch error, channelsQueried item still has required keys {channel, ok, count} with ok=false', async () => {
  const { client, cleanup } = await setup(throwingDispatch());
  try {
    const result = await client.callTool({ name: 'comms.recentLog', arguments: CALL_ARGS });
    assert.ok(!result.isError, 'dispatch error should not make whole tool isError');
    const { metadata } = parseText<RecentLogOutput>(result);
    const quoItem = metadata.channelsQueried.find((c) => c.channel === 'quo') as ChannelQueried | undefined;
    assert.ok(quoItem, 'quo channel should appear in channelsQueried even on error');
    assert.ok(Object.prototype.hasOwnProperty.call(quoItem, 'channel'), 'degraded item missing key: channel');
    assert.ok(Object.prototype.hasOwnProperty.call(quoItem, 'ok'), 'degraded item missing key: ok');
    assert.ok(Object.prototype.hasOwnProperty.call(quoItem, 'count'), 'degraded item missing key: count');
    assert.equal(typeof quoItem.channel, 'string', 'channel must be string');
    assert.equal(quoItem.ok, false, 'ok must be false on dispatch error');
    assert.equal(typeof quoItem.count, 'number', 'count must be number');
  } finally {
    await cleanup();
  }
});
