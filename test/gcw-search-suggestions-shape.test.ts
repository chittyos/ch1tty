/**
 * GCW drift guard: freeze the shape of the `suggestions` field in the
 * ch1tty/search response envelope.
 *
 * Source: src-stdio/aggregator.ts
 *   Line 845-847:
 *     const focusSuggestions = (focusName && query)
 *       ? getSuggestionsForFocus(focusName, this.suggestionsCatalog, { intent: query })
 *       : null;
 *   Line 867: ...(focusSuggestions ? { suggestions: focusSuggestions } : {}),
 *
 * Source: src-stdio/suggestions.ts
 *   getSuggestionsForFocus returns: { combos: SuggestedCombo[]; prompts: SuggestedPrompt[] }
 *   — it does NOT include the `description` field from the FocusSuggestions interface.
 *
 * fd-search-keyword-response-drift-guard.test.ts (FD-2, FD-13) freezes
 * presence/absence of `suggestions` at the envelope level only. Neither
 * FD nor any prior test freezes the internal shape of the `suggestions`
 * value itself. GCW closes that gap:
 *
 *   GCW-1  focus + catalog + query → `suggestions` key is present
 *   GCW-2  `suggestions` is a plain object (not null, not array, not primitive)
 *   GCW-3  `suggestions` has exactly two keys: `combos` and `prompts`
 *          (note: `description` from the FocusSuggestions interface is absent —
 *           getSuggestionsForFocus never includes it in its return value)
 *   GCW-4  `suggestions.combos` is an Array; each entry has at minimum
 *          `name` (string), `chain` (array), `accomplishes` (string), `verified` (boolean)
 *   GCW-5  `suggestions.prompts` is an Array; each entry has `text` (string)
 *          and `resolves_to` (string)
 *
 * Frozen 2026-09-27.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only)
 *   - buildCastExplanation metric freeze: not applicable (search, not cast)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gcw-${Date.now()}-${++dlqSeq}.jsonl`);
}

const BASE_CONFIGS: ServerConfig[] = [
  { id: 'neon', name: 'Neon DB', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true },
  { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true },
];

const FOCUS_PROFILES = {
  profiles: {
    dev: {
      description: 'Dev focus for GCW test',
      categories: ['code'] as string[],
      servers: ['neon'] as string[],
      boost: 0.5,
    },
  },
};

// Minimal suggestions catalog — one combo + one prompt referencing neon tools.
const SUGGESTIONS_CATALOG = {
  dev: {
    description: 'Dev suggestions for GCW test',
    combos: [
      {
        name: 'list-then-query',
        chain: ['neon/list_projects', 'neon/run_sql'],
        accomplishes: 'List projects then run SQL against one',
        verified: true,
      },
    ],
    prompts: [
      { text: 'list my database projects', resolves_to: 'neon/list_projects' },
    ],
  },
};

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    focus: 'dev',
    focusProfiles: FOCUS_PROFILES,
    suggestionsCatalog: SUGGESTIONS_CATALOG,
  });
}

async function search(agg: Aggregator, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/search', args);
  assert.equal(result.isError, undefined, 'search must not error');
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

// ── GCW-1: suggestions present when focus+catalog+query are all active ────────

test('GCW-1: focus+catalog+query → suggestions key is present in search envelope', async () => {
  const agg = makeAgg();
  try {
    const body = await search(agg, { query: 'database' });
    assert.ok(
      'suggestions' in body,
      `suggestions key must be present when focus, catalog, and query are all active; got keys: ${Object.keys(body).join(', ')}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GCW-2: suggestions is a plain object ─────────────────────────────────────

test('GCW-2: suggestions is a plain object (not null, not array, not primitive)', async () => {
  const agg = makeAgg();
  try {
    const body = await search(agg, { query: 'database' });
    const sugg = body['suggestions'];
    assert.ok(sugg !== null, 'suggestions must not be null');
    assert.equal(typeof sugg, 'object',
      `suggestions must be typeof 'object', got ${typeof sugg}`);
    assert.ok(!Array.isArray(sugg),
      `suggestions must not be an array; got: ${JSON.stringify(sugg)}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GCW-3: suggestions has exactly keys 'combos' and 'prompts' ───────────────

test('GCW-3: suggestions has exactly keys "combos" and "prompts" — description is absent', async () => {
  const agg = makeAgg();
  try {
    const body = await search(agg, { query: 'database' });
    const sugg = body['suggestions'] as Record<string, unknown>;
    const keys = Object.keys(sugg).sort();
    // getSuggestionsForFocus returns { combos, prompts } only — 'description' from
    // FocusSuggestions is not passed through. This test freezes that contract.
    assert.deepEqual(keys, ['combos', 'prompts'],
      `suggestions must have exactly keys ['combos','prompts'], got ${JSON.stringify(keys)}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GCW-4: combos is an array; each entry has the required fields ─────────────

test('GCW-4: suggestions.combos is an Array; each entry has name(string), chain(array), accomplishes(string), verified(boolean)', async () => {
  const agg = makeAgg();
  try {
    const body = await search(agg, { query: 'database' });
    const sugg = body['suggestions'] as { combos: unknown[]; prompts: unknown[] };
    assert.ok(Array.isArray(sugg.combos),
      `suggestions.combos must be an Array; got ${typeof sugg.combos}`);
    for (const [i, combo] of sugg.combos.entries()) {
      assert.equal(typeof combo, 'object',
        `combos[${i}] must be an object`);
      assert.ok(combo !== null && !Array.isArray(combo),
        `combos[${i}] must not be null or array`);
      const c = combo as Record<string, unknown>;
      assert.equal(typeof c['name'], 'string',
        `combos[${i}].name must be a string, got ${typeof c['name']}`);
      assert.ok(Array.isArray(c['chain']),
        `combos[${i}].chain must be an Array; got ${typeof c['chain']}`);
      assert.equal(typeof c['accomplishes'], 'string',
        `combos[${i}].accomplishes must be a string, got ${typeof c['accomplishes']}`);
      assert.equal(typeof c['verified'], 'boolean',
        `combos[${i}].verified must be a boolean, got ${typeof c['verified']}`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GCW-5: prompts is an array; each entry has text and resolves_to ───────────

test('GCW-5: suggestions.prompts is an Array; each entry has text(string) and resolves_to(string)', async () => {
  const agg = makeAgg();
  try {
    const body = await search(agg, { query: 'database' });
    const sugg = body['suggestions'] as { combos: unknown[]; prompts: unknown[] };
    assert.ok(Array.isArray(sugg.prompts),
      `suggestions.prompts must be an Array; got ${typeof sugg.prompts}`);
    for (const [i, prompt] of sugg.prompts.entries()) {
      assert.equal(typeof prompt, 'object',
        `prompts[${i}] must be an object`);
      assert.ok(prompt !== null && !Array.isArray(prompt),
        `prompts[${i}] must not be null or array`);
      const p = prompt as Record<string, unknown>;
      assert.equal(typeof p['text'], 'string',
        `prompts[${i}].text must be a string, got ${typeof p['text']}`);
      assert.equal(typeof p['resolves_to'], 'string',
        `prompts[${i}].resolves_to must be a string, got ${typeof p['resolves_to']}`);
    }
  } finally {
    await agg.shutdown();
  }
});
