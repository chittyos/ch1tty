/**
 * GBU drift guard: freeze `status.focus.categories` element type — each element
 * must be a valid ServerCategory literal.
 *
 * GBT-4 froze that `status.focus.categories` is an array (not a Set, object, or
 * string). It does NOT verify the element type: a regression serialising category
 * objects, numeric enum values, or an arbitrary string (e.g. "financial") instead of
 * the canonical ServerCategory literal would pass GBT silently.
 *
 * ServerCategory (packages/shared-types/src/index.ts) is the closed union:
 *   'ecosystem' | 'code' | 'search' | 'reasoning' | 'desktop' | 'documents' | 'communication'
 *
 * GBU closes that gap:
 *
 *   GBU-1  Single-category profile ('code') → categories array contains exactly
 *           ['code'], the element is a string, and it is in the allowed set.
 *
 *   GBU-2  Multi-category profile ('code' + 'ecosystem') → all elements are
 *           strings within the allowed ServerCategory set.
 *
 *   GBU-3  Empty-categories profile (server-only focus, analytics style) →
 *           categories is [] and every element (vacuously) satisfies the type.
 *
 *   GBU-4  Unknown profile name → status.focus is null (categories never leaks
 *           an invalid value when the profile is absent).
 *
 *   GBU-5  status.focus.servers elements are non-empty strings (symmetric
 *           element-type freeze for the servers array).
 *
 * Frozen 2026-09-26.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only)
 *   - buildCastExplanation metric freeze: not applicable (status, not cast)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gbu-${Date.now()}-${++_seq}.jsonl`);
}

const BASE_CFG: ServerConfig[] = [
  { id: 'neon',   name: 'Neon DB', type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.tech/mcp',   lazy: true },
  { id: 'stripe', name: 'Stripe',  type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.test/mcp', lazy: true },
];

/** The closed set of valid ServerCategory literals. */
const VALID_SERVER_CATEGORIES = new Set([
  'ecosystem', 'code', 'search', 'reasoning', 'desktop', 'documents', 'communication',
]);

const FOCUS_PROFILES = {
  profiles: {
    code:      { categories: ['code' as const],                          servers: [],          boost: 0.5 },
    mixed:     { categories: ['code' as const, 'ecosystem' as const],   servers: ['neon'],    boost: 0.6 },
    serveronly: { categories: [] as [],                                   servers: ['stripe'],  boost: 0.4 },
  },
};

function makeAgg(defaultFocus?: string): Aggregator {
  return new Aggregator(BASE_CFG, {
    ledgerDlqPath: dlq(),
    backendFactory: () => new FixtureBackend([]),
    focusProfiles: FOCUS_PROFILES,
    suggestionsCatalog: {},
    embedEnabled: false,
    ...(defaultFocus !== undefined ? { focus: defaultFocus } : {}),
  });
}

async function getFocusField(agg: Aggregator): Promise<unknown> {
  const result = await agg.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined, 'ch1tty/status must not return isError');
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  return body['focus'];
}

// ── GBU-1: single-category profile element is a valid ServerCategory ──────────

test('GBU-1: single-category focus profile → categories element is a valid ServerCategory literal', async () => {
  const agg = makeAgg('code');
  try {
    const focus = await getFocusField(agg) as Record<string, unknown>;
    assert.ok(focus !== null && typeof focus === 'object', 'status.focus must be non-null');
    const cats = focus['categories'];
    assert.ok(Array.isArray(cats), 'status.focus.categories must be an array');
    assert.equal(cats.length, 1, `expected 1 category element, got ${cats.length}`);
    const elem = (cats as unknown[])[0];
    assert.equal(typeof elem, 'string', `categories[0] must be a string, got ${typeof elem}`);
    assert.ok(VALID_SERVER_CATEGORIES.has(elem as string),
      `categories[0] '${elem}' is not a valid ServerCategory`);
    assert.equal(elem, 'code', `categories[0] must be 'code', got '${elem}'`);
  } finally {
    await agg.shutdown();
  }
});

// ── GBU-2: multi-category profile — all elements are valid ServerCategory ─────

test('GBU-2: multi-category focus profile → all categories elements are valid ServerCategory literals', async () => {
  const agg = makeAgg('mixed');
  try {
    const focus = await getFocusField(agg) as Record<string, unknown>;
    assert.ok(focus !== null && typeof focus === 'object', 'status.focus must be non-null');
    const cats = focus['categories'];
    assert.ok(Array.isArray(cats), 'status.focus.categories must be an array');
    assert.equal(cats.length, 2, `expected 2 category elements, got ${cats.length}`);
    for (const elem of cats as unknown[]) {
      assert.equal(typeof elem, 'string', `each category must be a string, got ${typeof elem}`);
      assert.ok(VALID_SERVER_CATEGORIES.has(elem as string),
        `category '${elem}' is not in the valid ServerCategory set`);
    }
    const sorted = [...(cats as string[])].sort();
    assert.deepEqual(sorted, ['code', 'ecosystem'],
      `expected ['code', 'ecosystem'] (sorted), got ${JSON.stringify(sorted)}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GBU-3: empty-categories (server-only) profile — categories is [] ──────────

test('GBU-3: server-only focus profile (no categories) → categories is an empty array', async () => {
  const agg = makeAgg('serveronly');
  try {
    const focus = await getFocusField(agg) as Record<string, unknown>;
    assert.ok(focus !== null && typeof focus === 'object', 'status.focus must be non-null');
    const cats = focus['categories'];
    assert.ok(Array.isArray(cats), 'status.focus.categories must be an array');
    assert.equal(cats.length, 0,
      `server-only profile categories must be empty [], got ${JSON.stringify(cats)}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GBU-4: unknown profile name → status.focus is null (no category leakage) ──

test('GBU-4: unknown focus profile name → status.focus is null (no category array leakage)', async () => {
  const agg = makeAgg('nonexistent-profile-xyz');
  try {
    const focus = await getFocusField(agg);
    assert.equal(focus, null,
      `status.focus must be null for an unknown profile, got ${JSON.stringify(focus)}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GBU-5: servers elements are non-empty strings (symmetric type freeze) ─────

test('GBU-5: status.focus.servers elements are non-empty strings', async () => {
  const agg = makeAgg('mixed');
  try {
    const focus = await getFocusField(agg) as Record<string, unknown>;
    assert.ok(focus !== null && typeof focus === 'object', 'status.focus must be non-null');
    const servers = focus['servers'];
    assert.ok(Array.isArray(servers), 'status.focus.servers must be an array');
    assert.ok(servers.length > 0, 'mixed profile must have at least one server');
    for (const elem of servers as unknown[]) {
      assert.equal(typeof elem, 'string', `each server must be a string, got ${typeof elem}`);
      assert.ok((elem as string).length > 0, `each server must be a non-empty string, got '${elem}'`);
    }
  } finally {
    await agg.shutdown();
  }
});
