/**
 * GG: entity context injection in no-filter search + backend isError passthrough.
 *
 * Covers two zero-coverage paths in aggregator.ts:
 *
 * 1. No-filter search entity injection (aggregator.ts:440):
 *    When a sessionId is supplied and the coordinator has a staged EntityContext
 *    with a chittyId, the no-filter search summary JSON includes `entity` and
 *    `identityClass` fields. When the entity is absent (no session, unstaged, or
 *    no chittyId), those fields are omitted.
 *
 * 2. Backend isError:true passthrough (aggregator.ts:557):
 *    handleExecute returns the backend result AS-IS. When a backend returns
 *    { isError: true, content: [...] } directly (not via a thrown exception),
 *    the execute response preserves isError:true with the backend's content.
 *    This is distinct from the exception path (already tested in CC).
 *
 * 3. cast executed path with backend isError:true (aggregator.ts:966):
 *    When cast resolves a tool and the backend returns isError:true, the cast
 *    response propagates isError:true to the caller.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ContentItem, PromptEntry, ResourceEntry, ResourceTemplateEntry, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

// ── Minimal static backend ──────────────────────────────────────────────────

type CallHandler = (serverId: string, toolName: string, args: Record<string, unknown>) => ToolCallResult;

function makeBackend(tools: ToolEntry[], handler: CallHandler): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: tools.length, toolCacheAge: 0 }),
    listTools: async () => tools,
    callTool: async (serverId, toolName, args = {}): Promise<ToolCallResult> =>
      handler(serverId, toolName, args),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

const ALPHA_CFG: ServerConfig = {
  id: 'alpha', name: 'Alpha', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://alpha.example.com/mcp',
};

const ALPHA_TOOLS: ToolEntry[] = [
  { name: 'query', description: 'Run a query', serverId: 'alpha', serverName: 'Alpha',
    namespacedName: 'alpha/query', category: 'code', inputSchema: { type: 'object', properties: {} } },
];

/** Inject an EntityContext directly into coordinator internals — avoids full staging. */
function injectEntity(
  agg: Aggregator,
  sessionId: string,
  entity: { chittyId?: string; identityClass?: string } | null,
): void {
  const coord = agg.coordinator as unknown as { contexts: Map<string, { entity?: { chittyId?: string; identityClass?: string; resolvedAt: number }; stagingComplete: boolean; toolPatterns: Map<string, unknown>; serverAffinity: Map<string, unknown> }> };
  const ctx = coord.contexts.get(sessionId);
  if (!ctx) throw new Error(`Session ${sessionId} not found in coordinator contexts`);
  if (entity) {
    ctx.entity = { ...entity, resolvedAt: Date.now() };
  }
  ctx.stagingComplete = true;
}

/** Parse the text content from a tool result. */
function parseText(result: ToolCallResult): unknown {
  const item = result.content[0];
  assert.ok(item, 'content[0] must exist');
  assert.equal(item.type, 'text');
  return JSON.parse((item as ContentItem & { text: string }).text);
}

// ── Tests ──────────────────────────────────────────────────────────────────

test('no-filter search: no sessionId → entity/identityClass absent from JSON', async () => {
  const backend = makeBackend(ALPHA_TOOLS, () => ({ content: [{ type: 'text', text: 'ok' }] }));
  const agg = new Aggregator([ALPHA_CFG], { backendFactory: () => backend, embedEnabled: false });
  try {
    const result = await agg.callTool('ch1tty/search', {});
    const data = parseText(result) as Record<string, unknown>;
    assert.ok(data.hint, 'hint field present');
    assert.ok(data.servers, 'servers field present');
    assert.equal(data.entity, undefined, 'entity absent without sessionId');
    assert.equal(data.identityClass, undefined, 'identityClass absent without sessionId');
  } finally {
    await agg.shutdown();
  }
});

test('no-filter search: sessionId with no entity (unstaged) → entity/identityClass absent', async () => {
  const backend = makeBackend(ALPHA_TOOLS, () => ({ content: [{ type: 'text', text: 'ok' }] }));
  const agg = new Aggregator([ALPHA_CFG], { backendFactory: () => backend, embedEnabled: false });
  try {
    // Create session via onSessionStart but don't inject entity
    const sessionId = 'sess-no-entity';
    await agg.coordinator.onSessionStart(sessionId, 'http');
    // Force stagingComplete without entity so coordinator.getEntityContext returns undefined
    injectEntity(agg, sessionId, null);

    const result = await agg.callTool('ch1tty/search', {}, sessionId);
    const data = parseText(result) as Record<string, unknown>;
    assert.equal(data.entity, undefined, 'entity absent when no entity context');
    assert.equal(data.identityClass, undefined, 'identityClass absent when no entity context');
  } finally {
    await agg.shutdown();
  }
});

