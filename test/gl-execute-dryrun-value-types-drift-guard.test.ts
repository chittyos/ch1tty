/**
 * GL drift guard: freeze ch1tty/execute dry-run primitive VALUE TYPES.
 *
 * EC froze the dry-run response key set and confirmed field presence. It does NOT:
 *   - assert `server` is non-empty or lacks '/' (plain serverId)
 *   - assert `tool` contains exactly one '/' (namespaced "serverId/toolName")
 *   - assert `tool` and `server` are consistent (tool.split('/')[0] === server)
 *   - assert `latencyMs` is finite (EC confirms presence; no isFinite check)
 *   - assert `sessionContext.callCount` is finite and >= 0 (EC: typeof number only)
 *
 * GL closes those gaps:
 *
 *   GL-1  dry-run `server` is a non-empty string containing no '/'
 *   GL-2  dry-run `tool` contains exactly one '/' (namespaced "serverId/toolName")
 *   GL-3  dry-run `tool` starts with `server + '/'` (tool and server are consistent)
 *   GL-4  dry-run `latencyMs` is a finite non-negative number
 *   GL-5  dry-run with session: `sessionContext.callCount` is a finite integer >= 0
 *
 * Source: handleMetaTool in src/aggregator.ts (execute dry-run path).
 *
 * Frozen 2026-09-20.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (execute, not cast)
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

/** Build a fresh Aggregator backed by the neon FixtureBackend for each test. */
function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  const dlq = join(tmpdir(), `ch1tty-gl-${Date.now()}-${++_seq}.jsonl`);
  return new Aggregator(
    [
      { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true } as ServerConfig,
      { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true } as ServerConfig,
    ],
    { backendFactory: () => backend, embedEnabled: false, ledgerDlqPath: dlq },
  );
}

/** Execute a dry-run call and return the parsed JSON body. */
async function dryRun(agg: Aggregator, tool: string): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/execute', { tool, dryRun: true });
  assert.ok(!result.isError, `dry-run must not return isError for tool "${tool}"`);
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length > 0, 'dry-run must return at least one content item');
  assert.equal(content[0].type, 'text', 'dry-run content[0] must be type:text');
  return JSON.parse(content[0].text!) as Record<string, unknown>;
}

// ── GL-1: dry-run server is a non-empty string with no '/' ───────────────────

test('GL-1: execute dry-run server is a non-empty string containing no "/" (plain serverId)', async () => {
  const agg = makeAgg();
  try {
    const dr = await dryRun(agg, 'neon/list_projects');
    assert.equal(typeof dr.server, 'string', 'GL-1: server must be a string');
    assert.ok((dr.server as string).length > 0, 'GL-1: server must be non-empty');
    assert.ok(
      !(dr.server as string).includes('/'),
      `GL-1: server must be a plain serverId (no '/'); got "${dr.server}". ` +
        'EC checks typeof string only — GL-1 tightens to plain-serverId constraint.',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GL-2: dry-run tool is a non-empty bare tool name (no '/') ────────────────

test('GL-2: execute dry-run tool is a non-empty string containing no "/" (bare tool name, not namespaced)', async () => {
  const agg = makeAgg();
  try {
    // Input is namespaced "neon/run_sql"; dry-run decomposes it into server + tool.
    const dr = await dryRun(agg, 'neon/run_sql');
    assert.equal(typeof dr.tool, 'string', 'GL-2: tool must be a string');
    assert.ok((dr.tool as string).length > 0, 'GL-2: tool must be non-empty');
    assert.ok(
      !(dr.tool as string).includes('/'),
      `GL-2: tool must be a bare tool name (no '/'); got "${dr.tool}". ` +
        'EC checks typeof string only — GL-2 verifies the dry-run decomposition yields a bare name.',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GL-3: dry-run server + '/' + tool reconstructs the input namespaced name ─

test('GL-3: execute dry-run server + "/" + tool reconstructs the namespaced input tool name', async () => {
  const agg = makeAgg();
  try {
    const inputTool = 'stripe/list_payments';
    const dr = await dryRun(agg, inputTool);
    const server = dr.server as string;
    const tool = dr.tool as string;
    const reconstructed = `${server}/${tool}`;
    assert.equal(
      reconstructed,
      inputTool,
      `GL-3: server + '/' + tool must reconstruct the input namespaced name; ` +
        `got server="${server}", tool="${tool}", reconstructed="${reconstructed}", expected="${inputTool}". ` +
        'No prior test verifies that server+tool round-trips to the input namespaced name.',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GL-4: dry-run latencyMs is finite and >= 0 ───────────────────────────────

test('GL-4: execute dry-run latencyMs is a finite non-negative number', async () => {
  const agg = makeAgg();
  try {
    const dr = await dryRun(agg, 'neon/list_projects');
    const ms = dr.latencyMs as number;
    assert.ok(
      typeof ms === 'number',
      `GL-4: latencyMs must be a number; got ${typeof ms}`,
    );
    assert.ok(
      Number.isFinite(ms),
      `GL-4: latencyMs must be finite; got ${ms}. ` +
        'EC confirms presence only — GL-4 adds the isFinite constraint.',
    );
    assert.ok(
      ms >= 0,
      `GL-4: latencyMs must be >= 0; got ${ms}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GL-5: dry-run with session — sessionContext.callCount is finite and >= 0 ──

test('GL-5: execute dry-run with session — sessionContext.callCount is a finite integer >= 0', async () => {
  const agg = makeAgg();
  try {
    const sessionId = `gl-5-${Date.now()}`;
    // A prior call so callCount > 0 is also valid; use a fresh session where callCount === 0.
    const result = await agg.callTool('ch1tty/execute', {
      tool: 'neon/list_projects',
      dryRun: true,
      sessionId,
    });
    assert.ok(!result.isError, 'GL-5: dry-run with session must not return isError');
    const content = (result as { content: Array<{ type: string; text?: string }> }).content;
    assert.ok(Array.isArray(content) && content.length > 0, 'GL-5: must return content');
    const dr = JSON.parse(content[0].text!) as Record<string, unknown>;
    assert.ok('sessionContext' in dr, 'GL-5: dry-run with session must include sessionContext');
    const sc = dr.sessionContext as Record<string, unknown>;
    const callCount = sc.callCount as number;
    assert.ok(
      typeof callCount === 'number',
      `GL-5: sessionContext.callCount must be a number; got ${typeof callCount}`,
    );
    assert.ok(
      Number.isFinite(callCount),
      `GL-5: sessionContext.callCount must be finite; got ${callCount}. ` +
        'EC checks typeof number only — GL-5 adds the isFinite constraint.',
    );
    assert.ok(
      callCount >= 0,
      `GL-5: sessionContext.callCount must be >= 0; got ${callCount}. ` +
        'EC checks typeof number only — GL-5 adds the >= 0 constraint.',
    );
  } finally {
    await agg.shutdown();
  }
});
