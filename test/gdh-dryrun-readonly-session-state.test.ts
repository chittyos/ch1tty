/**
 * GDH drift guard: freeze the invariant that ch1tty/execute dryRun is READ-ONLY
 * with respect to session state — it reads existing coordinator patterns but does
 * NOT call onToolCall, so callCount and recentTools are unchanged after a dryRun.
 *
 * The execute handler structure makes this explicit:
 *
 *   if (dryRun) {
 *     // read patterns → build dryRunSessionContext → return early
 *     return { content: [{ type: 'text', text: JSON.stringify({ status:'dry_run', ... }) }] };
 *   }
 *   // real path only:
 *   const result = await backend.callTool(...);
 *   if (effectiveSessionId) {
 *     this.sessions.recordToolCall(effectiveSessionId, toolName);
 *     this.coordinator.onToolCall(effectiveSessionId, toolName); // ← ONLY HERE
 *   }
 *
 * The dryRun branch returns before onToolCall is ever reached. A refactor that
 * accidentally moved onToolCall above the dryRun guard, or called it inside the
 * dryRun block, would silently change this contract: previewing a tool would now
 * pollute session history, causing recentTools to contain tools the user never
 * actually ran and inflating callCount beyond the true execution count.
 *
 * Five tests cover:
 *
 *   GDH-1  Fresh session, dryRun → sessionContext.callCount is 0
 *          (dryRun on a session with no prior real calls must report 0, not 1)
 *
 *   GDH-2  Fresh session, dryRun → sessionContext.recentTools is [] (empty)
 *          (dryRun must not insert a phantom entry into recentTools)
 *
 *   GDH-3  One real call then dryRun → callCount in dryRun response is still 1
 *          (the dryRun must not increment the counter that was 1 after the real call)
 *
 *   GDH-4  Two real calls then dryRun → callCount in dryRun response is 2, not 3
 *          (dryRun is observational; real count stays at 2)
 *
 *   GDH-5  dryRun then real call → callCount in real call's metadata is 1
 *          (the prior dryRun must not have pre-incremented the counter; real call
 *           sees callCount=1 because only it contributed)
 *
 * Source: dist/aggregator.js — handleExecute dryRun early-return path (lines ~796–818)
 * sits entirely before the onToolCall invocation (line ~820).
 *
 * Frozen 2026-09-27.
 *
 * CLAUDE.md compliance:
 *   - Public MCP surface unchanged (5 meta-tools: search/execute/status/reload/cast).
 *   - buildCastExplanation metric freeze: not applicable (execute path, not cast explain).
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
  return join(tmpdir(), `ch1tty-gdh-${Date.now()}-${++_seq}.jsonl`);
}

const BASE_CONFIGS: ServerConfig[] = [
  { id: 'neon',   name: 'Neon DB', type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.tech/mcp',  lazy: true },
  { id: 'stripe', name: 'Stripe',  type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true },
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
 * Call execute with dryRun:true and return the parsed dry_run JSON.
 * Asserts the response looks like a dryRun response before returning.
 */
async function dryRun(
  agg: Aggregator,
  tool: string,
  sessionId: string,
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/execute', { tool, sessionId, dryRun: true });
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length === 1,
    `dryRun response must have exactly 1 content item (got ${content?.length ?? 0})`);
  const item = content[0];
  assert.equal(item.type, 'text', 'dryRun content[0] must be type:text');
  assert.ok(typeof item.text === 'string', 'dryRun content[0] must have text');
  const parsed = JSON.parse(item.text!) as Record<string, unknown>;
  assert.equal(parsed.status, 'dry_run', 'dryRun response must have status:"dry_run"');
  return parsed;
}

/**
 * Call execute for real and return the parsed session metadata item (content[last]).
 * Asserts that session metadata was appended.
 */
async function realExecMeta(
  agg: Aggregator,
  tool: string,
  sessionId: string,
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/execute', { tool, sessionId });
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 2,
    `real execute with session must append a metadata item (got ${content?.length ?? 0} items)`);
  const meta = content[content.length - 1];
  assert.equal(meta.type, 'text', 'appended metadata item must be type:text');
  assert.ok(typeof meta.text === 'string', 'appended metadata item must have text');
  return JSON.parse(meta.text!) as Record<string, unknown>;
}

