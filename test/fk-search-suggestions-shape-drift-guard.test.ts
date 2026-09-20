/**
 * FK drift guard: freeze the `suggestions` sub-object shape in ch1tty/search responses.
 *
 * EI froze the same shapes for ch1tty/cast (test/ei-cast-suggestions-sessioncontext-shape.test.ts).
 * Search has its own code path that populates suggestions (src-stdio/aggregator.ts, the
 * handleSearch path), and a refactor could diverge its output from the cast path without
 * breaking EI's assertions.
 *
 * FD confirmed that 'suggestions' appears in the search envelope when focus + query +
 * catalog are present, but did not freeze the internal structure of the suggestions object.
 *
 * ── Frozen shapes ────────────────────────────────────────────────────────────
 *
 * suggestions top-level EXACT: { combos, prompts }
 *
 * combos item REQUIRED:  ['accomplishes', 'chain', 'name', 'verified']
 * combos item PERMITTED: ['accomplishes', 'chain', 'name', 'notes', 'verified']
 *   (notes is optional — absent when the catalog entry has no notes field)
 *
 * prompts item EXACT: ['resolves_to', 'text']
 *
 * ── Suites ───────────────────────────────────────────────────────────────────
 *
 * Suite 1 — suggestions presence/absence (4 tests)
 *   FK-1  focus + query + catalog → suggestions present in search envelope
 *   FK-2  no focus → suggestions absent
 *   FK-3  focus + no query (server-summary path) → suggestions absent
 *   FK-4  focus + query + no catalog entry for this focus → suggestions absent
 *
 * Suite 2 — suggestions top-level shape (3 tests)
 *   FK-5  suggestions has exactly keys ['combos', 'prompts']
 *   FK-6  suggestions.combos is an array
 *   FK-7  suggestions.prompts is an array
 *
 * Suite 3 — combo item fields (3 tests)
 *   FK-8  no unexpected keys in any combo item (PERMITTED is the upper bound)
 *   FK-9  all required combo keys are present in every item
 *   FK-10 notes is absent when the catalog entry has no notes
 *
 * Suite 4 — notes optional field (1 test)
 *   FK-11 notes is present when the catalog entry defines it
 *
 * Suite 5 — prompt item fields (2 tests)
 *   FK-12 prompt items have exactly ['resolves_to', 'text'] — no unexpected keys
 *   FK-13 all required prompt keys present
 *
 * Suite 6 — value types (3 tests)
 *   FK-14 combo.name and combo.accomplishes are non-empty strings
 *   FK-15 combo.chain is a non-empty array of strings
 *   FK-16 combo.verified is boolean; prompt.text and prompt.resolves_to are non-empty strings
 *
 * CLAUDE.md compliance:
 *   - Public surface unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (search suggestions shape)
 *
 * Frozen 2026-09-20.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { FixtureBackend } from './fixture-backend.js';
import type { FixtureToolDef } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

// ── Frozen field sets ─────────────────────────────────────────────────────────

const SUGGESTIONS_TOP_FIELDS: readonly string[] = ['combos', 'prompts'];
const COMBO_ITEM_PERMITTED: readonly string[] = ['accomplishes', 'chain', 'name', 'notes', 'verified'];
const COMBO_ITEM_REQUIRED: readonly string[] = ['accomplishes', 'chain', 'name', 'verified'];
const PROMPT_ITEM_FIELDS: readonly string[] = ['resolves_to', 'text'];

// ── Helpers ───────────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-fk-${Date.now()}-${++dlqSeq}.jsonl`);
}

function tool(name: string, description: string): FixtureToolDef {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties: {} },
    response: { content: [{ type: 'text', text: 'ok' }] },
  };
}

const ALPHA_TOOLS: FixtureToolDef[] = [
  tool('list_databases', 'List all databases in the code project'),
  tool('create_database', 'Create a new database for code development'),
];
const BETA_TOOLS: FixtureToolDef[] = [
  tool('list_invoices', 'List invoices for billing and accounting'),
  tool('process_payment', 'Process a payment for invoice billing'),
];

const ALPHA_CFG: ServerConfig = {
  id: 'alpha', name: 'Alpha', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://alpha.test/mcp', lazy: true,
};
const BETA_CFG: ServerConfig = {
  id: 'beta', name: 'Beta', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://beta.test/mcp', lazy: true,
};

const FOCUS_PROFILES = {
  profiles: {
    dev: { categories: ['code'] as string[], servers: ['alpha'] as string[], boost: 0.5 },
    ops: { categories: ['ecosystem'] as string[], servers: ['beta'] as string[], boost: 0.5 },
  },
};

// Catalog with one combo that HAS notes and one that does NOT — also has a prompt.
const CATALOG_WITH_NOTES = {
  dev: {
    description: 'Dev focus suggestions',
    combos: [
      {
        name: 'setup-and-list',
        chain: ['alpha/create_database', 'alpha/list_databases'],
        accomplishes: 'Create a database then list all existing databases',
        verified: true,
        notes: 'Useful for initial project setup',
      },
      {
        name: 'list-only',
        chain: ['alpha/list_databases'],
        accomplishes: 'List all existing databases in the project',
        verified: false,
        // no notes field
      },
    ],
    prompts: [
      { text: 'List all my databases', resolves_to: 'alpha/list_databases' },
    ],
  },
};

// Catalog without notes on any combo (baseline)
const CATALOG_NO_NOTES = {
  dev: {
    description: 'Dev focus suggestions (no notes)',
    combos: [
      {
        name: 'db-workflow',
        chain: ['alpha/create_database', 'alpha/list_databases'],
        accomplishes: 'Set up and list databases for development',
        verified: true,
      },
    ],
    prompts: [
      { text: 'Set up project databases', resolves_to: 'alpha/create_database' },
    ],
  },
};

function makeAgg(opts: {
  focus?: string;
  catalog?: Record<string, unknown>;
} = {}): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('alpha', { tools: ALPHA_TOOLS });
  backend.defineServer('beta', { tools: BETA_TOOLS });
  return new Aggregator([ALPHA_CFG, BETA_CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    focus: opts.focus,
    focusProfiles: opts.focus ? FOCUS_PROFILES : undefined,
    suggestionsCatalog: (opts.catalog ?? {}) as never,
  });
}

function parseData(result: { content: Array<{ type: string; text?: string }>; isError?: boolean }): Record<string, unknown> {
  const c0 = result.content[0] as { type: string; text: string };
  return JSON.parse(c0.text) as Record<string, unknown>;
}

// ── Suite 1: suggestions presence/absence ────────────────────────────────────

describe('FK — suggestions presence/absence in search envelope', () => {
  test('FK-1: focus + query + catalog → suggestions present', async () => {
    const agg = makeAgg({ focus: 'dev', catalog: CATALOG_NO_NOTES });
    try {
      const result = await agg.callTool('ch1tty/search', { query: 'database' });
      assert.equal(result.isError, undefined);
      const data = parseData(result);
      assert.ok('suggestions' in data, 'suggestions must be present when focus + query + catalog');
    } finally {
      await agg.shutdown();
    }
  });

  test('FK-2: no focus → suggestions absent', async () => {
    const agg = makeAgg({ catalog: CATALOG_NO_NOTES });
    try {
      const result = await agg.callTool('ch1tty/search', { query: 'database' });
      assert.equal(result.isError, undefined);
      const data = parseData(result);
      assert.equal(data.suggestions, undefined, 'suggestions must be absent when no focus');
    } finally {
      await agg.shutdown();
    }
  });

  test('FK-3: focus + no query (server-summary) → suggestions absent', async () => {
    const agg = makeAgg({ focus: 'dev', catalog: CATALOG_NO_NOTES });
    try {
      const result = await agg.callTool('ch1tty/search', {});
      assert.equal(result.isError, undefined);
      const data = parseData(result);
      assert.equal(data.suggestions, undefined, 'suggestions absent on server-summary path (no query)');
    } finally {
      await agg.shutdown();
    }
  });

  test('FK-4: focus + query + no catalog entry for focus → suggestions absent', async () => {
    // 'ops' focus but catalog only has 'dev'
    const agg = makeAgg({ focus: 'ops', catalog: CATALOG_NO_NOTES });
    try {
      const result = await agg.callTool('ch1tty/search', { query: 'invoice' });
      assert.equal(result.isError, undefined);
      const data = parseData(result);
      assert.equal(data.suggestions, undefined, 'suggestions absent when no catalog entry for active focus');
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 2: suggestions top-level shape ─────────────────────────────────────

describe('FK — suggestions top-level shape in search response', () => {
  test('FK-5: suggestions has exactly ["combos", "prompts"] at the top level', async () => {
    const agg = makeAgg({ focus: 'dev', catalog: CATALOG_NO_NOTES });
    try {
      const result = await agg.callTool('ch1tty/search', { query: 'database' });
      assert.equal(result.isError, undefined);
      const data = parseData(result);
      assert.ok('suggestions' in data, 'suggestions present');
      const suggestions = data.suggestions as Record<string, unknown>;
      const keys = Object.keys(suggestions).sort();
      assert.deepEqual(keys, [...SUGGESTIONS_TOP_FIELDS].sort(),
        `suggestions top-level keys must be exactly ${JSON.stringify(SUGGESTIONS_TOP_FIELDS.slice().sort())} — got ${JSON.stringify(keys)}`);
    } finally {
      await agg.shutdown();
    }
  });

  test('FK-6: suggestions.combos is an array', async () => {
    const agg = makeAgg({ focus: 'dev', catalog: CATALOG_NO_NOTES });
    try {
      const result = await agg.callTool('ch1tty/search', { query: 'database' });
      assert.equal(result.isError, undefined);
      const data = parseData(result);
      const suggestions = data.suggestions as Record<string, unknown>;
      assert.ok(Array.isArray(suggestions.combos), 'suggestions.combos must be an array');
    } finally {
      await agg.shutdown();
    }
  });

  test('FK-7: suggestions.prompts is an array', async () => {
    const agg = makeAgg({ focus: 'dev', catalog: CATALOG_NO_NOTES });
    try {
      const result = await agg.callTool('ch1tty/search', { query: 'database' });
      assert.equal(result.isError, undefined);
      const data = parseData(result);
      const suggestions = data.suggestions as Record<string, unknown>;
      assert.ok(Array.isArray(suggestions.prompts), 'suggestions.prompts must be an array');
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 3: combo item fields ────────────────────────────────────────────────

describe('FK — search suggestions combo item field shapes', () => {
  test('FK-8: no unexpected keys in any combo item (PERMITTED upper bound)', async () => {
    const agg = makeAgg({ focus: 'dev', catalog: CATALOG_WITH_NOTES });
    try {
      const result = await agg.callTool('ch1tty/search', { query: 'database' });
      assert.equal(result.isError, undefined);
      const data = parseData(result);
      const suggestions = data.suggestions as Record<string, unknown>;
      const combos = suggestions.combos as unknown[];
      assert.ok(combos.length > 0, 'at least one combo must be returned');
      for (const combo of combos) {
        assert.ok(typeof combo === 'object' && combo !== null && !Array.isArray(combo), 'each combo must be an object');
        const c = combo as Record<string, unknown>;
        const unexpected = Object.keys(c).filter((k) => !COMBO_ITEM_PERMITTED.includes(k));
        assert.deepEqual(
          unexpected,
          [],
          `Unexpected keys in search suggestions combo item (shape drift): ${unexpected.join(', ')}`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('FK-9: all required combo keys present in every item', async () => {
    const agg = makeAgg({ focus: 'dev', catalog: CATALOG_WITH_NOTES });
    try {
      const result = await agg.callTool('ch1tty/search', { query: 'database' });
      assert.equal(result.isError, undefined);
      const data = parseData(result);
      const suggestions = data.suggestions as Record<string, unknown>;
      const combos = suggestions.combos as unknown[];
      assert.ok(combos.length > 0, 'at least one combo must be returned');
      for (const combo of combos) {
        const c = combo as Record<string, unknown>;
        const missing = COMBO_ITEM_REQUIRED.filter((k) => !(k in c));
        assert.deepEqual(missing, [], `Missing required keys in search suggestions combo: ${missing.join(', ')}`);
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('FK-10: notes absent when catalog entry has no notes field', async () => {
    const agg = makeAgg({ focus: 'dev', catalog: CATALOG_NO_NOTES });
    try {
      const result = await agg.callTool('ch1tty/search', { query: 'database' });
      assert.equal(result.isError, undefined);
      const data = parseData(result);
      const suggestions = data.suggestions as Record<string, unknown>;
      const combos = suggestions.combos as Array<Record<string, unknown>>;
      assert.ok(combos.length > 0, 'at least one combo returned');
      for (const c of combos) {
        assert.equal(c.notes, undefined, 'notes must not appear when catalog has no notes');
      }
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 4: notes optional field ────────────────────────────────────────────

describe('FK — search suggestions combo notes optional field', () => {
  test('FK-11: notes is present when catalog entry defines it', async () => {
    const agg = makeAgg({ focus: 'dev', catalog: CATALOG_WITH_NOTES });
    try {
      const result = await agg.callTool('ch1tty/search', { query: 'database setup' });
      assert.equal(result.isError, undefined);
      const data = parseData(result);
      const suggestions = data.suggestions as Record<string, unknown>;
      const combos = suggestions.combos as Array<Record<string, unknown>>;
      assert.ok(combos.length > 0, 'at least one combo returned');
      const setupAndList = combos.find((c) => c.name === 'setup-and-list');
      assert.ok(setupAndList !== undefined, 'setup-and-list combo must be present');
      assert.ok('notes' in setupAndList, 'setup-and-list must have notes key when catalog defines it');
      assert.equal(typeof setupAndList.notes, 'string', 'notes must be a string when present');
      const listOnly = combos.find((c) => c.name === 'list-only');
      assert.ok(listOnly !== undefined, 'list-only combo must be present');
      assert.ok(!('notes' in listOnly), 'list-only must NOT have notes key when catalog omits it');
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 5: prompt item fields ───────────────────────────────────────────────

describe('FK — search suggestions prompt item field shapes', () => {
  test('FK-12: prompt items have no unexpected keys (exact: resolves_to + text)', async () => {
    const agg = makeAgg({ focus: 'dev', catalog: CATALOG_NO_NOTES });
    try {
      const result = await agg.callTool('ch1tty/search', { query: 'database' });
      assert.equal(result.isError, undefined);
      const data = parseData(result);
      const suggestions = data.suggestions as Record<string, unknown>;
      const prompts = suggestions.prompts as unknown[];
      assert.ok(prompts.length > 0, 'at least one prompt must be returned');
      for (const prompt of prompts) {
        assert.ok(typeof prompt === 'object' && prompt !== null && !Array.isArray(prompt), 'each prompt must be an object');
        const p = prompt as Record<string, unknown>;
        const unexpected = Object.keys(p).filter((k) => !PROMPT_ITEM_FIELDS.includes(k));
        assert.deepEqual(
          unexpected,
          [],
          `Unexpected keys in search suggestions prompt item (shape drift): ${unexpected.join(', ')}`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('FK-13: all required prompt keys present in every item', async () => {
    const agg = makeAgg({ focus: 'dev', catalog: CATALOG_NO_NOTES });
    try {
      const result = await agg.callTool('ch1tty/search', { query: 'database' });
      assert.equal(result.isError, undefined);
      const data = parseData(result);
      const suggestions = data.suggestions as Record<string, unknown>;
      const prompts = suggestions.prompts as unknown[];
      assert.ok(prompts.length > 0, 'at least one prompt returned');
      for (const prompt of prompts) {
        const p = prompt as Record<string, unknown>;
        const missing = PROMPT_ITEM_FIELDS.filter((k) => !(k in p));
        assert.deepEqual(missing, [], `Missing required keys in search suggestions prompt: ${missing.join(', ')}`);
      }
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 6: value types ──────────────────────────────────────────────────────

describe('FK — search suggestions value types', () => {
  test('FK-14: combo.name and combo.accomplishes are non-empty strings', async () => {
    const agg = makeAgg({ focus: 'dev', catalog: CATALOG_NO_NOTES });
    try {
      const result = await agg.callTool('ch1tty/search', { query: 'database' });
      assert.equal(result.isError, undefined);
      const data = parseData(result);
      const suggestions = data.suggestions as Record<string, unknown>;
      const combos = suggestions.combos as Array<Record<string, unknown>>;
      assert.ok(combos.length > 0, 'at least one combo returned');
      for (const c of combos) {
        assert.equal(typeof c.name, 'string', 'combo.name must be a string');
        assert.ok((c.name as string).length > 0, 'combo.name must be non-empty');
        assert.equal(typeof c.accomplishes, 'string', 'combo.accomplishes must be a string');
        assert.ok((c.accomplishes as string).length > 0, 'combo.accomplishes must be non-empty');
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('FK-15: combo.chain is a non-empty array of strings', async () => {
    const agg = makeAgg({ focus: 'dev', catalog: CATALOG_NO_NOTES });
    try {
      const result = await agg.callTool('ch1tty/search', { query: 'database' });
      assert.equal(result.isError, undefined);
      const data = parseData(result);
      const suggestions = data.suggestions as Record<string, unknown>;
      const combos = suggestions.combos as Array<Record<string, unknown>>;
      assert.ok(combos.length > 0, 'at least one combo returned');
      for (const c of combos) {
        assert.ok(Array.isArray(c.chain), 'combo.chain must be an array');
        assert.ok((c.chain as unknown[]).length > 0, 'combo.chain must be non-empty');
        for (const step of c.chain as unknown[]) {
          assert.equal(typeof step, 'string', 'each combo.chain entry must be a string');
        }
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('FK-16: combo.verified is boolean; prompt.text and prompt.resolves_to are non-empty strings', async () => {
    const agg = makeAgg({ focus: 'dev', catalog: CATALOG_WITH_NOTES });
    try {
      const result = await agg.callTool('ch1tty/search', { query: 'database' });
      assert.equal(result.isError, undefined);
      const data = parseData(result);
      const suggestions = data.suggestions as Record<string, unknown>;
      const combos = suggestions.combos as Array<Record<string, unknown>>;
      const prompts = suggestions.prompts as Array<Record<string, unknown>>;
      for (const c of combos) {
        assert.equal(typeof c.verified, 'boolean', 'combo.verified must be a boolean');
      }
      assert.ok(prompts.length > 0, 'at least one prompt returned');
      for (const p of prompts) {
        assert.equal(typeof p.text, 'string', 'prompt.text must be a string');
        assert.ok((p.text as string).length > 0, 'prompt.text must be non-empty');
        assert.equal(typeof p.resolves_to, 'string', 'prompt.resolves_to must be a string');
        assert.ok((p.resolves_to as string).length > 0, 'prompt.resolves_to must be non-empty');
      }
    } finally {
      await agg.shutdown();
    }
  });
});
