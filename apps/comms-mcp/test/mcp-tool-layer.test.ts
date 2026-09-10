/**
 * MCP tool layer tests for comms-mcp (Workstream R).
 *
 * Tests the `createCommsMcpServer` factory against a mock CommsDispatch, using
 * InMemoryTransport to wire a real MCP Client/Server pair in-process — no
 * spawned processes, no network. Covers the single `comms.recentLog` tool:
 * happy paths (identifier, person, channel filter), error cases (missing
 * selector, unknown tool), channel failure degradation, and imessage unbound.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createCommsMcpServer } from '../src/server.ts';
import type { CommsDispatch, OwnerIdentity } from '../src/types.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const OWNER: OwnerIdentity = {
  identifiers: ['+15555550000', 'owner@example.com'],
  displayName: 'Owner',
  chittyId: null,
};

const QUO_ROW = {
  external_id: 'AC-msg-1',
  message_id: 'int-1',
  external_thread_id: 'AC-thread-1',
  direction: 'inbound',
  body_text: 'hello from test',
  sent_at: '2026-09-05T10:00:00Z',
  source: 'openphone',
  parties: [
    { role: 'sender', identifier: '+15555550001' },
    { role: 'recipient', identifier: '+15555550000' },
  ],
};

const GMAIL_MSG = {
  id: 'gmail-msg-1',
  threadId: 'gmail-thread-1',
  date: '2026-09-06T11:00:00Z',
  sender: 'alice@example.com',
  toRecipients: ['owner@example.com'],
  subject: 'Test email',
  snippet: 'Email snippet text',
};

// ── Mock dispatch ─────────────────────────────────────────────────────────────

type CallHandler = (serverId: string, tool: string, args: Record<string, unknown>) => Promise<unknown>;

function makeDispatch(handler?: CallHandler): CommsDispatch {
  return {
    call: handler ?? (async () => []),
  };
}

function defaultDispatch(): CommsDispatch {
  return makeDispatch(async (serverId) => {
    if (serverId === 'chittyagent-quo') return [QUO_ROW];
    if (serverId === 'chittyagent-google') return [GMAIL_MSG];
    return [];
  });
}

// ── Test harness ──────────────────────────────────────────────────────────────

async function setup(dispatch?: CommsDispatch, owner?: OwnerIdentity): Promise<{ client: Client; cleanup: () => Promise<void> }> {
  const server = createCommsMcpServer(dispatch ?? defaultDispatch(), owner ?? OWNER);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const mcpClient = new Client(
    { name: 'test-client', version: '1.0.0' },
    { capabilities: {} },
  );

  await server.connect(serverTransport);
  await mcpClient.connect(clientTransport);

  return {
    client: mcpClient,
    cleanup: async () => { await mcpClient.close(); },
  };
}

// ── Tool listing ──────────────────────────────────────────────────────────────

test('list_tools returns exactly 1 tool: comms.recentLog', async () => {
  const { client, cleanup } = await setup();
  try {
    const res = await client.listTools();
    assert.equal(res.tools.length, 1);
    assert.equal(res.tools[0].name, 'comms.recentLog');
  } finally {
    await cleanup();
  }
});

// ── Happy path: identifier ────────────────────────────────────────────────────

test('comms.recentLog with identifier — returns merged entries from quo + email', async () => {
  const { client, cleanup } = await setup();
  try {
    const res = await client.callTool({
      name: 'comms.recentLog',
      arguments: { identifier: '+15555550001', channels: ['quo', 'email'] },
    });
    assert.equal(res.isError, undefined);
    const body = JSON.parse((res.content[0] as { text: string }).text) as {
      entries: Array<{ channel: string; providerMessageId: string }>;
      metadata: { channelsQueried: Array<{ channel: string; ok: boolean; count: number }> };
    };
    assert.ok(Array.isArray(body.entries));
    assert.ok(body.entries.length >= 1);
    const channels = body.entries.map((e) => e.channel);
    assert.ok(channels.includes('quo'), 'should have quo entry');
    assert.ok(channels.includes('email'), 'should have email entry');
    const channelStatus = body.metadata.channelsQueried;
    const quoStatus = channelStatus.find((c) => c.channel === 'quo');
    const emailStatus = channelStatus.find((c) => c.channel === 'email');
    assert.ok(quoStatus?.ok, 'quo should be ok');
    assert.ok(emailStatus?.ok, 'email should be ok');
  } finally {
    await cleanup();
  }
});

// ── Happy path: person (ChittyID) ─────────────────────────────────────────────

test('comms.recentLog with person — resolvedContact carries chittyId', async () => {
  const { client, cleanup } = await setup(
    makeDispatch(async () => [QUO_ROW]),
  );
  try {
    const res = await client.callTool({
      name: 'comms.recentLog',
      arguments: {
        person: 'CH-1-ABC-1234-P-US-1-A1',
        channels: ['quo'],
      },
    });
    assert.equal(res.isError, undefined);
    const body = JSON.parse((res.content[0] as { text: string }).text) as {
      metadata: { resolvedContact: { chittyId: string | null } };
    };
    assert.equal(body.metadata.resolvedContact.chittyId, 'CH-1-ABC-1234-P-US-1-A1');
  } finally {
    await cleanup();
  }
});

// ── Channel filter: single channel ────────────────────────────────────────────

test('comms.recentLog channels:["quo"] — only quo queried', async () => {
  let callCount = 0;
  const { client, cleanup } = await setup(
    makeDispatch(async (serverId) => {
      callCount++;
      if (serverId === 'chittyagent-quo') return [QUO_ROW];
      return [];
    }),
  );
  try {
    const res = await client.callTool({
      name: 'comms.recentLog',
      arguments: { identifier: '+15555550001', channels: ['quo'] },
    });
    assert.equal(res.isError, undefined);
    const body = JSON.parse((res.content[0] as { text: string }).text) as {
      metadata: { channelsQueried: Array<{ channel: string }> };
    };
    assert.equal(body.metadata.channelsQueried.length, 1);
    assert.equal(body.metadata.channelsQueried[0].channel, 'quo');
    assert.equal(callCount, 1, 'dispatch called exactly once for quo');
  } finally {
    await cleanup();
  }
});

// ── imessage: known unbound → ok:false, not an error ─────────────────────────

test('comms.recentLog channels:["imessage"] — ok:false with honest reason, no entries', async () => {
  const { client, cleanup } = await setup(makeDispatch(async () => []));
  try {
    const res = await client.callTool({
      name: 'comms.recentLog',
      arguments: { identifier: '+15555550001', channels: ['imessage'] },
    });
    assert.equal(res.isError, undefined);
    const body = JSON.parse((res.content[0] as { text: string }).text) as {
      entries: unknown[];
      metadata: { channelsQueried: Array<{ channel: string; ok: boolean; error: string | null }> };
    };
    assert.equal(body.entries.length, 0);
    const im = body.metadata.channelsQueried.find((c) => c.channel === 'imessage');
    assert.ok(im, 'imessage should appear in channelsQueried');
    assert.equal(im.ok, false);
    assert.ok(typeof im.error === 'string' && im.error.length > 0, 'error message should be present');
  } finally {
    await cleanup();
  }
});

// ── Channel failure degradation ───────────────────────────────────────────────

test('one channel dispatch failure — other channel still returns, failed degrades to ok:false', async () => {
  const { client, cleanup } = await setup(
    makeDispatch(async (serverId) => {
      if (serverId === 'chittyagent-quo') throw new Error('quo backend down');
      if (serverId === 'chittyagent-google') return [GMAIL_MSG];
      return [];
    }),
  );
  try {
    const res = await client.callTool({
      name: 'comms.recentLog',
      arguments: { identifier: 'alice@example.com', channels: ['quo', 'email'] },
    });
    assert.equal(res.isError, undefined);
    const body = JSON.parse((res.content[0] as { text: string }).text) as {
      entries: Array<{ channel: string }>;
      metadata: { channelsQueried: Array<{ channel: string; ok: boolean; error?: string | null }> };
    };
    const emailEntries = body.entries.filter((e) => e.channel === 'email');
    assert.ok(emailEntries.length >= 1, 'email entries should be returned');
    const quoStatus = body.metadata.channelsQueried.find((c) => c.channel === 'quo');
    const emailStatus = body.metadata.channelsQueried.find((c) => c.channel === 'email');
    assert.equal(quoStatus?.ok, false);
    assert.ok(typeof quoStatus?.error === 'string', 'quo error should be a string');
    assert.equal(emailStatus?.ok, true);
  } finally {
    await cleanup();
  }
});

// ── Error: missing both person and identifier ─────────────────────────────────

test('comms.recentLog without person or identifier returns isError', async () => {
  const { client, cleanup } = await setup();
  try {
    const res = await client.callTool({
      name: 'comms.recentLog',
      arguments: {},
    });
    assert.equal(res.isError, true);
    assert.match((res.content[0] as { text: string }).text, /person|identifier/);
  } finally {
    await cleanup();
  }
});

// ── Error: unknown tool ───────────────────────────────────────────────────────

test('unknown tool returns isError', async () => {
  const { client, cleanup } = await setup();
  try {
    const res = await client.callTool({ name: 'nonexistent_tool', arguments: {} });
    assert.equal(res.isError, true);
    assert.match((res.content[0] as { text: string }).text, /Unknown tool/);
  } finally {
    await cleanup();
  }
});

// ── Ordering: desc vs asc ─────────────────────────────────────────────────────

test('comms.recentLog order:asc — entries sorted oldest first', async () => {
  const olderRow = { ...QUO_ROW, external_id: 'AC-old', sent_at: '2026-09-01T08:00:00Z' };
  const newerRow = { ...QUO_ROW, external_id: 'AC-new', sent_at: '2026-09-08T08:00:00Z' };
  const { client, cleanup } = await setup(
    makeDispatch(async (serverId) => {
      if (serverId === 'chittyagent-quo') return [newerRow, olderRow];
      return [];
    }),
  );
  try {
    const res = await client.callTool({
      name: 'comms.recentLog',
      arguments: { identifier: '+15555550001', channels: ['quo'], order: 'asc' },
    });
    assert.equal(res.isError, undefined);
    const body = JSON.parse((res.content[0] as { text: string }).text) as {
      entries: Array<{ providerMessageId: string; occurredAt: string }>;
    };
    assert.ok(body.entries.length >= 2);
    const times = body.entries.map((e) => Date.parse(e.occurredAt));
    for (let i = 1; i < times.length; i++) {
      assert.ok(times[i] >= times[i - 1], 'entries should be asc by occurredAt');
    }
  } finally {
    await cleanup();
  }
});

// ── Truncation: limit ─────────────────────────────────────────────────────────

test('comms.recentLog limit:1 — truncates to 1 entry and sets truncated:true', async () => {
  const rows = [
    { ...QUO_ROW, external_id: 'AC-a', sent_at: '2026-09-05T10:00:00Z' },
    { ...QUO_ROW, external_id: 'AC-b', sent_at: '2026-09-05T09:00:00Z' },
    { ...QUO_ROW, external_id: 'AC-c', sent_at: '2026-09-05T08:00:00Z' },
  ];
  const { client, cleanup } = await setup(
    makeDispatch(async (serverId) => {
      if (serverId === 'chittyagent-quo') return rows;
      return [];
    }),
  );
  try {
    const res = await client.callTool({
      name: 'comms.recentLog',
      arguments: { identifier: '+15555550001', channels: ['quo'], limit: 1 },
    });
    assert.equal(res.isError, undefined);
    const body = JSON.parse((res.content[0] as { text: string }).text) as {
      entries: unknown[];
      metadata: { truncated: boolean; totalBeforeLimit: number };
    };
    assert.equal(body.entries.length, 1);
    assert.equal(body.metadata.truncated, true);
    assert.ok(body.metadata.totalBeforeLimit >= 3);
  } finally {
    await cleanup();
  }
});

// ── Metadata: window fields ───────────────────────────────────────────────────

test('comms.recentLog — metadata.window is present with since and until', async () => {
  const { client, cleanup } = await setup();
  try {
    const res = await client.callTool({
      name: 'comms.recentLog',
      arguments: { identifier: '+15555550001', channels: ['quo'] },
    });
    assert.equal(res.isError, undefined);
    const body = JSON.parse((res.content[0] as { text: string }).text) as {
      metadata: { window: { since: string; until: string } };
    };
    assert.ok(typeof body.metadata.window.since === 'string');
    assert.ok(typeof body.metadata.window.until === 'string');
  } finally {
    await cleanup();
  }
});
