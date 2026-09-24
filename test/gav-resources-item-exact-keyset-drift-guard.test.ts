/**
 * GAV drift guard: freeze resources[] item exact key set across cast modes.
 *
 * EO (cast:plan) and EP (cast:executed/discovered) each check resources items
 * using PERMITTED+REQUIRED:
 *   PERMITTED: { uri, name, description, mimeType, score }
 *   REQUIRED:  { uri, name, score }
 *
 * PERMITTED+REQUIRED leaves two symmetric gaps, both passing silently:
 *
 *   1. DROP gap: a regression removing `description: r.description` from the
 *      resources item construction would silently pass EO/EP even when the
 *      source resource HAS description. description is PERMITTED but not
 *      REQUIRED, so its absence never fails the EO/EP checks.
 *
 *   2. INJECT gap: a regression unconditionally injecting `description: ''`
 *      or `mimeType: null` for sources that have neither field would silently
 *      pass EO/EP (those keys ARE in PERMITTED so no unexpected-key failure).
 *
 * Actual construction (src-stdio/aggregator.ts line ~1407):
 *   related.resources = scoredResources.map((r) => ({
 *     uri: r.uri, name: r.name, description: r.description,
 *     mimeType: r.mimeType, score: r.score,
 *   }));
 *
 * JSON behavior: JSON.stringify drops keys whose value is undefined.
 * When a source resource has no description or mimeType field, those values
 * are undefined and the serialized+parsed resources item has only 3 keys
 * {name, score, uri}. When the source HAS description and mimeType, the
 * serialized item has exactly 5 keys {description, mimeType, name, score, uri}.
 *
 * Invariants frozen by GAV:
 *
 *   GAV-1  cast:executed: when source resource has description and mimeType,
 *          every resources item has EXACTLY {description, mimeType, name, score, uri}.
 *          (DROP gap: EO/EP would silently pass if description/mimeType were
 *           removed from construction — they're PERMITTED but not REQUIRED.)
 *
 *   GAV-2  cast:discovered: same 5-key guarantee when source has optional fields.
 *          (EP analogous DROP gap on discovered path.)
 *
 *   GAV-3  cast:plan (confirm:true): same 5-key guarantee when source has optional
 *          fields. (EO DROP gap on plan path.)
 *
 *   GAV-4  when source resource has no description and no mimeType, the resources
 *          item has EXACTLY {name, score, uri} — exactly the 3 required keys, no
 *          more, no less. (INJECT gap: EO/EP would silently pass if a regression
 *          unconditionally injected `description: ''` or `mimeType: null`.)
 *
 *   GAV-5  resources item description and mimeType echo the source string values
 *          exactly — not coerced, not truncated, not defaulted.
 *          (No prior test asserts value equality for these optional fields.)
 *
 * Source: src-stdio/aggregator.ts line ~1407
 *
 * Frozen 2026-09-24.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (resources item shape,
 *     not the explanation sub-object)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Frozen exact key sets ─────────────────────────────────────────────────────

// When source resource has BOTH description and mimeType.
const RESOURCE_ITEM_FULL_KEYS: readonly string[] = [
  'description', 'mimeType', 'name', 'score', 'uri',
];

// When source resource has NEITHER description NOR mimeType.
const RESOURCE_ITEM_BASE_KEYS: readonly string[] = [
  'name', 'score', 'uri',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gav-${Date.now()}-${++_seq}.jsonl`);
}

// Intent: "list neon database projects"
// Scoring terms (length > 2): list, neon, database, projects (4 terms)
const INTENT = 'list neon database projects';

function makeConfig(serverId: string, endpoint: string): ServerConfig[] {
  return [
    {
      id: serverId,
      name: `GAV ${serverId}`,
      type: 'remote',
      access: 'readwrite',
      category: 'code',
      endpoint,
      lazy: true,
    },
  ];
}

function assertExactKeys(
  items: unknown[],
  expected: readonly string[],
  label: string,
): void {
  assert.ok(Array.isArray(items) && items.length > 0, `${label}: must be a non-empty array`);
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as Record<string, unknown>;
    const actual = Object.keys(item).sort();
    const sorted = [...expected].sort();
    assert.deepEqual(
      actual,
      sorted,
      `${label}: resources[${i}] exact key set mismatch.\n` +
      `  expected: ${JSON.stringify(sorted)}\n` +
      `  actual:   ${JSON.stringify(actual)}`,
    );
  }
}

async function castBody(
  agg: Aggregator,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, ...extra });
  assert.equal(result.isError, undefined, 'cast must not return isError');
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

// ── GAV-1: cast:executed 5-key set when source has description + mimeType ────

test('GAV-1: cast:executed resources item has exactly {description,mimeType,name,score,uri} when source has optional fields', async () => {
  const backend = new FixtureBackend();
  backend.defineServer('gav1', {
    tools: [
      {
        name: 'list_neon_db_projects',
        description: 'List neon database projects',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '["p1"]' }] },
      },
    ],
    resources: [
      {
        uri: 'neon://projects/list',
        name: 'Neon DB Projects',
        description: 'List neon database projects overview',
        mimeType: 'application/json',
      },
    ],
  });
  const agg = new Aggregator(makeConfig('gav1', 'https://gav1.fixture.test/mcp'), {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
  try {
    const body = await castBody(agg);
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    assertExactKeys(body['resources'] as unknown[], RESOURCE_ITEM_FULL_KEYS, 'cast:executed resources');
  } finally {
    await agg.shutdown();
  }
});

// ── GAV-2: cast:discovered 5-key set when source has description + mimeType ──

test('GAV-2: cast:discovered resources item has exactly {description,mimeType,name,score,uri} when source has optional fields', async () => {
  const backend = new FixtureBackend();
  backend.defineServer('gav2', {
    tools: [
      {
        // Tool has 0 overlap with intent → best === undefined → cast:discovered
        name: 'write_bytes_to_disk',
        description: 'Write bytes to a disk file',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
        response: { content: [{ type: 'text', text: '{"ok":true}' }] },
      },
    ],
    resources: [
      {
        uri: 'neon://projects/list',
        name: 'Neon DB Projects',
        description: 'List neon database projects overview',
        mimeType: 'application/json',
      },
    ],
  });
  const agg = new Aggregator(makeConfig('gav2', 'https://gav2.fixture.test/mcp'), {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
  try {
    const body = await castBody(agg);
    assert.equal(body['cast'], 'discovered',
      `expected cast:discovered, got ${body['cast']} — fixture may not trigger the discovered path`);
    assertExactKeys(body['resources'] as unknown[], RESOURCE_ITEM_FULL_KEYS, 'cast:discovered resources');
  } finally {
    await agg.shutdown();
  }
});

// ── GAV-3: cast:plan 5-key set when source has description + mimeType ────────

test('GAV-3: cast:plan resources item has exactly {description,mimeType,name,score,uri} when source has optional fields', async () => {
  const backend = new FixtureBackend();
  backend.defineServer('gav3', {
    tools: [
      {
        name: 'list_neon_db_projects',
        description: 'List neon database projects',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '["p1"]' }] },
      },
    ],
    resources: [
      {
        uri: 'neon://projects/list',
        name: 'Neon DB Projects',
        description: 'List neon database projects overview',
        mimeType: 'application/json',
      },
    ],
  });
  const agg = new Aggregator(makeConfig('gav3', 'https://gav3.fixture.test/mcp'), {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
  try {
    const body = await castBody(agg, { confirm: true });
    assert.equal(body['cast'], 'plan', `expected cast:plan, got ${body['cast']}`);
    assertExactKeys(body['resources'] as unknown[], RESOURCE_ITEM_FULL_KEYS, 'cast:plan resources');
  } finally {
    await agg.shutdown();
  }
});

// ── GAV-4: 3-key base set when source has no description or mimeType ──────────

test('GAV-4: resources item has exactly {name,score,uri} when source resource has no description or mimeType', async () => {
  // ResourceEntry allows description and mimeType to be absent.
  // JSON.stringify drops undefined values, so the serialised item for a
  // bare resource has exactly the 3 required keys {name, score, uri}.
  // A regression unconditionally injecting description/mimeType (e.g.
  // `description: r.description ?? ''`) would add extra keys and break
  // this assertion, which EO/EP (PERMITTED check) would silently pass.
  const backend = new FixtureBackend();
  backend.defineServer('gav4', {
    tools: [
      {
        name: 'list_neon_database_projects',
        description: 'List neon database projects',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '[]' }] },
      },
    ],
    resources: [
      // Deliberately omits description and mimeType — only required fields
      {
        uri: 'neon://projects/list',
        name: 'Neon Database Projects',
      },
    ],
  });
  const agg = new Aggregator(makeConfig('gav4', 'https://gav4.fixture.test/mcp'), {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
  try {
    const body = await castBody(agg);
    // Tool 4/4 overlap (list, neon, database, projects) → cast:executed
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const resources = body['resources'] as unknown[];
    assert.ok(Array.isArray(resources) && resources.length > 0,
      'resources must be non-empty to test the bare-item shape');
    const item = resources[0] as Record<string, unknown>;
    const actual = Object.keys(item).sort();
    const expected = [...RESOURCE_ITEM_BASE_KEYS].sort();
    assert.deepEqual(
      actual,
      expected,
      `resources item for a source without description/mimeType must have ` +
      `exactly ${JSON.stringify(expected)} (JSON.stringify drops undefined); ` +
      `got ${JSON.stringify(actual)}. A regression injecting default values ` +
      `for absent optional fields would silently pass EO/EP's PERMITTED check.`,
    );
    // Explicitly verify the optional keys are absent (INJECT regression guard)
    assert.equal(
      Object.prototype.hasOwnProperty.call(item, 'description'),
      false,
      'description must be absent when source resource has no description',
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(item, 'mimeType'),
      false,
      'mimeType must be absent when source resource has no mimeType',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GAV-5: description and mimeType echo source string values exactly ─────────

test('GAV-5: resources item description and mimeType echo source resource string values exactly', async () => {
  const srcDescription = 'List neon database projects overview';
  const srcMimeType = 'application/vnd.neon+json';
  const backend = new FixtureBackend();
  backend.defineServer('gav5', {
    tools: [
      {
        name: 'list_neon_db_projects',
        description: 'List neon database projects',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '["p1"]' }] },
      },
    ],
    resources: [
      {
        uri: 'neon://projects/list',
        name: 'Neon DB Projects',
        description: srcDescription,
        mimeType: srcMimeType,
      },
    ],
  });
  const agg = new Aggregator(makeConfig('gav5', 'https://gav5.fixture.test/mcp'), {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
  try {
    const body = await castBody(agg);
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const resources = body['resources'] as unknown[];
    assert.ok(Array.isArray(resources) && resources.length > 0, 'resources must be non-empty');
    const item = resources[0] as Record<string, unknown>;
    assert.equal(typeof item['description'], 'string',
      'resources item.description must be typeof string when source provides a string');
    assert.equal(item['description'], srcDescription,
      'resources item.description must echo the source value exactly');
    assert.equal(typeof item['mimeType'], 'string',
      'resources item.mimeType must be typeof string when source provides a string');
    assert.equal(item['mimeType'], srcMimeType,
      'resources item.mimeType must echo the source value exactly');
  } finally {
    await agg.shutdown();
  }
});
