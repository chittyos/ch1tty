/**
 * GCX drift guard: freeze ch1tty/search suggestions ordering and truncation.
 *
 * FK froze the shape of the `suggestions` sub-object in search responses
 * (presence/absence, top-level keys, combo/prompt item fields, value types).
 * suggestion-ranking.test.ts (HH) froze intent-ranked ordering via cast:plan.
 *
 * Neither froze ordering or truncation through the ch1tty/search API path.
 * The search path passes `query` as `intent` to getSuggestionsForFocus
 * (src-stdio/aggregator.ts line ~846), so the same ranking logic applies.
 * A refactor of the search handler could break ordering without failing FK or HH.
 *
 * ── Frozen invariants ────────────────────────────────────────────────────────
 *
 * GCX-1  query strongly matching one combo → that combo first in suggestions.combos
 * GCX-2  query strongly matching one prompt → that prompt first in suggestions.prompts
 * GCX-3  catalog with >3 combos + no intent match → suggestions.combos.length ≤ 3
 *         (maxCombos default applied after ranking; verified-first tiebreaker)
 * GCX-4  catalog with >3 prompts → suggestions.prompts.length ≤ 3 (maxPrompts default)
 * GCX-5  no intent match (short or unrelated query) → verified combos before unverified
 *
 * CLAUDE.md compliance:
 *   - Public surface unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (search suggestions)
 *
 * Frozen 2026-09-27.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { FixtureBackend } from './fixture-backend.js';
import type { FixtureToolDef } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gcx-${Date.now()}-${++dlqSeq}.jsonl`);
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
  tool('run_sql', 'Run a SQL query against the database'),
  tool('create_table', 'Create a new database table'),
  tool('list_tables', 'List all database tables in the schema'),
  tool('drop_table', 'Drop a database table'),
];

const ALPHA_CFG: ServerConfig = {
  id: 'alpha', name: 'Alpha', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://alpha.test/mcp', lazy: true,
};

const FOCUS_PROFILES = {
  profiles: {
    dev: { categories: ['code'] as string[], servers: ['alpha'] as string[], boost: 0.5 },
  },
};

// Catalog with 4 combos — mixing verified/unverified and distinct keyword sets.
// combo-sql:  accomplishes mentions "SQL query" + verified:true
// combo-ddl:  accomplishes mentions "schema table" + verified:false
// combo-list: accomplishes mentions "list tables" + verified:true
// combo-drop: accomplishes mentions "drop remove" + verified:false
// (4 combos > maxCombos:3 default — tests truncation)
const CATALOG_ORDERING = {
  dev: {
    description: 'Dev ordering test catalog',
    combos: [
      {
        name: 'combo-ddl',
        chain: ['alpha/create_table'],
        accomplishes: 'Create and manage schema table structure for the database',
        verified: false,
      },
      {
        name: 'combo-sql',
        chain: ['alpha/run_sql'],
        accomplishes: 'Execute a SQL query against the database and return results',
        verified: true,
      },
      {
        name: 'combo-list',
        chain: ['alpha/list_tables'],
        accomplishes: 'List all available tables in the database schema',
        verified: true,
      },
      {
        name: 'combo-drop',
        chain: ['alpha/drop_table'],
        accomplishes: 'Drop and remove an existing database table',
        verified: false,
      },
    ],
    prompts: [
      {
        text: 'Drop and remove a table from the schema',
        resolves_to: 'alpha/drop_table',
      },
      {
        text: 'List all existing database tables',
        resolves_to: 'alpha/list_tables',
      },
      {
        text: 'Execute a SQL query against the database',
        resolves_to: 'alpha/run_sql',
      },
      {
        text: 'Create a new schema table in the database',
        resolves_to: 'alpha/create_table',
      },
    ],
  },
};

function makeAgg(catalog: Record<string, unknown> = CATALOG_ORDERING): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('alpha', { tools: ALPHA_TOOLS });
  return new Aggregator([ALPHA_CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    focus: 'dev',
    focusProfiles: FOCUS_PROFILES,
    suggestionsCatalog: catalog as never,
  });
}

function parseData(result: { content: Array<{ type: string; text?: string }>; isError?: boolean }): Record<string, unknown> {
  const c0 = result.content[0] as { type: string; text: string };
  return JSON.parse(c0.text) as Record<string, unknown>;
}

// ── GCX-1: query matches one combo → that combo first in suggestions.combos ──

describe('GCX-1 — search suggestions ordering: best-matching combo sorts first', () => {
  test('query "execute sql query" → combo-sql is first in suggestions.combos', async () => {
    const agg = makeAgg();
    try {
      // "execute sql query" contains terms matching combo-sql's accomplishes/name
      const result = await agg.callTool('ch1tty/search', { query: 'execute sql query' });
      assert.equal(result.isError, undefined, `search must not error: ${JSON.stringify(result.content)}`);
      const data = parseData(result);
      assert.ok('suggestions' in data, 'suggestions must be present when focus + query + catalog');
      const suggestions = data.suggestions as Record<string, unknown>;
      const combos = suggestions.combos as Array<Record<string, unknown>>;
      assert.ok(combos.length > 0, 'at least one combo must be returned');
      assert.equal(
        combos[0].name,
        'combo-sql',
        `first combo should be combo-sql (best match for "execute sql query"), got: ${combos[0].name}`,
      );
    } finally {
      await agg.shutdown();
    }
  });
});

// ── GCX-2: query matches one prompt → that prompt first in suggestions.prompts ─

describe('GCX-2 — search suggestions ordering: best-matching prompt sorts first', () => {
  test('query "list tables database" → list-tables prompt is first in suggestions.prompts', async () => {
    const agg = makeAgg();
    try {
      // "list tables database" matches the "List all existing database tables" prompt
      const result = await agg.callTool('ch1tty/search', { query: 'list tables database' });
      assert.equal(result.isError, undefined, `search must not error: ${JSON.stringify(result.content)}`);
      const data = parseData(result);
      assert.ok('suggestions' in data, 'suggestions must be present');
      const suggestions = data.suggestions as Record<string, unknown>;
      const prompts = suggestions.prompts as Array<Record<string, unknown>>;
      assert.ok(prompts.length > 0, 'at least one prompt must be returned');
      // The "List all existing database tables" prompt resolves to alpha/list_tables
      assert.equal(
        prompts[0].resolves_to,
        'alpha/list_tables',
        `first prompt should resolve to alpha/list_tables (best match for "list tables database"), got: ${prompts[0].resolves_to}`,
      );
    } finally {
      await agg.shutdown();
    }
  });
});

// ── GCX-3: catalog has 4 combos → search returns ≤3 (maxCombos default) ──────

describe('GCX-3 — search suggestions truncation: combos limited to maxCombos (default 3)', () => {
  test('catalog with 4 combos → suggestions.combos.length is exactly 3', async () => {
    const agg = makeAgg();
    try {
      // Use an unrelated query so ranking is purely verified-first + catalog order
      const result = await agg.callTool('ch1tty/search', { query: 'database' });
      assert.equal(result.isError, undefined, `search must not error: ${JSON.stringify(result.content)}`);
      const data = parseData(result);
      assert.ok('suggestions' in data, 'suggestions must be present');
      const suggestions = data.suggestions as Record<string, unknown>;
      const combos = suggestions.combos as Array<Record<string, unknown>>;
      assert.equal(
        combos.length,
        3,
        `suggestions.combos must be exactly 3 (maxCombos default applied to 4-item catalog), got ${combos.length}`,
      );
    } finally {
      await agg.shutdown();
    }
  });
});

// ── GCX-4: catalog has 4 prompts → search returns ≤3 (maxPrompts default) ────

describe('GCX-4 — search suggestions truncation: prompts limited to maxPrompts (default 3)', () => {
  test('catalog with 4 prompts → suggestions.prompts.length is exactly 3', async () => {
    const agg = makeAgg();
    try {
      const result = await agg.callTool('ch1tty/search', { query: 'database' });
      assert.equal(result.isError, undefined, `search must not error: ${JSON.stringify(result.content)}`);
      const data = parseData(result);
      assert.ok('suggestions' in data, 'suggestions must be present');
      const suggestions = data.suggestions as Record<string, unknown>;
      const prompts = suggestions.prompts as Array<Record<string, unknown>>;
      assert.equal(
        prompts.length,
        3,
        `suggestions.prompts must be exactly 3 (maxPrompts default applied to 4-item catalog), got ${prompts.length}`,
      );
    } finally {
      await agg.shutdown();
    }
  });
});

// ── GCX-5: no intent match → verified combos before unverified ────────────────

describe('GCX-5 — search suggestions ordering: verified combos before unverified when no intent match', () => {
  test('query with no matching terms → all verified combos appear before all unverified', async () => {
    const agg = makeAgg();
    try {
      // "xyzzy" → no terms ≥3 chars match any combo → scores all zero → verified-first tiebreaker
      // combo-sql (verified:true) and combo-list (verified:true) must appear before
      // combo-ddl (verified:false) and combo-drop (verified:false) in the returned slice.
      const result = await agg.callTool('ch1tty/search', { query: 'xyzzy' });
      assert.equal(result.isError, undefined, `search must not error: ${JSON.stringify(result.content)}`);
      const data = parseData(result);
      // With active focus + catalog entry, suggestions are present regardless of query relevance
      // (query is used for ranking combos/prompts, not for gating their presence)
      assert.ok('suggestions' in data, 'search must return suggestions for active focus with catalog entry');

      const suggestions = data.suggestions as Record<string, unknown>;
      const combos = suggestions.combos as Array<Record<string, unknown>>;
      // Catalog has 4 combos, maxCombos=3. Zero-score sort: verified desc, then catalog index asc.
      // combo-sql(T,i=1) → combo-list(T,i=2) → combo-ddl(F,i=0) → [combo-drop(F,i=3) truncated]
      assert.equal(combos.length, 3, 'search must return exactly 3 combos (maxCombos default)');
      assert.deepEqual(
        combos.map((c) => c.verified),
        [true, true, false],
        'verified flags must be [true, true, false] — verified combos before unverified',
      );
    } finally {
      await agg.shutdown();
    }
  });
});
