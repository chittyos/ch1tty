/**
 * GDC drift guard: freeze the EXACT KEY SETS of ch1tty/execute response JSON bodies.
 *
 * EC (ec-execute-response-shape-drift.test.ts) uses PERMITTED superset checks:
 *
 *   dryRun no-session PERMITTED = ['args', 'latencyMs', 'server', 'status', 'tool']
 *   metadata appended PERMITTED = ['latencyMs', 'sessionContext']
 *
 * Superset checks catch EXTRA keys not in the list but silently allow key
 * REMOVAL and never confirm that `sessionContext` is absent when no session is
 * active (or that it IS present when a session is active in the dryRun path).
 * GL and GN add value-type constraints but also do not do exact key set checks.
 *
 * GDC freezes the EXACT key sets so that both additions AND removals are caught:
 *
 *   GDC-1  dryRun no-session JSON exact keys = {status, server, tool, args, latencyMs}
 *          (sessionContext must be ABSENT — no extra keys beyond these 5)
 *
 *   GDC-2  dryRun with-session JSON exact keys =
 *          {status, server, tool, args, latencyMs, sessionContext}
 *          (no extra keys beyond these 6; sessionContext must be PRESENT)
 *
 *   GDC-3  execute+session appended metadata JSON exact keys = {latencyMs, sessionContext}
 *          (the second content item pushed when a session is active and dryRun is false;
 *          no extra keys — e.g. no stray `status` from the dry_run path)
 *
 *   GDC-4  execute+session (non-dryRun) content: first item is unchanged backend result
 *          and second item is the metadata; no third item is appended
 *
 *   GDC-5  dryRun JSON `status` value is exactly the string 'dry_run' (not null,
 *          undefined, 'dryRun', or any other variant)
 *
 * Source: handleExecute + callTool wrapper, src/aggregator.ts (execute paths).
 * latencyMs is injected by the callTool wrapper (Date.now() - executeStartMs) and
 * appended to the dryRun JSON in-place after handleExecute returns.
 *
 * Frozen 2026-09-27.
 *
 * CLAUDE.md compliance:
 *   - Public MCP surface unchanged (5 meta-tools: search/execute/status/reload/cast).
 *   - buildCastExplanation metric freeze: not applicable (execute, not cast explain).
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig, ToolCallResult } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

let _seq = 0;

/**
 * Returns a fresh FixtureServerDef with its own content arrays.
 * FIXTURE_SERVERS contains shared response objects — callTool returns the same
 * reference, so execResult.content.push() in the aggregator accumulates items
 * across repeated calls within the same process.  Creating fresh objects per
 * Aggregator instance avoids cross-test state pollution.
 */
function freshNeonDef() {
  return {
    tools: FIXTURE_SERVERS.neon.tools.map((t) => ({
      ...t,
      response: t.response === 'error'
        ? ('error' as const)
        : { ...t.response, content: t.response.content.map((c) => ({ ...c })) },
    })),
  };
}

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', freshNeonDef());
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  const dlq = join(tmpdir(), `ch1tty-gdc-${Date.now()}-${++_seq}.jsonl`);
  return new Aggregator(
    [
      { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true } as ServerConfig,
      { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true } as ServerConfig,
    ],
    { backendFactory: () => backend, embedEnabled: false, ledgerDlqPath: dlq },
  );
}

async function callExecute(agg: Aggregator, args: Record<string, unknown>): Promise<ToolCallResult> {
  return agg.callTool('ch1tty/execute', args) as Promise<ToolCallResult>;
}

function parseDryRun(result: ToolCallResult): Record<string, unknown> {
  assert.ok(!result.isError, 'execute must not return isError for dryRun');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'dryRun must have at least 1 content item');
  assert.equal(content[0].type, 'text', 'dryRun content[0] must be type:text');
  return JSON.parse(content[0].text!) as Record<string, unknown>;
}

// ── GDC-1: dryRun no-session — exact key set ──────────────────────────────────

