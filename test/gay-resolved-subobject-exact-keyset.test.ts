/**
 * GAY drift guard: freeze `resolved` sub-object exact key set across cast modes.
 *
 * The `resolved` field has a DIFFERENT TYPE depending on cast mode:
 *
 *   cast:plan     (confirm:true)  → object with 6 keys:
 *                                    { tool, server, category, description, score, inputSchema }
 *   cast:resolved (dryRun:true)  → object with 2 keys: { tool, score }
 *   cast:executed (default)      → STRING (the namespaced tool name), not an object
 *
 * Source: src-stdio/aggregator.ts
 *   ~line 1599 (cast:plan):     resolved: { tool, server, category, description, score, inputSchema }
 *   ~line 1575 (cast:resolved): resolved: { tool: best.namespacedName, score: best.score }
 *   ~line 1661 (cast:executed): resolved: best.namespacedName  ← plain string
 *
 * Prior coverage gap:
 *   GV froze cast:executed top-level key set (resolved is a key, not its type).
 *   GAT froze cast:plan top-level key set (resolved is a key, not its inner shape).
 *   No prior test verifies the EXACT inner key set of resolved in plan or dryRun,
 *   nor that cast:executed's resolved is a STRING rather than an object.
 *
 *   A regression adding resolved.namespace, resolved.serverId, or resolved.tier
 *   to cast:plan would silently pass all prior tests.
 *   A regression making cast:plan's resolved only have {tool, score} (collapsing
 *   to the dryRun shape) would also silently pass.
 *   A regression turning cast:executed's resolved into an object would silently
 *   pass all prior tests.
 *
 * Frozen invariants:
 *
 *   GAY-1  cast:plan resolved has EXACTLY {tool, server, category, description, score, inputSchema} — 6 keys
 *   GAY-2  cast:plan resolved.tool = "{serverId}/{toolName}"; resolved.server = serverId
 *   GAY-3  cast:plan resolved.score is finite and in [0, 1.0]
 *   GAY-4  cast:resolved (dryRun:true) resolved has EXACTLY {tool, score} — 2 keys, not 6
 *   GAY-5  cast:executed resolved is a string (not an object); value = "{serverId}/{toolName}"
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (resolved sub-object, not explain fields)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import { FixtureBackend } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SERVER_ID = 'gay-svc';
const TOOL_NAME = 'search_payments';
// 4 intent terms, all present in description → score 4/4 = 1.0
const INTENT = 'find payment transaction records';
const TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    limit: { type: 'number', description: 'Max results' },
  },
};

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gay-${Date.now()}-${++dlqSeq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer(SERVER_ID, {
    tools: [
      {
        name: TOOL_NAME,
        description: 'Find payment transaction records',
        inputSchema: TOOL_INPUT_SCHEMA,
        response: { content: [{ type: 'text', text: '{"results":[]}' }] },
      },
    ],
    prompts: [],
    resources: [],
  });
  const config: ServerConfig[] = [
    {
      id: SERVER_ID,
      name: 'Gay Service',
      type: 'remote',
      access: 'readwrite',
      category: 'ecosystem',
      endpoint: 'https://unused.example.com/mcp',
      lazy: true,
    },
  ];
  return new Aggregator(config, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, dlq()),
  });
}

async function castResult(agg: Aggregator, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', args);
  assert.equal(result.isError, undefined, `cast must not error: ${JSON.stringify(result.content)}`);
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

// ── GAY-1: cast:plan resolved exact keyset = {tool, server, category, description, score, inputSchema} ──

test('GAY-1: cast:plan resolved has exactly {tool, server, category, description, score, inputSchema}', async () => {
  const agg = makeAgg();
  try {
    const body = await castResult(agg, { intent: INTENT, confirm: true });
    assert.equal(body['cast'], 'plan', `expected cast:plan, got ${body['cast']}`);

    const resolved = body['resolved'] as Record<string, unknown>;
    assert.ok(resolved && typeof resolved === 'object' && !Array.isArray(resolved),
      'cast:plan resolved must be an object');

    const keys = Object.keys(resolved).sort();
    assert.deepEqual(
      keys,
      ['category', 'description', 'inputSchema', 'score', 'server', 'tool'],
      `cast:plan resolved must have exactly {tool, server, category, description, score, inputSchema}, got keys: ${JSON.stringify(keys)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GAY-2: cast:plan resolved.tool = "{serverId}/{toolName}"; resolved.server = serverId ──

test('GAY-2: cast:plan resolved.tool is namespaced; resolved.server is the serverId', async () => {
  const agg = makeAgg();
  try {
    const body = await castResult(agg, { intent: INTENT, confirm: true });
    assert.equal(body['cast'], 'plan');

    const resolved = body['resolved'] as Record<string, unknown>;

    // tool is the namespaced name: {serverId}/{toolName}
    assert.equal(typeof resolved['tool'], 'string', 'resolved.tool must be a string');
    assert.equal(
      resolved['tool'],
      `${SERVER_ID}/${TOOL_NAME}`,
      `resolved.tool must be "${SERVER_ID}/${TOOL_NAME}", got "${resolved['tool']}"`,
    );

    // server is the serverId prefix
    assert.equal(typeof resolved['server'], 'string', 'resolved.server must be a string');
    assert.equal(
      resolved['server'],
      SERVER_ID,
      `resolved.server must be "${SERVER_ID}", got "${resolved['server']}"`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GAY-3: cast:plan resolved.score finite and ∈ [0, 1.0] ───────────────────

test('GAY-3: cast:plan resolved.score is finite and in [0, 1.0]', async () => {
  const agg = makeAgg();
  try {
    const body = await castResult(agg, { intent: INTENT, confirm: true });
    assert.equal(body['cast'], 'plan');

    const resolved = body['resolved'] as Record<string, unknown>;
    const score = resolved['score'] as number;

    assert.equal(typeof score, 'number', 'resolved.score must be a number');
    assert.ok(Number.isFinite(score), `resolved.score must be finite, got ${score}`);
    assert.ok(score >= 0 && score <= 1.0, `resolved.score must be in [0, 1.0], got ${score}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GAY-4: cast:resolved (dryRun:true) resolved has EXACTLY {tool, score} ────

test('GAY-4: cast:resolved (dryRun:true) resolved has exactly {tool, score} — not the 6-key plan shape', async () => {
  const agg = makeAgg();
  try {
    const body = await castResult(agg, { intent: INTENT, dryRun: true });
    assert.equal(body['cast'], 'resolved', `expected cast:resolved, got ${body['cast']}`);

    const resolved = body['resolved'] as Record<string, unknown>;
    assert.ok(resolved && typeof resolved === 'object' && !Array.isArray(resolved),
      'cast:resolved resolved must be an object');

    const keys = Object.keys(resolved).sort();
    assert.deepEqual(
      keys,
      ['score', 'tool'],
      `cast:resolved resolved must have exactly {tool, score}, got keys: ${JSON.stringify(keys)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GAY-5: cast:executed resolved is a STRING, not an object ─────────────────

test('GAY-5: cast:executed resolved is a string (not an object), equal to the namespaced tool name', async () => {
  const agg = makeAgg();
  try {
    const body = await castResult(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);

    const resolved = body['resolved'];

    // Must be a string, not an object (unlike cast:plan and cast:resolved)
    assert.equal(typeof resolved, 'string',
      `cast:executed resolved must be a string, got ${typeof resolved}: ${JSON.stringify(resolved)}`);
    assert.equal(
      resolved,
      `${SERVER_ID}/${TOOL_NAME}`,
      `cast:executed resolved string must equal "${SERVER_ID}/${TOOL_NAME}", got "${resolved}"`,
    );
  } finally {
    await agg.shutdown();
  }
});
