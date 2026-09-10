import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createSessionCoordinatorServer } from '../src/server.ts';
import type {
  SessionClient,
  Session,
  SessionEvent,
  ListEventsResult,
} from '../src/session-client.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SESSION_1: Session = {
  id: 'sess-1',
  channel: 'claude-code',
  user_id: 'u1',
  status: 'active',
  context: { foo: 'bar' },
  event_count: 2,
  created_at: '2026-01-01T10:00:00Z',
  updated_at: '2026-01-01T11:00:00Z',
};

const SESSION_2: Session = {
  id: 'sess-2',
  channel: 'slack',
  status: 'idle',
  event_count: 0,
  created_at: '2026-01-02T09:00:00Z',
  updated_at: '2026-01-02T09:00:00Z',
};

const EVENT_1: SessionEvent = {
  id: 'evt-1',
  session_id: 'sess-1',
  type: 'user.message',
  payload: { text: 'hello' },
  actor: 'user:u1',
  created_at: '2026-01-01T10:30:00Z',
};

// ── Mock SessionClient ────────────────────────────────────────────────────────

interface MockOverrides {
  listSessions?: (filter?: unknown) => Promise<Session[]>;
  getSession?: (id: string) => Promise<Session>;
  createSession?: (input: unknown) => Promise<Session>;
  updateSession?: (id: string, input: unknown) => Promise<Session>;
  closeSession?: (id: string) => Promise<Session>;
  appendEvent?: (sessionId: string, input: unknown) => Promise<SessionEvent>;
  listEvents?: (sessionId: string, opts?: unknown) => Promise<ListEventsResult>;
}

function makeMockClient(overrides: MockOverrides = {}): SessionClient {
  return {
    listSessions: overrides.listSessions ?? (async () => [SESSION_1, SESSION_2]),
    getSession: overrides.getSession ?? (async () => SESSION_1),
    createSession: overrides.createSession ?? (async (input) => ({
      ...SESSION_1,
      id: 'sess-new',
      channel: (input as { channel: string }).channel,
      event_count: 0,
      created_at: '2026-01-03T00:00:00Z',
      updated_at: '2026-01-03T00:00:00Z',
    })),
    updateSession: overrides.updateSession ?? (async (id, input) => ({
      ...SESSION_1,
      id,
      ...(input as object),
      updated_at: '2026-01-03T00:00:00Z',
    })),
    closeSession: overrides.closeSession ?? (async (id) => ({
      ...SESSION_1,
      id,
      status: 'closed' as const,
      closed_at: '2026-01-03T00:00:00Z',
      updated_at: '2026-01-03T00:00:00Z',
    })),
    appendEvent: overrides.appendEvent ?? (async (sessionId, input) => ({
      ...EVENT_1,
      id: 'evt-new',
      session_id: sessionId,
      type: (input as { type: string }).type,
      created_at: '2026-01-03T00:00:00Z',
    })),
    listEvents: overrides.listEvents ?? (async () => ({
      events: [EVENT_1],
      has_more: false,
    })),
  } as unknown as SessionClient;
}

// ── Test harness ──────────────────────────────────────────────────────────────

