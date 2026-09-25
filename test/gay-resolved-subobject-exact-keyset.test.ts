/**
 * GAY drift guard: freeze exact-equality namespacing and inputSchema pass-through
 * for cast:plan resolved sub-object.
 *
 * Prior coverage state:
 *   GI-1  froze cast:plan resolved key set (exact 6 keys)          ← structural
 *   GI-8  froze cast:resolved (dryRun) resolved key set (exact 2)  ← structural
 *   GI-2/3 froze resolved.tool contains one slash; resolved.server has no slash
 *   GI-6  froze resolved.score is finite non-negative
 *   GI-7  froze resolved.inputSchema is non-null, non-array object
 *
 * Gaps not closed by GI:
 *   (a) resolved.tool is EXACTLY "{serverId}/{toolName}" — GI-2 checks slash count,
 *       not exact value; resolved.server is EXACTLY the serverId — GI-3 checks
 *       structural properties, not exact value.
 *   (b) resolved.inputSchema is passed through VERBATIM from the backend tool
 *       definition — GI-7 only checks type/null/array, not content.
 *
 * Frozen invariants:
 *   GAY-1  cast:plan resolved.tool === "{serverId}/{toolName}" (exact composition);
 *          resolved.server === serverId (exact prefix, not just "no slash")
 *   GAY-2  cast:plan resolved.inputSchema deepEquals the fixture inputSchema
 *          (pass-through is verbatim, not restructured)
 *
 * Note on score bound: scores are NOT capped at 1.0. src-stdio/aggregator.ts adds
 * affinity (≤ 0.2) and exact-name bonus (0.3) on top of keywordScore (≤ 1.0),
 * giving a theoretical max of 1.5. GI-6 correctly uses finite + non-negative only.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (resolved sub-object)
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
// 4 intent terms, all present in description → keyword score 4/4 = 1.0
const INTENT = 'find payment transaction records';
// Fixture schema — used in GAY-2 to verify pass-through is verbatim
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

async function castPlan(agg: Aggregator): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, confirm: true });
  assert.equal(result.isError, undefined, `cast must not error: ${JSON.stringify(result.content)}`);
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(body['cast'], 'plan', `expected cast:plan, got ${body['cast']}`);
  return body;
}

// ── GAY-1: resolved.tool exact namespaced value; resolved.server exact serverId ──

test('GAY-1: cast:plan resolved.tool is exact "{serverId}/{toolName}" and resolved.server is exact serverId', async () => {
  const agg = makeAgg();
  try {
    const body = await castPlan(agg);
    const resolved = body['resolved'] as Record<string, unknown>;

    assert.equal(
      resolved['tool'],
      `${SERVER_ID}/${TOOL_NAME}`,
      `resolved.tool must be "${SERVER_ID}/${TOOL_NAME}", got "${resolved['tool']}"`,
    );
    assert.equal(
      resolved['server'],
      SERVER_ID,
      `resolved.server must be "${SERVER_ID}", got "${resolved['server']}"`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GAY-2: resolved.inputSchema passes through verbatim from the backend definition ──

test('GAY-2: cast:plan resolved.inputSchema deepEquals the backend tool definition (pass-through is verbatim)', async () => {
  const agg = makeAgg();
  try {
    const body = await castPlan(agg);
    const resolved = body['resolved'] as Record<string, unknown>;

    assert.deepEqual(
      resolved['inputSchema'],
      TOOL_INPUT_SCHEMA,
      `resolved.inputSchema must be a verbatim copy of the tool's inputSchema, got: ${JSON.stringify(resolved['inputSchema'])}`,
    );
  } finally {
    await agg.shutdown();
  }
});
