/**
 * GEW drift guard: freeze cast:chain_executed `catalog` and `suggestions`
 * sub-object EXACT keysets.
 *
 * Background
 * ----------
 * cast:chain_executed always includes two sub-objects whose keysets have only
 * been partially frozen:
 *
 *   catalog    — EF (ef-cast-discovered-chain-shape-drift.test.ts) checks for
 *                REQUIRED fields via a missing-key assertion:
 *                  CATALOG_CHAIN_FIELDS.filter(k => !actual.includes(k))
 *                This passes silently if an extra field is added (e.g. `verified`,
 *                `notes`, `id`, `boostScore` leaking from the catalog entry or
 *                from the focus profile). A deepEqual exact freeze is missing.
 *
 *   suggestions — No test freezes the top-level key set of the suggestions
 *                sub-object that cast:chain_executed always includes when a
 *                catalogCombo is resolved (same catalog lookup as cast:executed).
 *                getSuggestionsForFocus returns { combos, prompts } — exactly 2
 *                keys — but a regression adding a `profiles`, `focus`, or `meta`
 *                key would pass all existing tests silently.
 *
 * Source refs
 * -----------
 *   catalog construction:
 *     catalog: { name: catalogCombo.name, chain: catalogCombo.chain,
 *                accomplishes: catalogCombo.accomplishes }
 *     src-stdio/aggregator.ts, chain_executed return block
 *     → Exactly 3 keys; `verified` and `notes` are intentionally stripped.
 *
 *   suggestions construction:
 *     getSuggestionsForFocus(focusName, this.suggestionsCatalog, { intent })
 *     → returns { combos: SuggestedCombo[], prompts: SuggestedPrompt[] }
 *     src-stdio/suggestions.ts line ~138
 *
 *   both are always present when a catalogCombo is resolved (comment in aggregator
 *   reads "focusName is always truthy here" and "focusSuggestions is always
 *   truthy when catalogCombo is non-null").
 *
 * GEW freezes (5 tests)
 * ---------------------
 *   GEW-1  catalog has EXACTLY {accomplishes, chain, name} — no extra fields
 *          like `verified`, `notes`, `id`, `boostScore`
 *   GEW-2  catalog EXACT keyset is stable with explain:true
 *          (the explain param must not inject extra fields into catalog)
 *   GEW-3  suggestions top-level has EXACTLY {combos, prompts}
 *          (no `profiles`, `focus`, `meta`, `catalog`, or other leak)
 *   GEW-4  suggestions.combos is an Array and suggestions.prompts is an Array
 *          (type guard — a string or object leak would fail here)
 *   GEW-5  both catalog and suggestions are present on a minimal chain_executed
 *          call (no explain, no sessionId) — they must always be present
 *
 * Fixture: same two-backend pattern as GEV (neon + stripe, finance focus,
 * catalog with invoice-then-list chain combo, chain:true to force chain_executed).
 *
 * Frozen 2026-10-01.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (catalog/suggestions
 *     sub-objects, not the explanation sub-object)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

// ── Fixture helpers (mirrors GEV pattern) ─────────────────────────────────────

let dlqSeq = 0;
function dlqPath(): string {
  return join(tmpdir(), `ch1tty-gew-${Date.now()}-${++dlqSeq}.jsonl`);
}

const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.test/mcp',
};
const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe Payments', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://stripe.test/mcp',
};

function makeBackend(tools: ToolEntry[]): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: tools.length, toolCacheAge: 0 }),
    listTools: async () => tools,
    callTool: async (): Promise<ToolCallResult> => ({ content: [{ type: 'text', text: 'ok' }] }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

const NEON_TOOLS: ToolEntry[] = [
  { name: 'run_sql', description: 'Run SQL queries on Neon database', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_projects', description: 'List Neon projects', inputSchema: { type: 'object', properties: {} } },
];
const STRIPE_TOOLS: ToolEntry[] = [
  { name: 'create_invoice', description: 'Create Stripe invoice for billing', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_customers', description: 'List Stripe customers', inputSchema: { type: 'object', properties: {} } },
];

const FOCUS_PROFILES = {
  profiles: {
    finance: {
      description: 'Finance tools',
      categories: ['ecosystem' as const],
      servers: ['stripe'],
      boost: 0.5,
    },
  },
};

const BASE_CATALOG = {
  finance: {
    combos: [
      {
        name: 'invoice-then-list',
        chain: ['stripe/create_invoice', 'stripe/list_customers'],
        accomplishes: 'Create invoice then list customers',
        verified: true,
        notes: 'Production-verified flow',
      },
    ],
    prompts: [
      {
        text: 'Create a stripe invoice and show customers',
        resolves_to: 'stripe/create_invoice',
      },
    ],
  },
};

function buildAgg(): Aggregator {
  const neonBackend = makeBackend(NEON_TOOLS);
  const stripeBackend = makeBackend(STRIPE_TOOLS);
  const backendMap: Record<string, Backend> = { neon: neonBackend, stripe: stripeBackend };
  return new Aggregator([NEON_CFG, STRIPE_CFG], {
    backendFactory: (cfg) => backendMap[cfg.id] ?? neonBackend,
    focusProfiles: FOCUS_PROFILES,
    suggestionsCatalog: BASE_CATALOG,
    ledgerDlqPath: dlqPath(),
  });
}

/** Invoke cast with chain:true and optional extra params; assert chain_executed; return body. */
async function castChainExecuted(
  agg: Aggregator,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const r = await agg.callTool('ch1tty/cast', {
    intent: 'create stripe invoice',
    focus: 'finance',
    chain: true,
    ...extra,
  });
  assert.equal((r as { isError?: unknown }).isError, undefined, 'cast must not return isError');
  const content = (r as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥1 content item');
  assert.equal(content[0]!.type, 'text', 'content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(
    body['cast'],
    'chain_executed',
    `expected cast:chain_executed, got cast="${String(body['cast'])}"`,
  );
  return body;
}

// ── GEW-1: catalog has EXACTLY {accomplishes, chain, name} ───────────────────

test('GEW-1: cast:chain_executed → catalog has EXACTLY {accomplishes, chain, name}', async () => {
  const agg = buildAgg();
  try {
    const body = await castChainExecuted(agg);
    const catalog = body['catalog'] as Record<string, unknown>;
    assert.ok(catalog !== null && typeof catalog === 'object' && !Array.isArray(catalog),
      'catalog must be a plain object');
    const actualKeys = Object.keys(catalog).sort();
    assert.deepEqual(
      actualKeys,
      ['accomplishes', 'chain', 'name'],
      `catalog must have EXACTLY {accomplishes, chain, name}; got ${JSON.stringify(actualKeys)}. ` +
      'Extra fields like verified, notes, id, or boostScore must not leak into the response.',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEW-2: catalog EXACT keyset is stable with explain:true ──────────────────

test('GEW-2: cast:chain_executed with explain:true → catalog still has EXACTLY {accomplishes, chain, name}', async () => {
  const agg = buildAgg();
  try {
    const body = await castChainExecuted(agg, { explain: true });
    const catalog = body['catalog'] as Record<string, unknown>;
    assert.ok(catalog !== null && typeof catalog === 'object' && !Array.isArray(catalog),
      'catalog must be a plain object');
    const actualKeys = Object.keys(catalog).sort();
    assert.deepEqual(
      actualKeys,
      ['accomplishes', 'chain', 'name'],
      `catalog must have EXACTLY {accomplishes, chain, name} even with explain:true; got ${JSON.stringify(actualKeys)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEW-3: suggestions top-level has EXACTLY {combos, prompts} ───────────────

test('GEW-3: cast:chain_executed → suggestions has EXACTLY {combos, prompts} at top level', async () => {
  const agg = buildAgg();
  try {
    const body = await castChainExecuted(agg);
    assert.ok('suggestions' in body, 'suggestions must be present in chain_executed');
    const suggestions = body['suggestions'] as Record<string, unknown>;
    assert.ok(suggestions !== null && typeof suggestions === 'object' && !Array.isArray(suggestions),
      'suggestions must be a plain object');
    const actualKeys = Object.keys(suggestions).sort();
    assert.deepEqual(
      actualKeys,
      ['combos', 'prompts'],
      `suggestions must have EXACTLY {combos, prompts}; got ${JSON.stringify(actualKeys)}. ` +
      'No extra fields like profiles, focus, meta, or catalog should be present.',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEW-4: suggestions.combos and suggestions.prompts are Arrays ──────────────

test('GEW-4: cast:chain_executed → suggestions.combos and suggestions.prompts are Arrays', async () => {
  const agg = buildAgg();
  try {
    const body = await castChainExecuted(agg);
    const suggestions = body['suggestions'] as { combos: unknown; prompts: unknown };
    assert.ok(Array.isArray(suggestions.combos),
      `suggestions.combos must be an Array, got ${typeof suggestions.combos}`);
    assert.ok(Array.isArray(suggestions.prompts),
      `suggestions.prompts must be an Array, got ${typeof suggestions.prompts}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GEW-5: catalog and suggestions are both present on minimal chain_executed ──

test('GEW-5: cast:chain_executed minimal call → catalog and suggestions are always present', async () => {
  const agg = buildAgg();
  try {
    // Minimal call: no explain, no sessionId — only chain:true + focus
    const body = await castChainExecuted(agg);
    assert.ok('catalog' in body, 'catalog must always be present in chain_executed');
    assert.ok('suggestions' in body, 'suggestions must always be present in chain_executed when catalogCombo resolves');
    const catalog = body['catalog'];
    const suggestions = body['suggestions'];
    assert.ok(catalog !== null && typeof catalog === 'object',
      `catalog must be an object, got ${typeof catalog}`);
    assert.ok(suggestions !== null && typeof suggestions === 'object',
      `suggestions must be an object, got ${typeof suggestions}`);
  } finally {
    await agg.shutdown();
  }
});
