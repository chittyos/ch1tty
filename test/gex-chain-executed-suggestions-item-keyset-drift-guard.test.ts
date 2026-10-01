/**
 * GEX drift guard: freeze cast:chain_executed `suggestions.combos[i]` and
 * `suggestions.prompts[i]` item-level EXACT keysets.
 *
 * Background
 * ----------
 * GEW (PR #1680) froze the top-level keyset of the `suggestions` sub-object:
 *   suggestions → EXACTLY {combos, prompts}
 * and verified that both are Arrays. GEW does NOT freeze the keyset of each
 * item inside those arrays.
 *
 * A regression adding `score`, `rank`, `id`, or `boostScore` to combo items,
 * or accidentally stripping `verified`, would pass all GEW tests silently.
 *
 * Source refs (src-stdio/suggestions.ts)
 * ---------------------------------------
 *   SuggestedCombo: { name: string; chain: string[]; accomplishes: string;
 *                     verified: boolean; notes?: string; }
 *   SuggestedPrompt: { text: string; resolves_to: string; }
 *
 *   getSuggestionsForFocus returns SuggestedCombo[] and SuggestedPrompt[]
 *   objects DIRECTLY from the catalog (no stripping). This is intentionally
 *   different from the `catalog` sub-object, which strips `verified`/`notes`
 *   and keeps only {name, chain, accomplishes}.
 *
 * GEX freezes (5 tests)
 * ---------------------
 *   GEX-1  suggestions.combos[i] — required fields {accomplishes, chain,
 *          name, verified} always present
 *   GEX-2  suggestions.combos[i] — no unexpected keys beyond
 *          {accomplishes, chain, name, notes, verified} (notes is optional)
 *   GEX-3  suggestions.prompts[i] — exactly {resolves_to, text}
 *   GEX-4  suggestions.combos[i] notes — present when catalog has it, absent
 *          when catalog lacks it
 *   GEX-5  keysets stable with explain:true
 *
 * Fixture: one-backend (stripe), catalog with two combos (one with notes,
 * one without) and one prompt.
 *
 * Frozen 2026-10-01.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (suggestions item
 *     keysets, not the explanation sub-object)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

// ── Fixture helpers ────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlqPath(): string {
  return join(tmpdir(), `ch1tty-gex-${Date.now()}-${++dlqSeq}.jsonl`);
}

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

// Two combos: one WITH notes (verified), one WITHOUT notes.
// This lets GEX-4 verify notes presence mirrors the catalog source.
const BASE_CATALOG = {
  finance: {
    description: 'Finance combos',
    combos: [
      {
        name: 'invoice-then-list',
        chain: ['stripe/create_invoice', 'stripe/list_customers'],
        accomplishes: 'Create invoice then list customers',
        verified: true,
        notes: 'Production-verified flow',
      },
      {
        name: 'list-customers-only',
        chain: ['stripe/list_customers'],
        accomplishes: 'List all Stripe customers',
        verified: false,
        // intentionally no notes field
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
  const backend = makeBackend(STRIPE_TOOLS);
  return new Aggregator([STRIPE_CFG], {
    backendFactory: () => backend,
    focusProfiles: FOCUS_PROFILES,
    suggestionsCatalog: BASE_CATALOG,
    ledgerDlqPath: dlqPath(),
  });
}

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

// ── GEX-1: suggestions.combos[i] required fields always present ───────────────

test('GEX-1: cast:chain_executed → suggestions.combos[i] has required fields {accomplishes, chain, name, verified}', async () => {
  const agg = buildAgg();
  try {
    const body = await castChainExecuted(agg);
    const suggestions = body['suggestions'] as { combos: Array<Record<string, unknown>> };
    assert.ok(Array.isArray(suggestions.combos) && suggestions.combos.length > 0,
      'suggestions.combos must be a non-empty array');
    const REQUIRED = ['accomplishes', 'chain', 'name', 'verified'];
    for (const combo of suggestions.combos) {
      for (const key of REQUIRED) {
        assert.ok(key in combo,
          `GEX-1: combo item must have "${key}"; got keys ${JSON.stringify(Object.keys(combo).sort())}`);
      }
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GEX-2: suggestions.combos[i] no unexpected keys ──────────────────────────

test('GEX-2: cast:chain_executed → suggestions.combos[i] has no keys outside {accomplishes, chain, name, notes, verified}', async () => {
  const agg = buildAgg();
  try {
    const body = await castChainExecuted(agg);
    const suggestions = body['suggestions'] as { combos: Array<Record<string, unknown>> };
    assert.ok(Array.isArray(suggestions.combos), 'suggestions.combos must be an array');
    const ALLOWED = new Set(['accomplishes', 'chain', 'name', 'notes', 'verified']);
    for (const combo of suggestions.combos) {
      const extra = Object.keys(combo).filter((k) => !ALLOWED.has(k));
      assert.deepEqual(
        extra,
        [],
        `GEX-2: combo item has unexpected keys ${JSON.stringify(extra)}; ` +
        'only {accomplishes, chain, name, notes, verified} are allowed',
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GEX-3: suggestions.prompts[i] exact keyset {resolves_to, text} ───────────

test('GEX-3: cast:chain_executed → suggestions.prompts[i] has EXACTLY {resolves_to, text}', async () => {
  const agg = buildAgg();
  try {
    const body = await castChainExecuted(agg);
    const suggestions = body['suggestions'] as { prompts: Array<Record<string, unknown>> };
    assert.ok(Array.isArray(suggestions.prompts) && suggestions.prompts.length > 0,
      'suggestions.prompts must be a non-empty array');
    for (const prompt of suggestions.prompts) {
      const actualKeys = Object.keys(prompt).sort();
      assert.deepEqual(
        actualKeys,
        ['resolves_to', 'text'],
        `GEX-3: prompt item must have EXACTLY {resolves_to, text}; got ${JSON.stringify(actualKeys)}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GEX-4: suggestions.combos[i] notes present iff catalog source has notes ───

test('GEX-4: cast:chain_executed → suggestions.combos[i] notes present iff catalog source has notes', async () => {
  const agg = buildAgg();
  try {
    const body = await castChainExecuted(agg);
    const suggestions = body['suggestions'] as { combos: Array<Record<string, unknown>> };
    assert.ok(Array.isArray(suggestions.combos) && suggestions.combos.length >= 2,
      'GEX-4 requires ≥2 combo items in suggestions');
    const withNotes = suggestions.combos.filter((c) => 'notes' in c);
    const withoutNotes = suggestions.combos.filter((c) => !('notes' in c));
    assert.ok(withNotes.length >= 1,
      `GEX-4: at least one combo must have notes; got ${JSON.stringify(suggestions.combos.map((c) => Object.keys(c).sort()))}`);
    assert.ok(withoutNotes.length >= 1,
      `GEX-4: at least one combo must lack notes; got ${JSON.stringify(suggestions.combos.map((c) => Object.keys(c).sort()))}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GEX-5: keysets stable with explain:true ───────────────────────────────────

test('GEX-5: cast:chain_executed with explain:true → combo and prompt item keysets unchanged', async () => {
  const agg = buildAgg();
  try {
    const body = await castChainExecuted(agg, { explain: true });
    const suggestions = body['suggestions'] as {
      combos: Array<Record<string, unknown>>;
      prompts: Array<Record<string, unknown>>;
    };
    assert.ok(Array.isArray(suggestions.combos) && suggestions.combos.length > 0,
      'suggestions.combos must be non-empty with explain:true');
    assert.ok(Array.isArray(suggestions.prompts) && suggestions.prompts.length > 0,
      'suggestions.prompts must be non-empty with explain:true');
    const REQUIRED = ['accomplishes', 'chain', 'name', 'verified'];
    const ALLOWED = new Set(['accomplishes', 'chain', 'name', 'notes', 'verified']);
    for (const combo of suggestions.combos) {
      for (const key of REQUIRED) {
        assert.ok(key in combo, `GEX-5: combo must have "${key}" with explain:true`);
      }
      const extra = Object.keys(combo).filter((k) => !ALLOWED.has(k));
      assert.deepEqual(extra, [],
        `GEX-5: combo has unexpected keys ${JSON.stringify(extra)} with explain:true`);
    }
    for (const prompt of suggestions.prompts) {
      const actualKeys = Object.keys(prompt).sort();
      assert.deepEqual(actualKeys, ['resolves_to', 'text'],
        `GEX-5: prompt item must be {resolves_to, text} with explain:true; got ${JSON.stringify(actualKeys)}`);
    }
  } finally {
    await agg.shutdown();
  }
});
