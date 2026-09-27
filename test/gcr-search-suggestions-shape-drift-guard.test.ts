/**
 * GCR drift guard: freeze `ch1tty/search` `suggestions` field value structure.
 *
 * GCK (open PR) freezes the top-level key set: when focus+query are both active,
 * the key `suggestions` appears. GCQ freezes the `focus` echo. Neither test freezes
 * the VALUE structure of `suggestions` itself. A regression that changes the
 * combos/prompts shape — e.g. renaming `accomplishes` → `description`, or dropping
 * `verified`, or flattening combo entries into strings — would pass every existing test.
 *
 * Source: src-stdio/aggregator.ts ~843–867 (focusSuggestions construction + serialization)
 *         src-stdio/suggestions.ts — FocusSuggestions / SuggestedCombo / SuggestedPrompt types
 *
 * Gating invariant (line ~845):
 *   const focusSuggestions = (focusName && query)
 *     ? getSuggestionsForFocus(focusName, this.suggestionsCatalog, { intent: query })
 *     : null;
 *   ...(focusSuggestions ? { suggestions: focusSuggestions } : {})
 *
 * So `suggestions` is emitted only when:
 *   (a) a focus name is active AND
 *   (b) a non-empty query string is present AND
 *   (c) the catalog has an entry for the focus name.
 *
 * GCR freezes:
 *
 *   GCR-1  suggestions absent when focus is active but NO query is provided
 *          (server-summary path — the gate condition `focusName && query` fails
 *           because query is empty; `suggestions` must not leak into summary responses)
 *
 *   GCR-2  suggestions absent when focus is active, query is provided, but the
 *          suggestions catalog has NO entry for this focus profile
 *          (getSuggestionsForFocus returns null → key omitted)
 *
 *   GCR-3  suggestions is an object with exactly the keys `{combos, prompts}` when
 *          focus is active, query is provided, and the catalog has an entry
 *          (no extra keys, no missing keys; value is not null / undefined / array)
 *
 *   GCR-4  suggestions.combos[] — each entry has the required keys
 *          `{name, chain, accomplishes, verified}` with correct primitive types;
 *          `notes` is either a string or absent (never present as a non-string)
 *
 *   GCR-5  suggestions.prompts[] — each entry has exactly `{text, resolves_to}` with
 *          string values (no extra keys, no missing keys)
 *
 * Frozen 2026-09-27.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (search suggestions, not cast explain)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Server configs ─────────────────────────────────────────────────────────────

const NEON_CONFIG: ServerConfig = {
  id: 'neon',
  name: 'Neon',
  type: 'remote',
  access: 'readwrite',
  category: 'code',
  endpoint: 'https://neon.tech/mcp',
  lazy: true,
};

// ── Focus profiles ─────────────────────────────────────────────────────────────

const FOCUS_PROFILES = {
  profiles: {
    code: {
      description: 'Software development tools',
      categories: ['code' as const],
      servers: ['neon'],
      boost: 0.5,
    },
    finance: {
      description: 'Billing and financial tools',
      categories: ['ecosystem' as const],
      servers: ['stripe'],
      boost: 0.5,
    },
  },
};

// ── Suggestions catalog ────────────────────────────────────────────────────────

/** A catalog with a 'code' entry containing one combo (with notes) + one prompt. */
const SUGGESTIONS_CATALOG_WITH_CODE = {
  code: {
    description: 'Software development suggestions',
    combos: [
      {
        name: 'create-and-query',
        chain: ['neon/create_database', 'neon/run_sql'],
        accomplishes: 'Set up a new Neon database and run an initial query against it',
        verified: true,
        notes: 'Run the SQL query after the database is online',
      },
      {
        name: 'schema-inspect',
        chain: ['neon/describe_table_schema'],
        accomplishes: 'Inspect the current schema of a Neon table',
        verified: false,
      },
    ],
    prompts: [
      { text: 'List all tables in the neon database', resolves_to: 'neon/run_sql' },
      { text: 'Create a new Neon project', resolves_to: 'neon/create_project' },
    ],
  },
};

