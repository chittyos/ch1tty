import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createCommsMcpServer } from '../src/server.ts';
import type { CommsDispatch, OwnerIdentity, RecentLogOutput } from '../src/types.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const OWNER: OwnerIdentity = {
  identifiers: ['nick@nevershitty.com', '+13125550100'],
  displayName: 'Nick',
  chittyId: null,
};

/** Stub dispatch: returns [] for every call (no entries, all channels ok=true). */
function stubDispatch(): CommsDispatch {
  return { async call() { return []; } };
}

type DispatchCall = { mcpServerId: string; tool: string; args: Record<string, unknown> };

/** Capturing dispatch: records each call then returns []. */
function capturingDispatch(): { dispatch: CommsDispatch; calls: DispatchCall[] } {
  const calls: DispatchCall[] = [];
  const dispatch: CommsDispatch = {
    async call(mcpServerId, tool, args) {
      calls.push({ mcpServerId, tool, args });
      return [];
    },
  };
  return { dispatch, calls };
}

/** Throwing dispatch: throws the given error on any call. */
function throwingDispatch(msg = 'backend unavailable'): CommsDispatch {
  return { async call() { throw new Error(msg); } };
}

// ── Test harness ──────────────────────────────────────────────────────────────

async function setup(dispatch: CommsDispatch, owner = OWNER): Promise<{ client: Client; cleanup: () => Promise<void> }> {
  const server = createCommsMcpServer(dispatch, owner);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
  await server.connect(serverTransport);
  await mcpClient.connect(clientTransport);
  return {
    client: mcpClient,
    cleanup: async () => { await mcpClient.close(); },
  };
}

// ── Tool listing ──────────────────────────────────────────────────────────────

test('list_tools: returns exactly 1 tool', async () => {
  const { client, cleanup } = await setup(stubDispatch());
  try {
    const result = await client.listTools();
    assert.equal(result.tools.length, 1);
  } finally {
    await cleanup();
  }
});

test('list_tools: tool is named comms.recentLog', async () => {
  const { client, cleanup } = await setup(stubDispatch());
  try {
    const result = await client.listTools();
    assert.equal(result.tools[0].name, 'comms.recentLog');
  } finally {
    await cleanup();
  }
});

test('list_tools: comms.recentLog schema has oneOf [person, identifier]', async () => {
  const { client, cleanup } = await setup(stubDispatch());
  try {
    const result = await client.listTools();
    const tool = result.tools[0];
    type Schema = { oneOf?: Array<{ required?: string[] }> };
    const schema = tool.inputSchema as Schema;
    assert.ok(Array.isArray(schema.oneOf), 'schema should have oneOf');
    const oneOfFields = schema.oneOf!.flatMap((o) => o.required ?? []);
    assert.ok(oneOfFields.includes('person'), 'oneOf should include person');
    assert.ok(oneOfFields.includes('identifier'), 'oneOf should include identifier');
  } finally {
    await cleanup();
  }
});

// ── Argument validation ───────────────────────────────────────────────────────

test('comms.recentLog with both person and identifier: returns isError (mutual exclusivity)', async () => {
  const { client, cleanup } = await setup(stubDispatch());
  try {
    const result = await client.callTool({
      name: 'comms.recentLog',
      arguments: { person: 'AB-C-DEF-GHIJ-P-KL-M-NO', identifier: '+13125550100' },
    });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('exactly one of'), `expected mutual-exclusivity message, got: ${content[0].text}`);
  } finally {
    await cleanup();
  }
});

test('comms.recentLog with neither person nor identifier: returns isError', async () => {
  const { client, cleanup } = await setup(stubDispatch());
  try {
    const result = await client.callTool({ name: 'comms.recentLog', arguments: {} });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('exactly one of'), `expected selector message, got: ${content[0].text}`);
  } finally {
    await cleanup();
  }
});

// ── Successful paths ──────────────────────────────────────────────────────────

test('comms.recentLog with person: returns JSON with entries and metadata', async () => {
  const { client, cleanup } = await setup(stubDispatch());
  try {
    const result = await client.callTool({
      name: 'comms.recentLog',
      arguments: { person: 'AB-C-DEF-GHIJ-P-KL-M-NO', channels: ['quo'] },
    });
    assert.ok(!result.isError);
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text) as RecentLogOutput;
    assert.ok(Array.isArray(parsed.entries), 'entries should be an array');
    assert.ok(parsed.metadata, 'metadata should be present');
    assert.ok(Array.isArray(parsed.metadata.channelsQueried), 'channelsQueried should be an array');
  } finally {
    await cleanup();
  }
});

test('comms.recentLog with identifier: returns JSON result', async () => {
  const { client, cleanup } = await setup(stubDispatch());
  try {
    const result = await client.callTool({
      name: 'comms.recentLog',
      arguments: { identifier: '+13125550199', channels: ['quo'] },
    });
    assert.ok(!result.isError);
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text) as RecentLogOutput;
    assert.ok(Array.isArray(parsed.entries));
  } finally {
    await cleanup();
  }
});

// ── Dispatch interaction ──────────────────────────────────────────────────────

