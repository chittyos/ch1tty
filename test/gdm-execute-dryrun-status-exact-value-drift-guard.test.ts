/**
 * GDM drift guard: freeze that ch1tty/execute dryRun response `status` field
 * is exactly the string `'dry_run'` — not `'dryRun'`, `'dry-run'`, `null`,
 * `undefined`, or any other value.
 *
 * Source: handleExecute (src/aggregator.ts):
 *
 *   return { content: [{ type: 'text', text: JSON.stringify({
 *     status: 'dry_run', server: serverId, tool: name, args: toolArgs, ...
 *   }) }] };
 *
 * The `status` field is the sole indicator to clients that a response is a
 * dry-run preview and not a real execution result.  A rename to 'dryRun' or
 * a type change to boolean would silently break clients that branch on
 * `body.status === 'dry_run'`.
 *
 * Prior art:
 *   EC: required key names include `status`; not the field value.
 *   GL: `typeof status === 'string'`; not exact string value.
 *   GDC/GDJ: key-set and key-count freeze; not field value.
 *   GDL: server/tool split values; not status value.
 *   None of the above freeze the exact string value of `status`.
 *
 * GDM tests:
 *
 *   GDM-1  `status` is exactly `'dry_run'` for a neon tool (not 'dryRun' or 'dry-run')
 *   GDM-2  `status` is exactly `'dry_run'` for a stripe tool (server-independent)
 *   GDM-3  `status` typeof is `'string'` (not boolean, null, undefined, or number)
 *   GDM-4  `status` is `'dry_run'` when args are passed alongside dryRun:true
 *   GDM-5  `status` is `'dry_run'` with an active sessionId (session enrichment
 *           must not mutate the status field value)
 *
 * Frozen 2026-09-28.
 *
 * CLAUDE.md compliance:
 *   - Public MCP surface: unchanged (5 meta-tools: search/execute/status/reload/cast).
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
  return join(tmpdir(), `ch1tty-gdm-${Date.now()}-${++_seq}.jsonl`);
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
 * Call execute with dryRun:true and return the parsed dryRun JSON object.
 */
async function dryRunBody(
  agg: Aggregator,
  namespacedTool: string,
  extraArgs?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/execute', {
    tool: namespacedTool,
    dryRun: true,
    ...(extraArgs ?? {}),
  });
  assert.ok(!result.isError, `dryRun for "${namespacedTool}" must not return isError`);
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'dryRun must have at least 1 content item');
  const item = content[0];
  assert.equal(item.type, 'text', 'dryRun content[0] must be type:text');
  assert.ok(typeof item.text === 'string', 'dryRun content[0].text must be a string');
  return JSON.parse(item.text!) as Record<string, unknown>;
}

// ── GDM-1: status is exactly 'dry_run' for neon ───────────────────────────────

test('GDM-1: dryRun status is exactly the string "dry_run" for a neon tool', async () => {
  const agg = makeAgg();
  try {
    const body = await dryRunBody(agg, 'neon/list_projects');
    assert.equal(
      body.status,
      'dry_run',
      `GDM-1: dryRun status must be exactly "dry_run"; ` +
      `got ${JSON.stringify(body.status)}. ` +
      'handleExecute hardcodes status: "dry_run" in the returned JSON. ' +
      'A rename to "dryRun" or "dry-run" would break clients that branch on this value.',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDM-2: status is 'dry_run' for stripe too (server-independent) ────────────

test('GDM-2: dryRun status is exactly "dry_run" for a stripe tool (server-independent)', async () => {
  const agg = makeAgg();
  try {
    const body = await dryRunBody(agg, 'stripe/list_payments');
    assert.equal(
      body.status,
      'dry_run',
      `GDM-2: dryRun status must be "dry_run" for stripe tools too; ` +
      `got ${JSON.stringify(body.status)}. ` +
      'status value must be constant across all server backends.',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDM-3: status typeof is 'string' ─────────────────────────────────────────

test('GDM-3: dryRun status is typeof "string" (not boolean, null, undefined, or number)', async () => {
  const agg = makeAgg();
  try {
    const body = await dryRunBody(agg, 'neon/run_sql');
    assert.equal(
      typeof body.status,
      'string',
      `GDM-3: dryRun status must be typeof "string"; ` +
      `got typeof ${typeof body.status} (value: ${JSON.stringify(body.status)}). ` +
      'status must never be a boolean true/false, null, or a number.',
    );
    assert.notEqual(body.status, null,      'GDM-3: status must not be null');
    assert.notEqual(body.status, undefined, 'GDM-3: status must not be undefined');
  } finally {
    await agg.shutdown();
  }
});

// ── GDM-4: status is 'dry_run' when args are passed alongside dryRun:true ─────

test('GDM-4: dryRun status is "dry_run" when tool args are passed alongside dryRun:true', async () => {
  const agg = makeAgg();
  try {
    const body = await dryRunBody(agg, 'neon/run_sql', {
      args: { project_id: 'proj-abc123', sql: 'SELECT 1' },
    });
    assert.equal(
      body.status,
      'dry_run',
      `GDM-4: dryRun status must be "dry_run" even when args are passed; ` +
      `got ${JSON.stringify(body.status)}. ` +
      'passing args must not change status from "dry_run" to something else.',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDM-5: status is 'dry_run' with sessionId active ─────────────────────────

test('GDM-5: dryRun status is "dry_run" with an active sessionId (session enrichment must not mutate status)', async () => {
  const agg = makeAgg();
  try {
    // First call to establish session context, then dryRun with same sessionId.
    const sessionId = 'gdm-session-5';
    await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', sessionId });
    const body = await dryRunBody(agg, 'neon/list_projects', { sessionId });
    assert.equal(
      body.status,
      'dry_run',
      `GDM-5: dryRun status must remain "dry_run" even with an active session; ` +
      `got ${JSON.stringify(body.status)}. ` +
      'session context is embedded as a nested sessionContext key — ' +
      'it must not replace or overwrite the top-level status field.',
    );
  } finally {
    await agg.shutdown();
  }
});
