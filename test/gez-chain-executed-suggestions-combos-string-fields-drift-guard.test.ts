/**
 * GEZ drift guard: freeze cast:chain_executed suggestions.combos[i] string
 * field value types (name, accomplishes, notes) and resolvedBy value type.
 *
 * Prior drift guards already cover:
 *
 *   GEW (PR #1680): suggestions top-level EXACTLY {combos, prompts}; both are Arrays.
 *   GEX (PR #1682): combos[i] required keyset {accomplishes, chain, name, verified};
 *                   optional {notes}. prompts[i] exact keyset {resolves_to, text}.
 *   GEY (PR #1683): combos[i].chain is a non-empty Array; chain items are non-empty
 *                   strings; combos[i].verified is a boolean; prompts[i].text and
 *                   prompts[i].resolves_to are non-empty strings.
 *
 * Remaining gaps that none of GEW/GEX/GEY close:
 *
 *   (a) combos[i].name — key confirmed present (GEX), type NOT frozen: a regression
 *       serialising the name as null or a numeric ID passes GEX/GEY silently.
 *
 *   (b) combos[i].accomplishes — key confirmed present (GEX), type NOT frozen:
 *       same regression class as (a).
 *
 *   (c) combos[i].notes — optional field; when it appears, its type is NOT frozen:
 *       a regression serialising notes as null or [] passes GEX silently.
 *
 *   (d) cast:chain_executed resolvedBy value type — EF Suite 3 confirms resolvedBy
 *       is a required key in chain_executed; EA/EG confirm it is a non-empty string
 *       for cast:executed/no_match respectively; but no test asserts the value type
 *       specifically for cast:chain_executed.
 *
 *   (e) suggestions.combos is non-empty — GEW-4 confirms combos is an Array but
 *       does NOT assert it contains at least one item when the catalog has combos.
 *
 * Source (aggregator.ts ~line 1531):
 *   { cast: 'chain_executed', resolvedBy, intent, latencyMs, latencyBreakdown,
 *     ...(focusName ? { focus } : {}), ...(explanation ? { explanation } : {}),
 *     catalog, steps, ...(chainSummary ? { summary } : {}),
 *     ...(chainSessionContext ? { sessionContext } : {}),
 *     ...(focusSuggestions ? { suggestions } : {}) }
 *
 * Source (suggestions.ts): getSuggestionsForFocus returns
 *   { combos: SuggestedCombo[], prompts: SuggestedPrompt[] }
 *   where SuggestedCombo = { name: string, chain: string[], accomplishes: string,
 *                            verified: boolean, notes?: string }
 *
 * GEZ freezes:
 *
 *   GEZ-1  suggestions.combos is non-empty (at least one combo when catalog has combos).
 *          GEW-4 confirms combos is an Array; this freezes that the Array is populated.
 *
 *   GEZ-2  suggestions.combos[i].name is a non-empty string.
 *          (GEX confirmed presence; GEZ freezes the value type.)
 *
 *   GEZ-3  suggestions.combos[i].accomplishes is a non-empty string.
 *          (GEX confirmed presence; GEZ freezes the value type.)
 *
 *   GEZ-4  suggestions.combos[i].notes, when present, is a non-empty string.
 *          (GEX confirmed it may appear; GEZ freezes that it is never blank/null.)
 *
 *   GEZ-5  cast:chain_executed resolvedBy is a non-empty string.
 *          (EF Suite 3 confirmed key presence; GEZ freezes the value type for this
 *          specific cast type — analogous to EA-7 for cast:executed and EG for
 *          cast:no_match.)
 *
 * Fixture: neon backend (list_projects, create_project).
 * Focus profile: 'code' → neon server.
 * Catalog: two combos — one without notes, one WITH notes — so GEZ-4 actually fires.
 * Intent: "list neon projects" reliably resolves to neon/list_projects (chain start).
 *
 * Frozen 2026-10-01.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (suggestions combos value
 *     types and resolvedBy value type, not explanation sub-object fields)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gez-${Date.now()}-${++_seq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Two combos: first has NO notes, second HAS notes — so GEZ-4 exercises the notes branch.
const GEZ_CATALOG = {
  code: {
    description: 'Neon database code tools',
    combos: [
      {
        name: 'neon-setup',
        chain: ['neon/list_projects', 'neon/create_project'],
        accomplishes: 'List existing Neon projects then create a new one',
        verified: true,
      },
      {
        name: 'neon-inspect',
        chain: ['neon/list_projects', 'neon/run_sql'],
        accomplishes: 'List Neon projects then run a SQL query',
        verified: false,
        notes: 'Useful for quick schema inspection',
      },
    ],
    prompts: [
      {
        text: 'List all Neon database projects in the workspace',
        resolves_to: 'neon/list_projects',
      },
    ],
  },
};

const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true,
};

function makeBackend(): FixtureBackend {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [
      {
        name: 'list_projects',
        description: 'list neon projects',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '["proj-1","proj-2"]' }] },
      },
      {
        name: 'create_project',
        description: 'create a neon project',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
        response: { content: [{ type: 'text', text: '{"id":"proj-new"}' }] },
      },
      {
        name: 'run_sql',
        description: 'run sql on neon',
        inputSchema: { type: 'object', properties: { sql: { type: 'string' } } },
        response: { content: [{ type: 'text', text: '[]' }] },
      },
    ],
  });
  return backend;
}

function makeAgg(): Aggregator {
  const path = dlq();
  return new Aggregator([NEON_CFG], {
    backendFactory: () => makeBackend(),
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: GEZ_CATALOG,
    focus: 'code',
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

async function castChain(agg: Aggregator): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', chain: true });
  assert.equal(result.isError, undefined, `cast must not error: ${JSON.stringify(result.content)}`);
  const body = JSON.parse(
    (result as { content: Array<{ type: string; text?: string }> }).content[0]!.text!,
  ) as Record<string, unknown>;
  assert.equal(body['cast'], 'chain_executed', `expected chain_executed, got ${String(body['cast'])}`);
  return body;
}

// ── GEZ-1: suggestions.combos is non-empty ────────────────────────────────────

test('GEZ-1: suggestions.combos is a non-empty Array when catalog has combos', async () => {
  const agg = makeAgg();
  try {
    const body = await castChain(agg);
    assert.ok(
      Object.prototype.hasOwnProperty.call(body, 'suggestions'),
      'GEZ-1: suggestions must be present when focus is active with catalog',
    );
    const suggestions = body['suggestions'] as Record<string, unknown>;
    const combos = suggestions['combos'];
    assert.ok(Array.isArray(combos), `GEZ-1: suggestions.combos must be an Array; got ${typeof combos}`);
    assert.ok(
      (combos as unknown[]).length > 0,
      `GEZ-1: suggestions.combos must be non-empty when catalog has combos; got length=${(combos as unknown[]).length}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEZ-2: suggestions.combos[i].name is a non-empty string ──────────────────

test('GEZ-2: suggestions.combos[i].name is a non-empty string for every combo', async () => {
  const agg = makeAgg();
  try {
    const body = await castChain(agg);
    const suggestions = body['suggestions'] as Record<string, unknown>;
    const combos = suggestions['combos'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(combos) && combos.length > 0, 'GEZ-2: combos must be a non-empty array');
    for (const combo of combos) {
      assert.ok(
        typeof combo['name'] === 'string',
        `GEZ-2: combos[i].name must be a string; got ${typeof combo['name']} (${JSON.stringify(combo['name'])})`,
      );
      assert.ok(
        (combo['name'] as string).length > 0,
        `GEZ-2: combos[i].name must be non-empty; got "" for combo ${JSON.stringify(combo)}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GEZ-3: suggestions.combos[i].accomplishes is a non-empty string ───────────

test('GEZ-3: suggestions.combos[i].accomplishes is a non-empty string for every combo', async () => {
  const agg = makeAgg();
  try {
    const body = await castChain(agg);
    const suggestions = body['suggestions'] as Record<string, unknown>;
    const combos = suggestions['combos'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(combos) && combos.length > 0, 'GEZ-3: combos must be a non-empty array');
    for (const combo of combos) {
      assert.ok(
        typeof combo['accomplishes'] === 'string',
        `GEZ-3: combos[i].accomplishes must be a string; got ${typeof combo['accomplishes']} (${JSON.stringify(combo['accomplishes'])})`,
      );
      assert.ok(
        (combo['accomplishes'] as string).length > 0,
        `GEZ-3: combos[i].accomplishes must be non-empty; got "" for combo ${JSON.stringify(combo)}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GEZ-4: combos[i].notes, when present, is a non-empty string ──────────────

test('GEZ-4: suggestions.combos[i].notes, when present, is a non-empty string', async () => {
  const agg = makeAgg();
  try {
    const body = await castChain(agg);
    const suggestions = body['suggestions'] as Record<string, unknown>;
    const combos = suggestions['combos'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(combos) && combos.length > 0, 'GEZ-4: combos must be a non-empty array');
    let notesFound = false;
    for (const combo of combos) {
      if (!Object.prototype.hasOwnProperty.call(combo, 'notes')) continue;
      notesFound = true;
      assert.ok(
        typeof combo['notes'] === 'string',
        `GEZ-4: combos[i].notes must be a string when present; got ${typeof combo['notes']} (${JSON.stringify(combo['notes'])})`,
      );
      assert.ok(
        (combo['notes'] as string).length > 0,
        `GEZ-4: combos[i].notes must be non-empty when present; got "" for combo ${JSON.stringify(combo)}`,
      );
    }
    // The fixture deliberately includes a combo with notes so the type guard fires.
    assert.ok(
      notesFound,
      'GEZ-4: at least one combo with notes must be present in this fixture (fixture issue if this fails)',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEZ-5: cast:chain_executed resolvedBy is a non-empty string ───────────────

test('GEZ-5: cast:chain_executed resolvedBy is a non-empty string', async () => {
  const agg = makeAgg();
  try {
    const body = await castChain(agg);
    assert.ok(
      Object.prototype.hasOwnProperty.call(body, 'resolvedBy'),
      'GEZ-5: resolvedBy must be present in cast:chain_executed',
    );
    const resolvedBy = body['resolvedBy'];
    assert.ok(
      typeof resolvedBy === 'string',
      `GEZ-5: resolvedBy must be a string; got ${typeof resolvedBy} (${JSON.stringify(resolvedBy)})`,
    );
    assert.ok(
      (resolvedBy as string).length > 0,
      `GEZ-5: resolvedBy must be non-empty; got "" in cast:chain_executed`,
    );
  } finally {
    await agg.shutdown();
  }
});
