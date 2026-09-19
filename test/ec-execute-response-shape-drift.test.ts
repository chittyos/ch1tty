/**
 * EC: Drift guard — ch1tty/execute response shape.
 *
 * ch1tty/execute always returns a ToolCallResult with two top-level fields:
 *
 *   content  — array of content items; always at least 1 item
 *   isError  — boolean (or undefined, treated as false)
 *
 * Content item invariants:
 *   Every item has `type` (string).
 *   Items with type:'text' always have `text` (string).
 *
 * ── Path A: Error responses ───────────────────────────────────────────────
 *   Missing tool arg, invalid format (no '/'), unknown server, backend error.
 *   isError: true; content[0] is {type:'text', text: string}.
 *
 * ── Path B: Dry-run response (dryRun: true) ──────────────────────────────
 *   isError: false; single content item; text is JSON with required keys:
 *     status:'dry_run', server, tool, args
 *   When sessionId active: text JSON also contains sessionContext.
 *
 * ── Path C: Success (no session) ─────────────────────────────────────────
 *   isError falsy; content is unchanged from backend (at least 1 item).
 *
 * ── Path D: Success (with session) ───────────────────────────────────────
 *   isError falsy; content has backend items PLUS an appended metadata item.
 *   The appended item is {type:'text', text: JSON.stringify({latencyMs, sessionContext})}.
 *   sessionContext shape: { recentTools: string[], callCount: number,
 *                           activeSessionFocus?: string }
 *
 * No test previously froze the complete execute result shape end-to-end; field
 * renames or removals (e.g. latencyMs → elapsedMs, sessionContext → context)
 * would have silently broken API clients. This guard catches those.
 *
 * Frozen 2026-09-19.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

const DLQ = join(tmpdir(), `ch1tty-ec-drift-${process.pid}-${Date.now()}.jsonl`);

function makeAggregator(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  backend.defineServer('tasks', FIXTURE_SERVERS.tasks);
  const configs: ServerConfig[] = [
    { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true },
    { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true },
    { id: 'tasks', name: 'Tasks', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://tasks.chitty.cc/mcp', lazy: true },
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

// ── Path A: Structural invariants ─────────────────────────────────────────

describe('ch1tty/execute structural invariants', () => {
  test('result always has content (array) regardless of success or error', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, { tool: 'neon/list_projects' });
      assert.ok(Array.isArray(r.content), 'content must be an array');
      assert.ok(r.content.length > 0, 'content must have at least one item');
    } finally {
      await agg.shutdown();
    }
  });

  test('result always has isError field (boolean or undefined) on error path', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, { tool: '' });
      assert.ok(
        r.isError === true || r.isError === false || r.isError === undefined,
        `isError must be boolean or undefined, got ${r.isError}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('every content item has a type field', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, { tool: 'neon/list_projects' });
      for (const item of r.content) {
        assert.ok('type' in item && typeof item.type === 'string', `content item must have string type, got ${JSON.stringify(item)}`);
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('type:text content items always have a text field', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, { tool: 'neon/list_projects' });
      for (const item of r.content) {
        if (item.type === 'text') {
          assert.ok('text' in item && typeof item.text === 'string', `type:text item must have string text, got ${JSON.stringify(item)}`);
        }
      }
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Path A: Error response shape ──────────────────────────────────────────

describe('ch1tty/execute error response shape', () => {
  test('missing tool arg returns isError:true', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, {});
      assert.equal(r.isError, true, 'missing tool arg must return isError:true');
    } finally {
      await agg.shutdown();
    }
  });

  test('missing tool arg error message is a non-empty string', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, {});
      const item = r.content[0];
      assert.equal(item.type, 'text');
      assert.ok(typeof item.text === 'string' && item.text.length > 0, 'error text must be non-empty');
    } finally {
      await agg.shutdown();
    }
  });

  test('invalid tool name (no /) returns isError:true', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, { tool: 'list_projects' });
      assert.equal(r.isError, true, 'invalid tool name (no /) must return isError:true');
    } finally {
      await agg.shutdown();
    }
  });

  test('unknown server returns isError:true', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, { tool: 'nonexistent/some_tool' });
      assert.equal(r.isError, true, 'unknown server must return isError:true');
    } finally {
      await agg.shutdown();
    }
  });

  test('all error paths return exactly one content item', async () => {
    const agg = makeAggregator();
    try {
      const noTool = await execute(agg, {});
      assert.equal(noTool.content.length, 1, 'missing-tool error must have exactly 1 content item');

      const badFormat = await execute(agg, { tool: 'no_slash' });
      assert.equal(badFormat.content.length, 1, 'invalid-format error must have exactly 1 content item');

      const unknownSrv = await execute(agg, { tool: 'ghost/tool' });
      assert.equal(unknownSrv.content.length, 1, 'unknown-server error must have exactly 1 content item');
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Path B: Dry-run response shape ────────────────────────────────────────

describe('ch1tty/execute dry-run response shape', () => {
  test('dry-run returns isError:false', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, { tool: 'neon/run_sql', args: { project_id: 'p1', sql: 'SELECT 1' }, dryRun: true });
      assert.equal(!!r.isError, false, 'dry-run must not return isError:true');
    } finally {
      await agg.shutdown();
    }
  });

  test('dry-run returns exactly one content item', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, { tool: 'neon/run_sql', args: { project_id: 'p1', sql: 'SELECT 1' }, dryRun: true });
      assert.equal(r.content.length, 1, 'dry-run must return exactly 1 content item');
    } finally {
      await agg.shutdown();
    }
  });

  test('dry-run content[0] is type:text', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, { tool: 'neon/run_sql', dryRun: true });
      assert.equal(r.content[0].type, 'text', 'dry-run content[0] must be type:text');
    } finally {
      await agg.shutdown();
    }
  });

  test('dry-run content[0].text is valid JSON', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, { tool: 'neon/run_sql', dryRun: true });
      const item = r.content[0];
      assert.equal(item.type, 'text');
      assert.doesNotThrow(() => JSON.parse(item.text!), 'dry-run text must be valid JSON');
    } finally {
      await agg.shutdown();
    }
  });

  test('dry-run JSON has required keys: status, server, tool, args, latencyMs', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, { tool: 'neon/run_sql', dryRun: true });
      const dr = JSON.parse(r.content[0].text!) as Record<string, unknown>;
      // latencyMs is always embedded in the dry-run JSON by handleMetaTool.
      const REQUIRED = ['args', 'latencyMs', 'server', 'status', 'tool'];
      const missing = REQUIRED.filter((k) => !(k in dr));
      assert.deepEqual(missing, [], `dry-run JSON missing required keys: ${missing.join(', ')}`);
    } finally {
      await agg.shutdown();
    }
  });

  test('dry-run JSON status is "dry_run"', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, { tool: 'neon/run_sql', dryRun: true });
      const dr = JSON.parse(r.content[0].text!) as Record<string, unknown>;
      assert.equal(dr.status, 'dry_run', 'dry-run status must be "dry_run"');
    } finally {
      await agg.shutdown();
    }
  });

  test('dry-run JSON server and tool are strings', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, { tool: 'neon/run_sql', dryRun: true });
      const dr = JSON.parse(r.content[0].text!) as Record<string, unknown>;
      assert.equal(typeof dr.server, 'string', 'dry-run server must be a string');
      assert.equal(typeof dr.tool, 'string', 'dry-run tool must be a string');
    } finally {
      await agg.shutdown();
    }
  });

  test('dry-run JSON args is an object', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, { tool: 'neon/run_sql', args: { project_id: 'p1', sql: 'SELECT 1' }, dryRun: true });
      const dr = JSON.parse(r.content[0].text!) as Record<string, unknown>;
      assert.ok(
        typeof dr.args === 'object' && dr.args !== null && !Array.isArray(dr.args),
        'dry-run args must be a plain object',
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('dry-run JSON (no session) has no unexpected keys beyond status/server/tool/args/latencyMs', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, { tool: 'neon/run_sql', dryRun: true });
      const dr = JSON.parse(r.content[0].text!) as Record<string, unknown>;
      // latencyMs is always embedded in the dry-run JSON by handleMetaTool.
      const PERMITTED = ['args', 'latencyMs', 'server', 'status', 'tool'];
      const unexpected = Object.keys(dr).filter((k) => !PERMITTED.includes(k));
      assert.deepEqual(
        unexpected,
        [],
        `dry-run JSON (no session) has unexpected keys: ${unexpected.join(', ')}`,
      );
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Path C: Success response shape (no session) ───────────────────────────

describe('ch1tty/execute success response shape (no session)', () => {
  test('success returns isError falsy', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, { tool: 'neon/list_projects' });
      assert.ok(!r.isError, `success must not return isError:true, got ${r.isError}`);
    } finally {
      await agg.shutdown();
    }
  });

  test('success content matches fixture response exactly (complete passthrough, no metadata appended)', async () => {
    const agg = makeAggregator();
    try {
      const fixtureEntry = FIXTURE_SERVERS.neon.tools.find((t) => t.name === 'list_projects')!;
      // Deep-clone BEFORE execute so subsequent session tests' in-place pushes can't affect the reference.
      const expectedContent: ContentItem[] = JSON.parse(
        JSON.stringify((fixtureEntry.response as { content: ContentItem[] }).content),
      );
      const r = await execute(agg, { tool: 'neon/list_projects' });
      assert.deepEqual(r.content, expectedContent, 'no-session content must equal fixture response exactly (unmodified passthrough)');
    } finally {
      await agg.shutdown();
    }
  });

  test('success content items all have type field', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, { tool: 'neon/list_projects' });
      for (const item of r.content) {
        assert.ok('type' in item && typeof item.type === 'string', `success content item must have string type`);
      }
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Path D: Session metadata shape (success with session) ─────────────────

describe('ch1tty/execute session metadata shape (success with session)', () => {
  test('success with session: content prefix matches no-session response exactly, exactly one metadata item appended', async () => {
    const agg = makeAggregator();
    try {
      // Capture no-session content first (before any metadata push mutates the fixture array).
      const rNoSession = await execute(agg, { tool: 'neon/list_projects' });
      const backendContent: ContentItem[] = [...rNoSession.content]; // snapshot before push
      const rSession = await execute(agg, { tool: 'neon/list_projects', sessionId: 'ec-test-session-1' });
      // After push: content = [backend items..., metadata item].
      assert.equal(rSession.content.length, backendContent.length + 1, `session content must be exactly backend length + 1 metadata item`);
      assert.deepEqual(
        rSession.content.slice(0, backendContent.length),
        backendContent,
        'session content prefix must equal backend response exactly (passthrough + append contract)',
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('appended metadata item is type:text', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, { tool: 'neon/list_projects', sessionId: 'ec-test-session-2' });
      const meta = r.content[r.content.length - 1];
      assert.equal(meta.type, 'text', 'appended session metadata item must be type:text');
    } finally {
      await agg.shutdown();
    }
  });

  test('appended metadata item text is valid JSON', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, { tool: 'neon/list_projects', sessionId: 'ec-test-session-3' });
      const meta = r.content[r.content.length - 1];
      assert.doesNotThrow(() => JSON.parse(meta.text!), 'appended metadata text must be valid JSON');
    } finally {
      await agg.shutdown();
    }
  });

  test('appended metadata JSON has latencyMs (non-negative number)', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, { tool: 'neon/list_projects', sessionId: 'ec-test-session-4' });
      const meta = JSON.parse(r.content[r.content.length - 1].text!) as Record<string, unknown>;
      assert.ok(
        'latencyMs' in meta && typeof meta.latencyMs === 'number' && (meta.latencyMs as number) >= 0,
        `metadata must have non-negative numeric latencyMs, got ${meta.latencyMs}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('appended metadata JSON has sessionContext object', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, { tool: 'neon/list_projects', sessionId: 'ec-test-session-5' });
      const meta = JSON.parse(r.content[r.content.length - 1].text!) as Record<string, unknown>;
      assert.ok(
        'sessionContext' in meta && typeof meta.sessionContext === 'object' && meta.sessionContext !== null,
        'metadata must have sessionContext object',
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('sessionContext has recentTools (array) and callCount (number)', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, { tool: 'neon/list_projects', sessionId: 'ec-test-session-6' });
      const meta = JSON.parse(r.content[r.content.length - 1].text!) as Record<string, unknown>;
      const sc = meta.sessionContext as Record<string, unknown>;
      assert.ok(Array.isArray(sc.recentTools), 'sessionContext.recentTools must be an array');
      assert.ok(
        (sc.recentTools as unknown[]).every((tool) => typeof tool === 'string'),
        'sessionContext.recentTools must contain only strings',
      );
      assert.ok(typeof sc.callCount === 'number', 'sessionContext.callCount must be a number');
    } finally {
      await agg.shutdown();
    }
  });

  test('sessionContext has no unexpected keys (recentTools, callCount, optional activeSessionFocus)', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, { tool: 'neon/list_projects', sessionId: 'ec-test-session-7' });
      const meta = JSON.parse(r.content[r.content.length - 1].text!) as Record<string, unknown>;
      const sc = meta.sessionContext as Record<string, unknown>;
      const PERMITTED = ['recentTools', 'callCount', 'activeSessionFocus'];
      const unexpected = Object.keys(sc).filter((k) => !PERMITTED.includes(k));
      assert.deepEqual(
        unexpected,
        [],
        `sessionContext has unexpected keys: ${unexpected.join(', ')}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('metadata JSON has no unexpected top-level keys (latencyMs, sessionContext)', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, { tool: 'neon/list_projects', sessionId: 'ec-test-session-8' });
      const meta = JSON.parse(r.content[r.content.length - 1].text!) as Record<string, unknown>;
      const PERMITTED = ['latencyMs', 'sessionContext'];
      const unexpected = Object.keys(meta).filter((k) => !PERMITTED.includes(k));
      assert.deepEqual(
        unexpected,
        [],
        `metadata JSON has unexpected top-level keys: ${unexpected.join(', ')}`,
      );
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Path B+D: Dry-run with session includes sessionContext ─────────────────

describe('ch1tty/execute dry-run with session', () => {
  test('dry-run with session includes sessionContext in JSON', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, { tool: 'neon/run_sql', dryRun: true, sessionId: 'ec-test-session-dry' });
      const dr = JSON.parse(r.content[0].text!) as Record<string, unknown>;
      assert.ok('sessionContext' in dr, 'dry-run with session must include sessionContext in JSON');
    } finally {
      await agg.shutdown();
    }
  });

  test('dry-run with session sessionContext has recentTools and callCount', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, { tool: 'neon/run_sql', dryRun: true, sessionId: 'ec-test-session-dry2' });
      const dr = JSON.parse(r.content[0].text!) as Record<string, unknown>;
      const sc = dr.sessionContext as Record<string, unknown>;
      assert.ok(Array.isArray(sc.recentTools), 'dry-run sessionContext.recentTools must be an array');
      assert.ok(typeof sc.callCount === 'number', 'dry-run sessionContext.callCount must be a number');
    } finally {
      await agg.shutdown();
    }
  });

  test('dry-run without session has no sessionContext in JSON', async () => {
    const agg = makeAggregator();
    try {
      const r = await execute(agg, { tool: 'neon/run_sql', dryRun: true });
      const dr = JSON.parse(r.content[0].text!) as Record<string, unknown>;
      assert.ok(!('sessionContext' in dr), 'dry-run without session must NOT have sessionContext in JSON');
    } finally {
      await agg.shutdown();
    }
  });
});
