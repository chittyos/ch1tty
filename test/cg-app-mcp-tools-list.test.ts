/**
 * CG: Focused-app MCP tools/list E2E via StreamableHTTPClientTransport.
 *
 * For each of the 5 focused apps, spins up the HTTP server in-process, connects
 * via the MCP SDK StreamableHTTPClientTransport, calls tools/list, and asserts
 * the expected tool names are returned. Tests the full MCP dispatch path
 * (HTTP transport → McpSessionManager → server tool registry) for each app.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { createTasksHttpApp } from '../apps/tasks-mcp/src/http-server.ts';
import { createSessionMcpHttpApp } from '../apps/session-coordinator-mcp/src/http-server.ts';
import { createLedgerMcpHttpApp } from '../apps/ledger-mcp/src/http-server.ts';
import { createEvidenceHttpApp } from '../apps/evidence-mcp/src/http-server.ts';
import { createCommsHttpApp } from '../apps/comms-mcp/src/http-server.ts';

// ── Helpers ───────────────────────────────────────────────────────────────────

type AppFactory = (opts: { mcpToken?: string }) => {
  handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void>;
};

async function startApp(factory: AppFactory, token?: string): Promise<{
  baseUrl: string;
  stop: () => Promise<void>;
}> {
  const app = factory({ mcpToken: token });
  const server: Server = createServer((req, res) => { void app.handleRequest(req, res); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    stop: () => new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    ),
  };
}

async function getToolNames(baseUrl: string, token?: string): Promise<string[]> {
  const client = new Client({ name: 'cg-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(
    new URL(`${baseUrl}/mcp`),
    token ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } } : undefined,
  );
  await client.connect(transport);
  try {
    const result = await client.listTools();
    return result.tools.map((t) => t.name).sort();
  } finally {
    await client.close();
  }
}

// ── tasks-mcp ─────────────────────────────────────────────────────────────────

test('tasks-mcp: tools/list returns expected tool names', async () => {
  const { baseUrl, stop } = await startApp(createTasksHttpApp as AppFactory);
  try {
    const names = await getToolNames(baseUrl);
    assert.deepEqual(names, [
      'complete_task',
      'create_task',
      'delete_task',
      'get_task',
      'list_tasks',
      'update_task',
    ]);
  } finally {
    await stop();
  }
});

test('tasks-mcp: tools/list works with bearer token', async () => {
  const token = 'test-cg-tasks';
  const { baseUrl, stop } = await startApp(createTasksHttpApp as AppFactory, token);
  try {
    const names = await getToolNames(baseUrl, token);
    assert.ok(names.length > 0, 'Expected at least one tool');
    assert.ok(names.includes('list_tasks'), 'Expected list_tasks tool');
  } finally {
    await stop();
  }
});

// ── session-coordinator-mcp ───────────────────────────────────────────────────

test('session-coordinator-mcp: tools/list returns expected tool names', async () => {
  const { baseUrl, stop } = await startApp(createSessionMcpHttpApp as AppFactory);
  try {
    const names = await getToolNames(baseUrl);
    assert.deepEqual(names, [
      'append_event',
      'close_session',
      'create_session',
      'get_session',
      'list_events',
      'list_sessions',
      'update_session',
    ]);
  } finally {
    await stop();
  }
});

// ── ledger-mcp ────────────────────────────────────────────────────────────────

test('ledger-mcp: tools/list returns expected tool names', async () => {
  const { baseUrl, stop } = await startApp(createLedgerMcpHttpApp as AppFactory);
  try {
    const names = await getToolNames(baseUrl);
    assert.deepEqual(names, [
      'append_entry',
      'get_entry',
      'list_entries',
      'list_namespaces',
    ]);
  } finally {
    await stop();
  }
});

// ── evidence-mcp ──────────────────────────────────────────────────────────────

test('evidence-mcp: tools/list returns expected tool names', async () => {
  const { baseUrl, stop } = await startApp(createEvidenceHttpApp as AppFactory);
  try {
    const names = await getToolNames(baseUrl);
    assert.deepEqual(names, [
      'get_canonical_uri',
      'get_document',
      'ingest_document',
      'list_documents',
      'search_documents',
    ]);
  } finally {
    await stop();
  }
});

// ── comms-mcp ─────────────────────────────────────────────────────────────────

test('comms-mcp: tools/list returns expected tool names', async () => {
  const { baseUrl, stop } = await startApp(createCommsHttpApp as AppFactory);
  try {
    const names = await getToolNames(baseUrl);
    assert.deepEqual(names, ['comms.recentLog']);
  } finally {
    await stop();
  }
});

test('comms-mcp: tools/list rejects request without token when auth required', async () => {
  const token = 'test-cg-comms';
  const { baseUrl, stop } = await startApp(createCommsHttpApp as AppFactory, token);
  try {
    await assert.rejects(
      () => getToolNames(baseUrl),
      (err: Error) => err.message.includes('401') || err.message.toLowerCase().includes('unauthorized'),
    );
  } finally {
    await stop();
  }
});
