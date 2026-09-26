/**
 * GBI drift guard: freeze cast:chain_executed exact top-level key set under
 * conditional additions (explanation, sessionContext, summary).
 *
 * EF froze chain_executed PERMITTED key sets (superset check, no explain/session).
 * cast-auto-chain.test.ts verifies execution behaviour. Neither freezes the EXACT
 * key set when conditional fields are added. A regression that accidentally leaks
 * a key (e.g. `score`, `alternatives`, `resolved` from executed, or a new internal
 * annotation key) when explain:true or sessionId is passed would pass every prior
 * test silently.
 *
 * Actual shapes (keyword route, neon fixture, code focus, probed 2026-09-25):
 *
 *   chain_executed (text steps, no session, no explain)
 *     → {cast, catalog, focus, intent, latencyBreakdown, latencyMs, resolvedBy,
 *        steps, suggestions, summary}  — 10 keys
 *
 *   chain_executed (text steps, explain:true)
 *     → above + explanation             — 11 keys
 *
 *   chain_executed (text steps, sessionId active)
 *     → 10-key base + sessionContext    — 11 keys
 *
 *   chain_executed (non-text steps, no session, no explain)
 *     → 10-key base − summary           — 9 keys
 *
 * Source: src-stdio/aggregator.ts lines ~1527-1549 (chain_executed body):
 *   { cast, resolvedBy, intent, latencyMs, latencyBreakdown,
 *     ...(focusName ? { focus } : {}),          always (required by catalogCombo)
 *     ...(explanation ? { explanation } : {}),  conditional: explain:true
 *     catalog, steps,
 *     ...(chainSummary !== undefined ? { summary } : {}),  conditional: text steps
 *     ...(chainSessionContext ? { sessionContext } : {}),   conditional: active session
 *     ...(focusSuggestions ? { suggestions } : {}) }        always (same catalog lookup)
 *
 * GBI freezes:
 *
 *   GBI-1  chain_executed with text-producing steps, no session, no explain has
 *          EXACTLY {cast, catalog, focus, intent, latencyBreakdown, latencyMs,
 *          resolvedBy, steps, suggestions, summary} — 10 keys.
 *          (EF CHAIN_PERMITTED covers this case as a superset check; GBI freezes
 *          the exact set, catching any new additions not in CHAIN_PERMITTED.)
 *
 *   GBI-2  WITH explain:true adds exactly `explanation` and no other new key — 11 keys.
 *
 *   GBI-3  WITH an active sessionId (session registered via a prior cast call) adds
 *          exactly `sessionContext` and no other new key — 11 keys.
 *
 *   GBI-4  WITH non-text steps (steps produce no text content) removes `summary` —
 *          9 keys (base − summary).
 *
 *   GBI-5  chain_executed does NOT contain executed/plan/no_match-only keys:
 *          resolved, score, alternatives, args, hint, resources, prompts, scope.
 *
 * Frozen 2026-09-25.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level key set,
 *     not the explanation sub-object structure)
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

const CHAIN_KEYS_BASE: readonly string[] = [
  'cast', 'catalog', 'focus', 'intent', 'latencyBreakdown', 'latencyMs',
  'resolvedBy', 'steps', 'suggestions', 'summary',
];

const CHAIN_KEYS_WITH_EXPLAIN: readonly string[] = [
  ...CHAIN_KEYS_BASE, 'explanation',
];

const CHAIN_KEYS_WITH_SESSION: readonly string[] = [
  ...CHAIN_KEYS_BASE, 'sessionContext',
];

const CHAIN_KEYS_NO_SUMMARY: readonly string[] = [
  'cast', 'catalog', 'focus', 'intent', 'latencyBreakdown', 'latencyMs',
  'resolvedBy', 'steps', 'suggestions',
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

const INTENT = 'list neon projects';

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gbi-${Date.now()}-${++_seq}.jsonl`);
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
    intent: INTENT,
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

describe('GBI — cast:chain_executed conditional key set', () => {
  test('GBI-1: base (text steps, no session, no explain) has exactly 10 keys', async () => {
    const agg = makeAgg({ textTools: true });
    const body = await chainExecuted(agg);
    assertExactKeys(body, CHAIN_KEYS_BASE, 'GBI-1');
  });

  test('GBI-2: explain:true adds exactly explanation — 11 keys', async () => {
    const agg = makeAgg({ textTools: true });
    const body = await chainExecuted(agg, { explain: true });
    assertExactKeys(body, CHAIN_KEYS_WITH_EXPLAIN, 'GBI-2');
    assert.equal(typeof (body['explanation'] as Record<string, unknown>)['method'], 'string',
      'GBI-2: explanation.method must be a string');
  });

  test('GBI-3: active sessionId adds exactly sessionContext — 11 keys', async () => {
    const agg = makeAgg({ textTools: true });
    const SESSION = 'gbi-session-probe';
    // Aggregator lazily calls onSessionStart before the cast handler (lines 588-592),
    // so the first call with a new sessionId already includes sessionContext.
    const body = await chainExecuted(agg, { sessionId: SESSION });
    assertExactKeys(body, CHAIN_KEYS_WITH_SESSION, 'GBI-3');
    const sc = body['sessionContext'] as Record<string, unknown>;
    assert.ok(Array.isArray(sc['recentTools']), 'GBI-3: sessionContext.recentTools must be an array');
    assert.equal(typeof sc['callCount'], 'number', 'GBI-3: sessionContext.callCount must be a number');
  });

  test('GBI-4: non-text steps omit summary — 9 keys', async () => {
    const agg = makeAgg({ textTools: false });
    const body = await chainExecuted(agg);
    assertExactKeys(body, CHAIN_KEYS_NO_SUMMARY, 'GBI-4');
    assert.equal(body['summary'], undefined, 'GBI-4: summary must be absent when steps produce no text');
  });

  test('GBI-5: chain_executed does not contain executed/plan-only keys', async () => {
    const agg = makeAgg({ textTools: true });
    const body = await chainExecuted(agg);
    const absent = ['resolved', 'score', 'alternatives', 'args', 'hint', 'resources', 'prompts', 'scope'];
    for (const key of absent) {
      assert.equal(body[key], undefined,
        `GBI-5: key "${key}" must be absent from cast:chain_executed`);
    }
  });
});
