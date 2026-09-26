/**
 * Workstream P: freeze ledger-mcp tool response required key presence and value types.
 *
 * These tests verify that each ledger-mcp tool response includes all required
 * keys with the correct value types. Optional fields (last_entry_at, metadata,
 * next_cursor) are not asserted here — only required presence and types are frozen.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createLedgerServer } from '../src/server.ts';
import type { LedgerClient, LedgerEntry, Namespace, ListEntriesResult } from '../src/ledger-client.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NS_FIXTURE: Namespace = {
  name: 'events',
  entry_count: 3,
  created_at: '2026-01-01T00:00:00Z',
  last_entry_at: '2026-06-01T00:00:00Z',
};

const ENTRY_FIXTURE: LedgerEntry = {
  id: 'eid-001',
  namespace: 'events',
  payload: { type: 'test' },
  metadata: { actor: 'system' },
  sequence: 1,
  created_at: '2026-01-01T10:00:00Z',
};

function makeMockClient(overrides: Partial<LedgerClient> = {}): LedgerClient {
  return {
    listNamespaces: async () => [NS_FIXTURE],
    listEntries: async () => ({ entries: [ENTRY_FIXTURE], has_more: false }),
    getEntry: async () => ENTRY_FIXTURE,
    appendEntry: async (_ns, input) => ({
      ...ENTRY_FIXTURE,
      id: 'eid-new',
      payload: input.payload,
      metadata: input.metadata,
      sequence: 2,
    }),
    ...overrides,
  } as unknown as LedgerClient;
}

async function setup(overrides?: Partial<LedgerClient>): Promise<{ client: Client; cleanup: () => Promise<void> }> {
  const server = createLedgerServer(makeMockClient(overrides));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: 'test-p-freeze', version: '1.0.0' }, { capabilities: {} });
  await server.connect(serverTransport);
  await mcpClient.connect(clientTransport);
  return { client: mcpClient, cleanup: async () => { await mcpClient.close(); } };
}

function parseText<T>(result: Awaited<ReturnType<Client['callTool']>>): T {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text) as T;
}

// ── list_namespaces: Namespace item key set ───────────────────────────────────

test('P-1: list_namespaces Namespace item has required keys {name, entry_count, created_at}', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'list_namespaces', arguments: {} });
    assert.ok(!result.isError, 'expected success');
    const namespaces = parseText<Namespace[]>(result);
    assert.ok(Array.isArray(namespaces) && namespaces.length > 0, 'non-empty array');
    const ns = namespaces[0];
    const requiredKeys = ['name', 'entry_count', 'created_at'];
    for (const k of requiredKeys) {
      assert.ok(Object.prototype.hasOwnProperty.call(ns, k), `Namespace missing required key: ${k}`);
    }
  } finally {
    await cleanup();
  }
});

// ── list_namespaces: Namespace field value types ──────────────────────────────

test('P-2: list_namespaces Namespace field value types: name string, entry_count number, created_at string', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'list_namespaces', arguments: {} });
    assert.ok(!result.isError, 'expected success');
    const namespaces = parseText<Namespace[]>(result);
    const ns = namespaces[0];
    assert.equal(typeof ns.name, 'string', 'name must be string');
    assert.equal(typeof ns.entry_count, 'number', 'entry_count must be number');
    assert.equal(typeof ns.created_at, 'string', 'created_at must be string');
  } finally {
    await cleanup();
  }
});

// ── list_entries: ListEntriesResult key set ───────────────────────────────────

test('P-3: list_entries result has required keys {entries, has_more} and entries items have required LedgerEntry keys + types', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'list_entries', arguments: { namespace: 'events' } });
    assert.ok(!result.isError, 'expected success');
    const body = parseText<ListEntriesResult>(result);
    assert.ok(Object.prototype.hasOwnProperty.call(body, 'entries'), 'missing key: entries');
    assert.ok(Object.prototype.hasOwnProperty.call(body, 'has_more'), 'missing key: has_more');
    assert.ok(Array.isArray(body.entries), 'entries must be an array');
    assert.equal(typeof body.has_more, 'boolean', 'has_more must be boolean');
    assert.ok(body.entries.length > 0, 'fixture must return at least one entry');
    const entry = body.entries[0];
    const requiredKeys: (keyof LedgerEntry)[] = ['id', 'namespace', 'payload', 'sequence', 'created_at'];
    for (const k of requiredKeys) {
      assert.ok(Object.prototype.hasOwnProperty.call(entry, k), `entries[0] missing required key: ${k}`);
    }
    assert.equal(typeof entry.id, 'string', 'entries[0].id must be string');
    assert.equal(typeof entry.namespace, 'string', 'entries[0].namespace must be string');
    assert.equal(typeof entry.created_at, 'string', 'entries[0].created_at must be string');
    assert.equal(typeof entry.sequence, 'number', 'entries[0].sequence must be number');
    assert.ok(entry.payload !== null && typeof entry.payload === 'object' && !Array.isArray(entry.payload), 'entries[0].payload must be a non-null object');
  } finally {
    await cleanup();
  }
});

// ── get_entry: LedgerEntry required key set ───────────────────────────────────

test('P-4: get_entry LedgerEntry has required keys {id, namespace, payload, sequence, created_at}', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'get_entry', arguments: { namespace: 'events', id: 'eid-001' } });
    assert.ok(!result.isError, 'expected success');
    const entry = parseText<LedgerEntry>(result);
    const requiredKeys: (keyof LedgerEntry)[] = ['id', 'namespace', 'payload', 'sequence', 'created_at'];
    for (const k of requiredKeys) {
      assert.ok(Object.prototype.hasOwnProperty.call(entry, k), `LedgerEntry missing required key: ${k}`);
    }
  } finally {
    await cleanup();
  }
});

// ── get_entry: LedgerEntry field value types ──────────────────────────────────

test('P-5: get_entry LedgerEntry field value types: id/namespace/created_at string, sequence number, payload object', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'get_entry', arguments: { namespace: 'events', id: 'eid-001' } });
    assert.ok(!result.isError, 'expected success');
    const entry = parseText<LedgerEntry>(result);
    assert.equal(typeof entry.id, 'string', 'id must be string');
    assert.equal(typeof entry.namespace, 'string', 'namespace must be string');
    assert.equal(typeof entry.created_at, 'string', 'created_at must be string');
    assert.equal(typeof entry.sequence, 'number', 'sequence must be number');
    assert.ok(entry.payload !== null && typeof entry.payload === 'object' && !Array.isArray(entry.payload), 'payload must be a non-null object');
  } finally {
    await cleanup();
  }
});

// ── append_entry: response is LedgerEntry with required keys ─────────────────

test('P-6: append_entry response is a LedgerEntry with required keys {id, namespace, payload, sequence, created_at}', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({
      name: 'append_entry',
      arguments: { namespace: 'events', payload: { type: 'test.event' } },
    });
    assert.ok(!result.isError, 'expected success');
    const entry = parseText<LedgerEntry>(result);
    const requiredKeys: (keyof LedgerEntry)[] = ['id', 'namespace', 'payload', 'sequence', 'created_at'];
    for (const k of requiredKeys) {
      assert.ok(Object.prototype.hasOwnProperty.call(entry, k), `append_entry response missing required key: ${k}`);
    }
    assert.equal(typeof entry.id, 'string', 'id must be string');
    assert.equal(typeof entry.namespace, 'string', 'namespace must be string');
    assert.equal(typeof entry.created_at, 'string', 'created_at must be string');
    assert.equal(typeof entry.sequence, 'number', 'sequence must be number');
    assert.ok(entry.payload !== null && typeof entry.payload === 'object' && !Array.isArray(entry.payload), 'payload must be a non-null object');
  } finally {
    await cleanup();
  }
});
