/**
 * GFT drift guard: freeze cast:executed error-path content and isError propagation.
 *
 * Background
 * ----------
 * cast:executed builds its outer response as:
 *   content[0]   = { type: 'text', text: JSON.stringify({cast:'executed', ...}) }
 *   content[1..] = ...result.content   ← backend items spread verbatim
 *   isError      = result.isError       ← hoisted from backend result
 *
 * Source: src/core.ts
 *   line ~968–984: handleCast executed branch
 *
 * GFB froze the SUCCESS path (GFB-4: outer isError undefined; GFB-1/2/3/5: content
 * array passthrough). GFB does NOT cover the ERROR path (backend returns isError: true).
 * entity-context-iserror.ts tests some aspects informally, but without the per-invariant
 * drift-guard pattern that freezes each field independently.
 *
 * Remaining gaps (error path — backend returns isError: true):
 *   (a) outer isError is true (not false, undefined, or absent) — not frozen.
 *   (b) content.length is exactly 2 (metadata + error item) — not frozen for error path.
 *   (c) content[1].text is the backend error text verbatim — not frozen for error path.
 *   (d) content[0] body.cast === 'executed' — not frozen for error path.
 *   (e) content[0] body.resolved is the tool namespacedName string — not frozen for error path.
 *
 * A refactor that replaces the metadata block with an error summary, truncates the
 * content array, or resets isError on non-thrown errors would pass all prior GF tests.
 *
 * GFT closes those gaps:
 *
 *   GFT-1  cast:executed outer isError is true when backend returns isError: true
 *   GFT-2  cast:executed content.length === 2 when backend errors with single item
 *   GFT-3  cast:executed content[1].text equals backend error text exactly (passthrough)
 *   GFT-4  cast:executed content[0] body.cast === 'executed' even when backend errors
 *   GFT-5  cast:executed content[0] body.resolved is the tool namespacedName even when backend errors
 *
 * Frozen 2026-10-02.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (cast:executed passthrough fields)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gft-${Date.now()}-${++dlqSeq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

const INTENT = 'run database migration';

const ERROR_TEXT = 'backend-error: migration service unavailable';

const TOOL_MIGRATE = {
  name: 'run_migration',
  description: 'Run a database migration for neon postgres',
  inputSchema: { type: 'object', properties: {} },
  response: {
    content: [{ type: 'text' as const, text: ERROR_TEXT }],
    isError: true as const,
  },
};

const TOOL_OTHER = {
  name: 'list_migrations',
  description: 'List pending database migration jobs for neon postgres',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text' as const, text: '{"migrations":[]}' }] },
};

const CFG: ServerConfig = {
  id: 'neon',
  name: 'Neon',
  type: 'remote',
  access: 'readwrite',
  category: 'database',
  endpoint: 'https://neon.tech/mcp',
  lazy: true,
};

function makeAgg(suffix: string): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', { tools: [TOOL_MIGRATE, TOOL_OTHER], prompts: [], resources: [] });
  const path = dlq();
  return new Aggregator([CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

async function castExecuted(agg: Aggregator): Promise<{ result: Awaited<ReturnType<Aggregator['callTool']>>; body: Record<string, unknown> }> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT });
  // Parse metadata from content[0] — do NOT assert cast === 'executed' here so each test
  // can independently verify whatever property it's testing.
  const metaItem = result.content[0];
  assert.ok(metaItem && 'text' in metaItem, 'content[0] must have text property');
  const body = JSON.parse((metaItem as { text: string }).text) as Record<string, unknown>;
  return { result, body };
}

// ── GFT-1: outer isError is true when backend errors ─────────────────────────

test('GFT-1: cast:executed outer isError is true when backend returns isError: true', async () => {
  const agg = makeAgg('gft-1');
  try {
    const { result } = await castExecuted(agg);
    assert.equal(
      result.isError,
      true,
      `GFT-1: outer isError must be true when backend errors, got ${JSON.stringify(result.isError)}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFT-2: content.length === 2 (metadata + single error item) ───────────────

test('GFT-2: cast:executed content.length === 2 when backend errors with single item', async () => {
  const agg = makeAgg('gft-2');
  try {
    const { result } = await castExecuted(agg);
    assert.equal(
      result.content.length,
      2,
      `GFT-2: content must have exactly 2 items (metadata + error item) on error path, got ${result.content.length}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFT-3: content[1].text equals backend error text exactly ─────────────────

test('GFT-3: cast:executed content[1].text equals backend error text exactly (passthrough)', async () => {
  const agg = makeAgg('gft-3');
  try {
    const { result } = await castExecuted(agg);
    const item1 = result.content[1];
    assert.ok(item1 && 'text' in item1, 'GFT-3: content[1] must have text property');
    assert.equal(
      (item1 as { text: string }).text,
      ERROR_TEXT,
      `GFT-3: content[1].text must equal backend error text exactly, got ${JSON.stringify((item1 as { text: string }).text)}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFT-4: content[0] body.cast === 'executed' even on error path ─────────────

test('GFT-4: cast:executed content[0] body.cast === \'executed\' even when backend errors', async () => {
  const agg = makeAgg('gft-4');
  try {
    const { body } = await castExecuted(agg);
    assert.equal(
      body['cast'],
      'executed',
      `GFT-4: body.cast must equal 'executed' on error path, got ${JSON.stringify(body['cast'])}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GFT-5: content[0] body.resolved is the tool namespacedName even on error ─

test('GFT-5: cast:executed content[0] body.resolved is the tool namespacedName when backend errors', async () => {
  const agg = makeAgg('gft-5');
  try {
    const { body } = await castExecuted(agg);
    assert.equal(
      typeof body['resolved'],
      'string',
      `GFT-5: body.resolved must be a string on error path, got ${typeof body['resolved']}`,
    );
    assert.equal(
      body['resolved'],
      'neon/run_migration',
      `GFT-5: body.resolved must equal 'neon/run_migration' on error path, got ${JSON.stringify(body['resolved'])}`,
    );
  } finally { await agg.shutdown(); }
});
