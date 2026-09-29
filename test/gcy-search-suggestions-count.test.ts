/**
 * GCY drift guard: freeze ch1tty/search suggestions count — no premature truncation
 * when N < maxCombos / maxPrompts.
 *
 * GCX (PR #1558) froze ordering and the upper bound (4 entries → ≤ 3 returned).
 * This test freezes the LOWER bound: when the catalog has N entries where N < 3,
 * all N must be returned — none may be dropped prematurely.
 *
 * Implementation reference (suggestions.ts, getSuggestionsForFocus):
 *   combos:  combos.slice(0, maxCombos)   (default maxCombos = 3)
 *   prompts: prompts.slice(0, maxPrompts)  (default maxPrompts = 3)
 * slice(0, 3) on an array of length N < 3 returns all N elements.
 *
 * Gaps not covered by existing tests:
 *   FK-6/FK-7 confirm combos/prompts are arrays but do not assert their lengths.
 *   GCX confirms length ≤ 3 when N > 3 but is on a separate branch (PR #1558).
 *   suggestion-ranking.test.ts tests getSuggestionsForFocus() directly (unit), not
 *   the ch1tty/search API path.
 *
 * ── Tests ─────────────────────────────────────────────────────────────────────
 * GCY-1: catalog with exactly 1 combo  → suggestions.combos.length === 1
 * GCY-2: catalog with exactly 2 combos → suggestions.combos.length === 2
 * GCY-3: catalog with exactly 3 combos (at maxCombos boundary) → length === 3
 * GCY-4: catalog with exactly 2 prompts → suggestions.prompts.length === 2
 * GCY-5: catalog with 0 combos, 2 prompts → combos is [] (empty array), prompts has length 2
 *
 * CLAUDE.md compliance:
 *   - Public surface unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (search suggestions count)
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
  return join(tmpdir(), `ch1tty-gcy-${Date.now()}-${++dlqSeq}.jsonl`);
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
  tool('list_records', 'List all records in the database'),
  tool('create_record', 'Create a new database record'),
  tool('update_record', 'Update an existing database record'),
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

function makeCombo(name: string): object {
  return {
    name,
    chain: [`alpha/${name}`],
    accomplishes: `Perform the ${name} operation`,
    verified: true,
  };
}

function makePrompt(text: string): object {
  return { text, resolves_to: 'alpha/list_records' };
}

function makeCatalog(combos: object[], prompts: object[]): Record<string, unknown> {
  return {
    dev: {
      description: 'Dev focus suggestions for GCY tests',
      combos,
      prompts,
    },
  };
}

function makeAgg(catalog: Record<string, unknown>): Aggregator {
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

// ── Suite: suggestions count — no premature truncation ────────────────────────

describe('GCY — search suggestions count when N < maxCombos/maxPrompts', () => {
  test('GCY-1: catalog with exactly 1 combo → suggestions.combos.length === 1', async () => {
    const agg = makeAgg(makeCatalog([makeCombo('list_records')], [makePrompt('list all')]));
    try {
      const result = await agg.callTool('ch1tty/search', { query: 'records' });
      assert.equal(result.isError, undefined);
      const data = parseData(result);
      const suggestions = data.suggestions as { combos: unknown[]; prompts: unknown[] };
      assert.ok(suggestions, 'suggestions must be present');
      assert.equal(suggestions.combos.length, 1, 'exactly 1 combo in catalog → 1 returned, not 0 or 3');
    } finally {
      await agg.shutdown();
    }
  });

  test('GCY-2: catalog with exactly 2 combos → suggestions.combos.length === 2', async () => {
    const combos = [makeCombo('list_records'), makeCombo('create_record')];
    const agg = makeAgg(makeCatalog(combos, [makePrompt('list all')]));
    try {
      const result = await agg.callTool('ch1tty/search', { query: 'record' });
      assert.equal(result.isError, undefined);
      const data = parseData(result);
      const suggestions = data.suggestions as { combos: unknown[]; prompts: unknown[] };
      assert.ok(suggestions, 'suggestions must be present');
      assert.equal(suggestions.combos.length, 2, '2 combos in catalog → 2 returned, not truncated to fewer');
    } finally {
      await agg.shutdown();
    }
  });

  test('GCY-3: catalog with exactly 3 combos (at maxCombos boundary) → suggestions.combos.length === 3', async () => {
    const combos = [makeCombo('list_records'), makeCombo('create_record'), makeCombo('update_record')];
    const agg = makeAgg(makeCatalog(combos, [makePrompt('list all')]));
    try {
      const result = await agg.callTool('ch1tty/search', { query: 'record' });
      assert.equal(result.isError, undefined);
      const data = parseData(result);
      const suggestions = data.suggestions as { combos: unknown[]; prompts: unknown[] };
      assert.ok(suggestions, 'suggestions must be present');
      assert.equal(suggestions.combos.length, 3, '3 combos (= maxCombos) → all 3 returned');
    } finally {
      await agg.shutdown();
    }
  });

  test('GCY-4: catalog with exactly 2 prompts → suggestions.prompts.length === 2', async () => {
    const prompts = [makePrompt('list all records'), makePrompt('show me records')];
    const agg = makeAgg(makeCatalog([makeCombo('list_records')], prompts));
    try {
      const result = await agg.callTool('ch1tty/search', { query: 'record' });
      assert.equal(result.isError, undefined);
      const data = parseData(result);
      const suggestions = data.suggestions as { combos: unknown[]; prompts: unknown[] };
      assert.ok(suggestions, 'suggestions must be present');
      assert.equal(suggestions.prompts.length, 2, '2 prompts in catalog → 2 returned, not truncated');
    } finally {
      await agg.shutdown();
    }
  });

  test('GCY-5: catalog with 0 combos and 2 prompts → combos is empty array, prompts has length 2', async () => {
    const prompts = [makePrompt('list all records'), makePrompt('show me records')];
    const agg = makeAgg(makeCatalog([], prompts));
    try {
      const result = await agg.callTool('ch1tty/search', { query: 'record' });
      assert.equal(result.isError, undefined);
      const data = parseData(result);
      const suggestions = data.suggestions as { combos: unknown[]; prompts: unknown[] } | undefined;
      // When the catalog has 0 combos but 2 prompts: getSuggestionsForFocus returns
      // { combos: [], prompts: [...] } — non-null because prompts array is non-empty.
      // suggestions must be present (non-null return) and combos must be an empty array.
      assert.ok(suggestions, 'suggestions present when prompts exist even if combos is empty');
      assert.ok(Array.isArray(suggestions.combos), 'combos is an array');
      assert.equal(suggestions.combos.length, 0, 'combos length === 0 when catalog has 0 combos');
      assert.equal(suggestions.prompts.length, 2, 'prompts length === 2');
    } finally {
      await agg.shutdown();
    }
  });
});
