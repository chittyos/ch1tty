/**
 * GDI drift guard: freeze `ch1tty/search` tools[] `recentlyUsed` field —
 * presence semantics and value types.
 *
 * The search result builder (src-stdio/aggregator.ts line ~820–841) attaches a
 * `recentlyUsed` field to each tools[] entry when a session is active and the
 * tool or its server appears in recent session activity.  Its value takes two
 * distinct shapes depending on how precise the match is:
 *
 *   object form  → { callCount: number, lastUsedMs: number }
 *                   when the coordinator has a pattern for this SPECIFIC tool
 *                   (the tool was explicitly called via ch1tty/execute this session)
 *
 *   boolean form → true
 *                   when the SAME SERVER was recently used but NOT this specific
 *                   tool (server-level affinity, tool-level unknown)
 *
 *   absent       → field not present (undefined dropped by JSON.stringify)
 *                   when no session is active, OR when neither the server nor
 *                   the specific tool appears in recent session history
 *
 * No existing test freezes this three-way contract:
 *   - EB (eb-search-response-shape-drift) only checks REQUIRED keys; recentlyUsed
 *     is never listed in TOOL_ENTRY_REQUIRED, so its absence in a fresh-session
 *     run silently passes EB.
 *   - GH (gh-search-entry-value-types-drift-guard) adds value-type checks for the
 *     fixed fields (tool, server, serverName, category, description, inputSchema,
 *     inFocus) but never touches recentlyUsed.
 *   - GCN/GCO (score/inFocus conditional presence) do not cover recentlyUsed.
 *
 * A regression that:
 *   • always sets recentlyUsed (leaking session state to unauthenticated callers)
 *   • renames recentlyUsed.callCount → count or lastUsedMs → lastUsed
 *   • flips the object↔boolean distinction (always an object, or always boolean)
 *   • drops recentlyUsed entirely from session-aware searches
 * would silently pass every prior test.
 *
 * Five tests cover:
 *
 *   GDI-1  No session → recentlyUsed absent from EVERY tools[] entry.
 *           (No sessionId arg, no transport sessionId. recentlyUsed must never
 *            appear when the aggregator has no session context.)
 *
 *   GDI-2  Session active but no prior tool calls → recentlyUsed absent.
 *           (Session is created lazily on first real use; a brand-new sessionId
 *            that has never called execute must not yield recentlyUsed entries —
 *            the coordinator has no pattern for this session yet.)
 *
 *   GDI-3  After calling `neon/list_projects` via execute → that specific tool
 *           entry has recentlyUsed in the OBJECT form { callCount, lastUsedMs }.
 *           (The coordinator records a pattern for the namespaced tool, so the
 *            object branch fires; the field must be an object, not boolean true.)
 *
 *   GDI-4  Same session, different neon tool (neon/run_sql not yet called) →
 *           recentlyUsed is exactly boolean true (server-level affinity only).
 *           (neon server appears in coordinator affinity but neon/run_sql has no
 *            pattern; the boolean branch fires.  A regression returning an object
 *            with callCount:0 or returning false/undefined would fail this test.)
 *
 *   GDI-5  recentlyUsed object form value types: callCount is a finite integer
 *           >= 1; lastUsedMs is a finite non-negative integer.
 *           (typeof checks alone would pass NaN, Infinity, or floats.  This test
 *            adds the isFinite + isInteger + >= 1 / >= 0 invariants.)
 *
 * Source: src-stdio/aggregator.ts handleSearch — results map at lines ~820–841:
 *   recentPattern = coordinator.getToolPattern(sessionId, namespacedName);
 *   recentlyUsedVal = recentPattern
 *     ? { callCount: recentPattern.count, lastUsedMs: recentPattern.lastUsed }
 *     : (recentServerIds.has(serverId) ? true : undefined);
 *   ...(recentlyUsedVal !== undefined ? { recentlyUsed: recentlyUsedVal } : {})
 *
 * Frozen 2026-09-27.
 *
 * CLAUDE.md compliance:
 *   - Public MCP surface unchanged (5 meta-tools: search/execute/status/reload/cast).
 *   - buildCastExplanation metric freeze: not applicable (search path, not cast explain).
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gdi-${Date.now()}-${++_seq}.jsonl`);
}

const BASE_CONFIGS: ServerConfig[] = [
  { id: 'neon',   name: 'Neon DB', type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.tech/mcp',  lazy: true },
  { id: 'stripe', name: 'Stripe',  type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true },
];

function makeAgg(): { agg: Aggregator; backend: FixtureBackend } {
  const backend = new FixtureBackend();
  backend.defineServer('neon',   FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  const agg = new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
  return { agg, backend };
}

/** Parse a ch1tty/search response body and return tools[] entries. */
async function searchTools(
  agg: Aggregator,
  query: string,
  sessionId?: string,
): Promise<Record<string, unknown>[]> {
  const result = await agg.callTool('ch1tty/search', { query, ...(sessionId ? { sessionId } : {}) });
  assert.ok(!result.isError, 'search must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length > 0, 'search must return at least one content item');
  assert.equal(content[0]!.type, 'text', 'search content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.ok(Array.isArray(body.tools), 'search body must have a tools array');
  return body.tools as Record<string, unknown>[];
}

// ── GDI-1: No session → recentlyUsed absent from every entry ─────────────────

test('GDI-1: search without session — recentlyUsed absent from all tools[] entries', async () => {
  const { agg } = makeAgg();
  try {
    const tools = await searchTools(agg, 'project');
    assert.ok(tools.length > 0, 'GDI-1: must have at least one tool entry');
    for (const entry of tools) {
      assert.ok(
        !('recentlyUsed' in entry),
        `GDI-1: recentlyUsed must be absent without session; found on entry "${entry.tool}"`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GDI-2: Session active, no prior calls → recentlyUsed absent ───────────────

test('GDI-2: search with fresh session (no prior execute calls) — recentlyUsed absent', async () => {
  const { agg } = makeAgg();
  try {
    const sid = 'gdi-2-session';
    const tools = await searchTools(agg, 'project', sid);
    assert.ok(tools.length > 0, 'GDI-2: must have at least one tool entry');
    for (const entry of tools) {
      assert.ok(
        !('recentlyUsed' in entry),
        `GDI-2: recentlyUsed must be absent on fresh session with no execute calls; found on "${entry.tool}"`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GDI-3: After calling neon/list_projects → that entry has object form ──────

test('GDI-3: after calling neon/list_projects via execute — neon/list_projects has recentlyUsed object {callCount,lastUsedMs}', async () => {
  const { agg } = makeAgg();
  try {
    const sid = 'gdi-3-session';
    // One real execute call to record the tool pattern in the coordinator.
    const execResult = await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', args: {}, sessionId: sid });
    assert.ok(!execResult.isError, 'GDI-3: execute must succeed');

    const tools = await searchTools(agg, 'project', sid);
    const entry = tools.find((t) => t.tool === 'neon/list_projects');
    assert.ok(entry !== undefined, 'GDI-3: neon/list_projects must appear in search results for query "project"');

    assert.ok('recentlyUsed' in entry, 'GDI-3: recentlyUsed must be present after the tool was executed');
    const ru = entry.recentlyUsed;

    // Must be the OBJECT form — not boolean true, not a primitive.
    assert.equal(typeof ru, 'object', `GDI-3: recentlyUsed must be an object (not boolean true), got ${typeof ru}`);
    assert.notEqual(ru, null, 'GDI-3: recentlyUsed must not be null');
    assert.ok(!Array.isArray(ru), 'GDI-3: recentlyUsed must not be an array');
    assert.notStrictEqual(ru, true, 'GDI-3: recentlyUsed must be {callCount,lastUsedMs} object, not boolean true');

    // The object must have exactly callCount and lastUsedMs (and nothing else).
    const keys = Object.keys(ru as Record<string, unknown>).sort();
    assert.deepEqual(
      keys,
      ['callCount', 'lastUsedMs'],
      `GDI-3: recentlyUsed object must have exactly {callCount, lastUsedMs}; got ${JSON.stringify(keys)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDI-4: Same server, different tool → boolean true (server-level affinity) ─

test('GDI-4: after calling neon/list_projects — neon/run_sql has recentlyUsed === true (server-level affinity, no tool pattern)', async () => {
  const { agg } = makeAgg();
  try {
    const sid = 'gdi-4-session';
    // Call list_projects but NOT run_sql; both are on the neon server.
    await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', args: {}, sessionId: sid });

    const tools = await searchTools(agg, 'sql', sid);
    const runSqlEntry = tools.find((t) => t.tool === 'neon/run_sql');
    assert.ok(runSqlEntry !== undefined, 'GDI-4: neon/run_sql must appear in search results for query "sql"');

    assert.ok('recentlyUsed' in runSqlEntry, 'GDI-4: recentlyUsed must be present — neon server was recently used');

    // Must be EXACTLY boolean true (not an object, not false, not 1).
    assert.strictEqual(
      runSqlEntry.recentlyUsed,
      true,
      `GDI-4: recentlyUsed must be exactly boolean true for a server-level hit (not tool-specific pattern); ` +
        `got ${JSON.stringify(runSqlEntry.recentlyUsed)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDI-5: Object form value types: callCount finite integer >= 1, lastUsedMs >= 0

test('GDI-5: recentlyUsed object form — callCount is a finite integer >= 1; lastUsedMs is a finite non-negative integer', async () => {
  const { agg } = makeAgg();
  try {
    const sid = 'gdi-5-session';
    // Execute the same tool twice to confirm callCount >= 1 (not stuck at 0).
    await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', args: {}, sessionId: sid });
    await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', args: {}, sessionId: sid });

    const tools = await searchTools(agg, 'project', sid);
    const entry = tools.find((t) => t.tool === 'neon/list_projects');
    assert.ok(entry !== undefined, 'GDI-5: neon/list_projects must appear in search results');
    assert.ok('recentlyUsed' in entry, 'GDI-5: recentlyUsed must be present after two execute calls');

    const ru = entry.recentlyUsed as { callCount: unknown; lastUsedMs: unknown };

    // callCount: finite, integer, >= 1
    assert.equal(typeof ru.callCount, 'number', 'GDI-5: callCount must be typeof number');
    assert.ok(Number.isFinite(ru.callCount as number), `GDI-5: callCount must be finite, got ${ru.callCount}`);
    assert.ok(Number.isInteger(ru.callCount as number), `GDI-5: callCount must be an integer, got ${ru.callCount}`);
    assert.ok(
      (ru.callCount as number) >= 1,
      `GDI-5: callCount must be >= 1 after two execute calls, got ${ru.callCount}`,
    );

    // lastUsedMs: finite, integer (epoch ms), >= 0
    assert.equal(typeof ru.lastUsedMs, 'number', 'GDI-5: lastUsedMs must be typeof number');
    assert.ok(Number.isFinite(ru.lastUsedMs as number), `GDI-5: lastUsedMs must be finite, got ${ru.lastUsedMs}`);
    assert.ok(Number.isInteger(ru.lastUsedMs as number), `GDI-5: lastUsedMs must be an integer (epoch ms), got ${ru.lastUsedMs}`);
    assert.ok(
      (ru.lastUsedMs as number) >= 0,
      `GDI-5: lastUsedMs must be >= 0, got ${ru.lastUsedMs}`,
    );
  } finally {
    await agg.shutdown();
  }
});
