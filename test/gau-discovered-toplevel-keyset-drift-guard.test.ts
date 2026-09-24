/**
 * GAU drift guard: freeze cast:discovered exact top-level key set.
 *
 * GU froze exact top-level key sets for cast:no_match and cast:resolved.
 * GV froze exact top-level key sets for cast:executed.
 * GAT froze exact top-level key sets for cast:plan (confirm:true).
 *
 * No prior test on main freezes the exact top-level key set for cast:discovered
 * (the mode where no executable tools matched but related prompts/resources did).
 * A regression adding or renaming a top-level field — e.g. accidentally leaking
 * a cast:executed-only field like score or alternatives, or unconditionally
 * injecting sessionContext — would pass all prior tests silently.
 *
 * Actual shapes (keyword route, gau-fixture server, probed 2026-09-24):
 *
 *   cast:discovered (no session, no focus, no explain, resources present)
 *     → {cast, hint, intent, latencyMs, resolvedBy, resources}
 *
 *   cast:discovered (with sessionId)
 *     → above set PLUS sessionContext
 *
 *   cast:discovered (with explain:true)
 *     → base set PLUS explanation
 *
 * How cast:discovered is triggered:
 *   The fixture tool has ZERO keyword overlap with the intent
 *   ("list neon database projects" vs "write content to file on local disk storage")
 *   so scoredTools is empty and best === undefined.
 *   The fixture resource has full overlap (uri + name + description all contain
 *   the intent terms "list", "neon", "database", "projects") → score 1.0 > 0.1
 *   threshold → scoredResources is non-empty → cast:discovered fires.
 *
 * Invariants frozen by GAU:
 *
 *   GAU-1  cast:discovered without session, without focus, without explain has
 *          EXACTLY {cast, hint, intent, latencyMs, resolvedBy, resources} —
 *          the 6-key base set.
 *          (No prior test froze the exact keyset; a regression adding e.g.
 *           score, alternatives, or an internal annotation would pass silently.)
 *
 *   GAU-2  cast:discovered WITH sessionId adds exactly sessionContext and no
 *          other new key.
 *          (GR/GS froze sessionContext VALUE TYPES for other modes; no test
 *           freezes that sessionContext is the only extra key in cast:discovered.)
 *
 *   GAU-3  cast:discovered does NOT contain explanation when explain is not set.
 *          (No test asserts explanation's ABSENCE in cast:discovered; a regression
 *           that always includes explanation would pass all prior tests silently.)
 *
 *   GAU-4  cast:discovered WITH explain:true adds exactly explanation and no
 *          other new key. Symmetric to GAU-3.
 *
 *   GAU-5  cast:discovered does NOT contain prompts, focus, scope, suggestions,
 *          or sessionContext when not applicable (resources-only match, no focus
 *          active, no scope param, no session).
 *          (These are conditional keys that should only appear when specifically
 *           triggered; a regression unconditionally spreading them would pass
 *           the GAU-1 keyset check only because of strict deepEqual.)
 *
 * Source: dist/aggregator.js (cast:discovered body built at line ~1244):
 *   {
 *     cast: 'discovered', resolvedBy, intent,
 *     latencyMs: Date.now() - castStartMs,
 *     ...(scopeAnnotation ? { scope } : {}),
 *     ...(explanation ? { explanation } : {}),
 *     hint: 'No executable tools matched, but related prompts/resources found.',
 *     ...related,   ← spreads resources and/or prompts
 *     ...(discoveredSessionContext ? { sessionContext } : {}),
 *     ...(focusSuggestions ? { suggestions } : {}),
 *   }
 *
 * Frozen 2026-09-24.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level cast:discovered
 *     key set, not the explanation sub-object)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Frozen exact key sets ──────────────────────────────────────────────────────

const DISCOVERED_KEYS_BASE: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'resolvedBy', 'resources',
];

const DISCOVERED_KEYS_WITH_SESSION: readonly string[] = [
  ...DISCOVERED_KEYS_BASE, 'sessionContext',
];

const DISCOVERED_KEYS_WITH_EXPLAIN: readonly string[] = [
  ...DISCOVERED_KEYS_BASE, 'explanation',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gau-${Date.now()}-${++_seq}.jsonl`);
}

/**
 * Build an Aggregator where the fixture tool has NO keyword overlap with
 * intent "list neon database projects" but the fixture resource DOES.
 *
 * Intent terms (length > 2): list, neon, database, projects
 * Tool description: "Write content to file on local disk storage"
 *   → terms: write, content, file, local, disk, storage → 0 overlap → not scored
 * Resource:
 *   uri         "neon://gau/projects/list"
 *   name        "Neon Projects"
 *   description "List neon database projects overview"
 *   haystack contains list, neon, database, projects → 4/4 = 1.0 > 0.1 → scored
 * Result: best === undefined, scoredResources non-empty → cast:discovered fires.
 */
function makeDiscoveredAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('gau', {
    tools: [
      {
        name: 'write_content_to_disk',
        description: 'Write content to file on local disk storage',
        inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
        response: { content: [{ type: 'text', text: '{}' }] },
      },
    ],
    resources: [
      {
        uri: 'neon://gau/projects/list',
        name: 'Neon Projects',
        description: 'List neon database projects overview',
        mimeType: 'application/json',
      },
    ],
  });
  const configs: ServerConfig[] = [
    {
      id: 'gau',
      name: 'GAU Fixture',
      type: 'remote',
      access: 'readwrite',
      category: 'code',
      endpoint: 'https://gau.fixture.test/mcp',
      lazy: true,
    },
  ];
  return new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
}

const INTENT = 'list neon database projects';

async function callCastDiscovered(
  agg: Aggregator,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, ...extra });
  assert.equal(result.isError, undefined, 'cast should not return isError');
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(
    body.cast,
    'discovered',
    `expected cast:discovered but got cast:${body.cast} — fixture may not be triggering the discovered path`,
  );
  return body;
}

function assertExactKeys(
  obj: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(obj).sort();
  const sorted = [...expected].sort();
  assert.deepEqual(
    actual,
    sorted,
    `${label}: expected exact keys ${JSON.stringify(sorted)} but got ${JSON.stringify(actual)}`,
  );
}

// ── GAU-1: base keyset (no session, no focus, no explain) ────────────────────

test('GAU-1: cast:discovered (no session, no explain) has exactly {cast, hint, intent, latencyMs, resolvedBy, resources}', async () => {
  const agg = makeDiscoveredAgg();
  try {
    const body = await callCastDiscovered(agg);
    assertExactKeys(body, DISCOVERED_KEYS_BASE, 'cast:discovered base');
  } finally {
    await agg.shutdown();
  }
});

// ── GAU-2: WITH sessionId adds exactly sessionContext ────────────────────────

test('GAU-2: cast:discovered WITH sessionId adds exactly sessionContext and no other new key', async () => {
  const agg = makeDiscoveredAgg();
  try {
    const body = await callCastDiscovered(agg, { sessionId: 'gau-session-disc-2' });
    assertExactKeys(body, DISCOVERED_KEYS_WITH_SESSION, 'cast:discovered with sessionId');
  } finally {
    await agg.shutdown();
  }
});

// ── GAU-3: explanation absent when explain not set ───────────────────────────

test('GAU-3: cast:discovered does NOT contain explanation when explain param is not set', async () => {
  const agg = makeDiscoveredAgg();
  try {
    const body = await callCastDiscovered(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'explanation'),
      false,
      'cast:discovered without explain must not include explanation; ' +
      'a regression that always builds explanation would silently pass prior tests',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GAU-4: WITH explain:true adds exactly explanation ───────────────────────

test('GAU-4: cast:discovered WITH explain:true adds exactly explanation and no other new key', async () => {
  const agg = makeDiscoveredAgg();
  try {
    const body = await callCastDiscovered(agg, { explain: true });
    assertExactKeys(body, DISCOVERED_KEYS_WITH_EXPLAIN, 'cast:discovered with explain:true');
  } finally {
    await agg.shutdown();
  }
});

// ── GAU-5: conditional keys absent when not applicable ───────────────────────

test('GAU-5: cast:discovered without session, focus, scope, or matching prompts does not contain prompts/focus/scope/suggestions/sessionContext', async () => {
  const agg = makeDiscoveredAgg();
  try {
    const body = await callCastDiscovered(agg);
    const absent = ['prompts', 'focus', 'scope', 'suggestions', 'sessionContext'] as const;
    for (const key of absent) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(body, key),
        false,
        `cast:discovered must not include '${key}' when not applicable; ` +
        'a regression unconditionally spreading conditional keys would silently pass the base keyset check',
      );
    }
  } finally {
    await agg.shutdown();
  }
});
