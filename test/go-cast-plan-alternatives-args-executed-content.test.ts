/**
 * GO drift guard: freeze cast:plan alternatives[] item VALUE TYPES, cast:plan
 * `args` object type, and cast:executed content item count.
 *
 * EA froze:
 *   - alternatives[] is an array (presence check)
 *   - alternatives[] items have keys `tool`, `score`, `description`
 *   - alternatives[].tool is typeof string
 *   - alternatives[].score is typeof number
 *   - cast:plan hint is the expected static string
 *   - args is in the required-keys list
 *
 * EA does NOT assert:
 *   - alternatives[] items have EXACTLY the three keys (extra keys silently pass)
 *   - alternatives[].tool contains exactly one '/' (namespaced format)
 *   - alternatives[].score is finite and >= 0 (NaN or Infinity would pass typeof check)
 *   - alternatives[].description is typeof string (presence checked but not type)
 *   - args is a non-null, non-array plain object (required-key list checks presence only)
 *
 * No prior test asserts:
 *   - cast:executed content array has >= 2 items (metadata + backend result appended)
 *     A regression that discarded result.content items would silently pass all prior guards.
 *
 * GO closes those gaps:
 *
 *   GO-1  cast:plan alternatives[] item exact key set is {description, score, tool}
 *          — no extra keys; a rename or addition silently passes EA
 *   GO-2  cast:plan alternatives[].tool contains exactly one '/'
 *          (namespaced "serverId/toolName" format; a bare tool name silently passes EA)
 *   GO-3  cast:plan alternatives[].score is a finite non-negative number
 *          (EA: typeof === 'number' only; Infinity and NaN would pass)
 *   GO-4  cast:plan alternatives[].description is typeof string
 *          (EA checks key presence but omits typeof assertion for description)
 *   GO-5  cast:plan `args` is a non-null, non-array plain object
 *          (EA lists args as a required key; never asserts typeof/shape)
 *   GO-6  cast:executed content array has at least 2 items
 *          (item[0] is the metadata JSON; item[1+] are the backend tool result)
 *
 * Source: handleCast in src-stdio/core.ts — alternatives built at line 942,
 *   args coerced at line 849, executed return appends result.content at line 975.
 *
 * Frozen 2026-09-21.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (plan/executed shape, not explain)
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
  return join(tmpdir(), `ch1tty-go-${Date.now()}-${++_seq}.jsonl`);
}

/** Frozen exact key set for an alternatives[] item (sorted). */
const ALT_ITEM_KEYS = ['description', 'score', 'tool'];

/**
 * Three backends so scoreIntent produces alternatives (tools scoring 2nd–4th).
 * Intent "list" matches list_projects, list_tasks, and list_payments across all three.
 */
const BASE_CONFIGS: ServerConfig[] = [
  { id: 'neon',   name: 'Neon DB', type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.tech/mcp',         lazy: true },
  { id: 'stripe', name: 'Stripe',  type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp',         lazy: true },
  { id: 'tasks',  name: 'Tasks',   type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://tasks.chitty.cc/mcp',    lazy: true },
];

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon',   FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  backend.defineServer('tasks',  FIXTURE_SERVERS.tasks);
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
}

async function castPlan(agg: Aggregator, intent: string): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent, confirm: true });
  assert.equal(result.isError, undefined, `cast:plan must not error for intent "${intent}"`);
  const body = JSON.parse((result.content[0] as { type: string; text: string }).text) as Record<string, unknown>;
  assert.equal(body['cast'], 'plan', `expected cast:plan, got ${body['cast']}`);
  return body;
}

// ── GO-1: alternatives[] exact key set ────────────────────────────────────────