async function setup(overrides?: MockOverrides): Promise<{ client: Client; cleanup: () => Promise<void> }> {
  const mockClient = makeMockClient(overrides);
  const server = createSessionCoordinatorServer(mockClient);
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

test('list_tools returns exactly 7 tools', async () => {
  const { client, cleanup } = await setup();
  try {
    const res = await client.listTools();
    assert.equal(res.tools.length, 7);
    const names = res.tools.map((t) => t.name);
    assert.deepEqual(names.sort(), [
      'append_event',
      'close_session',
      'create_session',
      'get_session',
      'list_events',
      'list_sessions',
      'update_session',
    ]);
  } finally {
    await cleanup();
  }
});

// ── list_sessions ─────────────────────────────────────────────────────────────

test('list_sessions — returns all sessions', async () => {
  const { client, cleanup } = await setup();
  try {
    const res = await client.callTool({ name: 'list_sessions', arguments: {} });
    assert.equal(res.isError, undefined);
    const body = JSON.parse((res.content[0] as { text: string }).text);
    assert.equal(body.length, 2);
    assert.equal(body[0].id, 'sess-1');
    assert.equal(body[1].id, 'sess-2');
  } finally {
    await cleanup();
  }
});

test('list_sessions — forwards filter args to client', async () => {
  let capturedFilter: unknown;
  const { client, cleanup } = await setup({
    listSessions: async (filter) => { capturedFilter = filter; return [SESSION_1]; },
  });
  try {
    await client.callTool({ name: 'list_sessions', arguments: { channel: 'slack', status: 'active', limit: 10 } });
    assert.deepEqual(capturedFilter, { channel: 'slack', user_id: undefined, status: 'active', limit: 10 });
  } finally {
    await cleanup();
  }
});

// ── get_session ───────────────────────────────────────────────────────────────

test('get_session — returns session by id', async () => {
  const { client, cleanup } = await setup();
  try {
    const res = await client.callTool({ name: 'get_session', arguments: { id: 'sess-1' } });
    assert.equal(res.isError, undefined);
    const body = JSON.parse((res.content[0] as { text: string }).text);
    assert.equal(body.id, 'sess-1');
    assert.equal(body.channel, 'claude-code');
  } finally {
    await cleanup();
  }
});

test('get_session — missing id returns error', async () => {
  const { client, cleanup } = await setup();
  try {
    const res = await client.callTool({ name: 'get_session', arguments: {} });
    assert.equal(res.isError, true);
    assert.match((res.content[0] as { text: string }).text, /required argument "id"/);
  } finally {
    await cleanup();
  }
});

// ── create_session ────────────────────────────────────────────────────────────

test('create_session — creates session with channel', async () => {
  const { client, cleanup } = await setup();
  try {
    const res = await client.callTool({ name: 'create_session', arguments: { channel: 'web' } });
    assert.equal(res.isError, undefined);
    const body = JSON.parse((res.content[0] as { text: string }).text);
    assert.equal(body.id, 'sess-new');
    assert.equal(body.channel, 'web');
  } finally {
    await cleanup();
  }
});

test('create_session — missing channel returns error', async () => {
  const { client, cleanup } = await setup();
  try {
    const res = await client.callTool({ name: 'create_session', arguments: {} });
    assert.equal(res.isError, true);
    assert.match((res.content[0] as { text: string }).text, /required argument "channel"/);
  } finally {
    await cleanup();
  }
});

// ── update_session ────────────────────────────────────────────────────────────

test('update_session — updates status', async () => {
  let capturedId: string | undefined;
  let capturedInput: unknown;
  const { client, cleanup } = await setup({
    updateSession: async (id, input) => { capturedId = id; capturedInput = input; return SESSION_1; },
  });
  try {
    await client.callTool({ name: 'update_session', arguments: { id: 'sess-1', status: 'idle' } });
    assert.equal(capturedId, 'sess-1');
    assert.deepEqual(capturedInput, { status: 'idle', context: undefined });
  } finally {
    await cleanup();
  }
});

test('update_session — missing id returns error', async () => {
  const { client, cleanup } = await setup();
  try {
    const res = await client.callTool({ name: 'update_session', arguments: { status: 'idle' } });
    assert.equal(res.isError, true);
    assert.match((res.content[0] as { text: string }).text, /required argument "id"/);
  } finally {
    await cleanup();
  }
});

// ── close_session ─────────────────────────────────────────────────────────────

test('close_session — closes session', async () => {
  const { client, cleanup } = await setup();
  try {
    const res = await client.callTool({ name: 'close_session', arguments: { id: 'sess-1' } });
    assert.equal(res.isError, undefined);
    const body = JSON.parse((res.content[0] as { text: string }).text);
    assert.equal(body.status, 'closed');
  } finally {
    await cleanup();
  }
});

test('close_session — missing id returns error', async () => {
  const { client, cleanup } = await setup();
  try {
    const res = await client.callTool({ name: 'close_session', arguments: {} });
    assert.equal(res.isError, true);
    assert.match((res.content[0] as { text: string }).text, /required argument "id"/);
  } finally {
    await cleanup();
  }
});

// ── append_event ──────────────────────────────────────────────────────────────

test('append_event — appends event to session', async () => {
  const { client, cleanup } = await setup();
  try {
    const res = await client.callTool({
      name: 'append_event',
      arguments: { session_id: 'sess-1', type: 'agent.tool_call', actor: 'agent:claude' },
    });
    assert.equal(res.isError, undefined);
    const body = JSON.parse((res.content[0] as { text: string }).text);
    assert.equal(body.session_id, 'sess-1');
    assert.equal(body.type, 'agent.tool_call');
  } finally {
    await cleanup();
  }
});

test('append_event — missing session_id returns error', async () => {
  const { client, cleanup } = await setup();
  try {
    const res = await client.callTool({ name: 'append_event', arguments: { type: 'foo' } });
    assert.equal(res.isError, true);
    assert.match((res.content[0] as { text: string }).text, /required argument "session_id"/);
  } finally {
    await cleanup();
  }
});

test('append_event — missing type returns error', async () => {
  const { client, cleanup } = await setup();
  try {
    const res = await client.callTool({ name: 'append_event', arguments: { session_id: 'sess-1' } });
    assert.equal(res.isError, true);
    assert.match((res.content[0] as { text: string }).text, /required argument "type"/);
  } finally {
    await cleanup();
  }
});

// ── list_events ───────────────────────────────────────────────────────────────

test('list_events — returns events for session', async () => {
  const { client, cleanup } = await setup();
  try {
    const res = await client.callTool({ name: 'list_events', arguments: { session_id: 'sess-1' } });
    assert.equal(res.isError, undefined);
    const body = JSON.parse((res.content[0] as { text: string }).text);
    assert.equal(body.events.length, 1);
    assert.equal(body.events[0].id, 'evt-1');
    assert.equal(body.has_more, false);
  } finally {
    await cleanup();
  }
});

test('list_events — missing session_id returns error', async () => {
  const { client, cleanup } = await setup();
  try {
    const res = await client.callTool({ name: 'list_events', arguments: {} });
    assert.equal(res.isError, true);
    assert.match((res.content[0] as { text: string }).text, /required argument "session_id"/);
  } finally {
    await cleanup();
  }
});

// ── Error propagation ─────────────────────────────────────────────────────────

test('client error is surfaced as isError response', async () => {
  const { client, cleanup } = await setup({
    getSession: async () => { throw new Error('session not found'); },
  });
  try {
    const res = await client.callTool({ name: 'get_session', arguments: { id: 'missing' } });
    assert.equal(res.isError, true);
    assert.match((res.content[0] as { text: string }).text, /session not found/);
  } finally {
    await cleanup();
  }
});

// ── Unknown tool ──────────────────────────────────────────────────────────────

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
