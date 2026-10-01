/**
 * GEY drift guard: freeze cast:chain_executed suggestions sub-object inner
 * value types.
 *
 * Context: cast:chain_executed includes a `suggestions` field when focus is
 * active. The suggestions object contains combos (cross-tool chains) and
 * prompts (pre-written intent strings).
 *
 * What prior drift guards already cover:
 *   GEW (PR #1680, open): top-level suggestions key set {combos, prompts};
 *        both are Arrays.
 *   GEX (PR #1682, open): item-level key sets —
 *        combos[i]: required {accomplishes, chain, name, verified}; optional {notes}
 *        prompts[i]: exact {resolves_to, text}
 *
 * What none of them test: the VALUE TYPES of the inner fields.
 * GEX confirms the KEY NAMES are present but does NOT assert:
 *   - combos[i].chain is an Array (not a string/number/null)
 *   - combos[i].chain is non-empty (a 0-tool chain is semantically broken)
 *   - each item in combos[i].chain is a string (namespaced tool name)
 *   - combos[i].verified is a boolean (not undefined/null/string)
 *   - prompts[i].text is a non-empty string
 *   - prompts[i].resolves_to is a non-empty string
 *
 * A regression that serialises combos[i].chain as a comma-joined string,
 * sets verified to null, or produces blank text/resolves_to values would
 * pass all GEX tests silently.
 *
 * Source: src-stdio/suggestions.ts — SuggestedCombo { name, chain: string[],
 * accomplishes, verified, notes? } and SuggestedPrompt { text, resolves_to }.
 *
 * GEY freezes:
 *
 *   GEY-1  combos[i].chain is a non-empty Array (not a scalar, not empty)
 *
 *   GEY-2  each item in combos[i].chain is a non-empty string (a namespaced
 *          tool name such as 'server/tool')
 *
 *   GEY-3  combos[i].verified is a boolean (true or false, not undefined/null/string)
 *
 *   GEY-4  prompts[i].text is a non-empty string
 *
 *   GEY-5  prompts[i].resolves_to is a non-empty string
 *
 * Fixture: FixtureBackend + focus:code + suggestionsCatalog with one combo
 * (chain: ['neon/list_projects', 'neon/create_project']) and one prompt.
 * Intent "list neon projects" resolves to neon/list_projects (first chain
 * step). KeywordOnlyCoordinator disables brain route for determinism.
 *
 * Frozen 2026-10-01.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (suggestions
 *     sub-object value types, not explanation sub-object fields)
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
  return join(tmpdir(), `ch1tty-gey-${Date.now()}-${++_seq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

const GEY_CATALOG = {
  code: {
    description: 'Neon database code tools',
    combos: [{
      name: 'neon-setup',
      chain: ['neon/list_projects', 'neon/create_project'],
      accomplishes: 'List existing Neon projects then create a new one',
      verified: true,
    }],
    prompts: [{
      text: 'List all Neon database projects in the workspace',
      resolves_to: 'neon/list_projects',
    }],
  },
};

const BASE_CONFIG: ServerConfig = {
  id: 'neon',
  name: 'Neon',
  type: 'remote',
  access: 'readwrite',
  category: 'code',
  endpoint: 'https://neon.tech/mcp',
  lazy: true,
};

function makeBackend(): FixtureBackend {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [
      {
        name: 'list_projects',
        description: 'List all neon database projects',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '["proj-1","proj-2"]' }] },
      },
      {
        name: 'create_project',
        description: 'Create a new neon database project',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
        response: { content: [{ type: 'text', text: '{"id":"proj-new"}' }] },
      },
    ],
    prompts: [],
    resources: [],
  });
  return backend;
}

function makeAgg(): Aggregator {
  const path = dlq();
  return new Aggregator([BASE_CONFIG], {
    backendFactory: () => makeBackend(),
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: GEY_CATALOG,
    focus: 'code',
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

/** Execute a chain cast and return the parsed chain_executed body. */
async function castChain(agg: Aggregator): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', chain: true });
  assert.equal(result.isError, undefined, `cast must not error: ${JSON.stringify(result.content)}`);
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(body['cast'], 'chain_executed', `expected chain_executed, got ${String(body['cast'])}`);
  return body;
}

