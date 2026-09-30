/**
 * GBA drift guard: freeze cast:chain_executed exact top-level key set.
 *
 * EF froze cast:chain_executed field TYPES for step items.
 * EJ froze step item PERMITTED key set and catalog sub-object EXACT key set.
 * GT froze latencyBreakdown key sets for cast:executed and confirmed
 *    cast:plan does NOT expose latencyBreakdown.
 *
 * No prior test on main freezes the exact TOP-LEVEL key set of
 * cast:chain_executed. A regression adding, renaming, or promoting a field
 * (e.g. accidentally including cast:executed-only keys like resolved/score/
 * alternatives, or leaking an internal annotation) would pass all prior tests
 * silently.
 *
 * Actual shapes (keyword route, neon chain fixture, focus:code):
 *
 *   cast:chain_executed (no session, no explain, non-text step output)
 *     → {cast, catalog, focus, intent, latencyBreakdown, latencyMs,
 *        resolvedBy, steps, suggestions}
 *     NOTE: `focus` is always present (catalogCombo requires an active focus;
 *     resolveActiveFocus always sets focusName when chain_executed fires).
 *     NOTE: `suggestions` is always present when catalogCombo is non-null
 *     and the catalog contains the active focus profile
 *     (getSuggestionsForFocus returns non-null; see aggregator.ts ~1544 comment).
 *     NOTE: `summary` is ABSENT when no step returns text content (allTexts
 *     stays empty → chainSummary is undefined → field is not spread).
 *
 *   cast:chain_executed (with sessionId)
 *     → base PLUS sessionContext
 *
 *   cast:chain_executed (with explain:true)
 *     → base PLUS explanation
 *
 *   cast:chain_executed (steps produce text output)
 *     → base PLUS summary
 *
 * Invariants frozen by GBA:
 *
 *   GBA-1  cast:chain_executed without session, without explain, with non-text
 *          step output has EXACTLY {cast, catalog, focus, intent,
 *          latencyBreakdown, latencyMs, resolvedBy, steps, suggestions} —
 *          the 9-key base set.
 *
 *   GBA-2  cast:chain_executed WITH sessionId adds exactly sessionContext and
 *          no other new key. (No prior test freezes the chain_executed
 *          top-level key set with session active.)
 *
 *   GBA-3  cast:chain_executed WITH explain:true adds exactly explanation and
 *          no other new key.
 *
 *   GBA-4  cast:chain_executed with text-producing steps adds exactly summary
 *          and no other new key compared to the base set.
 *
 *   GBA-5  cast:chain_executed does NOT contain keys that belong to other cast
 *          modes: resolved, score, alternatives, args, hint, resources, prompts.
 *          These are valid in cast:executed or cast:plan but must never appear
 *          at the root of a chain_executed response.
 *
 * Source: src-stdio/aggregator.ts ~line 1531 (cast:chain_executed JSON body).
 * Frozen 2026-09-25.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level key set,
 *     not explanation sub-object)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Frozen exact key sets ──────────────────────────────────────────────────────

const CHAIN_KEYS_BASE: readonly string[] = [
  'cast', 'catalog', 'focus', 'intent', 'latencyBreakdown', 'latencyMs', 'resolvedBy', 'steps', 'suggestions',
];

const CHAIN_KEYS_WITH_SESSION: readonly string[] = [...CHAIN_KEYS_BASE, 'sessionContext'];
const CHAIN_KEYS_WITH_EXPLAIN: readonly string[] = [...CHAIN_KEYS_BASE, 'explanation'];
const CHAIN_KEYS_WITH_SUMMARY: readonly string[] = [...CHAIN_KEYS_BASE, 'summary'];

// Keys valid in other cast modes that must never appear at chain_executed root:
const CHAIN_EXCLUDED_KEYS: readonly string[] = [
  'resolved', 'score', 'alternatives', 'args', 'hint', 'resources', 'prompts',
];

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CATALOG = {
  code: {
    description: 'Code focus',
    combos: [{
      name: 'neon-list-create',
      chain: ['neon/list_projects', 'neon/create_project'],
      accomplishes: 'List then create a Neon database project',
      verified: true,
    }],
    prompts: [],
  },
};

const SERVER_CONFIG: ServerConfig[] = [{
  id: 'neon',
  name: 'Neon',
  type: 'remote',
  access: 'readwrite',
  category: 'database',
  endpoint: 'https://neon.example.com/mcp',
  lazy: true,
}];

const INTENT = 'list neon database projects';

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gba-${Date.now()}-${++_seq}.jsonl`);
}

// Coordinator that always falls back to keyword scoring (no brain route).
class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

/**
 * Aggregator where both chain steps return non-text content.
 * allTexts stays empty → chainSummary is undefined → `summary` absent.
 */
function makeNoSummaryAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [
      {
        name: 'list_projects',
        description: 'list neon database projects',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'resource', resource: { uri: 'neon://projects', name: 'projects-list' } }] },
      },
      {
        name: 'create_project',
        description: 'create a neon database project',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
        response: { content: [{ type: 'resource', resource: { uri: 'neon://project/new', name: 'new-project' } }] },
      },
    ],
  });
  const path = dlq();
  return new Aggregator(SERVER_CONFIG, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: CATALOG,
    focus: 'code',
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

/**
 * Aggregator where both chain steps return text content.
 * allTexts is populated → chainSummary is defined → `summary` present.
 */
function makeSummaryAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [
      {
        name: 'list_projects',
        description: 'list neon database projects',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: 'project-alpha' }] },
      },
      {
        name: 'create_project',
        description: 'create a neon database project',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
        response: { content: [{ type: 'text', text: 'created-project-beta' }] },
      },
    ],
  });
  const path = dlq();
  return new Aggregator(SERVER_CONFIG, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: CATALOG,
    focus: 'code',
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

async function castChain(
  agg: Aggregator,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, chain: true, ...extra });
  assert.equal(result.isError, undefined, `cast must not error: ${JSON.stringify(result.content)}`);
  const body = JSON.parse(
    (result.content as Array<{ type: string; text: string }>)[0]!.text,
  ) as Record<string, unknown>;
  assert.equal(body['cast'], 'chain_executed', `expected chain_executed, got cast="${String(body['cast'])}"`);
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

test('GBA-1: cast:chain_executed base top-level key set (no session, no explain, non-text steps)', async () => {
  const agg = makeNoSummaryAgg();
  const body = await castChain(agg);
  assertExactKeys(body, CHAIN_KEYS_BASE, 'GBA-1');
});

test('GBA-2: cast:chain_executed WITH sessionId adds exactly sessionContext and no other new key', async () => {
  const agg = makeNoSummaryAgg();
  const SESSION = 'gba-session-2';
  const body = await castChain(agg, { sessionId: SESSION });
  assertExactKeys(body, CHAIN_KEYS_WITH_SESSION, 'GBA-2');
});

test('GBA-3: cast:chain_executed WITH explain:true adds exactly explanation and no other new key', async () => {
  const agg = makeNoSummaryAgg();
  const body = await castChain(agg, { explain: true });
  assertExactKeys(body, CHAIN_KEYS_WITH_EXPLAIN, 'GBA-3');
});

test('GBA-4: cast:chain_executed with text-producing steps adds exactly summary and no other new key', async () => {
  const agg = makeSummaryAgg();
  const body = await castChain(agg);
  assertExactKeys(body, CHAIN_KEYS_WITH_SUMMARY, 'GBA-4');
});

test('GBA-5: cast:chain_executed does NOT contain cast:executed/plan-only keys', async () => {
  const agg = makeNoSummaryAgg();
  const body = await castChain(agg);
  for (const absent of CHAIN_EXCLUDED_KEYS) {
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, absent),
      `"${absent}" must be absent in cast:chain_executed`,
    );
  }
});
