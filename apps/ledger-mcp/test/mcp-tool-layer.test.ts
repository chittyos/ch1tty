import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createLedgerServer } from '../src/server.ts';
import type {
  LedgerClient,
  LedgerEntry,
  Namespace,
  ListEntriesFilter,
  ListEntriesResult,
} from '../src/ledger-client.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NS_EVENTS: Namespace = {
  name: 'events',
  entry_count: 2,
  created_at: '2026-01-01T00:00:00Z',
  last_entry_at: '2026-01-02T00:00:00Z',
};

const NS_AUDIT: Namespace = {
  name: 'audit',
  entry_count: 0,
  created_at: '2026-01-01T00:00:00Z',
};

const ENTRY_1: LedgerEntry = {
  id: 'e1',
  namespace: 'events',
  payload: { type: 'user.created', user_id: 'u1' },
  metadata: { actor: 'system' },
  sequence: 1,
  created_at: '2026-01-01T10:00:00Z',
};

const ENTRY_2: LedgerEntry = {
  id: 'e2',
  namespace: 'events',
  payload: { type: 'user.updated', user_id: 'u1' },
  sequence: 2,
  created_at: '2026-01-02T10:00:00Z',
};

// ── Mock LedgerClient ─────────────────────────────────────────────────────────

interface MockOverrides {
  listNamespaces?: () => Promise<Namespace[]>;
  listEntries?: (namespace: string, filter?: ListEntriesFilter) => Promise<ListEntriesResult>;
  getEntry?: (namespace: string, id: string) => Promise<LedgerEntry>;
  appendEntry?: (namespace: string, input: { payload: Record<string, unknown>; metadata?: Record<string, unknown> }) => Promise<LedgerEntry>;
}

function makeMockClient(overrides: MockOverrides = {}): LedgerClient {
  return {
    listNamespaces: overrides.listNamespaces ?? (async () => [NS_EVENTS, NS_AUDIT]),
    listEntries: overrides.listEntries ?? (async () => ({ entries: [ENTRY_1, ENTRY_2], has_more: false })),
    getEntry: overrides.getEntry ?? (async () => ENTRY_1),
    appendEntry: overrides.appendEntry ?? (async (ns, input) => ({
      ...ENTRY_1,
      id: 'e_new',
      namespace: ns,
      payload: input.payload,
      metadata: input.metadata,
      sequence: 3,
      created_at: '2026-01-03T00:00:00Z',
    })),
  } as unknown as LedgerClient;
}

// ── Test harness ──────────────────────────────────────────────────────────────

async function setup(overrides?: MockOverrides): Promise<{ client: Client; cleanup: () => Promise<void> }> {
  const mockClient = makeMockClient(overrides);
  const server = createLedgerServer(mockClient);
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

test('list_tools returns exactly 4 tools', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.listTools();
    assert.equal(result.tools.length, 4);
    const names = result.tools.map(t => t.name).sort();
    assert.deepEqual(names, ['append_entry', 'get_entry', 'list_entries', 'list_namespaces']);
  } finally {
    await cleanup();
  }
});

test('list_tools: list_entries has required=[namespace]', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.listTools();
    const tool = result.tools.find(t => t.name === 'list_entries');
    assert.ok(tool, 'list_entries missing');
    const schema = tool.inputSchema as { required?: string[] };
    assert.deepEqual(schema.required, ['namespace']);
  } finally {
    await cleanup();
  }
});

test('list_tools: get_entry has required=[namespace, id]', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.listTools();
    const tool = result.tools.find(t => t.name === 'get_entry');
    assert.ok(tool);
    const schema = tool.inputSchema as { required?: string[] };
    assert.deepEqual(schema.required?.sort(), ['id', 'namespace']);
  } finally {
    await cleanup();
  }
});

test('list_tools: append_entry has required=[namespace, payload]', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.listTools();
    const tool = result.tools.find(t => t.name === 'append_entry');
    assert.ok(tool);
    const schema = tool.inputSchema as { required?: string[] };
    assert.deepEqual(schema.required?.sort(), ['namespace', 'payload']);
  } finally {
    await cleanup();
  }
});

// ── list_namespaces ───────────────────────────────────────────────────────────

test('list_namespaces: returns namespace array as JSON', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'list_namespaces', arguments: {} });
    assert.ok(!result.isError);
    const content = result.content as Array<{ type: string; text: string }>;
    const namespaces = JSON.parse(content[0].text) as Namespace[];
    assert.equal(namespaces.length, 2);
    assert.equal(namespaces[0].name, 'events');
    assert.equal(namespaces[0].entry_count, 2);
    assert.equal(namespaces[1].name, 'audit');
  } finally {
    await cleanup();
  }
});