test('GDC-1: execute dryRun no-session JSON exact key set = {status,server,tool,args,latencyMs}', async () => {
  const agg = makeAgg();
  try {
    const result = await callExecute(agg, { tool: 'neon/list_projects', dryRun: true });
    const dr = parseDryRun(result);
    const EXACT = new Set(['status', 'server', 'tool', 'args', 'latencyMs']);
    const actualKeys = new Set(Object.keys(dr));
    const missing = [...EXACT].filter((k) => !actualKeys.has(k));
    const extra = [...actualKeys].filter((k) => !EXACT.has(k));
    assert.deepEqual(
      missing,
      [],
      `GDC-1: dryRun no-session JSON missing required keys: ${missing.join(', ')}`,
    );
    assert.deepEqual(
      extra,
      [],
      `GDC-1: dryRun no-session JSON has unexpected extra keys: ${extra.join(', ')}. ` +
        'sessionContext must be absent when no session is active.',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDC-2: dryRun with-session — exact key set ────────────────────────────────

test('GDC-2: execute dryRun with-session JSON exact key set = {status,server,tool,args,latencyMs,sessionContext}', async () => {
  const agg = makeAgg();
  try {
    const sessionId = `gdc-2-${Date.now()}`;
    // First call to register the session in the coordinator.
    await callExecute(agg, { tool: 'neon/list_projects', sessionId });
    // Second call: dryRun with the same session (now the coordinator has the session).
    const result = await callExecute(agg, { tool: 'neon/list_projects', dryRun: true, sessionId });
    const dr = parseDryRun(result);
    const EXACT = new Set(['status', 'server', 'tool', 'args', 'latencyMs', 'sessionContext']);
    const actualKeys = new Set(Object.keys(dr));
    const missing = [...EXACT].filter((k) => !actualKeys.has(k));
    const extra = [...actualKeys].filter((k) => !EXACT.has(k));
    assert.deepEqual(
      missing,
      [],
      `GDC-2: dryRun with-session JSON missing required keys: ${missing.join(', ')}`,
    );
    assert.deepEqual(
      extra,
      [],
      `GDC-2: dryRun with-session JSON has unexpected extra keys: ${extra.join(', ')}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDC-3: execute+session appended metadata JSON exact key set ───────────────

test('GDC-3: execute+session appended metadata JSON exact key set = {latencyMs,sessionContext}', async () => {
  const agg = makeAgg();
  try {
    const sessionId = `gdc-3-${Date.now()}`;
    const result = await callExecute(agg, { tool: 'neon/list_projects', sessionId });
    assert.ok(!result.isError, 'GDC-3: execute+session must not return isError');
    const content = (result as { content: Array<{ type: string; text?: string }> }).content;
    // The appended metadata item is always the last item; with session it's content[1].
    const meta = JSON.parse(content[content.length - 1].text!) as Record<string, unknown>;
    const EXACT = new Set(['latencyMs', 'sessionContext']);
    const actualKeys = new Set(Object.keys(meta));
    const missing = [...EXACT].filter((k) => !actualKeys.has(k));
    const extra = [...actualKeys].filter((k) => !EXACT.has(k));
    assert.deepEqual(
      missing,
      [],
      `GDC-3: appended metadata JSON missing required keys: ${missing.join(', ')}`,
    );
    assert.deepEqual(
      extra,
      [],
      `GDC-3: appended metadata JSON has unexpected extra keys: ${extra.join(', ')}. ` +
        "No 'status' or other fields from the dryRun path should appear here.",
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDC-4: execute+session content has exactly 2 items (backend + metadata) ───

test('GDC-4: execute+session content has exactly 2 items — backend result + metadata', async () => {
  const agg = makeAgg();
  try {
    const sessionId = `gdc-4-${Date.now()}`;
    const result = await callExecute(agg, { tool: 'neon/list_projects', sessionId });
    assert.ok(!result.isError, 'GDC-4: execute+session must not return isError');
    const content = (result as { content: Array<{ type: string; text?: string }> }).content;
    assert.equal(
      content.length,
      2,
      `GDC-4: execute+session must return exactly 2 content items (backend + metadata); got ${content.length}`,
    );
    // First item is backend result (passthrough); second is appended metadata.
    assert.equal(content[1].type, 'text', 'GDC-4: appended metadata item must be type:text');
    // Confirm the second item is the metadata (has latencyMs) not the backend result.
    const meta = JSON.parse(content[1].text!) as Record<string, unknown>;
    assert.ok('latencyMs' in meta, 'GDC-4: second content item must be the metadata (has latencyMs)');
  } finally {
    await agg.shutdown();
  }
});

// ── GDC-5: dryRun `status` value is exactly 'dry_run' ────────────────────────

test("GDC-5: execute dryRun JSON status value is exactly the string 'dry_run'", async () => {
  const agg = makeAgg();
  try {
    const result = await callExecute(agg, { tool: 'neon/list_projects', dryRun: true });
    const dr = parseDryRun(result);
    assert.strictEqual(
      dr.status,
      'dry_run',
      `GDC-5: dryRun JSON status must be exactly 'dry_run'; got ${JSON.stringify(dr.status)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
