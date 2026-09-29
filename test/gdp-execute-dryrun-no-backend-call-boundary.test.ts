/**
 * GDP drift guard: freeze `ch1tty/execute` dryRun no-backend-call boundary semantics.
 *
 * The dryRun path in src-stdio/aggregator.ts (line ~919) resolves only to the
 * routing layer: it verifies the server is registered, then returns the resolved
 * {server, tool, args} WITHOUT calling the backend. This means:
 *
 *   1. A known server + nonexistent tool name still returns dry_run (not isError),
 *      because no backend validation of the tool name occurs.
 *   2. The backend receives ZERO calls during dryRun — backend.getCallLog() is
 *      unchanged.
 *   3. Only the nested `args` object is echoed in the body — top-level execute
 *      params (timeout, sessionId, dryRun itself) are NOT included.
 *
 * No existing merged test freezes these boundary semantics. EC/GL/GN always call
 * dryRun with a valid, known tool name. GDH (unmerged) freezes session read-only
 * state; this test freezes the no-backend-call guarantee and args isolation.
 *
 * GDP-1  known server + nonexistent tool name → isError === false
 * GDP-2  known server + nonexistent tool name → body.status === 'dry_run'
 * GDP-3  known server + nonexistent tool name → body.tool echoes the input verbatim
 * GDP-4  dryRun makes ZERO backend calls (FixtureBackend callLog unchanged)
 * GDP-5  dryRun body.args contains ONLY the nested args object — top-level execute
 *         params (timeout, sessionId) are NOT echoed into body
 *
 * Source: src-stdio/aggregator.ts handleExecute() dryRun branch (~line 919).
 *
 * Frozen 2026-09-28.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (execute path, not cast explain)
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

/** Build a fresh Aggregator backed by FixtureBackend for each test. */
function makeAgg(): { agg: Aggregator; backend: FixtureBackend } {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  const dlq = join(tmpdir(), `ch1tty-gdp-${Date.now()}-${++_seq}.jsonl`);
  const agg = new Aggregator(
    [
      { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true } as ServerConfig,
      { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true } as ServerConfig,
    ],
    { backendFactory: () => backend, embedEnabled: false, ledgerDlqPath: dlq },
  );
  return { agg, backend };
}

/** Call execute dryRun and return the parsed body JSON. */
async function dryRun(
  agg: Aggregator,
  tool: string,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/execute', { tool, dryRun: true, ...extra });
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length > 0, 'must return content array');
  assert.equal(content[0].type, 'text', 'content[0] must be type:text');
  return JSON.parse(content[0].text!) as Record<string, unknown>;
}

// ── GDP-1: known server + nonexistent tool → isError === false ────────────────

test('GDP-1: execute dryRun with known server + nonexistent tool name returns isError false', async () => {
  const { agg } = makeAgg();
  try {
    const result = await agg.callTool('ch1tty/execute', {
      tool: 'neon/this_tool_does_not_exist_ever',
      dryRun: true,
    });
    assert.equal(
      (result as { isError?: boolean }).isError,
      false,
      'GDP-1: dryRun with nonexistent tool under known server must return isError:false. ' +
        'The routing layer resolves only to the server; no backend validation of tool name occurs.',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDP-2: known server + nonexistent tool → status === 'dry_run' ─────────────

test('GDP-2: execute dryRun with known server + nonexistent tool name returns status dry_run', async () => {
  const { agg } = makeAgg();
  try {
    const body = await dryRun(agg, 'neon/this_tool_does_not_exist_either');
    assert.equal(
      body.status,
      'dry_run',
      `GDP-2: body.status must equal 'dry_run' even for nonexistent tool; got ${String(body.status)}. ` +
        'dryRun short-circuits after server lookup, never reaches the backend.',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDP-3: known server + nonexistent tool → body.tool echoes verbatim ────────

test('GDP-3: execute dryRun with nonexistent tool name echoes tool name verbatim in body', async () => {
  const { agg } = makeAgg();
  const phantomTool = 'neon/phantom_tool_xyz_99';
  try {
    const body = await dryRun(agg, phantomTool);
    assert.equal(
      body.tool,
      'phantom_tool_xyz_99',
      `GDP-3: body.tool must echo the tool name part (after '/') verbatim; got ${String(body.tool)}. ` +
        'The routing layer does not validate or normalise tool names.',
    );
    assert.equal(
      body.server,
      'neon',
      `GDP-3: body.server must equal 'neon'; got ${String(body.server)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDP-4: dryRun makes ZERO backend calls ────────────────────────────────────

test('GDP-4: execute dryRun makes zero backend calls — FixtureBackend callLog unchanged', async () => {
  const { agg, backend } = makeAgg();
  try {
    const callsBefore = backend.getCallLog().length;
    // Call dryRun twice — once with a valid tool, once with a nonexistent tool
    await dryRun(agg, 'neon/list_projects');
    await dryRun(agg, 'stripe/nonexistent_charge_method');
    const callsAfter = backend.getCallLog().length;
    assert.equal(
      callsAfter,
      callsBefore,
      `GDP-4: dryRun must not touch the backend. callLog grew from ${callsBefore} to ${callsAfter}. ` +
        'The dryRun path exits before backend.callTool() is invoked.',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDP-5: dryRun body.args contains ONLY nested args, not top-level params ──

test('GDP-5: execute dryRun body.args echoes only nested tool args — timeout and sessionId absent', async () => {
  const { agg } = makeAgg();
  const nestedArgs = { projectId: 'proj-123', limit: 5 };
  try {
    const body = await dryRun(agg, 'neon/list_projects', {
      args: nestedArgs,
      timeout: 5000,
      sessionId: 'gdp-5-session',
    });
    assert.deepEqual(
      body.args,
      nestedArgs,
      `GDP-5: body.args must equal the nested args object exactly; got ${JSON.stringify(body.args)}. ` +
        'Top-level execute params (timeout, sessionId, dryRun) must not bleed into the echoed args.',
    );
    assert.ok(
      !('timeout' in (body as Record<string, unknown>)),
      'GDP-5: body must not contain a top-level timeout key (it is a ch1tty/execute param, not a tool arg)',
    );
    assert.ok(
      !('sessionId' in (body as Record<string, unknown>)),
      'GDP-5: body must not contain a top-level sessionId key',
    );
  } finally {
    await agg.shutdown();
  }
});
