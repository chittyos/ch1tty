/**
 * GDZ drift guard: freeze cast:executed alternatives array item exact key set.
 *
 * GV-1 froze the top-level key set of cast:executed (which includes `alternatives`
 * when present), but no test freezes the EXACT key set of each item INSIDE the
 * `alternatives` array. The field is produced at core.ts line 942:
 *
 *   alternatives = scoredTools.slice(1, 4).map(t => ({
 *     tool: t.namespacedName,
 *     score: t.score,
 *     description: t.description,
 *   }))
 *
 * A regression adding e.g. `server`, `category`, `inputSchema`, or `namespacedName`
 * directly into each alternatives item would pass every existing test silently.
 *
 * GDZ freezes:
 *
 *   GDZ-1: cast:executed alternatives items each have EXACTLY {tool, score, description}
 *   GDZ-2: alternatives `tool` is a non-empty string (namespaced as "serverId/name")
 *   GDZ-3: alternatives `score` is a finite non-negative number
 *   GDZ-4: alternatives `description` is a string
 *   GDZ-5: cast:executed with a single-tool registry → no `alternatives` key at top level
 *
 * Frozen 2026-09-29.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only)
 *   - buildCastExplanation metric freeze: not applicable (alternatives, not explain)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;
function makeDlq(): string {
  return join(tmpdir(), `ch1tty-gdz-${Date.now()}-${++_seq}.jsonl`);
}

const NEON_CFG: ServerConfig = {
  id: 'neon',
  name: 'Neon Database',
  type: 'remote',
  access: 'readwrite',
  category: 'code',
  endpoint: 'https://neon.test/mcp',
};

const MULTI_TOOLS: ToolEntry[] = [
  {
    name: 'list_projects',
    description: 'List Neon projects',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'run_sql',
    description: 'Run SQL query on Neon',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  },
  {
    name: 'create_project',
    description: 'Create a new Neon project',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
  },
];

const SINGLE_TOOL: ToolEntry[] = [
  {
    name: 'list_projects',
    description: 'List Neon database projects',
    inputSchema: { type: 'object', properties: {} },
  },
];

function makeBackend(tools: ToolEntry[]): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: tools.length, toolCacheAge: 0 }),
    listTools: async () => tools,
    callTool: async (): Promise<ToolCallResult> => ({
      content: [{ type: 'text', text: 'tool-output' }],
    }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

function makeAgg(tools: ToolEntry[] = MULTI_TOOLS): Aggregator {
  const backend = makeBackend(tools);
  return new Aggregator([NEON_CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: makeDlq(),
  } as Parameters<typeof Aggregator.prototype.callTool>[1]);
}

/** Parse cast body JSON from content[0]. */
function parseCast(result: ToolCallResult): Record<string, unknown> {
  assert.ok(Array.isArray(result.content) && result.content.length > 0, 'result.content must be non-empty');
  const item = result.content[0] as { type: string; text: string };
  assert.equal(item.type, 'text', 'content[0].type must be text');
  return JSON.parse(item.text) as Record<string, unknown>;
}

// ── GDZ-1: alternatives items have EXACTLY {tool, score, description} ─────────

test('GDZ-1: cast:executed alternatives items each have EXACTLY {tool, score, description}', async () => {
  const agg = makeAgg(MULTI_TOOLS);
  const result = await agg.callTool('ch1tty/cast', { intent: 'neon' });
  const cast = parseCast(result);
  assert.equal(cast.cast, 'executed', `expected cast:executed, got ${cast.cast}`);
  const alts = cast.alternatives as Array<Record<string, unknown>> | undefined;
  assert.ok(
    Array.isArray(alts) && alts.length > 0,
    `multi-tool cast:executed must include non-empty alternatives; got keys: ${JSON.stringify(Object.keys(cast))}`,
  );
  for (const alt of alts) {
    const keys = Object.keys(alt).sort();
    assert.deepEqual(
      keys,
      ['description', 'score', 'tool'],
      `Each alternatives item must have EXACTLY {tool, score, description}, got ${JSON.stringify(keys)}`
    );
  }
});

// ── GDZ-2: alternatives `tool` is a non-empty string ─────────────────────────

test('GDZ-2: cast:executed alternatives `tool` is a non-empty string', async () => {
  const agg = makeAgg(MULTI_TOOLS);
  const result = await agg.callTool('ch1tty/cast', { intent: 'neon' });
  const cast = parseCast(result);
  assert.equal(cast.cast, 'executed', `expected cast:executed, got ${cast.cast}`);
  const alts = cast.alternatives as Array<Record<string, unknown>> | undefined;
  assert.ok(
    Array.isArray(alts) && alts.length > 0,
    `multi-tool cast:executed must include non-empty alternatives; got keys: ${JSON.stringify(Object.keys(cast))}`,
  );
  for (const alt of alts) {
    assert.equal(typeof alt.tool, 'string', `alternatives[].tool must be a string, got ${typeof alt.tool}`);
    assert.ok((alt.tool as string).length > 0, 'alternatives[].tool must be non-empty');
  }
});

// ── GDZ-3: alternatives `score` is a finite non-negative number ──────────────

test('GDZ-3: cast:executed alternatives `score` is a finite non-negative number', async () => {
  const agg = makeAgg(MULTI_TOOLS);
  const result = await agg.callTool('ch1tty/cast', { intent: 'neon' });
  const cast = parseCast(result);
  assert.equal(cast.cast, 'executed', `expected cast:executed, got ${cast.cast}`);
  const alts = cast.alternatives as Array<Record<string, unknown>> | undefined;
  assert.ok(
    Array.isArray(alts) && alts.length > 0,
    `multi-tool cast:executed must include non-empty alternatives; got keys: ${JSON.stringify(Object.keys(cast))}`,
  );
  for (const alt of alts) {
    assert.equal(typeof alt.score, 'number', `alternatives[].score must be a number, got ${typeof alt.score}`);
    assert.ok(Number.isFinite(alt.score as number), `alternatives[].score must be finite, got ${alt.score}`);
    assert.ok((alt.score as number) >= 0, `alternatives[].score must be >= 0, got ${alt.score}`);
  }
});

// ── GDZ-4: alternatives `description` is a string ────────────────────────────

test('GDZ-4: cast:executed alternatives `description` is a string', async () => {
  const agg = makeAgg(MULTI_TOOLS);
  const result = await agg.callTool('ch1tty/cast', { intent: 'neon' });
  const cast = parseCast(result);
  assert.equal(cast.cast, 'executed', `expected cast:executed, got ${cast.cast}`);
  const alts = cast.alternatives as Array<Record<string, unknown>> | undefined;
  assert.ok(
    Array.isArray(alts) && alts.length > 0,
    `multi-tool cast:executed must include non-empty alternatives; got keys: ${JSON.stringify(Object.keys(cast))}`,
  );
  for (const alt of alts) {
    assert.equal(typeof alt.description, 'string', `alternatives[].description must be a string, got ${typeof alt.description}`);
  }
});

// ── GDZ-5: single-tool registry → no `alternatives` key in cast:executed ──────

test('GDZ-5: cast:executed with single-tool registry → no `alternatives` key at top level', async () => {
  const agg = makeAgg(SINGLE_TOOL);
  const result = await agg.callTool('ch1tty/cast', { intent: 'neon database' });
  const cast = parseCast(result);
  assert.equal(cast.cast, 'executed', `expected cast:executed, got ${cast.cast}`);
  assert.ok(
    !('alternatives' in cast),
    `cast:executed with only one matching tool must NOT include 'alternatives' key; got keys: ${JSON.stringify(Object.keys(cast))}`
  );
});
