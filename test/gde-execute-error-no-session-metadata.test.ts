/**
 * GDE: Drift guard — ch1tty/execute error path never appends session metadata.
 *
 * When handleExecute returns isError:true, the caller (handleMetaTool) must
 * NOT push a session metadata item onto content. The guard is:
 *
 *   if (!execResult.isError) { ... content.push(metadata) }
 *
 * Without this test, a refactor that removes the isError guard would silently
 * change the error contract: callers expecting exactly one content item on
 * error would receive two, and isError:true would coexist with appended
 * session context — confusing clients that key on isError to skip session
 * parsing.
 *
 * Five tests cover the three error sub-paths (missing arg, bad format,
 * unknown server) all with an active sessionId, asserting:
 *   - content.length === 1 (no metadata item appended)
 *   - isError === true (not cleared by any metadata-append branch)
 *   - content[0].type === 'text' (plain error message, not a JSON metadata blob)
 *
 * Frozen 2026-09-27.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

const DLQ = join(tmpdir(), `ch1tty-gde-drift-${process.pid}-${Date.now()}.jsonl`);

function makeAggregator(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  const configs: ServerConfig[] = [
    { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true },
    { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true },
  ];
  return new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: DLQ,
  });
}

type ContentItem = { type: string; text?: string; [key: string]: unknown };
type ExecResult = { content: ContentItem[]; isError?: boolean };

async function execute(agg: Aggregator, args: Record<string, unknown>): Promise<ExecResult> {
  const result = await agg.callTool('ch1tty/execute', args);
  return result as ExecResult;
}

const SESSION = 'gde-test-session';

describe('ch1tty/execute error path + session: no metadata appended', () => {
  test('GDE-1: error (unknown server) with session — content has exactly 1 item', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, { tool: 'nonexistent/some_tool', sessionId: SESSION });
      assert.equal(r.content.length, 1, 'error with session must not append metadata — content must have exactly 1 item');
    } finally {
      await agg.shutdown();
    }
  });

  test('GDE-2: error (missing tool arg) with session — content has exactly 1 item', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, { sessionId: SESSION });
      assert.equal(r.content.length, 1, 'missing-tool error with session must not append metadata — content must have exactly 1 item');
    } finally {
      await agg.shutdown();
    }
  });

  test('GDE-3: error (invalid tool format, no /) with session — content has exactly 1 item', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, { tool: 'no_slash_tool', sessionId: SESSION });
      assert.equal(r.content.length, 1, 'bad-format error with session must not append metadata — content must have exactly 1 item');
    } finally {
      await agg.shutdown();
    }
  });

  test('GDE-4: error (unknown server) with session — isError is still true', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, { tool: 'ghost/some_tool', sessionId: SESSION });
      assert.equal(r.isError, true, 'error with session must still return isError:true (session handling must not clear isError)');
    } finally {
      await agg.shutdown();
    }
  });

  test('GDE-5: error (unknown server) with session — content[0] is type:text (plain error, not metadata JSON)', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, { tool: 'ghost/some_tool', sessionId: SESSION });
      const item = r.content[0];
      assert.equal(item.type, 'text', 'error content[0] must be type:text (not a metadata JSON blob)');
      // The error item text must NOT look like a session-metadata JSON
      // (which would have latencyMs + sessionContext keys). Verify it does not
      // parse to an object with those keys — if it does the isError guard is broken.
      let parsed: Record<string, unknown> | null = null;
      try { parsed = JSON.parse(item.text ?? ''); } catch { /* not JSON — fine */ }
      if (parsed !== null && typeof parsed === 'object') {
        assert.ok(!('sessionContext' in parsed), 'error content[0] must not be a session metadata blob (sessionContext key must be absent)');
        assert.ok(!('latencyMs' in parsed && 'sessionContext' in parsed), 'error content[0] must not have both latencyMs and sessionContext');
      }
    } finally {
      await agg.shutdown();
    }
  });
});
