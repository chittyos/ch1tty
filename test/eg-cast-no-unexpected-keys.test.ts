/**
 * EG: Drift guard — no-unexpected-keys for cast:executed, cast:plan,
 *     cast:resolved, and cast:no_match response shapes.
 *
 * EA (ea-cast-result-shape-drift.test.ts) freezes REQUIRED keys — it catches
 * renames that remove a key the client expects. EG is the complement: it
 * freezes the PERMITTED sets, catching new or renamed keys that would appear
 * in responses and surprise API clients.
 *
 * Frozen field sets (all conditional optionals included):
 *
 * cast:executed top-level PERMITTED:
 *   cast, intent, latencyBreakdown, latencyMs, resolved, resolvedBy, score
 *   + alternatives, chainContinuation, explanation, focus,
 *     prompts, resolvedFromCatalog, resources, scope, sessionContext, suggestions
 *
 * cast:executed latencyBreakdown PERMITTED:
 *   executionMs, registryMs, scoringMs  [+ brainMs when brain route active]
 *
 * cast:plan top-level PERMITTED:
 *   alternatives, args, cast, hint, intent, latencyMs, resolved, resolvedBy
 *   + chainContinuation, explanation, focus, prompts, resolvedFromCatalog,
 *     resources, scope, sessionContext, suggestions
 *
 * cast:plan resolved sub-object PERMITTED (exact — no conditional fields):
 *   category, description, inputSchema, score, server, tool
 *
 * cast:resolved top-level PERMITTED:
 *   cast, intent, latencyMs, resolved, resolvedBy
 *   + catalogCombo, explanation, focus, scope, sessionContext
 *
 * cast:resolved resolved sub-object PERMITTED (exact):
 *   score, tool
 *
 * cast:no_match top-level PERMITTED:
 *   cast, hint, intent, latencyMs, resolvedBy
 *   + explanation, scope, sessionContext, suggestions
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

const DLQ = join(tmpdir(), `ch1tty-eg-${Date.now()}.jsonl`);

function makeAgg(): Aggregator {
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

// ── Permitted field sets ─────────────────────────────────────────────────────

const EXECUTED_PERMITTED: readonly string[] = [
  'alternatives',
  'cast',
  'chainContinuation',
  'explanation',
  'focus',
  'intent',
  'latencyBreakdown',
  'latencyMs',
  'prompts',
  'resolved',
  'resolvedBy',
  'resolvedFromCatalog',
  'resources',
  'scope',
  'score',
  'sessionContext',
  'suggestions',
];

const EXECUTED_BREAKDOWN_PERMITTED: readonly string[] = [
  'brainMs',
  'executionMs',
  'registryMs',
  'scoringMs',
];

const PLAN_PERMITTED: readonly string[] = [
  'alternatives',
  'args',
  'cast',
  'chainContinuation',
  'explanation',
  'focus',
  'hint',
  'intent',
  'latencyMs',
  'prompts',
  'resolved',
  'resolvedBy',
  'resolvedFromCatalog',
  'resources',
  'scope',
  'sessionContext',
  'suggestions',
];

const PLAN_RESOLVED_PERMITTED: readonly string[] = [
  'category',
  'description',
  'inputSchema',
  'score',
  'server',
  'tool',
];

const RESOLVED_PERMITTED: readonly string[] = [
  'cast',
  'catalogCombo',
  'explanation',
  'focus',
  'intent',
  'latencyMs',
  'resolved',
  'resolvedBy',
  'scope',
  'sessionContext',
];

const RESOLVED_RESOLVED_PERMITTED: readonly string[] = [
  'score',
  'tool',
];

const NO_MATCH_PERMITTED: readonly string[] = [
  'cast',
  'explanation',
  'hint',
  'intent',
  'latencyMs',
  'resolvedBy',
  'scope',
  'sessionContext',
  'suggestions',
];

// ── Helper ────────────────────────────────────────────────────────────────────

function parseBody(agg: Aggregator, intent: string, opts: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return agg.callTool('ch1tty/cast', { intent, ...opts }).then((result) => {
    assert.equal(result.isError, undefined, `cast returned isError for intent="${intent}": ${JSON.stringify(result.content)}`);
    return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  });
}

// ── Suite 1: cast:executed ────────────────────────────────────────────────────

describe('EG — cast:executed no-unexpected-keys guards', () => {
  test('no unexpected top-level keys in cast:executed response', async () => {
    const agg = makeAgg();
    try {
      const body = await parseBody(agg, 'list database projects');
      assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
      const unexpected = Object.keys(body).filter((k) => !EXECUTED_PERMITTED.includes(k));
      assert.deepEqual(
        unexpected,
        [],
        `Unexpected keys in cast:executed (shape drift): ${unexpected.join(', ')}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('cast:executed latencyBreakdown has no unexpected keys', async () => {
    const agg = makeAgg();
    try {
      const body = await parseBody(agg, 'list database projects');
      assert.equal(body['cast'], 'executed');
      const breakdown = body['latencyBreakdown'] as Record<string, unknown>;
      assert.ok(breakdown && typeof breakdown === 'object' && !Array.isArray(breakdown), 'latencyBreakdown must be an object');
      const unexpected = Object.keys(breakdown).filter((k) => !EXECUTED_BREAKDOWN_PERMITTED.includes(k));
      assert.deepEqual(
        unexpected,
        [],
        `Unexpected keys in latencyBreakdown (shape drift): ${unexpected.join(', ')}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('cast:executed score is a number', async () => {
    const agg = makeAgg();
    try {
      const body = await parseBody(agg, 'list database projects');
      assert.equal(body['cast'], 'executed');
      assert.equal(typeof body['score'], 'number', `score must be a number, got ${typeof body['score']}`);
    } finally {
      await agg.shutdown();
    }
  });

  test('cast:executed response has at least 2 content items (metadata + tool result)', async () => {
    const agg = makeAgg();
    try {
      const result = await agg.callTool('ch1tty/cast', { intent: 'list database projects' });
      assert.equal(result.isError, undefined);
      assert.ok(result.content.length >= 2, `cast:executed must have ≥2 content items (metadata + tool result), got ${result.content.length}`);
    } finally {
      await agg.shutdown();
    }
  });

  test('cast:executed first content item is type:text', async () => {
    const agg = makeAgg();
    try {
      const result = await agg.callTool('ch1tty/cast', { intent: 'list database projects' });
      assert.equal(result.isError, undefined);
      const first = result.content[0] as Record<string, unknown>;
      assert.equal(first['type'], 'text', 'first content item must be type:text');
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 2: cast:plan ────────────────────────────────────────────────────────

describe('EG — cast:plan no-unexpected-keys guards', () => {
  test('no unexpected top-level keys in cast:plan response', async () => {
    const agg = makeAgg();
    try {
      const body = await parseBody(agg, 'list database projects', { confirm: true });
      assert.equal(body['cast'], 'plan', `expected cast:plan, got ${body['cast']}`);
      const unexpected = Object.keys(body).filter((k) => !PLAN_PERMITTED.includes(k));
      assert.deepEqual(
        unexpected,
        [],
        `Unexpected keys in cast:plan (shape drift): ${unexpected.join(', ')}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('cast:plan resolved sub-object has no unexpected keys', async () => {
    const agg = makeAgg();
    try {
      const body = await parseBody(agg, 'list database projects', { confirm: true });
      assert.equal(body['cast'], 'plan');
      const resolved = body['resolved'] as Record<string, unknown>;
      assert.ok(resolved && typeof resolved === 'object' && !Array.isArray(resolved), 'resolved must be an object');
      const unexpected = Object.keys(resolved).filter((k) => !PLAN_RESOLVED_PERMITTED.includes(k));
      assert.deepEqual(
        unexpected,
        [],
        `Unexpected keys in cast:plan resolved (shape drift): ${unexpected.join(', ')}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('cast:plan args is an object or null', async () => {
    const agg = makeAgg();
    try {
      const body = await parseBody(agg, 'list database projects', { confirm: true });
      assert.equal(body['cast'], 'plan');
      const args = body['args'];
      assert.ok(
        args === null || (typeof args === 'object' && !Array.isArray(args)),
        `args must be an object or null, got ${JSON.stringify(args)}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('cast:plan has exactly 1 content item', async () => {
    const agg = makeAgg();
    try {
      const result = await agg.callTool('ch1tty/cast', { intent: 'list database projects', confirm: true });
      assert.equal(result.isError, undefined);
      assert.equal(result.content.length, 1, `cast:plan must have exactly 1 content item, got ${result.content.length}`);
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 3: cast:resolved (dryRun) ──────────────────────────────────────────

describe('EG — cast:resolved no-unexpected-keys guards', () => {
  test('no unexpected top-level keys in cast:resolved response', async () => {
    const agg = makeAgg();
    try {
      const body = await parseBody(agg, 'list database projects', { dryRun: true });
      assert.equal(body['cast'], 'resolved', `expected cast:resolved, got ${body['cast']}`);
      const unexpected = Object.keys(body).filter((k) => !RESOLVED_PERMITTED.includes(k));
      assert.deepEqual(
        unexpected,
        [],
        `Unexpected keys in cast:resolved (shape drift): ${unexpected.join(', ')}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('cast:resolved resolved sub-object has no unexpected keys', async () => {
    const agg = makeAgg();
    try {
      const body = await parseBody(agg, 'list database projects', { dryRun: true });
      assert.equal(body['cast'], 'resolved');
      const resolved = body['resolved'] as Record<string, unknown>;
      assert.ok(resolved && typeof resolved === 'object' && !Array.isArray(resolved), 'resolved must be an object');
      const unexpected = Object.keys(resolved).filter((k) => !RESOLVED_RESOLVED_PERMITTED.includes(k));
      assert.deepEqual(
        unexpected,
        [],
        `Unexpected keys in cast:resolved.resolved (shape drift): ${unexpected.join(', ')}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('cast:resolved has exactly 1 content item', async () => {
    const agg = makeAgg();
    try {
      const result = await agg.callTool('ch1tty/cast', { intent: 'list database projects', dryRun: true });
      assert.equal(result.isError, undefined);
      assert.equal(result.content.length, 1, `cast:resolved must have exactly 1 content item, got ${result.content.length}`);
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 4: cast:no_match ────────────────────────────────────────────────────

describe('EG — cast:no_match no-unexpected-keys guards', () => {
  test('no unexpected top-level keys in cast:no_match response', async () => {
    const agg = makeAgg();
    try {
      const body = await parseBody(agg, 'zzzzzzzzz_no_matching_tool_xyz_unique_9999');
      assert.equal(body['cast'], 'no_match', `expected cast:no_match, got ${body['cast']}`);
      const unexpected = Object.keys(body).filter((k) => !NO_MATCH_PERMITTED.includes(k));
      assert.deepEqual(
        unexpected,
        [],
        `Unexpected keys in cast:no_match (shape drift): ${unexpected.join(', ')}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('cast:no_match hint is the expected static string', async () => {
    const agg = makeAgg();
    try {
      const body = await parseBody(agg, 'zzzzzzzzz_no_matching_tool_xyz_unique_9999');
      assert.equal(body['cast'], 'no_match');
      assert.equal(
        body['hint'],
        'No tools, prompts, or resources matched your intent. Try ch1tty/search with different keywords.',
        'no_match hint must match frozen string',
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('cast:no_match has exactly 1 content item', async () => {
    const agg = makeAgg();
    try {
      const result = await agg.callTool('ch1tty/cast', { intent: 'zzzzzzzzz_no_matching_tool_xyz_unique_9999' });
      assert.equal(result.isError, undefined);
      assert.equal(result.content.length, 1, `cast:no_match must have exactly 1 content item, got ${result.content.length}`);
    } finally {
      await agg.shutdown();
    }
  });

  test('cast:no_match resolvedBy is a non-empty string', async () => {
    const agg = makeAgg();
    try {
      const body = await parseBody(agg, 'zzzzzzzzz_no_matching_tool_xyz_unique_9999');
      assert.equal(body['cast'], 'no_match');
      assert.ok(
        typeof body['resolvedBy'] === 'string' && (body['resolvedBy'] as string).length > 0,
        `resolvedBy must be a non-empty string, got ${JSON.stringify(body['resolvedBy'])}`,
      );
    } finally {
      await agg.shutdown();
    }
  });
});
