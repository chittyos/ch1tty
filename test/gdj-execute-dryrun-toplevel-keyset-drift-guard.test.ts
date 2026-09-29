/**
 * GDJ drift guard: freeze the exact top-level key set of the ch1tty/execute
 * dryRun JSON response.
 *
 * handleMetaTool (src-stdio/aggregator.ts lines 602-611) ADDS latencyMs to
 * the dryRun JSON after handleExecute returns, so the complete key set is:
 *
 *   Without session:  { status, server, tool, args, latencyMs }               — 5 keys
 *   With session:     { status, server, tool, args, latencyMs, sessionContext } — 6 keys
 *
 * Prior art:
 *   EC froze required key NAMES (status/server/tool/args) and sessionContext
 *     presence, but did NOT check exact count or latencyMs presence in dryRun.
 *   GL froze value types of server/tool/latencyMs/sessionContext fields.
 *   GDC froze the non-dryRun execute key sets.
 *   None of the above assert Object.keys.length or that no extra/missing keys exist
 *   for the dryRun path specifically.
 *
 * GDJ closes those gaps:
 *
 *   GDJ-1  No session: Object.keys(dr) has exactly 5 entries
 *   GDJ-2  No session: all of {status, server, tool, args, latencyMs} present
 *   GDJ-3  No session: sessionContext key is ABSENT (session-only field)
 *   GDJ-4  With session: Object.keys(dr) has exactly 6 entries
 *   GDJ-5  With session: the extra 6th key is exactly 'sessionContext'
 *
 * Source:
 *   handleExecute (src-stdio/aggregator.ts lines 919-937): builds
 *     { status, server, tool, args, sessionContext? } — returns early for dryRun.
 *   handleMetaTool (lines 602-611): adds latencyMs to that JSON unconditionally.
 *   handleMetaTool (lines 588-592): lazily creates a coordinator session context
 *     when args.sessionId is provided, ensuring hasSession() returns true.
 *
 * Frozen 2026-09-28.
 *
 * CLAUDE.md compliance:
 *   - Public MCP surface: unchanged (5 meta-tools: search/execute/status/reload/cast)
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

function dlq(): string {
  return join(tmpdir(), `ch1tty-gdj-${Date.now()}-${++_seq}.jsonl`);
}

const BASE_CONFIGS: ServerConfig[] = [
  { id: 'neon',   name: 'Neon DB', type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.tech/mcp',  lazy: true } as ServerConfig,
  { id: 'stripe', name: 'Stripe',  type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true } as ServerConfig,
];

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon',   FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
}

/**
 * Call execute with dryRun:true and return the parsed top-level JSON object.
 * Passes sessionId in args when provided; omits it when undefined.
 */
async function dryRunParsed(
  agg: Aggregator,
  tool: string,
  sessionId?: string,
): Promise<Record<string, unknown>> {
  const callArgs: Record<string, unknown> = { tool, dryRun: true };
  if (sessionId !== undefined) callArgs.sessionId = sessionId;
  const result = await agg.callTool('ch1tty/execute', callArgs);
  assert.ok(!result.isError, `dryRun must not return isError for tool "${tool}"`);
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length === 1,
    `GDJ helper: dryRun must return exactly 1 content item (got ${content?.length ?? 0})`);
  const item = content[0];
  assert.equal(item.type, 'text', 'GDJ helper: dryRun content[0] must be type:text');
  assert.ok(typeof item.text === 'string', 'GDJ helper: dryRun content[0] must have text');
  return JSON.parse(item.text!) as Record<string, unknown>;
}

// ── GDJ-1: No session — exactly 5 top-level keys ─────────────────────────────

test('GDJ-1: dryRun without session has exactly 5 top-level keys', async () => {
  const agg = makeAgg();
  try {
    const dr = await dryRunParsed(agg, 'neon/list_projects');
    const keys = Object.keys(dr);
    assert.equal(keys.length, 5,
      `GDJ-1: dryRun without session must have exactly 5 top-level keys; ` +
      `got ${keys.length}: ${JSON.stringify(keys)}. ` +
      `Expected: ["status","server","tool","args","latencyMs"]. ` +
      `handleMetaTool adds latencyMs unconditionally; handleExecute omits sessionContext when no session.`);
  } finally {
    await agg.shutdown();
  }
});

