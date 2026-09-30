/**
 * GDAA drift guard: freeze cast:plan and cast:no_match response exact key sets.
 *
 * GDX freezes the cast:executed sessionContext sub-object key set.
 * GDY (open PR) freezes cast:executed sessionContext.recentTools item types.
 * GDZ (open PR) freezes cast:executed alternatives item key set.
 * None of the merged drift-guard tests cover the cast:plan path (confirm=true)
 * or the cast:no_match path — both critical response shapes that silently drift.
 *
 * GDAA closes those gaps:
 *
 *   GDAA-1: cast:plan (confirm=true, no focus) top-level key set is EXACTLY
 *           {alternatives, args, cast, hint, intent, latencyMs, resolved,
 *           resolvedBy, resources}
 *   GDAA-2: cast:plan resolved sub-object has EXACTLY {tool, server, category,
 *           description, score, inputSchema}
 *   GDAA-3: cast:plan (confirm=true, focus=code active) top-level key set is
 *           EXACTLY {alternatives, args, cast, chainContinuation, focus, hint,
 *           intent, latencyMs, resolved, resolvedBy, resolvedFromCatalog,
 *           resources, suggestions}
 *   GDAA-4: cast:no_match top-level key set is EXACTLY {cast, hint, intent,
 *           latencyMs, resolvedBy}
 *   GDAA-5: cast:plan alternatives array item has EXACTLY {tool, score, description}
 *
 * Frozen 2026-09-29.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only)
 *   - buildCastExplanation metric freeze: not applicable (cast:plan/no_match, not explain)
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
  return join(tmpdir(), `ch1tty-gdaa-${Date.now()}-${++_seq}.jsonl`);
}

const NEON_CFG: ServerConfig = {
  id: 'neon',
  name: 'Neon Database',
  type: 'remote',
  access: 'readwrite',
  category: 'code',
  endpoint: 'https://neon.test/mcp',
};

const STRIPE_CFG: ServerConfig = {
  id: 'stripe',
  name: 'Stripe',
  type: 'remote',
  access: 'readwrite',
  category: 'finance',
  endpoint: 'https://stripe.test/mcp',
};

const NEON_TOOLS: ToolEntry[] = [
  {
    name: 'list_projects',
    description: 'List Neon projects',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'run_sql',
    description: 'Run SQL query on Neon database',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  },
  {
    name: 'create_project',
    description: 'Create a new Neon project',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
  },
];

const STRIPE_TOOLS: ToolEntry[] = [
  {
    name: 'list_customers',
    description: 'List Stripe customers',
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

function makeAgg(configs = [NEON_CFG]): Aggregator {
  const backendMap = new Map<string, Backend>([
    ['neon', makeBackend(NEON_TOOLS)],
    ['stripe', makeBackend(STRIPE_TOOLS)],
  ]);
  return new Aggregator(configs, {
    backendFactory: (cfg: ServerConfig) => backendMap.get(cfg.id) ?? makeBackend([]),
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

// ── GDAA-1: cast:plan top-level key set (no focus) ────────────────────────────

test('GDAA-1: cast:plan (confirm=true, no focus) top-level key set is EXACTLY {alternatives, args, cast, hint, intent, latencyMs, resolved, resolvedBy, resources}', async () => {
  const agg = makeAgg();
  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', confirm: true });
  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `expected cast:plan, got ${JSON.stringify(cast.cast)}`);
  const keys = Object.keys(cast).sort();
  const expected = ['alternatives', 'args', 'cast', 'hint', 'intent', 'latencyMs', 'resolved', 'resolvedBy', 'resources'].sort();
  assert.deepEqual(keys, expected, `cast:plan top-level keys must be EXACTLY ${JSON.stringify(expected)}, got: ${JSON.stringify(keys)}`);
});

// ── GDAA-2: cast:plan resolved sub-object key set ─────────────────────────────

test('GDAA-2: cast:plan resolved sub-object has EXACTLY {tool, server, category, description, score, inputSchema}', async () => {
  const agg = makeAgg();
  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', confirm: true });
  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `expected cast:plan, got ${JSON.stringify(cast.cast)}`);
  const resolved = cast.resolved as Record<string, unknown> | undefined;
  assert.ok(resolved !== null && typeof resolved === 'object', 'resolved must be an object in cast:plan');
  const resolvedKeys = Object.keys(resolved).sort();
  const expected = ['category', 'description', 'inputSchema', 'score', 'server', 'tool'].sort();
  assert.deepEqual(resolvedKeys, expected, `cast:plan resolved must have EXACTLY {tool, server, category, description, score, inputSchema}, got: ${JSON.stringify(resolvedKeys)}`);
});

// ── GDAA-3: cast:plan top-level key set with active focus ─────────────────────

test('GDAA-3: cast:plan (confirm=true, focus active) top-level key set is EXACTLY {alternatives, args, cast, chainContinuation, focus, hint, intent, latencyMs, resolved, resolvedBy, resolvedFromCatalog, resources, suggestions}', async () => {
  const agg = makeAgg([NEON_CFG, STRIPE_CFG]);
  const result = await agg.callTool('ch1tty/cast', { intent: 'run sql query', confirm: true, focus: 'code' });
  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `expected cast:plan, got ${JSON.stringify(cast.cast)}`);
  const keys = Object.keys(cast).sort();
  const expected = ['alternatives', 'args', 'cast', 'chainContinuation', 'focus', 'hint', 'intent', 'latencyMs', 'resolved', 'resolvedBy', 'resolvedFromCatalog', 'resources', 'suggestions'].sort();
  assert.deepEqual(keys, expected, `cast:plan with focus must have EXACTLY ${JSON.stringify(expected)}, got: ${JSON.stringify(keys)}`);
  assert.equal(cast.focus, 'code', `focus field must equal 'code', got ${JSON.stringify(cast.focus)}`);
});

// ── GDAA-4: cast:no_match top-level key set ───────────────────────────────────

test('GDAA-4: cast:no_match top-level key set is EXACTLY {cast, hint, intent, latencyMs, resolvedBy}', async () => {
  const agg = makeAgg();
  // Use an intent that will not match any tool (gibberish with no keyword overlap)
  const result = await agg.callTool('ch1tty/cast', { intent: 'xyzzy frobble quux wibble' });
  const cast = parseCast(result);
  assert.equal(cast.cast, 'no_match', `expected cast:no_match for nonsense intent, got ${JSON.stringify(cast.cast)}`);
  const keys = Object.keys(cast).sort();
  const expected = ['cast', 'hint', 'intent', 'latencyMs', 'resolvedBy'].sort();
  assert.deepEqual(keys, expected, `cast:no_match top-level keys must be EXACTLY {cast, hint, intent, latencyMs, resolvedBy}, got: ${JSON.stringify(keys)}`);
});

// ── GDAA-5: cast:plan alternatives item key set ───────────────────────────────

test('GDAA-5: cast:plan alternatives array items each have EXACTLY {tool, score, description}', async () => {
  const agg = makeAgg();
  const result = await agg.callTool('ch1tty/cast', { intent: 'neon database', confirm: true });
  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `expected cast:plan, got ${JSON.stringify(cast.cast)}`);
  const alternatives = cast.alternatives as unknown[];
  assert.ok(Array.isArray(alternatives), 'alternatives must be an array');
  if (alternatives.length === 0) {
    // Acceptable: only one tool matched; key-set constraint vacuously holds
    return;
  }
  for (const alt of alternatives) {
    assert.ok(alt !== null && typeof alt === 'object', 'each alternative must be an object');
    const altKeys = Object.keys(alt as Record<string, unknown>).sort();
    const expected = ['description', 'score', 'tool'].sort();
    assert.deepEqual(altKeys, expected, `each cast:plan alternative must have EXACTLY {tool, score, description}, got: ${JSON.stringify(altKeys)}`);
  }
});