test('list_namespaces: calls client.listNamespaces', async () => {
  let called = false;
  const { client, cleanup } = await setup({
    listNamespaces: async () => { called = true; return [NS_EVENTS]; },
  });
  try {
    await client.callTool({ name: 'list_namespaces', arguments: {} });
    assert.ok(called);
  } finally {
    await cleanup();
  }
});

// ── list_entries ──────────────────────────────────────────────────────────────

test('list_entries: passes namespace to client', async () => {
  let capturedNs = '';
  const { client, cleanup } = await setup({
    listEntries: async (ns) => { capturedNs = ns; return { entries: [], has_more: false }; },
  });
  try {
    await client.callTool({ name: 'list_entries', arguments: { namespace: 'payments' } });
    assert.equal(capturedNs, 'payments');
  } finally {
    await cleanup();
  }
});

test('list_entries: passes filter fields to client', async () => {
  let capturedFilter: ListEntriesFilter | undefined;
  const { client, cleanup } = await setup({
    listEntries: async (_ns, filter) => { capturedFilter = filter; return { entries: [], has_more: false }; },
  });
  try {
    await client.callTool({
      name: 'list_entries',
      arguments: { namespace: 'events', cursor: 'tok-abc', limit: 10, since: '2026-01-01T00:00:00Z' },
    });
    assert.equal(capturedFilter?.cursor, 'tok-abc');
    assert.equal(capturedFilter?.limit, 10);
    assert.equal(capturedFilter?.since, '2026-01-01T00:00:00Z');
  } finally {
    await cleanup();
  }
});

test('list_entries: returns entries result as JSON', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'list_entries', arguments: { namespace: 'events' } });
    assert.ok(!result.isError);
    const content = result.content as Array<{ type: string; text: string }>;
    const body = JSON.parse(content[0].text) as ListEntriesResult;
    assert.equal(body.entries.length, 2);
    assert.equal(body.entries[0].id, 'e1');
    assert.equal(body.has_more, false);
  } finally {
    await cleanup();
  }
});

test('list_entries: missing namespace → isError', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'list_entries', arguments: {} });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('"namespace"'));
  } finally {
    await cleanup();
  }
});

test('list_entries: empty string namespace → isError', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'list_entries', arguments: { namespace: '' } });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('"namespace"'));
  } finally {
    await cleanup();
  }
});

// ── get_entry ─────────────────────────────────────────────────────────────────

test('get_entry: passes namespace and id to client', async () => {
  let capturedNs = '';
  let capturedId = '';
  const { client, cleanup } = await setup({
    getEntry: async (ns, id) => { capturedNs = ns; capturedId = id; return ENTRY_1; },
  });
  try {
    await client.callTool({ name: 'get_entry', arguments: { namespace: 'events', id: 'e1' } });
    assert.equal(capturedNs, 'events');
    assert.equal(capturedId, 'e1');
  } finally {
    await cleanup();
  }
});

test('get_entry: returns entry as JSON', async () => {
  const { client, cleanup } = await setup({ getEntry: async () => ENTRY_1 });
  try {
    const result = await client.callTool({ name: 'get_entry', arguments: { namespace: 'events', id: 'e1' } });
    assert.ok(!result.isError);
    const content = result.content as Array<{ type: string; text: string }>;
    const entry = JSON.parse(content[0].text) as LedgerEntry;
    assert.equal(entry.id, 'e1');
    assert.equal(entry.sequence, 1);
    assert.deepEqual(entry.payload, { type: 'user.created', user_id: 'u1' });
  } finally {
    await cleanup();
  }
});

test('get_entry: missing namespace → isError', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'get_entry', arguments: { id: 'e1' } });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('"namespace"'));
  } finally {
    await cleanup();
  }
});

test('get_entry: empty string namespace → isError', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'get_entry', arguments: { namespace: '', id: 'e1' } });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('"namespace"'));
  } finally {
    await cleanup();
  }
});

test('get_entry: missing id → isError', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'get_entry', arguments: { namespace: 'events' } });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('"id"'));
  } finally {
    await cleanup();
  }
});

test('get_entry: empty string id → isError', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'get_entry', arguments: { namespace: 'events', id: '' } });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('"id"'));
  } finally {
    await cleanup();
  }
});

test('get_entry: client 404 error → isError with message', async () => {
  const { client, cleanup } = await setup({
    getEntry: async () => { throw new Error('ledger API GET /api/ledger/events/entries/bad → 404: entry not found'); },
  });
  try {
    const result = await client.callTool({ name: 'get_entry', arguments: { namespace: 'events', id: 'bad' } });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('404'));
  } finally {
    await cleanup();
  }
});