test('comms.recentLog channels:[quo] dispatches to chittyagent-quo', async () => {
  const { dispatch, calls } = capturingDispatch();
  const { client, cleanup } = await setup(dispatch);
  try {
    await client.callTool({
      name: 'comms.recentLog',
      arguments: { identifier: '+13125550199', channels: ['quo'] },
    });
    assert.ok(calls.length >= 1, 'dispatch should have been called at least once');
    const quoCall = calls.find((c) => c.mcpServerId === 'chittyagent-quo');
    assert.ok(quoCall, 'expected a dispatch call to chittyagent-quo');
    assert.equal(quoCall!.tool, 'quo_recent_messages_local');
  } finally {
    await cleanup();
  }
});

test('comms.recentLog channels:[email] dispatches to chittyagent-google', async () => {
  const { dispatch, calls } = capturingDispatch();
  const { client, cleanup } = await setup(dispatch);
  try {
    await client.callTool({
      name: 'comms.recentLog',
      arguments: { identifier: 'alice@example.com', channels: ['email'] },
    });
    const emailCall = calls.find((c) => c.mcpServerId === 'chittyagent-google');
    assert.ok(emailCall, 'expected a dispatch call to chittyagent-google');
    assert.equal(emailCall!.tool, 'search_threads');
  } finally {
    await cleanup();
  }
});

test('comms.recentLog channels:[quo]: dispatch args include participants array', async () => {
  const { dispatch, calls } = capturingDispatch();
  const { client, cleanup } = await setup(dispatch);
  try {
    await client.callTool({
      name: 'comms.recentLog',
      arguments: { identifier: '+13125550199', channels: ['quo'] },
    });
    const quoCall = calls.find((c) => c.mcpServerId === 'chittyagent-quo');
    assert.ok(quoCall, 'expected a dispatch call to chittyagent-quo');
    assert.ok(Array.isArray(quoCall!.args['participants']), 'args.participants should be an array');
    assert.ok((quoCall!.args['participants'] as string[]).includes('+13125550199'));
  } finally {
    await cleanup();
  }
});

test('comms.recentLog channels:[quo]: no dispatch call for email', async () => {
  const { dispatch, calls } = capturingDispatch();
  const { client, cleanup } = await setup(dispatch);
  try {
    await client.callTool({
      name: 'comms.recentLog',
      arguments: { identifier: '+13125550199', channels: ['quo'] },
    });
    const emailCall = calls.find((c) => c.mcpServerId === 'chittyagent-google');
    assert.equal(emailCall, undefined, 'should not dispatch to email when channels=[quo]');
  } finally {
    await cleanup();
  }
});

// ── Channel degradation ───────────────────────────────────────────────────────

test('comms.recentLog: imessage channel always ok=false (unbound) — not isError', async () => {
  const { client, cleanup } = await setup(stubDispatch());
  try {
    const result = await client.callTool({
      name: 'comms.recentLog',
      arguments: { identifier: '+13125550199', channels: ['imessage'] },
    });
    assert.ok(!result.isError, 'unbound channel should not make the whole tool isError');
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text) as RecentLogOutput;
    const imessageChannel = parsed.metadata.channelsQueried.find((c) => c.channel === 'imessage');
    assert.ok(imessageChannel, 'imessage should be in channelsQueried');
    assert.equal(imessageChannel!.ok, false, 'imessage channel should be ok=false');
  } finally {
    await cleanup();
  }
});

test('comms.recentLog: dispatch error degrades channel to ok=false — result is still JSON, not isError', async () => {
  const { client, cleanup } = await setup(throwingDispatch('quo backend down'));
  try {
    const result = await client.callTool({
      name: 'comms.recentLog',
      arguments: { identifier: '+13125550199', channels: ['quo'] },
    });
    assert.ok(!result.isError, 'dispatch error should degrade channel, not make tool isError');
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text) as RecentLogOutput;
    const quoChannel = parsed.metadata.channelsQueried.find((c) => c.channel === 'quo');
    assert.ok(quoChannel, 'quo should be in channelsQueried');
    assert.equal(quoChannel!.ok, false, 'quo channel should be ok=false after dispatch error');
    assert.ok(quoChannel!.error?.includes('quo backend down'));
  } finally {
    await cleanup();
  }
});

// ── Result structure ──────────────────────────────────────────────────────────

test('comms.recentLog: metadata.window has since and until', async () => {
  const { client, cleanup } = await setup(stubDispatch());
  try {
    const result = await client.callTool({
      name: 'comms.recentLog',
      arguments: { identifier: '+13125550199', channels: ['quo'] },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text) as RecentLogOutput;
    assert.ok(parsed.metadata.window.since, 'window.since should be set');
    assert.ok(parsed.metadata.window.until, 'window.until should be set');
  } finally {
    await cleanup();
  }
});

test('comms.recentLog: metadata.channelsQueried includes requested channel', async () => {
  const { client, cleanup } = await setup(stubDispatch());
  try {
    const result = await client.callTool({
      name: 'comms.recentLog',
      arguments: { identifier: '+13125550199', channels: ['quo'] },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text) as RecentLogOutput;
    const channels = parsed.metadata.channelsQueried.map((c) => c.channel);
    assert.ok(channels.includes('quo'), 'quo should be in channelsQueried');
  } finally {
    await cleanup();
  }
});

// ── Error handling ────────────────────────────────────────────────────────────

test('unknown tool: returns isError with "Unknown tool" message', async () => {
  const { client, cleanup } = await setup(stubDispatch());
  try {
    const result = await client.callTool({ name: 'comms.nonExistentTool', arguments: {} });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('Unknown tool'));
  } finally {
    await cleanup();
  }
});
