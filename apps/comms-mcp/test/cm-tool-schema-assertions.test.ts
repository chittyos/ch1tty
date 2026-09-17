/**
 * CM: comms-mcp tool layer — schema property assertions for comms.recentLog
 *
 * The existing mcp-tool-layer.test.ts covers tool invocation paths (validation,
 * dispatch interaction, channel degradation, error handling) but does not assert
 * the specific property types, enums, min/max, defaults, pattern, format, or
 * additionalProperties of the comms.recentLog inputSchema.
 *
 * These tests close that gap, matching the schema-assertion depth that
 * evidence-mcp, ledger-mcp, session-coordinator-mcp, and tasks-mcp already have
 * in their respective mcp-tool-layer.test.ts files.
 *
 * Source of truth: apps/comms-mcp/src/server.ts — the `inputSchema` const.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createCommsMcpServer } from '../src/server.ts';
import type { CommsDispatch, OwnerIdentity } from '../src/types.ts';

// ── Minimal fixtures ──────────────────────────────────────────────────────────

const OWNER: OwnerIdentity = {
  identifiers: ['nick@nevershitty.com', '+13125550100'],
  displayName: 'Nick',
  chittyId: null,
};

function stubDispatch(): CommsDispatch {
  return { async call() { return []; } };
}

// ── Test harness ──────────────────────────────────────────────────────────────

type PropertySchema = {
  type?: string;
  description?: string;
  pattern?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  default?: unknown;
  enum?: unknown[];
  items?: { type?: string; enum?: string[] };
  additionalProperties?: boolean;
};

type ToolInputSchema = {
  type?: string;
  additionalProperties?: boolean;
  oneOf?: Array<{ required?: string[] }>;
  properties?: Record<string, PropertySchema>;
};

async function getSchema(): Promise<ToolInputSchema> {
  const server = createCommsMcpServer(stubDispatch(), OWNER);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
  await server.connect(serverTransport);
  await mcpClient.connect(clientTransport);
  try {
    const result = await mcpClient.listTools();
    const tool = result.tools.find((t) => t.name === 'comms.recentLog');
    assert.ok(tool, 'comms.recentLog tool not found');
    return tool.inputSchema as ToolInputSchema;
  } finally {
    await mcpClient.close();
  }
}

// ── Top-level schema ──────────────────────────────────────────────────────────

test('comms.recentLog schema: type is "object"', async () => {
  const schema = await getSchema();
  assert.equal(schema.type, 'object');
});

test('comms.recentLog schema: additionalProperties is false', async () => {
  const schema = await getSchema();
  assert.equal(schema.additionalProperties, false);
});

test('comms.recentLog schema: oneOf has exactly 2 entries', async () => {
  const schema = await getSchema();
  assert.ok(Array.isArray(schema.oneOf), 'oneOf should be an array');
  assert.equal(schema.oneOf!.length, 2);
});

// ── person property ───────────────────────────────────────────────────────────

test('comms.recentLog schema: person property has type "string"', async () => {
  const schema = await getSchema();
  assert.equal(schema.properties?.['person']?.type, 'string');
});

test('comms.recentLog schema: person property has a pattern (ChittyID format)', async () => {
  const schema = await getSchema();
  const pattern = schema.properties?.['person']?.pattern;
  assert.ok(typeof pattern === 'string' && pattern.length > 0, 'person pattern should be a non-empty string');
  assert.ok(pattern.includes('P'), 'person pattern should include P (Person type)');
});

// ── identifier property ───────────────────────────────────────────────────────

test('comms.recentLog schema: identifier property has type "string"', async () => {
  const schema = await getSchema();
  assert.equal(schema.properties?.['identifier']?.type, 'string');
});

// ── channels property ─────────────────────────────────────────────────────────

test('comms.recentLog schema: channels property has type "array"', async () => {
  const schema = await getSchema();
  assert.equal(schema.properties?.['channels']?.type, 'array');
});

test('comms.recentLog schema: channels items have type "string"', async () => {
  const schema = await getSchema();
  assert.equal(schema.properties?.['channels']?.items?.type, 'string');
});

test('comms.recentLog schema: channels items enum contains quo, imessage, email, twilio, voice', async () => {
  const schema = await getSchema();
  const itemEnum = schema.properties?.['channels']?.items?.enum;
  assert.ok(Array.isArray(itemEnum), 'channels items should have an enum');
  assert.ok((itemEnum as string[]).includes('quo'), 'quo should be in enum');
  assert.ok((itemEnum as string[]).includes('imessage'), 'imessage should be in enum');
  assert.ok((itemEnum as string[]).includes('email'), 'email should be in enum');
  assert.ok((itemEnum as string[]).includes('twilio'), 'twilio should be in enum');
  assert.ok((itemEnum as string[]).includes('voice'), 'voice should be in enum');
});

test('comms.recentLog schema: channels has a default value', async () => {
  const schema = await getSchema();
  const def = schema.properties?.['channels']?.default;
  assert.ok(Array.isArray(def), 'channels default should be an array');
  assert.ok((def as string[]).length > 0, 'channels default should be non-empty');
});

// ── days property ─────────────────────────────────────────────────────────────

test('comms.recentLog schema: days property has type "integer"', async () => {
  const schema = await getSchema();
  assert.equal(schema.properties?.['days']?.type, 'integer');
});

test('comms.recentLog schema: days property has minimum 1', async () => {
  const schema = await getSchema();
  assert.equal(schema.properties?.['days']?.minimum, 1);
});

test('comms.recentLog schema: days property has maximum 365', async () => {
  const schema = await getSchema();
  assert.equal(schema.properties?.['days']?.maximum, 365);
});

test('comms.recentLog schema: days property has default 30', async () => {
  const schema = await getSchema();
  assert.equal(schema.properties?.['days']?.default, 30);
});

// ── since property ────────────────────────────────────────────────────────────

test('comms.recentLog schema: since property has type "string"', async () => {
  const schema = await getSchema();
  assert.equal(schema.properties?.['since']?.type, 'string');
});

test('comms.recentLog schema: since property has format "date-time"', async () => {
  const schema = await getSchema();
  assert.equal(schema.properties?.['since']?.format, 'date-time');
});

// ── until property ────────────────────────────────────────────────────────────

test('comms.recentLog schema: until property has type "string"', async () => {
  const schema = await getSchema();
  assert.equal(schema.properties?.['until']?.type, 'string');
});

test('comms.recentLog schema: until property has format "date-time"', async () => {
  const schema = await getSchema();
  assert.equal(schema.properties?.['until']?.format, 'date-time');
});

// ── limit property ────────────────────────────────────────────────────────────

test('comms.recentLog schema: limit property has type "integer"', async () => {
  const schema = await getSchema();
  assert.equal(schema.properties?.['limit']?.type, 'integer');
});

test('comms.recentLog schema: limit property has minimum 1', async () => {
  const schema = await getSchema();
  assert.equal(schema.properties?.['limit']?.minimum, 1);
});

test('comms.recentLog schema: limit property has maximum 1000', async () => {
  const schema = await getSchema();
  assert.equal(schema.properties?.['limit']?.maximum, 1000);
});

test('comms.recentLog schema: limit property has default 100', async () => {
  const schema = await getSchema();
  assert.equal(schema.properties?.['limit']?.default, 100);
});

// ── order property ────────────────────────────────────────────────────────────

test('comms.recentLog schema: order property has type "string"', async () => {
  const schema = await getSchema();
  assert.equal(schema.properties?.['order']?.type, 'string');
});

test('comms.recentLog schema: order property enum is ["desc", "asc"]', async () => {
  const schema = await getSchema();
  assert.deepEqual(schema.properties?.['order']?.enum, ['desc', 'asc']);
});

test('comms.recentLog schema: order property has default "desc"', async () => {
  const schema = await getSchema();
  assert.equal(schema.properties?.['order']?.default, 'desc');
});

// ── includeBody property ──────────────────────────────────────────────────────

test('comms.recentLog schema: includeBody property has type "boolean"', async () => {
  const schema = await getSchema();
  assert.equal(schema.properties?.['includeBody']?.type, 'boolean');
});

test('comms.recentLog schema: includeBody property has default false', async () => {
  const schema = await getSchema();
  assert.equal(schema.properties?.['includeBody']?.default, false);
});
