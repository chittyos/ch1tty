/**
 * CCCC batch — 5 targeted branch tests for gaps remaining after BBBB merge
 *
 * Branches closed:
 *
 *   1. coordinator.ts:160  — onToolCall: ctx.entity?.chittyId undefined branch
 *                            (fired when onToolCall is called before staging sets entity)
 *
 *   2. coordinator.ts:275  — stageSession: `if (!ctx) return;` true branch
 *                            (direct cast call with a sessionId that has no entry in contexts)
 *
 *   3. coordinator.ts:313  — stageSession step 2: `!Array.isArray(memories?.results)` false branch
 *                            (ecosystem returns memories.results as a non-array string)
 *
 *   4. coordinator.ts:332  — stageSession step 3: Array.isArray(workstreams.results) true branch
 *                            (ecosystem returns workstreams.results as a valid array → activeWorkstreams set)
 *                            Note: tests 3 + 4 share a single staging run for efficiency.
 *
 *   5. openclaw-facade.ts:125 — ch1tty-session recall path: `b.query ?? 'session context'`
 *                               and `b.scope ?? 'session'` true branches
 *                               (action != 'persist', no query, no scope in request body)
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

import { SessionCoordinator } from '../src/coordinator.js';
import { Aggregator } from '../src/aggregator.js';
import { HttpMcpServer } from '../src/http-server.js';
import type {
  Backend, BackendStatus, ContentItem, PromptEntry,
  ResourceEntry, ResourceTemplateEntry, ServerConfig,
  ToolCallResult, ToolEntry,
} from '../src/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;
function makeDlqPath(): string {
  return join(tmpdir(), `ch1tty-cccc-${process.pid}-${++_seq}.dlq.jsonl`);
}

function makeNullBackend(): Backend {
  return {
    registerServer: (_: ServerConfig): void => {},
    isRegistered: (_: string): boolean => true,
    getStatus: (_: string): BackendStatus => ({ connected: true, toolCount: 0, toolCacheAge: null }),
    listTools: async (_: string): Promise<ToolEntry[]> => [],
    listResources: async (_: string): Promise<{ resources: ResourceEntry[]; templates: ResourceTemplateEntry[] }> => ({
      resources: [], templates: [],
    }),
    readResource: async (_: string, _u: string) => ({ contents: [] }),
    listPrompts: async (_: string): Promise<PromptEntry[]> => [],
    getPrompt: async (_: string, _n: string): Promise<{ description?: string; messages: Array<{ role: 'user' | 'assistant'; content: ContentItem }> }> => ({
      messages: [],
    }),
    callTool: async (_: string, __: string, ___?: Record<string, unknown>): Promise<ToolCallResult> => ({
      content: [],
    }),
    shutdown: async (): Promise<void> => {},
  };
}

interface HttpCtx {
  server: HttpMcpServer;
  aggregator: Aggregator;
  base: string;
  dlq: string;
}

async function startHttp(): Promise<HttpCtx> {
  const dlq = makeDlqPath();
  const aggregator = new Aggregator([], { ledgerDlqPath: dlq, embedEnabled: false });
  const server = new HttpMcpServer(aggregator, { port: 0, bindAddress: '127.0.0.1' });
  await server.start();
  return { server, aggregator, base: `http://127.0.0.1:${server.getPort()}`, dlq };
}

async function stopHttp(ctx: HttpCtx): Promise<void> {
  await ctx.server.stop();
  await ctx.aggregator.shutdown();
  rmSync(ctx.dlq, { force: true });
}

// ── 1. coordinator.ts:160 — ctx.entity?.chittyId undefined branch ─────────────
//
// In onToolCall, line 160 passes `entity_id: ctx.entity?.chittyId` to recordToLedger.
// The `?. ` optional chain has two branches: entity exists vs entity is undefined.
// Calling onToolCall immediately after onSessionStart (before staging sets entity)
// exercises the undefined/false branch.

test('coordinator.onToolCall before entity resolved: ctx.entity?.chittyId undefined branch (line 160)', async () => {
  const dlq = makeDlqPath();
  const coord = new SessionCoordinator({}, { enabled: false }, dlq);

  try {
    const sessionId = 'cccc-coord-160';
    await coord.onSessionStart(sessionId, 'stdio');

    // Staging has not run yet (no ecosystem backend) but even with no-backend staging
    // completes synchronously inside stageSession without setting entity.
    // getEntityContext returns undefined → ctx.entity?.chittyId false branch fires.
    assert.equal(coord.getEntityContext(sessionId), undefined, 'entity must be undefined before staging sets it');

    // onToolCall must not throw even with entity=undefined
    assert.doesNotThrow(() => {
      coord.onToolCall(sessionId, 'testserver/some_tool');
    });

    // Multiple calls still safe
    assert.doesNotThrow(() => {
      coord.onToolCall(sessionId, 'testserver/another_tool');
      coord.onToolCall(sessionId, 'testserver/another_tool'); // second call → pattern update path
    });
  } finally {
    await coord.onSessionEnd('cccc-coord-160');
    await coord.ledger.shutdown();
    rmSync(dlq, { force: true });
  }
});

// ── 2. coordinator.ts:275 — stageSession !ctx early return ────────────────────
//
// stageSession is private. Casting to access it directly lets us call it with a
// sessionId that has no entry in this.contexts → `if (!ctx) return;` fires (line 275).

test('coordinator.stageSession: unknown sessionId → !ctx true branch → early return without error', async () => {
  const dlq = makeDlqPath();
  const coord = new SessionCoordinator({}, { enabled: false }, dlq);

  type WithPrivate = { stageSession: (id: string) => Promise<void> };

  try {
    // No session has been started — contexts Map is empty → ctx is undefined → early return
    await assert.doesNotReject(
      async () => {
        await (coord as unknown as WithPrivate).stageSession('ghost-session-id');
      },
      'stageSession with unknown sessionId must return silently, not throw',
    );
  } finally {
    await coord.ledger.shutdown();
    rmSync(dlq, { force: true });
  }
});

// ── 3+4. coordinator.ts:313 + 332 — memories non-array + workstreams array ─────
//
// During stageSession, step 2 calls chitty_memory_recall('recent session context').
// If the result's `results` field is NOT an array, line 313's false branch fires and
// recentMemories stays unset.  Step 3 calls chitty_memory_recall('active workstreams').
// If the result's `results` field IS an array, line 332's map executes and sets
// activeWorkstreams on the entity.
//
// Using query values to distinguish step 2 vs step 3 calls since the tool name is
// the same but the query argument differs.

test('coordinator.stageSession: memories.results non-array → line 313 false branch; workstreams array → line 332 map fires', async () => {
  const dlq = makeDlqPath();
  const coord = new SessionCoordinator({}, { enabled: false }, dlq);

  const ecosystemBackend: Backend = {
    ...makeNullBackend(),
    callTool: async (_serverId: string, toolName: string, args?: Record<string, unknown>): Promise<ToolCallResult> => {
      if (toolName === 'context_resolve') {
        // Step 1: return a valid chitty_id so ctx.entity gets set, enabling steps 2 + 3
        return { content: [{ type: 'text', text: JSON.stringify({ chitty_id: 'cccc-entity-313-332' }) }] };
      }

      if (toolName === 'chitty_memory_recall') {
        const q = (args as { query?: string } | undefined)?.query ?? '';

        if (q === 'recent session context') {
          // Step 2: return results as a plain string (not array) → Array.isArray(results) false
          // This exercises line 313's false branch; recentMemories must stay undefined
          return { content: [{ type: 'text', text: JSON.stringify({ results: 'not-an-array-string' }) }] };
        }

        if (q === 'active workstreams') {
          // Step 3: return results as a valid array → Array.isArray true → line 332 map fires
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ results: [{ content: 'ws-item-alpha' }, { content: 'ws-item-beta' }] }),
            }],
          };
        }
      }

      return { content: [{ type: 'text', text: 'null' }] };
    },
  };

  try {
    coord.bindEcosystem(ecosystemBackend, 'eco-cccc');

    const sessionId = 'cccc-coord-313-332';
    await coord.onSessionStart(sessionId, 'stdio');

    // Wait for background staging to complete (ecosystem calls are async)
    const deadline = Date.now() + 3000;
    while (!coord.isStagingComplete(sessionId) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }

    assert.ok(coord.isStagingComplete(sessionId), 'staging must complete within 3 s');

    const entity = coord.getEntityContext(sessionId);
    assert.ok(entity !== undefined, 'entity must be set after context_resolve succeeds');
    assert.equal(entity.chittyId, 'cccc-entity-313-332', 'chittyId must be resolved');

    // Line 313 false branch: memories.results was a string, not an array → not set
    assert.equal(
      entity.recentMemories,
      undefined,
      'recentMemories must be undefined when memories.results is not an array (line 313 false branch)',
    );

    // Line 332: workstreams.results was a valid array → map ran → activeWorkstreams set
    assert.deepEqual(
      entity.activeWorkstreams,
      ['ws-item-alpha', 'ws-item-beta'],
      'activeWorkstreams must be populated by map when workstreams.results is an array (line 332)',
    );
  } finally {
    await coord.onSessionEnd('cccc-coord-313-332');
    await coord.ledger.shutdown();
    rmSync(dlq, { force: true });
  }
});

// ── 5. openclaw-facade.ts:125 — recall path without query/scope ───────────────
//
// When skill='ch1tty-session' and action != 'persist' (or no action),
// mapArgs takes the recall branch at line 125:
//   { query: b.query ?? 'session context', scope: b.scope ?? 'session' }
// Sending no query and no scope exercises both `?? 'session context'` and `?? 'session'`
// true branches.

test('openclaw ch1tty-session recall without query/scope: both ?? defaults fire (line 125)', async () => {
  const ctx = await startHttp();
  let capturedArgs: Record<string, unknown> | undefined;

  ctx.aggregator.callTool = async (
    _tool: string,
    args: Record<string, unknown>,
  ): Promise<ToolCallResult> => {
    capturedArgs = args;
    return { content: [{ type: 'text', text: JSON.stringify({ memories: [] }) }] };
  };

  try {
    const res = await fetch(`${ctx.base}/openclaw/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skill: 'ch1tty-session',
        args: {
          // No 'action' field → not 'persist' → recall branch at line 125
          // No 'query' → b.query ?? 'session context' true branch fires
          // No 'scope' → b.scope ?? 'session' true branch fires
        },
      }),
    });

    assert.equal(res.status, 200, 'invoke must return 200');
    assert.ok(capturedArgs !== undefined, 'callTool must be invoked');

    const inner = (capturedArgs!.args as Record<string, unknown>);
    assert.equal(
      inner.query,
      'session context',
      'query must default to "session context" when omitted (b.query ?? branch)',
    );
    assert.equal(
      inner.scope,
      'session',
      'scope must default to "session" when omitted (b.scope ?? branch)',
    );
  } finally {
    await stopHttp(ctx);
  }
});
