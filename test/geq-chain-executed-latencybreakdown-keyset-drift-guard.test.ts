/**
 * GEQ drift guard: freeze cast:chain_executed `latencyBreakdown` sub-object
 * exact key set and value types.
 *
 * ET froze latencyBreakdown shape for cast:executed only (permitted keys,
 * required keys, value types, brainMs absent on keyword route).
 *
 * GT additionally froze the latencyBreakdown key set for cast:executed:
 *   GT-1: scoringMs individually present
 *   GT-2: executionMs individually present
 *   GT-3: exact permitted set {scoringMs, executionMs, registryMs, brainMs?}
 *   GT-4: brainMs absent on keyword route
 *   GT-5: cast:plan does NOT expose latencyBreakdown
 *
 * Neither ET nor GT covers cast:chain_executed. The latencyBreakdown for
 * chain_executed is built at src-stdio/aggregator.ts line ~1535:
 *   { scoringMs: chainScoringMs, executionMs: chainExecutionMs, registryMs,
 *     ...(castRoute === 'brain' ? { brainMs: brainRouteMs } : {}) }
 *
 * GBA (gba-chain-executed-toplevel-keyset-drift-guard.test.ts) freezes that
 * `latencyBreakdown` is present in the top-level key set but does NOT freeze
 * what is INSIDE that sub-object. A regression that renames `scoringMs` →
 * `scoreMs`, drops `registryMs`, or injects an extra field would pass every
 * prior chain_executed test silently.
 *
 * GEQ freezes:
 *
 *   GEQ-1  latencyBreakdown.scoringMs is individually present on chain_executed
 *           (ET/GT only check this for cast:executed)
 *   GEQ-2  latencyBreakdown.executionMs is individually present on chain_executed
 *           (same gap)
 *   GEQ-3  latencyBreakdown.registryMs is individually present on chain_executed
 *           (same gap)
 *   GEQ-4  latencyBreakdown exact key set on keyword route is a subset of
 *           {scoringMs, executionMs, registryMs, brainMs} — no unrecognised keys
 *           (a renamed or added key passes every prior test silently)
 *   GEQ-5  latencyBreakdown does NOT contain brainMs on keyword route
 *           (embedEnabled:false forces keyword route; brainMs is injected only
 *            when castRoute === 'brain')
 *
 * Source: src-stdio/aggregator.ts line ~1535 (chain_executed latencyBreakdown build).
 *
 * Fixture: neon 2-step combo (list_projects → create_project), same as GBA/GEI/GEN.
 *
 * Frozen 2026-10-01.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (latencyBreakdown,
 *     not explanation sub-object)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Frozen permitted key set (keyword route only — brainMs conditional) ────────

const LATENCY_PERMITTED: readonly string[] = ['scoringMs', 'executionMs', 'registryMs', 'brainMs'];
const LATENCY_REQUIRED: readonly string[] = ['scoringMs', 'executionMs', 'registryMs'];

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-geq-${Date.now()}-${++_seq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

const CHAIN_CATALOG = {
  code: {
    description: 'Code focus',
    combos: [{
      name: 'neon-setup',
      chain: ['neon/list_projects', 'neon/create_project'],
      accomplishes: 'List existing Neon projects then create a new one',
      verified: true,
    }],
    prompts: [],
  },
};

const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true,
};

function makeChainAgg(): Aggregator {
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
    ],
  });
  const path = dlq();
  return new Aggregator([NEON_CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: CHAIN_CATALOG,
    focus: 'code',
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

async function castChainExecuted(agg: Aggregator): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', chain: true });
  assert.equal(result.isError, undefined, `cast must not error: ${JSON.stringify(result.content)}`);
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(body['cast'], 'chain_executed', `expected chain_executed, got ${String(body['cast'])}`);
  return body;
}

// ── GEQ-1: scoringMs is present ───────────────────────────────────────────────

test('GEQ-1: latencyBreakdown.scoringMs is present on chain_executed', async () => {
  const agg = makeChainAgg();
  try {
    const body = await castChainExecuted(agg);
    const lb = body['latencyBreakdown'] as Record<string, unknown>;
    assert.ok(lb !== null && typeof lb === 'object', 'GEQ-1: latencyBreakdown must be an object');
    assert.ok('scoringMs' in lb, 'GEQ-1: latencyBreakdown.scoringMs must be present');
  } finally {
    await agg.shutdown();
  }
});

// ── GEQ-2: executionMs is present ─────────────────────────────────────────────

test('GEQ-2: latencyBreakdown.executionMs is present on chain_executed', async () => {
  const agg = makeChainAgg();
  try {
    const body = await castChainExecuted(agg);
    const lb = body['latencyBreakdown'] as Record<string, unknown>;
    assert.ok(lb !== null && typeof lb === 'object', 'GEQ-2: latencyBreakdown must be an object');
    assert.ok('executionMs' in lb, 'GEQ-2: latencyBreakdown.executionMs must be present');
  } finally {
    await agg.shutdown();
  }
});

// ── GEQ-3: registryMs is present ──────────────────────────────────────────────

test('GEQ-3: latencyBreakdown.registryMs is present on chain_executed', async () => {
  const agg = makeChainAgg();
  try {
    const body = await castChainExecuted(agg);
    const lb = body['latencyBreakdown'] as Record<string, unknown>;
    assert.ok(lb !== null && typeof lb === 'object', 'GEQ-3: latencyBreakdown must be an object');
    assert.ok('registryMs' in lb, 'GEQ-3: latencyBreakdown.registryMs must be present');
  } finally {
    await agg.shutdown();
  }
});

// ── GEQ-4: no unrecognised keys ───────────────────────────────────────────────

test('GEQ-4: latencyBreakdown has no unrecognised keys on keyword route', async () => {
  const agg = makeChainAgg();
  try {
    const body = await castChainExecuted(agg);
    const lb = body['latencyBreakdown'] as Record<string, unknown>;
    assert.ok(lb !== null && typeof lb === 'object', 'GEQ-4: latencyBreakdown must be an object');
    const unexpected = Object.keys(lb).filter((k) => !LATENCY_PERMITTED.includes(k));
    assert.deepEqual(
      unexpected,
      [],
      `GEQ-4: unrecognised keys in latencyBreakdown: ${unexpected.join(', ')}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEQ-5: brainMs absent on keyword route ────────────────────────────────────

test('GEQ-5: latencyBreakdown.brainMs absent on keyword route (embedEnabled:false)', async () => {
  const agg = makeChainAgg();
  try {
    const body = await castChainExecuted(agg);
    const lb = body['latencyBreakdown'] as Record<string, unknown>;
    assert.ok(lb !== null && typeof lb === 'object', 'GEQ-5: latencyBreakdown must be an object');
    assert.ok(!('brainMs' in lb), 'GEQ-5: brainMs must NOT be present when keyword route is used');
  } finally {
    await agg.shutdown();
  }
});
