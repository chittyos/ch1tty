/**
 * FH — ch1tty/execute: response envelope and content item shape drift guard.
 *
 * handleExecute constructs its own ToolCallResult for every error path and the
 * dryRun path. Prior tests verify that execute succeeds/fails functionally but
 * none freeze the EXACT key set of the returned envelope or the content item
 * shape. A field addition (e.g. `errorCode`, `metadata`) or type change
 * (`isError: 1` instead of `true`) would pass silently.
 *
 * Covered:
 *   Suite 1 — Top-level execute response key sets (FH-1..4)
 *     1. Success (backend passthrough) → exactly ['content'] — no isError key
 *     2. ch1tty-generated error: missing tool arg → exactly ['content','isError']
 *     3. ch1tty-generated error: unknown server → exactly ['content','isError']
 *     4. Backend-simulated error → exactly ['content','isError']
 *
 *   Suite 2 — Content item shape (FH-5..7)
 *     5. Text item on success → exactly ['text','type']
 *     6. Text item on ch1tty error → exactly ['text','type']
 *     7. ch1tty error always produces exactly 1 content item
 *
 *   Suite 3 — isError value types (FH-8..10)
 *     8. isError on success is absent (not present as a key)
 *     9. isError on ch1tty error is boolean true (not 1, not 'error', not truthy)
 *    10. isError on backend error is boolean true
 *
 *   Suite 4 — dryRun shape (FH-11..12)
 *    11. dryRun top-level → exactly ['content','isError'], isError === false
 *    12. dryRun content text is valid JSON with status:'dry_run', server, tool, args, latencyMs keys
 *
 * Frozen 2026-09-19.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';
import type { FixtureToolDef } from './fixture-backend.js';

// ── Canonical key sets ────────────────────────────────────────────────────────

const SUCCESS_RESULT_KEYS: readonly string[] = ['content'];
const ERROR_RESULT_KEYS: readonly string[] = ['content', 'isError'].sort();
const TEXT_ITEM_KEYS: readonly string[] = ['text', 'type'].sort();
const DRY_RUN_BODY_KEYS: readonly string[] = ['args', 'latencyMs', 'server', 'status', 'tool'].sort();

// ── Test infrastructure ───────────────────────────────────────────────────────

function dlq(): string {
  return join(tmpdir(), `ch1tty-fh-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
}

const SUCCESS_TOOL: FixtureToolDef = {
  name: 'list_items',
  description: 'List items',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text', text: '[]' }] },
};

const FAIL_TOOL: FixtureToolDef = {
  name: 'fail_op',
  description: 'Always errors',
  inputSchema: { type: 'object', properties: {} },
  response: 'error',
};

const ALPHA_CFG: ServerConfig = {
  id: 'alpha', name: 'Alpha', type: 'remote', access: 'readwrite', category: 'code',
  endpoint: 'https://alpha.test/mcp',
};

function makeAggregator(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('alpha', { tools: [SUCCESS_TOOL, FAIL_TOOL] });
  return new Aggregator([ALPHA_CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    suggestionsCatalog: {},
  });
}

// ── Suite 1: Top-level execute response key sets ──────────────────────────────

describe('FH-1..4: top-level execute response key sets', () => {
  test('FH-1: success → exactly ["content"] — no isError key', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/execute', { tool: 'alpha/list_items', args: {} });
      assert.deepEqual(
        Object.keys(result).sort(),
        [...SUCCESS_RESULT_KEYS].sort(),
        'success result must have exactly ["content"]',
      );
    } finally { await agg.shutdown(); }
  });

  test('FH-2: ch1tty error (missing tool arg) → exactly ["content","isError"]', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/execute', {});
      assert.deepEqual(
        Object.keys(result).sort(),
        [...ERROR_RESULT_KEYS].sort(),
        'missing-tool error must have exactly ["content","isError"]',
      );
    } finally { await agg.shutdown(); }
  });

  test('FH-3: ch1tty error (unknown server) → exactly ["content","isError"]', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/execute', { tool: 'nope/do_thing' });
      assert.deepEqual(
        Object.keys(result).sort(),
        [...ERROR_RESULT_KEYS].sort(),
        'unknown-server error must have exactly ["content","isError"]',
      );
    } finally { await agg.shutdown(); }
  });

  test('FH-4: backend error → exactly ["content","isError"]', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/execute', { tool: 'alpha/fail_op', args: {} });
      assert.deepEqual(
        Object.keys(result).sort(),
        [...ERROR_RESULT_KEYS].sort(),
        'backend error must have exactly ["content","isError"]',
      );
    } finally { await agg.shutdown(); }
  });
});

// ── Suite 2: Content item shape ───────────────────────────────────────────────

describe('FH-5..7: content item shape', () => {
  test('FH-5: text item on success → exactly ["text","type"]', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/execute', { tool: 'alpha/list_items', args: {} });
      assert.ok(Array.isArray(result.content), 'content must be array');
      const item = (result.content as unknown[])[0] as Record<string, unknown>;
      assert.deepEqual(
        Object.keys(item).sort(),
        [...TEXT_ITEM_KEYS].sort(),
        'text content item must have exactly ["text","type"]',
      );
    } finally { await agg.shutdown(); }
  });

  test('FH-6: text item on ch1tty error → exactly ["text","type"]', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/execute', { tool: 'nope/do_thing' });
      const item = (result.content as unknown[])[0] as Record<string, unknown>;
      assert.deepEqual(
        Object.keys(item).sort(),
        [...TEXT_ITEM_KEYS].sort(),
        'error content item must have exactly ["text","type"]',
      );
    } finally { await agg.shutdown(); }
  });

  test('FH-7: ch1tty error always produces exactly 1 content item', async () => {
    const agg = makeAggregator();
    try {
      const r1 = await agg.callTool('ch1tty/execute', {});
      const r2 = await agg.callTool('ch1tty/execute', { tool: 'bad-format-no-slash' });
      const r3 = await agg.callTool('ch1tty/execute', { tool: 'nope/tool' });
      assert.equal((r1.content as unknown[]).length, 1, 'missing-tool: exactly 1 content item');
      assert.equal((r2.content as unknown[]).length, 1, 'bad-format: exactly 1 content item');
      assert.equal((r3.content as unknown[]).length, 1, 'unknown-server: exactly 1 content item');
    } finally { await agg.shutdown(); }
  });
});

// ── Suite 3: isError value types ─────────────────────────────────────────────

describe('FH-8..10: isError value types', () => {
  test('FH-8: isError on success is absent (not present as a key)', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/execute', { tool: 'alpha/list_items', args: {} });
      assert.equal(
        Object.prototype.hasOwnProperty.call(result, 'isError'),
        false,
        'success result must NOT have isError as own property',
      );
    } finally { await agg.shutdown(); }
  });

  test('FH-9: isError on ch1tty error is boolean true', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/execute', { tool: 'nope/tool' });
      assert.equal(typeof result.isError, 'boolean', 'isError must be boolean');
      assert.equal(result.isError, true, 'isError must be true');
    } finally { await agg.shutdown(); }
  });

  test('FH-10: isError on backend error is boolean true', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/execute', { tool: 'alpha/fail_op', args: {} });
      assert.equal(typeof result.isError, 'boolean', 'isError must be boolean');
      assert.equal(result.isError, true, 'isError must be true');
    } finally { await agg.shutdown(); }
  });
});

// ── Suite 4: dryRun shape ─────────────────────────────────────────────────────

describe('FH-11..12: dryRun response shape', () => {
  test('FH-11: dryRun top-level → ["content","isError"], isError === false', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/execute', { tool: 'alpha/list_items', args: {}, dryRun: true });
      assert.deepEqual(
        Object.keys(result).sort(),
        [...ERROR_RESULT_KEYS].sort(),
        'dryRun result must have exactly ["content","isError"]',
      );
      assert.equal(result.isError, false, 'dryRun isError must be exactly false');
    } finally { await agg.shutdown(); }
  });

  test('FH-12: dryRun content text is valid JSON with status/server/tool/args keys', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/execute', { tool: 'alpha/list_items', args: { n: 5 }, dryRun: true });
      const item = (result.content as Array<{ type: string; text: string }>)[0];
      assert.equal(item.type, 'text', 'dryRun content item type must be text');
      const body = JSON.parse(item.text) as Record<string, unknown>;
      assert.deepEqual(
        Object.keys(body).sort(),
        [...DRY_RUN_BODY_KEYS].sort(),
        'dryRun body must have exactly ["args","latencyMs","server","status","tool"]',
      );
      assert.equal(body.status, 'dry_run', 'dryRun status must be "dry_run"');
      assert.equal(body.server, 'alpha', 'dryRun server must be "alpha"');
      assert.equal(body.tool, 'list_items', 'dryRun tool must be "list_items"');
    } finally { await agg.shutdown(); }
  });
});
