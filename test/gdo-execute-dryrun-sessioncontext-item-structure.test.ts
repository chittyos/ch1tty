/**
 * GDO drift guard: freeze ch1tty/execute dryRun+sessionId — sessionContext
 * embedded in the dryRun JSON body (not a second content item).
 *
 * For a REAL execute with sessionId, the response is two content items:
 *   content[0] = raw backend output
 *   content[1] = { latencyMs, sessionContext }        (second item)
 *
 * For execute dryRun+sessionId the schema comment (aggregator line ~401) says:
 *   "When dryRun: true, latencyMs and (if session active) sessionContext are
 *    embedded in the dry_run JSON instead."
 * So dryRun always returns exactly 1 content item, and when sessionId is set
 * sessionContext is a key inside that single JSON body.
 *
 * Prior tests on main as of 2026-09-28:
 *   FH-12: dryRun body key set without sessionId → {args, latencyMs, server, status, tool}
 *          Does NOT test the sessionId case (sessionContext absent from frozen set).
 *   GDH:   dryRun read-only session state (callCount stays 0) — NOT structure.
 *   qq-execute-dryrrun-sessioncontext.test.ts: functional dryRun sessionContext
 *          tests — does NOT freeze content item count or exact JSON key set.
 *
 * GDO freezes:
 *
 *   GDO-1  execute dryRun+sessionId → content has exactly 1 item.
 *          (No second item; sessionContext is embedded in content[0].text JSON.)
 *
 *   GDO-2  content[0].text is valid JSON containing a 'sessionContext' key
 *          when sessionId is set — sessionContext present in dryRun body.
 *
 *   GDO-3  The dryRun JSON key set WITH sessionId is exactly
 *          {args, latencyMs, server, sessionContext, status, tool} — exactly the
 *          FH-12 set plus 'sessionContext', no other extra keys.
 *
 *   GDO-4  sessionContext within the dryRun JSON has exactly {callCount,
 *          recentTools} — 'activeSessionFocus' absent when no focus is active.
 *
 *   GDO-5  sessionContext.recentTools is an Array.
 *
 * Source: src-stdio/aggregator.ts handleExecute dryRun branch (~line 919).
 *
 * Frozen 2026-09-28.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable
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
  return join(tmpdir(), `ch1tty-gdo-${Date.now()}-${++_seq}.jsonl`);
}

const NEON_CFG: ServerConfig = {
  id: 'neon',
  name: 'Neon',
  type: 'remote',
  access: 'readwrite',
  category: 'data',
  endpoint: 'https://neon.tech/mcp',
  lazy: true,
};

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  return new Aggregator([NEON_CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
}

// Frozen key sets (derived from src-stdio/aggregator.ts ~line 919-934)
const DRY_RUN_BODY_WITH_SESSION: readonly string[] = [
  'args', 'latencyMs', 'server', 'sessionContext', 'status', 'tool',
].sort() as string[];

const SESSION_CONTEXT_BASE_KEYS: readonly string[] = [
  'callCount', 'recentTools',
].sort() as string[];

const SESSION = 'gdo-session-001';
const TOOL = 'neon/list_projects';

type ContentItem = { type: string; text?: string };
type CallResult = { content?: ContentItem[]; isError?: boolean };

async function dryRunWithSession(agg: Aggregator): Promise<ContentItem[]> {
  const result = (await agg.callTool('ch1tty/execute', {
    tool: TOOL,
    sessionId: SESSION,
    dryRun: true,
  })) as CallResult;
  assert.ok(Array.isArray(result.content), 'execute must return content array');
  return result.content!;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GDO-1: execute dryRun+sessionId → content has exactly 1 item (sessionContext embedded in body)', async () => {
  const agg = makeAgg();
  const content = await dryRunWithSession(agg);
  assert.equal(
    content.length,
    1,
    `dryRun must return exactly 1 content item (sessionContext embedded in JSON body, not a second item); got ${content.length}`,
  );
});

test('GDO-2: content[0].text contains "sessionContext" key when sessionId is set', async () => {
  const agg = makeAgg();
  const content = await dryRunWithSession(agg);
  assert.ok(content[0]?.text, 'content[0].text must be present');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.ok(
    Object.prototype.hasOwnProperty.call(body, 'sessionContext'),
    `dryRun body must contain "sessionContext" when sessionId is set; keys: ${JSON.stringify(Object.keys(body))}`,
  );
});

test('GDO-3: dryRun+sessionId body key set is exactly {args, latencyMs, server, sessionContext, status, tool}', async () => {
  const agg = makeAgg();
  const content = await dryRunWithSession(agg);
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  const actual = Object.keys(body).sort();
  assert.deepEqual(
    actual,
    [...DRY_RUN_BODY_WITH_SESSION].sort(),
    `dryRun+sessionId body key set mismatch — expected ${JSON.stringify(DRY_RUN_BODY_WITH_SESSION)}; got ${JSON.stringify(actual)}`,
  );
});

test('GDO-4: sessionContext has exactly {callCount, recentTools} — no activeSessionFocus when no focus active', async () => {
  const agg = makeAgg();
  const content = await dryRunWithSession(agg);
  const body = JSON.parse(content[0]!.text!) as { sessionContext: Record<string, unknown> };
  const sc = body['sessionContext'];
  assert.ok(sc && typeof sc === 'object', 'sessionContext must be an object');
  const scKeys = Object.keys(sc).sort();
  assert.deepEqual(
    scKeys,
    [...SESSION_CONTEXT_BASE_KEYS].sort(),
    `sessionContext keys must be exactly ${JSON.stringify(SESSION_CONTEXT_BASE_KEYS)} when no focus active; got ${JSON.stringify(scKeys)}`,
  );
});

test('GDO-5: sessionContext.recentTools is an Array', async () => {
  const agg = makeAgg();
  const content = await dryRunWithSession(agg);
  const body = JSON.parse(content[0]!.text!) as { sessionContext: { recentTools: unknown } };
  const recentTools = body['sessionContext']['recentTools'];
  assert.ok(
    Array.isArray(recentTools),
    `sessionContext.recentTools must be an Array; got ${Object.prototype.toString.call(recentTools)}`,
  );
});