test('no-filter search: sessionId with chittyId → entity and identityClass injected', async () => {
  const backend = makeBackend(ALPHA_TOOLS, () => ({ content: [{ type: 'text', text: 'ok' }] }));
  const agg = new Aggregator([ALPHA_CFG], { backendFactory: () => backend, embedEnabled: false });
  try {
    const sessionId = 'sess-with-entity';
    await agg.coordinator.onSessionStart(sessionId, 'http');
    injectEntity(agg, sessionId, { chittyId: 'nick@nevershitty.com', identityClass: 'developer' });

    const result = await agg.callTool('ch1tty/search', {}, sessionId);
    const data = parseText(result) as Record<string, unknown>;
    assert.equal(data.entity, 'nick@nevershitty.com', 'chittyId surfaced as entity field');
    assert.equal(data.identityClass, 'developer', 'identityClass present in JSON');
    assert.ok(data.hint, 'hint still present');
    assert.ok(data.servers, 'servers still present');
  } finally {
    await agg.shutdown();
  }
});

test('no-filter search: entity without chittyId (only identityClass) → both absent from JSON', async () => {
  const backend = makeBackend(ALPHA_TOOLS, () => ({ content: [{ type: 'text', text: 'ok' }] }));
  const agg = new Aggregator([ALPHA_CFG], { backendFactory: () => backend, embedEnabled: false });
  try {
    const sessionId = 'sess-no-chittyid';
    await agg.coordinator.onSessionStart(sessionId, 'http');
    // Entity present but chittyId absent — the conditional on line 440 gates on chittyId
    injectEntity(agg, sessionId, { identityClass: 'developer' });

    const result = await agg.callTool('ch1tty/search', {}, sessionId);
    const data = parseText(result) as Record<string, unknown>;
    assert.equal(data.entity, undefined, 'entity absent when chittyId absent');
    assert.equal(data.identityClass, undefined, 'identityClass absent when chittyId absent');
  } finally {
    await agg.shutdown();
  }
});

test('execute: backend returns isError:true directly → passthrough (not wrapped)', async () => {
  // The backend returns isError:true natively (not via an exception).
  // aggregator.ts:557: `return result;` — the result is returned AS-IS.
  const backend = makeBackend(ALPHA_TOOLS, () => ({
    content: [{ type: 'text', text: 'tool-level failure' }],
    isError: true,
  }));
  const agg = new Aggregator([ALPHA_CFG], { backendFactory: () => backend, embedEnabled: false });
  try {
    const result = await agg.callTool('ch1tty/execute', { tool: 'alpha/query', args: {} });
    assert.equal(result.isError, true, 'isError:true preserved from backend');
    assert.ok(
      result.content.some((c) => 'text' in c && (c as { text: string }).text === 'tool-level failure'),
      'backend content text preserved as-is',
    );
  } finally {
    await agg.shutdown();
  }
});

test('execute: backend returns ok result → isError absent (not injected)', async () => {
  const backend = makeBackend(ALPHA_TOOLS, () => ({
    content: [{ type: 'text', text: 'result data' }],
  }));
  const agg = new Aggregator([ALPHA_CFG], { backendFactory: () => backend, embedEnabled: false });
  try {
    const result = await agg.callTool('ch1tty/execute', { tool: 'alpha/query', args: {} });
    assert.equal(result.isError, undefined, 'isError absent on success');
    assert.ok(
      result.content.some((c) => 'text' in c && (c as { text: string }).text === 'result data'),
      'backend content preserved on success',
    );
  } finally {
    await agg.shutdown();
  }
});

test('cast: backend isError:true propagates through executed cast result', async () => {
  // Verify aggregator.ts:966: `isError: result.isError` — the backend's isError
  // is forwarded through the cast wrapper to the caller.
  const backend = makeBackend(
    [
      { name: 'query_db', description: 'query database data', serverId: 'alpha', serverName: 'Alpha',
        namespacedName: 'alpha/query_db', category: 'code',
        inputSchema: { type: 'object', properties: {} } },
    ],
    () => ({
      content: [{ type: 'text', text: 'backend tool failed' }],
      isError: true,
    }),
  );
  const agg = new Aggregator(
    [{ ...ALPHA_CFG, id: 'alpha', name: 'Alpha' }],
    { backendFactory: () => backend, embedEnabled: false },
  );
  try {
    // confirm:false so the tool actually executes
    const result = await agg.callTool('ch1tty/cast', { intent: 'query database data', confirm: false });
    // The cast result should have isError:true propagated from the backend
    assert.equal(result.isError, true, 'isError:true propagated through cast to caller');
    // The cast metadata text block should still be present (JSON with cast:executed)
    const metaItem = result.content[0];
    assert.ok(metaItem && 'text' in metaItem, 'cast metadata content block present');
    const meta = JSON.parse((metaItem as { text: string }).text);
    assert.equal(meta.cast, 'executed', 'cast result shape is "executed"');
    // Backend content block should also be present
    const hasBackendContent = result.content.some(
      (c) => 'text' in c && (c as { text: string }).text === 'backend tool failed',
    );
    assert.ok(hasBackendContent, 'backend error content forwarded in cast result');
  } finally {
    await agg.shutdown();
  }
});
