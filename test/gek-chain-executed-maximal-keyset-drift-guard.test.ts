/**
 * GEK drift guard: freeze cast:chain_executed MAXIMAL key set when both
 * explain:true AND an active sessionId are combined with text-producing steps.
 *
 * GBI froze each conditional SEPARATELY:
 *   GBI-2: +explain → 11 keys (base 10 + explanation)
 *   GBI-3: +session → 11 keys (base 10 + sessionContext)
 *
 * Neither froze the maximal 12-key set when BOTH conditionals are active
 * simultaneously. A regression that drops `explanation` or `sessionContext`
 * when both are present, or that injects an extra field only in the combo
 * case, would pass all GBI tests silently.
 *
 * Source: src-stdio/aggregator.ts lines ~1527-1549 (chain_executed body).
 * The body spreads `explanation` and `chainSessionContext` independently
 * (no mutual exclusion), so both can coexist:
 *   { cast, resolvedBy, intent, latencyMs, latencyBreakdown,
 *     focus,                           always (catalogCombo requires it)
 *     explanation,                     explain:true
 *     catalog, steps, summary,         text steps
 *     sessionContext,                  active session
 *     suggestions }                    always (same catalog lookup)
 *   → 12 keys
 *
 * GEK freezes:
 *
 *   GEK-1  explain:true + active session + text steps → EXACTLY 12 keys:
 *          {cast, catalog, explanation, focus, intent, latencyBreakdown,
 *           latencyMs, resolvedBy, sessionContext, steps, suggestions, summary}
 *
 *   GEK-2  explanation sub-object contains `method` (string) in the combo.
 *
 *   GEK-3  sessionContext sub-object contains `recentTools` (Array) and
 *          `callCount` (number) in the combo.
 *
 *   GEK-4  explain:true + active session + NON-text steps → 11 keys
 *          (summary absent: base 10 − summary + explanation + sessionContext)
 *          i.e. {cast, catalog, explanation, focus, intent, latencyBreakdown,
 *               latencyMs, resolvedBy, sessionContext, steps, suggestions}
 *
 *   GEK-5  explain:true + active session + text steps does NOT contain
 *          executed/plan/no_match-only keys: resolved, score, alternatives,
 *          args, hint, resources, prompts, scope.
 *
 * Frozen 2026-10-01.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level key set,
 *     not explanation sub-object structure)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import { FixtureBackend } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

// ── Frozen exact key sets ──────────────────────────────────────────────────────

const CHAIN_KEYS_MAXIMAL: readonly string[] = [
  'cast', 'catalog', 'explanation', 'focus', 'intent', 'latencyBreakdown',
  'latencyMs', 'resolvedBy', 'sessionContext', 'steps', 'suggestions', 'summary',
];

const CHAIN_KEYS_MAXIMAL_NO_SUMMARY: readonly string[] = [
  'cast', 'catalog', 'explanation', 'focus', 'intent', 'latencyBreakdown',
  'latencyMs', 'resolvedBy', 'sessionContext', 'steps', 'suggestions',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

const BASE_CONFIGS: ServerConfig[] = [
  {
    id: 'neon',
    name: 'Neon',
    type: 'remote',
    access: 'readwrite',
    category: 'ecosystem',
    endpoint: 'https://neon.tech/mcp',
    lazy: true,
  },
];

const CATALOG = {
  code: {
    description: 'Code focus',
    combos: [
      {
        name: 'neon-setup',
        chain: ['neon/list_projects', 'neon/create_project'],
        accomplishes: 'List existing Neon projects then create a new one',
        verified: true,
      },
    ],
    prompts: [],
  },
};

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gek-${Date.now()}-${++_seq}.jsonl`);
}

function makeAgg(opts: { textTools?: boolean } = {}): Aggregator {
  const backend = new FixtureBackend();
  const textTools = opts.textTools !== false;
  backend.defineServer('neon', {
    tools: [
      {
        name: 'list_projects',
        description: 'list neon database projects',
        inputSchema: { type: 'object', properties: {} },
        response: textTools
          ? { content: [{ type: 'text', text: '["proj-1","proj-2"]' }] }
          : { content: [{ type: 'resource', uri: 'neon://projects', text: '[]', mimeType: 'application/json' }] },
      },
      {
        name: 'create_project',
        description: 'create a new neon project database instance',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
        response: textTools
          ? { content: [{ type: 'text', text: '{"id":"proj-new"}' }] }
          : { content: [{ type: 'resource', uri: 'neon://proj-new', text: '{}', mimeType: 'application/json' }] },
      },
    ],
    prompts: [],
    resources: [],
  });
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    suggestionsCatalog: CATALOG,
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, dlq()),
  });
}

async function chainExecuted(
  agg: Aggregator,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    chain: true,
    focus: 'code',
    ...extra,
  });
  assert.equal(result.isError, undefined, 'cast must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥ 1 content item');
  assert.equal(content[0]!.type, 'text', 'content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(body['cast'], 'chain_executed', `expected cast:chain_executed, got cast="${String(body['cast'])}"`);
  return body;
}

function assertExactKeys(
  body: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(body).sort();
  const exp = [...expected].sort();
  assert.deepEqual(
    actual,
    exp,
    `${label}: top-level keys must be exactly ${JSON.stringify(exp)}; got ${JSON.stringify(actual)}`,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GEK — cast:chain_executed maximal key set (explain+session combo)', () => {
  test('GEK-1: explain:true + active session + text steps → EXACTLY 12 keys', async () => {
    const agg = makeAgg({ textTools: true });
    const SESSION = 'gek-session-probe';
    const body = await chainExecuted(agg, { explain: true, sessionId: SESSION });
    assertExactKeys(body, CHAIN_KEYS_MAXIMAL, 'GEK-1');
  });

  test('GEK-2: explanation sub-object contains method (string) in combo', async () => {
    const agg = makeAgg({ textTools: true });
    const SESSION = 'gek-explain-session-sub';
    const body = await chainExecuted(agg, { explain: true, sessionId: SESSION });
    const explanation = body['explanation'] as Record<string, unknown>;
    assert.equal(typeof explanation['method'], 'string',
      'GEK-2: explanation.method must be a string');
  });

  test('GEK-3: sessionContext contains recentTools (Array) and callCount (number) in combo', async () => {
    const agg = makeAgg({ textTools: true });
    const SESSION = 'gek-session-context-sub';
    const body = await chainExecuted(agg, { explain: true, sessionId: SESSION });
    const sc = body['sessionContext'] as Record<string, unknown>;
    assert.ok(Array.isArray(sc['recentTools']),
      'GEK-3: sessionContext.recentTools must be an Array');
    assert.equal(typeof sc['callCount'], 'number',
      'GEK-3: sessionContext.callCount must be a number');
  });

  test('GEK-4: explain:true + active session + NON-text steps → EXACTLY 11 keys (no summary)', async () => {
    const agg = makeAgg({ textTools: false });
    const SESSION = 'gek-nosummary-combo';
    const body = await chainExecuted(agg, { explain: true, sessionId: SESSION });
    assertExactKeys(body, CHAIN_KEYS_MAXIMAL_NO_SUMMARY, 'GEK-4');
    assert.equal(body['summary'], undefined, 'GEK-4: summary must be absent when steps produce no text');
  });

  test('GEK-5: maximal combo does not contain executed/plan/no_match-only keys', async () => {
    const agg = makeAgg({ textTools: true });
    const SESSION = 'gek-absent-keys';
    const body = await chainExecuted(agg, { explain: true, sessionId: SESSION });
    const absent = ['resolved', 'score', 'alternatives', 'args', 'hint', 'resources', 'prompts', 'scope'];
    for (const key of absent) {
      assert.equal(body[key], undefined,
        `GEK-5: key "${key}" must be absent from maximal cast:chain_executed`);
    }
  });
});