/** Extract verified suggestions sub-object from chain_executed body. */
function getSuggestions(body: Record<string, unknown>): {
  combos: Array<Record<string, unknown>>;
  prompts: Array<Record<string, unknown>>;
} {
  const suggestions = body['suggestions'] as Record<string, unknown> | undefined;
  assert.ok(suggestions !== undefined, 'chain_executed must include suggestions when focus is active');
  assert.ok(typeof suggestions === 'object' && !Array.isArray(suggestions), 'suggestions must be a non-array object');
  const combos = suggestions['combos'] as Array<Record<string, unknown>>;
  const prompts = suggestions['prompts'] as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(combos), 'suggestions.combos must be an Array');
  assert.ok(Array.isArray(prompts), 'suggestions.prompts must be an Array');
  return { combos, prompts };
}

// ── GEY-1: combos[i].chain is a non-empty Array ──────────────────────────────

test('GEY-1: suggestions.combos[i].chain is a non-empty Array (not a scalar, not empty)', async () => {
  const agg = makeAgg();
  try {
    const body = await castChain(agg);
    const { combos } = getSuggestions(body);
    assert.ok(combos.length > 0, 'GEY-1: fixture combos must be non-empty');
    for (const combo of combos) {
      const chain = combo['chain'];
      assert.ok(
        Array.isArray(chain),
        `GEY-1: combos[i].chain must be an Array; got ${typeof chain} (value: ${JSON.stringify(chain)})`,
      );
      assert.ok(
        (chain as unknown[]).length > 0,
        `GEY-1: combos[i].chain must be non-empty; got [] for combo "${String(combo['name'])}"`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GEY-2: each item in combos[i].chain is a non-empty string ────────────────

test('GEY-2: each item in suggestions.combos[i].chain is a non-empty string', async () => {
  const agg = makeAgg();
  try {
    const body = await castChain(agg);
    const { combos } = getSuggestions(body);
    assert.ok(combos.length > 0, 'GEY-2: fixture combos must be non-empty');
    for (const combo of combos) {
      const chain = combo['chain'] as unknown[];
      assert.ok(Array.isArray(chain), 'GEY-2: combos[i].chain must be an Array');
      for (let idx = 0; idx < chain.length; idx++) {
        const item = chain[idx];
        assert.equal(
          typeof item,
          'string',
          `GEY-2: combos[i].chain[${idx}] must be a string; got ${typeof item} (value: ${JSON.stringify(item)})`,
        );
        assert.ok(
          (item as string).length > 0,
          `GEY-2: combos[i].chain[${idx}] must be non-empty`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GEY-3: combos[i].verified is a boolean ───────────────────────────────────

test('GEY-3: suggestions.combos[i].verified is a boolean (not undefined/null/string)', async () => {
  const agg = makeAgg();
  try {
    const body = await castChain(agg);
    const { combos } = getSuggestions(body);
    assert.ok(combos.length > 0, 'GEY-3: fixture combos must be non-empty');
    for (const combo of combos) {
      const verified = combo['verified'];
      assert.equal(
        typeof verified,
        'boolean',
        `GEY-3: combos[i].verified must be a boolean; got ${typeof verified} (value: ${JSON.stringify(verified)}) for combo "${String(combo['name'])}"`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GEY-4: prompts[i].text is a non-empty string ─────────────────────────────

test('GEY-4: suggestions.prompts[i].text is a non-empty string', async () => {
  const agg = makeAgg();
  try {
    const body = await castChain(agg);
    const { prompts } = getSuggestions(body);
    assert.ok(prompts.length > 0, 'GEY-4: fixture prompts must be non-empty');
    for (let idx = 0; idx < prompts.length; idx++) {
      const prompt = prompts[idx]!;
      assert.equal(
        typeof prompt['text'],
        'string',
        `GEY-4: prompts[${idx}].text must be a string; got ${typeof prompt['text']}`,
      );
      assert.ok(
        (prompt['text'] as string).length > 0,
        `GEY-4: prompts[${idx}].text must be non-empty`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GEY-5: prompts[i].resolves_to is a non-empty string ──────────────────────

test('GEY-5: suggestions.prompts[i].resolves_to is a non-empty string', async () => {
  const agg = makeAgg();
  try {
    const body = await castChain(agg);
    const { prompts } = getSuggestions(body);
    assert.ok(prompts.length > 0, 'GEY-5: fixture prompts must be non-empty');
    for (let idx = 0; idx < prompts.length; idx++) {
      const prompt = prompts[idx]!;
      assert.equal(
        typeof prompt['resolves_to'],
        'string',
        `GEY-5: prompts[${idx}].resolves_to must be a string; got ${typeof prompt['resolves_to']}`,
      );
      assert.ok(
        (prompt['resolves_to'] as string).length > 0,
        `GEY-5: prompts[${idx}].resolves_to must be non-empty`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});