// ── append_entry ──────────────────────────────────────────────────────────────

test('append_entry: passes namespace and payload to client', async () => {
  let capturedNs = '';
  let capturedPayload: Record<string, unknown> | undefined;
  const { client, cleanup } = await setup({
    appendEntry: async (ns, input) => {
      capturedNs = ns;
      capturedPayload = input.payload;
      return { ...ENTRY_1, id: 'e_new', namespace: ns, payload: input.payload, sequence: 3, created_at: '2026-01-03T00:00:00Z' };
    },
  });
  try {
    await client.callTool({
      name: 'append_entry',
      arguments: { namespace: 'payments', payload: { type: 'payment.completed', amount: 100 } },
    });
    assert.equal(capturedNs, 'payments');
    assert.deepEqual(capturedPayload, { type: 'payment.completed', amount: 100 });
  } finally {
    await cleanup();
  }
});

test('append_entry: passes optional metadata to client', async () => {
  let capturedMetadata: Record<string, unknown> | undefined;
  const { client, cleanup } = await setup({
    appendEntry: async (_ns, input) => { capturedMetadata = input.metadata; return { ...ENTRY_1, id: 'e_new', sequence: 3, created_at: '2026-01-03T00:00:00Z' }; },
  });
  try {
    await client.callTool({
      name: 'append_entry',
      arguments: { namespace: 'events', payload: { x: 1 }, metadata: { actor: 'user:u1', correlation_id: 'c42' } },
    });
    assert.deepEqual(capturedMetadata, { actor: 'user:u1', correlation_id: 'c42' });
  } finally {
    await cleanup();
  }
});

test('append_entry: returns created entry as JSON', async () => {
  const { client, cleanup } = await setup({
    appendEntry: async (ns, input) => ({
      ...ENTRY_1,
      id: 'e_new',
      namespace: ns,
      payload: input.payload,
      sequence: 3,
      created_at: '2026-01-03T00:00:00Z',
    }),
  });
  try {
    const result = await client.callTool({
      name: 'append_entry',
      arguments: { namespace: 'events', payload: { type: 'order.placed' } },
    });
    assert.ok(!result.isError);
    const content = result.content as Array<{ type: string; text: string }>;
    const entry = JSON.parse(content[0].text) as LedgerEntry;
    assert.equal(entry.id, 'e_new');
    assert.equal(entry.sequence, 3);
    assert.deepEqual(entry.payload, { type: 'order.placed' });
  } finally {
    await cleanup();
  }
});

test('append_entry: missing namespace → isError', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({
      name: 'append_entry',
      arguments: { payload: { type: 'test.event' } },
    });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('"namespace"'));
  } finally {
    await cleanup();
  }
});

test('append_entry: empty string namespace → isError', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({
      name: 'append_entry',
      arguments: { namespace: '', payload: { type: 'test.event' } },
    });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('"namespace"'));
  } finally {
    await cleanup();
  }
});

test('append_entry: missing payload → isError', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({
      name: 'append_entry',
      arguments: { namespace: 'events' },
    });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('"payload"'));
  } finally {
    await cleanup();
  }
});

test('append_entry: null payload → isError', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({
      name: 'append_entry',
      arguments: { namespace: 'events', payload: null },
    });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('"payload"'));
  } finally {
    await cleanup();
  }
});

// ── Error handling ────────────────────────────────────────────────────────────

test('unknown tool: returns isError=true with message', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'delete_entry', arguments: {} });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('Unknown tool'));
  } finally {
    await cleanup();
  }
});

test('client error: Error instance surfaces as isError text response', async () => {
  const { client, cleanup } = await setup({
    listNamespaces: async () => { throw new Error('ledger API GET /api/ledger/namespaces → 503: service unavailable'); },
  });
  try {
    const result = await client.callTool({ name: 'list_namespaces', arguments: {} });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('503'));
  } finally {
    await cleanup();
  }
});

test('client error: non-Error thrown captured as string', async () => {
  const { client, cleanup } = await setup({
    listEntries: async () => { throw 'network timeout'; },
  });
  try {
    const result = await client.callTool({ name: 'list_entries', arguments: { namespace: 'events' } });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('network timeout'));
  } finally {
    await cleanup();
  }
});

test('append_entry error: 422 from API surfaces in isError response', async () => {
  const { client, cleanup } = await setup({
    appendEntry: async () => { throw new Error('ledger API POST /api/ledger/events/entries → 422: payload too large'); },
  });
  try {
    const result = await client.callTool({
      name: 'append_entry',
      arguments: { namespace: 'events', payload: { x: 'data' } },
    });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('422'));
  } finally {
    await cleanup();
  }
});