test('GO-1 cast:plan alternatives[] item exact key set is {description, score, tool}', async () => {
  const agg = makeAgg();
  try {
    const body = await castPlan(agg, 'list');
    const alts = body['alternatives'] as unknown[];
    assert.ok(Array.isArray(alts), 'alternatives must be an array');
    // With 3 backends that all have "list" tools, we expect alternatives.
    assert.ok(alts.length > 0, 'must have at least one alternative with 3 list-tool backends');
    for (const alt of alts) {
      assert.ok(typeof alt === 'object' && alt !== null && !Array.isArray(alt), 'each alternative must be a plain object');
      const actual = Object.keys(alt as Record<string, unknown>).sort();
      assert.deepEqual(actual, ALT_ITEM_KEYS,
        `alternatives item key set must be exactly ${JSON.stringify(ALT_ITEM_KEYS)}, got ${JSON.stringify(actual)}`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GO-2: alternatives[].tool contains exactly one '/' ────────────────────────

test('GO-2 cast:plan alternatives[].tool contains exactly one "/" (namespaced)', async () => {
  const agg = makeAgg();
  try {
    const body = await castPlan(agg, 'list');
    const alts = body['alternatives'] as Array<Record<string, unknown>>;
    assert.ok(alts.length > 0, 'must have at least one alternative');
    for (const alt of alts) {
      const tool = alt['tool'] as string;
      const slashCount = (tool.match(/\//g) ?? []).length;
      assert.equal(slashCount, 1,
        `alternatives[].tool must contain exactly one '/' (namespaced serverId/toolName), got "${tool}"`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GO-3: alternatives[].score is finite >= 0 ─────────────────────────────────

test('GO-3 cast:plan alternatives[].score is a finite non-negative number', async () => {
  const agg = makeAgg();
  try {
    const body = await castPlan(agg, 'list');
    const alts = body['alternatives'] as Array<Record<string, unknown>>;
    assert.ok(alts.length > 0, 'must have at least one alternative');
    for (const alt of alts) {
      const score = alt['score'] as number;
      assert.ok(Number.isFinite(score), `alternatives[].score must be finite, got ${score}`);
      assert.ok(score >= 0, `alternatives[].score must be >= 0, got ${score}`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GO-4: alternatives[].description is typeof string ────────────────────────

test('GO-4 cast:plan alternatives[].description is typeof string', async () => {
  const agg = makeAgg();
  try {
    const body = await castPlan(agg, 'list');
    const alts = body['alternatives'] as Array<Record<string, unknown>>;
    assert.ok(alts.length > 0, 'must have at least one alternative');
    for (const alt of alts) {
      assert.equal(typeof alt['description'], 'string',
        `alternatives[].description must be typeof string, got ${typeof alt['description']}`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GO-5: cast:plan args is a non-null, non-array plain object ────────────────

test('GO-5 cast:plan args is a non-null non-array plain object', async () => {
  const agg = makeAgg();
  try {
    // Without passing args — toolArgs defaults to {}; still a plain object.
    const body = await castPlan(agg, 'list database projects');
    const args = body['args'];
    assert.ok(args !== null, 'cast:plan args must not be null');
    assert.equal(typeof args, 'object', `cast:plan args must be typeof object, got ${typeof args}`);
    assert.ok(!Array.isArray(args), 'cast:plan args must not be an array');
  } finally {
    await agg.shutdown();
  }
});

// ── GO-6: cast:executed content has >= 2 items ───────────────────────────────

test('GO-6 cast:executed content has at least 2 items (metadata + backend result)', async () => {
  const agg = makeAgg();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list database projects' });
    assert.equal(result.isError, undefined, 'cast:executed must not error');
    const content = result.content as Array<{ type: string; text?: string }>;
    assert.ok(Array.isArray(content), 'content must be an array');
    // Item [0]: metadata JSON with cast:'executed'
    assert.equal(content[0]?.type, 'text', 'content[0].type must be text');
    const meta = JSON.parse(content[0].text ?? '') as Record<string, unknown>;
    assert.equal(meta['cast'], 'executed', `content[0] must be the cast:executed metadata, got cast="${meta['cast']}"`);
    // Item [1+]: backend tool result items appended from handleExecute
    assert.ok(content.length >= 2,
      `cast:executed content must have >= 2 items (metadata + result), got ${content.length}`);
  } finally {
    await agg.shutdown();
  }
});