/** A catalog with only a 'finance' entry — no 'code' entry. */
const SUGGESTIONS_CATALOG_NO_CODE = {
  finance: {
    description: 'Finance suggestions',
    combos: [
      {
        name: 'charge-workflow',
        chain: ['stripe/create_payment_intent', 'stripe/confirm_payment'],
        accomplishes: 'Create and confirm a Stripe payment',
        verified: true,
      },
    ],
    prompts: [
      { text: 'Create a Stripe payment intent', resolves_to: 'stripe/create_payment_intent' },
    ],
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gcr-${Date.now()}-${++_seq}.jsonl`);
}

function makeAgg(opts: {
  defaultFocus?: string;
  suggestionsCatalog?: Record<string, unknown>;
} = {}): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  return new Aggregator([NEON_CONFIG], {
    focusProfiles: FOCUS_PROFILES,
    focus: opts.defaultFocus,
    suggestionsCatalog: opts.suggestionsCatalog as Record<string, {
      description: string;
      combos: { name: string; chain: string[]; accomplishes: string; verified: boolean; notes?: string }[];
      prompts: { text: string; resolves_to: string }[];
    }>,
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
}

async function search(
  agg: Aggregator,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await agg.callTool('ch1tty/search', args);
  const text = (res.content as Array<{ type: string; text: string }>)[0]?.text ?? '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GCR-1: suggestions absent when focus active but no query (server-summary path)', async () => {
  const agg = makeAgg({ defaultFocus: 'code', suggestionsCatalog: SUGGESTIONS_CATALOG_WITH_CODE });

  // No query → triggers server-summary path; `focusName && query` is falsy → no suggestions
  const resp = await search(agg, { focus: 'code' });

  // Confirm we got the server-summary shape (not a tool list)
  assert.ok(Array.isArray(resp.servers), 'expected server-summary response (servers array)');
  assert.ok(!Object.prototype.hasOwnProperty.call(resp, 'suggestions'),
    `suggestions must be absent from server-summary responses; got ${JSON.stringify(resp.suggestions)}`);

  await agg.shutdown();
});

test('GCR-2: suggestions absent when focus active + query but NO catalog entry for this focus', async () => {
  // 'code' focus is active but catalog only has 'finance' entry — getSuggestionsForFocus returns null
  const agg = makeAgg({ suggestionsCatalog: SUGGESTIONS_CATALOG_NO_CODE });

  const resp = await search(agg, { query: 'neon database', focus: 'code' });

  // Tools must be returned normally
  assert.ok(Array.isArray(resp.tools), 'expected tools array in response');
  assert.ok(!Object.prototype.hasOwnProperty.call(resp, 'suggestions'),
    `suggestions must be absent when catalog has no entry for focus 'code'; got ${JSON.stringify(resp.suggestions)}`);

  await agg.shutdown();
});

test('GCR-3: suggestions is an object with exactly {combos, prompts} when focus+query+catalog active', async () => {
  const agg = makeAgg({ suggestionsCatalog: SUGGESTIONS_CATALOG_WITH_CODE });

  const resp = await search(agg, { query: 'neon database', focus: 'code' });

  // suggestions must be present
  assert.ok(Object.prototype.hasOwnProperty.call(resp, 'suggestions'),
    'suggestions must be present when focus+query+catalog are all active');

  const suggestions = resp.suggestions;

  // Must be a plain non-null object (not an array, not a primitive)
  assert.ok(suggestions !== null, 'suggestions must not be null');
  assert.ok(typeof suggestions === 'object', `suggestions must be an object, got ${typeof suggestions}`);
  assert.ok(!Array.isArray(suggestions), 'suggestions must not be an array');

  // Must have exactly the keys {combos, prompts} — no extra keys, no missing keys
  const suggestionsKeys = Object.keys(suggestions as object).sort();
  assert.deepEqual(suggestionsKeys, ['combos', 'prompts'],
    `suggestions must have exactly {combos, prompts}, got keys: ${JSON.stringify(suggestionsKeys)}`);

  // Both values must be arrays
  const { combos, prompts } = suggestions as Record<string, unknown>;
  assert.ok(Array.isArray(combos), `suggestions.combos must be an array, got ${typeof combos}`);
  assert.ok(Array.isArray(prompts), `suggestions.prompts must be an array, got ${typeof prompts}`);

  await agg.shutdown();
});

test('GCR-4: suggestions.combos[] each entry has {name, chain, accomplishes, verified}; notes optional string', async () => {
  const agg = makeAgg({ suggestionsCatalog: SUGGESTIONS_CATALOG_WITH_CODE });

  const resp = await search(agg, { query: 'create database', focus: 'code' });
  assert.ok(Object.prototype.hasOwnProperty.call(resp, 'suggestions'),
    'suggestions must be present for this test to be meaningful');

  const { combos } = (resp.suggestions as Record<string, unknown>);
  assert.ok(Array.isArray(combos) && combos.length > 0,
    `combos must be a non-empty array; got ${JSON.stringify(combos)}`);

  for (const combo of combos as unknown[]) {
    assert.ok(combo !== null && typeof combo === 'object' && !Array.isArray(combo),
      `each combo entry must be a plain object; got ${JSON.stringify(combo)}`);

    const c = combo as Record<string, unknown>;

    // Required keys and types
    assert.ok(Object.prototype.hasOwnProperty.call(c, 'name'),
      `combo missing required key 'name': ${JSON.stringify(c)}`);
    assert.strictEqual(typeof c.name, 'string',
      `combo.name must be a string, got ${typeof c.name}`);
    assert.ok((c.name as string).length > 0, 'combo.name must be non-empty');

    assert.ok(Object.prototype.hasOwnProperty.call(c, 'chain'),
      `combo missing required key 'chain': ${JSON.stringify(c)}`);
    assert.ok(Array.isArray(c.chain),
      `combo.chain must be an array, got ${typeof c.chain}`);
    assert.ok((c.chain as unknown[]).length > 0, 'combo.chain must be non-empty');
    for (const step of c.chain as unknown[]) {
      assert.strictEqual(typeof step, 'string',
        `each combo.chain element must be a string, got ${typeof step}`);
    }

    assert.ok(Object.prototype.hasOwnProperty.call(c, 'accomplishes'),
      `combo missing required key 'accomplishes': ${JSON.stringify(c)}`);
    assert.strictEqual(typeof c.accomplishes, 'string',
      `combo.accomplishes must be a string, got ${typeof c.accomplishes}`);
    assert.ok((c.accomplishes as string).length > 0, 'combo.accomplishes must be non-empty');

    assert.ok(Object.prototype.hasOwnProperty.call(c, 'verified'),
      `combo missing required key 'verified': ${JSON.stringify(c)}`);
    assert.strictEqual(typeof c.verified, 'boolean',
      `combo.verified must be a boolean, got ${typeof c.verified}`);

    // notes is optional — when present it must be a string
    if (Object.prototype.hasOwnProperty.call(c, 'notes')) {
      assert.strictEqual(typeof c.notes, 'string',
        `combo.notes when present must be a string, got ${typeof c.notes}`);
    }
  }

  await agg.shutdown();
});

test('GCR-5: suggestions.prompts[] each entry has exactly {text, resolves_to} with string values', async () => {
  const agg = makeAgg({ suggestionsCatalog: SUGGESTIONS_CATALOG_WITH_CODE });

  const resp = await search(agg, { query: 'create database', focus: 'code' });
  assert.ok(Object.prototype.hasOwnProperty.call(resp, 'suggestions'),
    'suggestions must be present for this test to be meaningful');

  const { prompts } = (resp.suggestions as Record<string, unknown>);
  assert.ok(Array.isArray(prompts) && prompts.length > 0,
    `prompts must be a non-empty array; got ${JSON.stringify(prompts)}`);

  for (const prompt of prompts as unknown[]) {
    assert.ok(prompt !== null && typeof prompt === 'object' && !Array.isArray(prompt),
      `each prompt entry must be a plain object; got ${JSON.stringify(prompt)}`);

    const p = prompt as Record<string, unknown>;

    // Required keys and types
    assert.ok(Object.prototype.hasOwnProperty.call(p, 'text'),
      `prompt missing required key 'text': ${JSON.stringify(p)}`);
    assert.strictEqual(typeof p.text, 'string',
      `prompt.text must be a string, got ${typeof p.text}`);
    assert.ok((p.text as string).length > 0, 'prompt.text must be non-empty');

    assert.ok(Object.prototype.hasOwnProperty.call(p, 'resolves_to'),
      `prompt missing required key 'resolves_to': ${JSON.stringify(p)}`);
    assert.strictEqual(typeof p.resolves_to, 'string',
      `prompt.resolves_to must be a string, got ${typeof p.resolves_to}`);
    assert.ok((p.resolves_to as string).length > 0, 'prompt.resolves_to must be non-empty');

    // No extra keys allowed
    const promptKeys = Object.keys(p).sort();
    assert.deepEqual(promptKeys, ['resolves_to', 'text'],
      `prompt must have exactly {text, resolves_to}, got keys: ${JSON.stringify(promptKeys)}`);
  }

  await agg.shutdown();
});