function sc(obj: Record<string, unknown>): Record<string, unknown> {
  return obj.sessionContext as Record<string, unknown>;
}

// ── GDH-1: Fresh session + dryRun → callCount is 0 ───────────────────────────

test('GDH-1: fresh session + dryRun → sessionContext.callCount is 0 (dryRun is read-only)', async () => {
  const agg = makeAgg();
  try {
    const sid = 'gdh-s1';
    const dr = await dryRun(agg, 'neon/list_projects', sid);
    const ctx = sc(dr);
    assert.ok(ctx !== undefined && ctx !== null,
      'GDH-1: dryRun with session must include sessionContext');
    assert.equal(ctx.callCount, 0,
      `GDH-1: callCount must be 0 after a dryRun on a fresh session; got ${ctx.callCount}. ` +
      'dryRun must not call onToolCall — if it did, callCount would be 1 here.');
  } finally {
    await agg.shutdown();
  }
});

// ── GDH-2: Fresh session + dryRun → recentTools is [] ────────────────────────

test('GDH-2: fresh session + dryRun → sessionContext.recentTools is [] (no phantom entry)', async () => {
  const agg = makeAgg();
  try {
    const sid = 'gdh-s2';
    const dr = await dryRun(agg, 'neon/list_projects', sid);
    const ctx = sc(dr);
    assert.ok(Array.isArray(ctx.recentTools),
      'GDH-2: sessionContext.recentTools must be an array in dryRun response');
    assert.equal((ctx.recentTools as unknown[]).length, 0,
      `GDH-2: recentTools must be empty [] after a dryRun on a fresh session; got ${JSON.stringify(ctx.recentTools)}. ` +
      'dryRun must not insert a phantom recentTools entry — if it did, the array would contain "neon/list_projects".');
  } finally {
    await agg.shutdown();
  }
});

// ── GDH-3: One real call then dryRun → dryRun callCount is still 1 ───────────

test('GDH-3: one real call then dryRun → dryRun sessionContext.callCount is still 1 (not 2)', async () => {
  const agg = makeAgg();
  try {
    const sid = 'gdh-s3';
    // Real call: sets callCount to 1
    await realExecMeta(agg, 'neon/list_projects', sid);
    // dryRun: must read callCount=1 without incrementing it
    const dr = await dryRun(agg, 'stripe/list_customers', sid);
    const ctx = sc(dr);
    assert.equal(ctx.callCount, 1,
      `GDH-3: after 1 real call, dryRun must report callCount=1 (not 2); got ${ctx.callCount}. ` +
      'The dryRun must not call onToolCall — doing so would push callCount to 2.');
  } finally {
    await agg.shutdown();
  }
});

// ── GDH-4: Two real calls then dryRun → dryRun callCount is 2, not 3 ─────────

test('GDH-4: two real calls then dryRun → dryRun sessionContext.callCount is 2, not 3', async () => {
  const agg = makeAgg();
  try {
    const sid = 'gdh-s4';
    await realExecMeta(agg, 'neon/list_projects', sid);
    await realExecMeta(agg, 'stripe/list_payments', sid);
    const dr = await dryRun(agg, 'neon/list_projects', sid);
    const ctx = sc(dr);
    assert.equal(ctx.callCount, 2,
      `GDH-4: after 2 real calls, dryRun must report callCount=2 (not 3); got ${ctx.callCount}. ` +
      'Each real call increments once. dryRun must not add a third increment.');
  } finally {
    await agg.shutdown();
  }
});

// ── GDH-5: dryRun then real call → real call callCount is 1 ──────────────────

test('GDH-5: dryRun then real call → real call sessionContext.callCount is 1 (dryRun did not pre-increment)', async () => {
  const agg = makeAgg();
  try {
    const sid = 'gdh-s5';
    // dryRun first: must not increment the counter
    await dryRun(agg, 'neon/list_projects', sid);
    // Real call: must see callCount=1 (only this call contributed)
    const meta = await realExecMeta(agg, 'neon/list_projects', sid);
    const ctx = sc(meta);
    assert.equal(ctx.callCount, 1,
      `GDH-5: after dryRun + 1 real call, real call must report callCount=1 (not 2); got ${ctx.callCount}. ` +
      'The prior dryRun must not have pre-incremented the counter — if it did, callCount would be 2.');
  } finally {
    await agg.shutdown();
  }
});
