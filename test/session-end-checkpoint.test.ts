/**
 * onSessionEnd checkpoint tests.
 *
 * onSessionEnd() conditionally persists observations to ContextConsciousness via
 * context_checkpoint (only when toolPatterns.size > 0 AND ecosystemBackend is bound),
 * then records session_end to the ledger, flushes, and deletes the session context.
 *
 * These tests cover the conditional checkpoint gate, the summary sort order, graceful
 * failure handling, and the session-context lifecycle (context deleted after end).
 *
 * All coordinator calls are served in-process — no network required.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionCoordinator } from '../src/coordinator.js';
import type {
  Backend,
  BackendStatus,
  ContentItem,
  PromptEntry,
  ResourceEntry,
  ResourceTemplateEntry,
  ServerConfig,
  ToolCallResult,
  ToolEntry,
} from '../src/types.js';

// ── Stub ecosystem backend ────────────────────────────────────────────────────

type ToolHandler = (args: Record<string, unknown>) => unknown;

class StubEcosystem implements Backend {
  readonly calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  private handlers = new Map<string, ToolHandler>();
  shouldFail = false;

  setHandler(tool: string, handler: ToolHandler): void {
    this.handlers.set(tool, handler);
  }

  async callTool(
    _serverId: string,
    toolName: string,
    args: Record<string, unknown> = {},
  ): Promise<ToolCallResult> {
    this.calls.push({ tool: toolName, args });
    if (this.shouldFail) throw new Error('ContextConsciousness unavailable');
    const h = this.handlers.get(toolName);
    if (!h) return { content: [{ type: 'text', text: 'null' }] };
    const result = await h(args);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  registerServer(_config: ServerConfig): void {}
  isRegistered(_serverId: string): boolean { return true; }
  getStatus(_serverId: string): BackendStatus {
    return { connected: true, toolCount: 0, toolCacheAge: null };
  }
  async listTools(_serverId: string): Promise<ToolEntry[]> { return []; }
  async listResources(_serverId: string): Promise<{
    resources: ResourceEntry[];
    templates: ResourceTemplateEntry[];
  }> { return { resources: [], templates: [] }; }
  async readResource(_serverId: string, _uri: string): Promise<{
    contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }>;
  }> { return { contents: [] }; }
  async listPrompts(_serverId: string): Promise<PromptEntry[]> { return []; }
  async getPrompt(
    _serverId: string,
    _name: string,
  ): Promise<{ description?: string; messages: Array<{ role: 'user' | 'assistant'; content: ContentItem }> }> {
    return { messages: [] };
  }
  async shutdown(): Promise<void> {}
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('onSessionEnd with toolPatterns > 0 calls context_checkpoint', async () => {
  const coord = new SessionCoordinator({}, { enabled: false });
  const stub = new StubEcosystem();
  coord.bindEcosystem(stub, 'chittyos');

  const sessionId = 'sess-end-1';
  await coord.onSessionStart(sessionId, 'stdio');
  coord.onToolCall(sessionId, 'neon/run_sql');
  coord.onToolCall(sessionId, 'neon/run_sql');
  coord.onToolCall(sessionId, 'github/search_code');

  await coord.onSessionEnd(sessionId);

  const cpCalls = stub.calls.filter((c) => c.tool === 'context_checkpoint');
  assert.equal(cpCalls.length, 1, 'context_checkpoint called exactly once');
  assert.equal(cpCalls[0].args.session_id, sessionId, 'session_id in args matches');
  const summary = cpCalls[0].args.summary as string;
  assert.ok(summary.includes('3 tool calls'), `summary includes total count: "${summary}"`);
  assert.ok(summary.includes('neon/run_sql (2x)'), `top tool present in summary: "${summary}"`);
  assert.ok(summary.startsWith('Session ended.'), `summary has expected prefix: "${summary}"`);
});

test('onSessionEnd with toolPatterns === 0 skips context_checkpoint', async () => {
  const coord = new SessionCoordinator({}, { enabled: false });
  const stub = new StubEcosystem();
  coord.bindEcosystem(stub, 'chittyos');

  const sessionId = 'sess-end-2';
  await coord.onSessionStart(sessionId, 'stdio');
  // No tool calls — toolPatterns.size === 0

  await coord.onSessionEnd(sessionId);

  const cpCalls = stub.calls.filter((c) => c.tool === 'context_checkpoint');
  assert.equal(cpCalls.length, 0, 'context_checkpoint NOT called when no tool patterns');
});

test('onSessionEnd without ecosystem backend skips checkpoint', async () => {
  const coord = new SessionCoordinator({}, { enabled: false });
  // No bindEcosystem call

  const sessionId = 'sess-end-3';
  await coord.onSessionStart(sessionId, 'stdio');
  coord.onToolCall(sessionId, 'neon/run_sql');

  await assert.doesNotReject(() => coord.onSessionEnd(sessionId));
  // Context deleted despite no ecosystem backend
  assert.equal(
    coord.getEntityContext(sessionId),
    undefined,
    'entity context undefined after end (no ecosystem)',
  );
});

test('onSessionEnd handles context_checkpoint failure gracefully', async () => {
  const coord = new SessionCoordinator({}, { enabled: false });
  const stub = new StubEcosystem();
  stub.shouldFail = true;
  coord.bindEcosystem(stub, 'chittyos');

  const sessionId = 'sess-end-4';
  await coord.onSessionStart(sessionId, 'stdio');
  coord.onToolCall(sessionId, 'neon/run_sql');

  // Should not throw even though checkpoint throws
  await assert.doesNotReject(() => coord.onSessionEnd(sessionId));
  // Context still deleted after failed checkpoint
  assert.equal(
    coord.getEntityContext(sessionId),
    undefined,
    'context deleted even after checkpoint failure',
  );
});

test('onSessionEnd checkpoint summary sorts patterns by count descending', async () => {
  const coord = new SessionCoordinator({}, { enabled: false });
  const stub = new StubEcosystem();
  coord.bindEcosystem(stub, 'chittyos');

  const sessionId = 'sess-end-5';
  await coord.onSessionStart(sessionId, 'stdio');
  // Register low-count tool first to verify sort by count, not insertion order
  coord.onToolCall(sessionId, 'github/search_code');   // count=1
  coord.onToolCall(sessionId, 'neon/run_sql');          // count=3
  coord.onToolCall(sessionId, 'neon/run_sql');
  coord.onToolCall(sessionId, 'neon/run_sql');

  await coord.onSessionEnd(sessionId);

  const cpCall = stub.calls.find((c) => c.tool === 'context_checkpoint');
  assert.ok(cpCall, 'context_checkpoint was called');
  const summary = cpCall.args.summary as string;
  const neonPos = summary.indexOf('neon/run_sql');
  const githubPos = summary.indexOf('github/search_code');
  assert.ok(neonPos > -1 && githubPos > -1, 'both tools appear in summary');
  assert.ok(neonPos < githubPos, 'neon/run_sql (3x) appears before github/search_code (1x)');
});

test('onSessionEnd for unknown sessionId is a safe no-op', async () => {
  const coord = new SessionCoordinator({}, { enabled: false });
  const stub = new StubEcosystem();
  coord.bindEcosystem(stub, 'chittyos');

  // No prior onSessionStart
  await assert.doesNotReject(() => coord.onSessionEnd('nonexistent-session-xyz'));
  assert.equal(stub.calls.length, 0, 'no ecosystem calls for unknown sessionId');
});

test('onSessionEnd deletes context — getEntityContext and getToolPatterns return empty after end', async () => {
  const coord = new SessionCoordinator({}, { enabled: false });

  const sessionId = 'sess-end-6';
  await coord.onSessionStart(sessionId, 'stdio');
  coord.onToolCall(sessionId, 'tasks/list_tasks');
  coord.onToolCall(sessionId, 'notion/search_pages');

  await coord.onSessionEnd(sessionId);

  assert.equal(coord.getEntityContext(sessionId), undefined, 'entity context undefined after end');
  assert.equal(
    coord.getToolPatterns(sessionId).length,
    0,
    'tool patterns empty for deleted session',
  );
  assert.equal(coord.isStagingComplete(sessionId), false, 'isStagingComplete false for deleted session');
});