// ── GDJ-2: No session — all 5 required keys present ──────────────────────────

test('GDJ-2: dryRun without session has all of {status, server, tool, args, latencyMs}', async () => {
  const agg = makeAgg();
  try {
    const dr = await dryRunParsed(agg, 'neon/list_projects');
    const REQUIRED = ['status', 'server', 'tool', 'args', 'latencyMs'] as const;
    for (const key of REQUIRED) {
      assert.ok(Object.prototype.hasOwnProperty.call(dr, key),
        `GDJ-2: dryRun without session must have key "${key}"; keys present: ${JSON.stringify(Object.keys(dr))}. ` +
        `EC checks status/server/tool/args; GDJ-2 adds latencyMs (injected by handleMetaTool lines 602-611).`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GDJ-3: No session — sessionContext is absent ──────────────────────────────

test('GDJ-3: dryRun without session must NOT contain sessionContext key', async () => {
  const agg = makeAgg();
  try {
    const dr = await dryRunParsed(agg, 'neon/list_projects');
    assert.ok(!Object.prototype.hasOwnProperty.call(dr, 'sessionContext'),
      `GDJ-3: dryRun without session must not include sessionContext; ` +
      `sessionContext is only present when args.sessionId is provided. ` +
      `Got keys: ${JSON.stringify(Object.keys(dr))}.`);
  } finally {
    await agg.shutdown();
  }
});

// ── GDJ-4: With session — exactly 6 top-level keys ───────────────────────────

test('GDJ-4: dryRun with session has exactly 6 top-level keys', async () => {
  const agg = makeAgg();
  try {
    const sid = 'gdj-s4';
    const dr = await dryRunParsed(agg, 'neon/list_projects', sid);
    const keys = Object.keys(dr);
    assert.equal(keys.length, 6,
      `GDJ-4: dryRun with session must have exactly 6 top-level keys; ` +
      `got ${keys.length}: ${JSON.stringify(keys)}. ` +
      `Expected: ["status","server","tool","args","sessionContext","latencyMs"] in some order. ` +
      `handleMetaTool lazily creates the session (lines 588-592) then handleExecute adds sessionContext.`);
  } finally {
    await agg.shutdown();
  }
});

// ── GDJ-5: With session — 6th key is sessionContext ──────────────────────────

test('GDJ-5: dryRun with session has sessionContext as the extra key beyond the no-session 5', async () => {
  const agg = makeAgg();
  try {
    const sid = 'gdj-s5';
    const dr = await dryRunParsed(agg, 'neon/list_projects', sid);

    // Confirm all 5 no-session keys are present
    const NO_SESSION_KEYS = ['status', 'server', 'tool', 'args', 'latencyMs'];
    for (const key of NO_SESSION_KEYS) {
      assert.ok(Object.prototype.hasOwnProperty.call(dr, key),
        `GDJ-5: with-session dryRun must still have no-session key "${key}"`);
    }

    // Confirm the extra (6th) key is sessionContext
    assert.ok(Object.prototype.hasOwnProperty.call(dr, 'sessionContext'),
      `GDJ-5: dryRun with session must have sessionContext as the 6th key; ` +
      `keys present: ${JSON.stringify(Object.keys(dr))}. ` +
      `sessionContext is set by handleExecute when hasSession() is true (line 934).`);

    // No other unexpected keys
    const unexpected = Object.keys(dr).filter(
      (k) => !NO_SESSION_KEYS.includes(k) && k !== 'sessionContext',
    );
    assert.equal(unexpected.length, 0,
      `GDJ-5: dryRun with session must have no unexpected extra keys; ` +
      `found: ${JSON.stringify(unexpected)}`);
  } finally {
    await agg.shutdown();
  }
});
