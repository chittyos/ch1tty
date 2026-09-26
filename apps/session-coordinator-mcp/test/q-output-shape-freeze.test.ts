/**
 * Workstream Q: freeze session-coordinator-mcp tool response required key presence and value types.
 *
 * These tests verify that each session-coordinator-mcp tool response includes all required
 * keys with the correct value types. Optional fields (user_id, context, closed_at, payload,
 * actor, cursor) are not asserted here — only required presence and types are frozen.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createSessionCoordinatorServer } from '../src/server.ts';
import type { SessionClient, Session, SessionEvent, ListEventsResult } from '../src/session-client.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SESSION_FIXTURE: Session = {
  id: 'sid-001',
  channel: 'claude-code',
  status: 'active',
  event_count: 2,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
};

const EVENT_FIXTURE: SessionEvent = {
  id: 'evid-001',
  session_id: 'sid-001',
  type: 'user.message',
  created_at: '2026-01-01T10:00:00Z',
};

function makeMockClient(overrides: Partial<SessionClient> = {}): SessionClient {
  return {
    listSessions: async () => [SESSION_FIXTURE],
    getSession: async () => SESSION_FIXTURE,
    createSession: async (input) => ({ ...SESSION_FIXTURE, id: 'sid-new', channel: input.channel }),
    updateSession: async () => ({ ...SESSION_FIXTURE, status: 'idle' }),
    closeSession: async () => ({ ...SESSION_FIXTURE, status: 'closed', closed_at: '2026-07-01T00:00:00Z' }),
    appendEvent: async (_sid, input) => ({ ...EVENT_FIXTURE, id: 'evid-new', type: input.type }),
    listEvents: async () => ({ events: [EVENT_FIXTURE], has_more: false }),
    ...overrides,
  } as unknown as SessionClient;
}

async function setup(overrides?: Partial<SessionClient>): Promise<{ client: Client; cleanup: () => Promise<void> }> {
  const server = createSessionCoordinatorServer(makeMockClient(overrides));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: 'test-q-freeze', version: '1.0.0' }, { capabilities: {} });
  await server.connect(serverTransport);
  await mcpClient.connect(clientTransport);
  return { client: mcpClient, cleanup: async () => { await mcpClient.close(); } };
}

function parseText<T>(result: Awaited<ReturnType<Client['callTool']>>): T {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text) as T;
}

// ── list_sessions: Session item required keys ─────────────────────────────────

test('Q-1: list_sessions Session item has required keys {id, channel, status, event_count, created_at, updated_at}', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'list_sessions', arguments: {} });
    assert.ok(!result.isError, 'expected success');
    const sessions = parseText<Session[]>(result);
    assert.ok(Array.isArray(sessions) && sessions.length > 0, 'non-empty array');
    const s = sessions[0];
    const requiredKeys: (keyof Session)[] = ['id', 'channel', 'status', 'event_count', 'created_at', 'updated_at'];
    for (const k of requiredKeys) {
      assert.ok(Object.prototype.hasOwnProperty.call(s, k), `Session missing required key: ${k}`);
    }
  } finally {
    await cleanup();
  }
});

// ── list_sessions: Session field value types ──────────────────────────────────

test('Q-2: list_sessions Session field value types: id/channel/status/created_at/updated_at string, event_count number', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'list_sessions', arguments: {} });
    assert.ok(!result.isError, 'expected success');
    const sessions = parseText<Session[]>(result);
    const s = sessions[0];
    assert.equal(typeof s.id, 'string', 'id must be string');
    assert.equal(typeof s.channel, 'string', 'channel must be string');
    assert.equal(typeof s.status, 'string', 'status must be string');
    assert.equal(typeof s.event_count, 'number', 'event_count must be number');
    assert.equal(typeof s.created_at, 'string', 'created_at must be string');
    assert.equal(typeof s.updated_at, 'string', 'updated_at must be string');
  } finally {
    await cleanup();
  }
});

// ── get_session: required keys ────────────────────────────────────────────────

test('Q-3: get_session Session has required keys {id, channel, status, event_count, created_at, updated_at}', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'get_session', arguments: { id: 'sid-001' } });
    assert.ok(!result.isError, 'expected success');
    const s = parseText<Session>(result);
    const requiredKeys: (keyof Session)[] = ['id', 'channel', 'status', 'event_count', 'created_at', 'updated_at'];
    for (const k of requiredKeys) {
      assert.ok(Object.prototype.hasOwnProperty.call(s, k), `Session missing required key: ${k}`);
    }
    assert.equal(typeof s.id, 'string', 'id must be string');
    assert.equal(typeof s.channel, 'string', 'channel must be string');
    assert.equal(typeof s.status, 'string', 'status must be string');
    assert.equal(typeof s.event_count, 'number', 'event_count must be number');
    assert.equal(typeof s.created_at, 'string', 'created_at must be string');
    assert.equal(typeof s.updated_at, 'string', 'updated_at must be string');
  } finally {
    await cleanup();
  }
});

// ── create_session: response is Session with required keys ────────────────────

test('Q-4: create_session response is a Session with required keys {id, channel, status, event_count, created_at, updated_at}', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'create_session', arguments: { channel: 'claude-code' } });
    assert.ok(!result.isError, 'expected success');
    const s = parseText<Session>(result);
    const requiredKeys: (keyof Session)[] = ['id', 'channel', 'status', 'event_count', 'created_at', 'updated_at'];
    for (const k of requiredKeys) {
      assert.ok(Object.prototype.hasOwnProperty.call(s, k), `create_session response missing required key: ${k}`);
    }
    assert.equal(typeof s.id, 'string', 'id must be string');
    assert.equal(typeof s.channel, 'string', 'channel must be string');
    assert.equal(typeof s.status, 'string', 'status must be string');
    assert.equal(typeof s.event_count, 'number', 'event_count must be number');
    assert.equal(typeof s.created_at, 'string', 'created_at must be string');
    assert.equal(typeof s.updated_at, 'string', 'updated_at must be string');
  } finally {
    await cleanup();
  }
});

// ── append_event: response is SessionEvent with required keys ─────────────────

test('Q-5: append_event response is a SessionEvent with required keys {id, session_id, type, created_at}', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({
      name: 'append_event',
      arguments: { session_id: 'sid-001', type: 'user.message' },
    });
    assert.ok(!result.isError, 'expected success');
    const ev = parseText<SessionEvent>(result);
    const requiredKeys: (keyof SessionEvent)[] = ['id', 'session_id', 'type', 'created_at'];
    for (const k of requiredKeys) {
      assert.ok(Object.prototype.hasOwnProperty.call(ev, k), `SessionEvent missing required key: ${k}`);
    }
  } finally {
    await cleanup();
  }
});

// ── append_event: SessionEvent field value types ──────────────────────────────

test('Q-6: append_event SessionEvent field value types: id/session_id/type/created_at string', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({
      name: 'append_event',
      arguments: { session_id: 'sid-001', type: 'agent.tool_call' },
    });
    assert.ok(!result.isError, 'expected success');
    const ev = parseText<SessionEvent>(result);
    assert.equal(typeof ev.id, 'string', 'id must be string');
    assert.equal(typeof ev.session_id, 'string', 'session_id must be string');
    assert.equal(typeof ev.type, 'string', 'type must be string');
    assert.equal(typeof ev.created_at, 'string', 'created_at must be string');
  } finally {
    await cleanup();
  }
});

// ── list_events: ListEventsResult shape ───────────────────────────────────────

test('Q-7: list_events result has required keys {events, has_more} and event items have required SessionEvent keys + types', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'list_events', arguments: { session_id: 'sid-001' } });
    assert.ok(!result.isError, 'expected success');
    const body = parseText<ListEventsResult>(result);
    assert.ok(Object.prototype.hasOwnProperty.call(body, 'events'), 'missing key: events');
    assert.ok(Object.prototype.hasOwnProperty.call(body, 'has_more'), 'missing key: has_more');
    assert.ok(Array.isArray(body.events), 'events must be an array');
    assert.equal(typeof body.has_more, 'boolean', 'has_more must be boolean');
    assert.ok(body.events.length > 0, 'fixture must return at least one event');
    const ev = body.events[0];
    const requiredKeys: (keyof SessionEvent)[] = ['id', 'session_id', 'type', 'created_at'];
    for (const k of requiredKeys) {
      assert.ok(Object.prototype.hasOwnProperty.call(ev, k), `events[0] missing required key: ${k}`);
    }
    assert.equal(typeof ev.id, 'string', 'events[0].id must be string');
    assert.equal(typeof ev.session_id, 'string', 'events[0].session_id must be string');
    assert.equal(typeof ev.type, 'string', 'events[0].type must be string');
    assert.equal(typeof ev.created_at, 'string', 'events[0].created_at must be string');
  } finally {
    await cleanup();
  }
});

// ── update_session: response is Session with required keys + value types ──────

test('Q-8: update_session response is a Session with required keys {id, channel, status, event_count, created_at, updated_at} and correct value types', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'update_session', arguments: { id: 'sid-001', status: 'idle' } });
    assert.ok(!result.isError, 'expected success');
    const s = parseText<Session>(result);
    const requiredKeys: (keyof Session)[] = ['id', 'channel', 'status', 'event_count', 'created_at', 'updated_at'];
    for (const k of requiredKeys) {
      assert.ok(Object.prototype.hasOwnProperty.call(s, k), `update_session response missing required key: ${k}`);
    }
    assert.equal(typeof s.id, 'string', 'id must be string');
    assert.equal(typeof s.channel, 'string', 'channel must be string');
    assert.equal(typeof s.status, 'string', 'status must be string');
    assert.equal(typeof s.event_count, 'number', 'event_count must be number');
    assert.equal(typeof s.created_at, 'string', 'created_at must be string');
    assert.equal(typeof s.updated_at, 'string', 'updated_at must be string');
  } finally {
    await cleanup();
  }
});

// ── close_session: response is Session with required keys + value types ───────

test('Q-9: close_session response is a Session with required keys {id, channel, status, event_count, created_at, updated_at} and correct value types', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'close_session', arguments: { id: 'sid-001' } });
    assert.ok(!result.isError, 'expected success');
    const s = parseText<Session>(result);
    const requiredKeys: (keyof Session)[] = ['id', 'channel', 'status', 'event_count', 'created_at', 'updated_at'];
    for (const k of requiredKeys) {
      assert.ok(Object.prototype.hasOwnProperty.call(s, k), `close_session response missing required key: ${k}`);
    }
    assert.equal(typeof s.id, 'string', 'id must be string');
    assert.equal(typeof s.channel, 'string', 'channel must be string');
    assert.equal(typeof s.status, 'string', 'status must be string');
    assert.equal(typeof s.event_count, 'number', 'event_count must be number');
    assert.equal(typeof s.created_at, 'string', 'created_at must be string');
    assert.equal(typeof s.updated_at, 'string', 'updated_at must be string');
  } finally {
    await cleanup();
  }
});
