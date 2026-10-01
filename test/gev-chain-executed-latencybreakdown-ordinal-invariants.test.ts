/**
 * GEV drift guard: freeze cast:chain_executed latencyBreakdown ordinal invariants.
 *
 * NNNN-3 froze the sum invariant for cast:executed:
 *   scoringMs + executionMs ≤ latencyMs + 5ms (tolerance for sub-ms capture gap)
 *
 * NNNN-4 and NNNN-5 froze individual non-negativity for cast:chain_executed:
 *   scoringMs ≥ 0  (NNNN-4)
 *   executionMs ≥ 0  (NNNN-5)
 *
 * Neither NNNN nor any subsequent test freezes the ORDINAL RELATIONSHIPS between
 * latencyBreakdown sub-fields and the top-level latencyMs for cast:chain_executed.
 * A regression that:
 *   (a) inflates latencyBreakdown.scoringMs beyond latencyMs (off-by-1000x unit bug)
 *   (b) swaps scoringMs and executionMs in the chain_executed path, making their sum
 *       exceed latencyMs by orders of magnitude
 *   (c) emits latencyMs = 0 on the chain_executed path (division guard reset, etc.)
 *   (d) emits NaN or Infinity in any latencyBreakdown field via a timing edge case
 *       (Date.now() returning the same value twice, division by zero, etc.)
 * would pass all prior tests since NNNN-4/5 only assert ≥ 0, not ≤ latencyMs.
 *
 * GEV freezes (cast:chain_executed only — cast:executed covered by NNNN-3 + BBBBB):
 *
 *   GEV-1  scoringMs + executionMs ≤ latencyMs + 5ms tolerance
 *          (parallel to NNNN-3; the 5ms tolerance accounts for the sub-millisecond
 *           gap between when scoringMs and latencyMs are captured — the same gap
 *           documented in NNNN-3's comment in src-stdio/aggregator.ts)
 *
 *   GEV-2  scoringMs ≤ latencyMs + 5ms
 *          (scoring alone must not exceed total — independent guard for the
 *           scenario where executionMs is 0 but scoringMs is inflated)
 *
 *   GEV-3  executionMs ≤ latencyMs + 5ms
 *          (execution alone must not exceed total — independent guard symmetric
 *           to GEV-2; catches a regression that injects chain wall-clock time
 *           outside latencyMs instead of inside it)
 *
 *   GEV-4  latencyMs is a finite non-negative number on cast:chain_executed
 *          (latencyMs must be ≥ 0 and Number.isFinite — typeof-only guards pass NaN
 *           and Infinity; this guards the top-level latencyMs field specifically,
 *           complementing GEV-5 which guards the latencyBreakdown sub-fields)
 *
 *   GEV-5  all latencyBreakdown values are finite (not NaN, not Infinity)
 *          (GER froze value types as 'number' but a number can be NaN or Infinity;
 *           this is the explicit finiteness guard for the chain_executed path)
 *
 * Fixture: same pattern as NNNN — two-backend map (neon + stripe), catalog with a
 * chain combo for the 'finance' focus, chain:true on the cast call to force
 * cast:chain_executed.
 *
 * Source: src-stdio/aggregator.ts
 *   latencyBreakdown on chain_executed path: { scoringMs, executionMs, registryMs }
 *   built analogously to the executed path (line ~1657 for executed, same logic
 *   for chain path).
 *
 * Frozen 2026-10-01.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (latencyBreakdown ordinal
 *     invariants, not explain sub-object)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

// ── Fixture helpers (mirrors NNNN pattern) ────────────────────────────────────

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-gev-${label}-${Date.now()}.jsonl`);
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
    finance: { description: 'Finance tools', categories: ['ecosystem' as const], servers: ['stripe'], boost: 0.5 },
  },
};

const BASE_CATALOG = {
  finance: {
    combos: [
      {
        name: 'invoice-then-list',
        chain: ['stripe/create_invoice', 'stripe/list_customers'],
        accomplishes: 'Create invoice then list customers',
      },
    ],
    prompts: [],
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
    ledgerDlqPath: dlqPath('agg'),
  });
}

/** Invoke cast with chain:true; assert and return the cast:chain_executed body. */
async function castChainExecuted(agg: Aggregator): Promise<Record<string, unknown>> {
  const r = await agg.callTool('ch1tty/cast', {
    intent: 'create stripe invoice',
    focus: 'finance',
    chain: true,
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

// ── GEV-1: scoringMs + executionMs ≤ latencyMs + 5ms ─────────────────────────

test('GEV-1: cast:chain_executed → scoringMs + executionMs ≤ latencyMs + 5ms tolerance', async () => {
  const agg = buildAgg();
  try {
    const body = await castChainExecuted(agg);
    const latencyMs = body['latencyMs'] as number;
    const breakdown = body['latencyBreakdown'] as Record<string, number>;
    const { scoringMs, executionMs } = breakdown;
    assert.ok(
      scoringMs + executionMs <= latencyMs + 5,
      `scoringMs(${scoringMs}) + executionMs(${executionMs}) = ${scoringMs + executionMs} > latencyMs(${latencyMs}) + 5ms tolerance`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEV-2: scoringMs ≤ latencyMs + 5ms ───────────────────────────────────────

test('GEV-2: cast:chain_executed → scoringMs ≤ latencyMs + 5ms', async () => {
  const agg = buildAgg();
  try {
    const body = await castChainExecuted(agg);
    const latencyMs = body['latencyMs'] as number;
    const breakdown = body['latencyBreakdown'] as Record<string, number>;
    const { scoringMs } = breakdown;
    assert.ok(
      scoringMs <= latencyMs + 5,
      `scoringMs(${scoringMs}) > latencyMs(${latencyMs}) + 5ms — scoring phase should not exceed total elapsed time`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEV-3: executionMs ≤ latencyMs + 5ms ─────────────────────────────────────

test('GEV-3: cast:chain_executed → executionMs ≤ latencyMs + 5ms', async () => {
  const agg = buildAgg();
  try {
    const body = await castChainExecuted(agg);
    const latencyMs = body['latencyMs'] as number;
    const breakdown = body['latencyBreakdown'] as Record<string, number>;
    const { executionMs } = breakdown;
    assert.ok(
      executionMs <= latencyMs + 5,
      `executionMs(${executionMs}) > latencyMs(${latencyMs}) + 5ms — execution phase should not exceed total elapsed time`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEV-4: latencyMs > 0 ─────────────────────────────────────────────────────

test('GEV-4: cast:chain_executed → latencyMs is a finite non-negative number (≥ 0)', async () => {
  const agg = buildAgg();
  try {
    const body = await castChainExecuted(agg);
    const latencyMs = body['latencyMs'] as number;
    assert.equal(typeof latencyMs, 'number', `latencyMs must be a number, got ${typeof latencyMs}`);
    assert.ok(
      latencyMs >= 0 && Number.isFinite(latencyMs),
      `latencyMs must be ≥ 0 and finite; got ${latencyMs}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEV-5: all latencyBreakdown values are finite ────────────────────────────

test('GEV-5: cast:chain_executed → all latencyBreakdown values are finite (not NaN, not Infinity)', async () => {
  const agg = buildAgg();
  try {
    const body = await castChainExecuted(agg);
    const breakdown = body['latencyBreakdown'] as Record<string, unknown>;
    for (const [key, val] of Object.entries(breakdown)) {
      assert.equal(typeof val, 'number', `latencyBreakdown.${key} must be a number, got ${typeof val}`);
      assert.ok(
        Number.isFinite(val as number),
        `latencyBreakdown.${key} must be finite (not NaN or Infinity), got ${val}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});
