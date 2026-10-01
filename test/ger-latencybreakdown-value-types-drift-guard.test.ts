/**
 * GER drift guard: freeze cast:chain_executed (and cast:executed) latencyBreakdown
 * sub-object VALUE TYPES.
 *
 * GEQ (PR #1673) freezes the latencyBreakdown EXACT KEY SET
 * {scoringMs, executionMs, registryMs} (plus optional brainMs on brain route).
 * GEQ does NOT assert what types those values must have.
 *
 * A regression that emits:
 *   latencyBreakdown: { scoringMs: "12", executionMs: null, registryMs: -5 }
 * passes GEQ's keyset check but violates the contract that these fields are
 * finite non-negative numbers representing milliseconds.
 *
 * The sub-object is built at two distinct code paths
 * (src-stdio/aggregator.ts):
 *   ~line 1535 (chain_executed):
 *     latencyBreakdown: { scoringMs: chainScoringMs, executionMs: chainExecutionMs,
 *                         registryMs, ...(brain ? { brainMs } : {}) }
 *   ~line 1657 (executed):
 *     latencyBreakdown: { scoringMs: execScoringMs, executionMs,
 *                         registryMs, ...(brain ? { brainMs } : {}) }
 *
 * A refactor of one path that changes its types can pass all prior tests.
 * GER freezes both paths independently.
 *
 * Source invariants (per aggregator comment):
 *   - scoringMs: wall time of registry fetch + intent routing/scoring (pre-execution)
 *   - executionMs: wall time of the backend call(s)
 *   - registryMs: wall time of getRegistry() only — a SUB-COMPONENT of scoringMs
 *   → registryMs ≤ scoringMs must hold
 *
 * GER freezes:
 *
 *   GER-1  cast:chain_executed — scoringMs is a finite non-negative number.
 *          (typeof === 'number', Number.isFinite, >= 0)
 *
 *   GER-2  cast:chain_executed — executionMs is a finite non-negative number.
 *
 *   GER-3  cast:chain_executed — registryMs is a finite non-negative number.
 *
 *   GER-4  cast:chain_executed — registryMs ≤ scoringMs.
 *          (registryMs is a sub-component of scoringMs per aggregator docs;
 *           a regression swapping the two assignments violates this inequality.)
 *
 *   GER-5  cast:executed — scoringMs, executionMs, and registryMs all finite
 *          non-negative numbers (separate code path at ~line 1657).
 *
 * Frozen 2026-10-01.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (latencyBreakdown
 *     sub-object value types, not explanation fields)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CATALOG = {
  code: {
    description: 'Code focus',
    combos: [{
      name: 'neon-setup',
      chain: ['neon/list_projects', 'neon/create_project'],
      accomplishes: 'List then create a Neon project',
      verified: true,
    }],
    prompts: [],
  },
};

const FOCUS_PROFILES = {
  profiles: {
    code: { categories: ['code' as const], servers: ['neon'], boost: 0.5 },
  },
};

const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true,
};

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-ger-${Date.now()}-${++_seq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [
      {
        name: 'list_projects',
        description: 'list neon database projects',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'resource', resource: { uri: 'neon://projects', name: 'projects' } }] },
      },
      {
        name: 'create_project',
        description: 'create a neon database project',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
        response: { content: [{ type: 'resource', resource: { uri: 'neon://project/new', name: 'new-project' } }] },
      },
    ],
  });
  const path = dlq();
  return new Aggregator([NEON_CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: CATALOG,
    focusProfiles: FOCUS_PROFILES,
    focus: 'code',
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

const INTENT = 'list neon database projects';

async function castChain(agg: Aggregator): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, chain: true });
  assert.equal(result.isError, undefined,
    `cast must not error: ${JSON.stringify(result.content)}`);
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(body['cast'], 'chain_executed',
    `expected chain_executed, got ${String(body['cast'])}`);
  return body;
}

async function castExecuted(agg: Aggregator): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, chain: false });
  assert.equal(result.isError, undefined,
    `cast must not error: ${JSON.stringify(result.content)}`);
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  // cast:executed or cast:resolved; either has latencyBreakdown
  assert.ok(
    body['cast'] === 'executed' || body['cast'] === 'resolved',
    `expected executed or resolved, got ${String(body['cast'])}`,
  );
  return body;
}

function assertFiniteNonNeg(value: unknown, label: string): void {
  assert.equal(typeof value, 'number',
    `${label} must be typeof 'number', got ${typeof value}`);
  assert.ok(Number.isFinite(value as number),
    `${label} must be finite, got ${value}`);
  assert.ok((value as number) >= 0,
    `${label} must be >= 0, got ${value}`);
}

// ── GER-1: chain_executed scoringMs is a finite non-negative number ───────────

test('GER-1: chain_executed latencyBreakdown.scoringMs is a finite non-negative number', async () => {
  const agg = makeAgg();
  try {
    const body = await castChain(agg);
    const lb = body['latencyBreakdown'] as Record<string, unknown>;
    assert.ok(lb !== null && typeof lb === 'object' && !Array.isArray(lb),
      `latencyBreakdown must be a plain object, got ${typeof lb}`);
    assertFiniteNonNeg(lb['scoringMs'], 'latencyBreakdown.scoringMs');
  } finally {
    await agg.shutdown();
  }
});

// ── GER-2: chain_executed executionMs is a finite non-negative number ─────────

test('GER-2: chain_executed latencyBreakdown.executionMs is a finite non-negative number', async () => {
  const agg = makeAgg();
  try {
    const body = await castChain(agg);
    const lb = body['latencyBreakdown'] as Record<string, unknown>;
    assertFiniteNonNeg(lb['executionMs'], 'latencyBreakdown.executionMs');
  } finally {
    await agg.shutdown();
  }
});

// ── GER-3: chain_executed registryMs is a finite non-negative number ──────────

test('GER-3: chain_executed latencyBreakdown.registryMs is a finite non-negative number', async () => {
  const agg = makeAgg();
  try {
    const body = await castChain(agg);
    const lb = body['latencyBreakdown'] as Record<string, unknown>;
    assertFiniteNonNeg(lb['registryMs'], 'latencyBreakdown.registryMs');
  } finally {
    await agg.shutdown();
  }
});

// ── GER-4: chain_executed registryMs ≤ scoringMs (sub-component invariant) ───

test('GER-4: chain_executed latencyBreakdown.registryMs <= scoringMs (sub-component constraint)', async () => {
  const agg = makeAgg();
  try {
    const body = await castChain(agg);
    const lb = body['latencyBreakdown'] as Record<string, unknown>;
    const registryMs = lb['registryMs'] as number;
    const scoringMs = lb['scoringMs'] as number;
    assert.ok(
      typeof registryMs === 'number' && typeof scoringMs === 'number',
      `both registryMs and scoringMs must be numbers to compare`,
    );
    assert.ok(
      registryMs <= scoringMs,
      `registryMs (${registryMs}) must be <= scoringMs (${scoringMs}): registryMs is a sub-component of scoringMs`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GER-5: cast:executed latencyBreakdown Ms fields are finite non-negative numbers ─

test('GER-5: cast:executed latencyBreakdown scoringMs/executionMs/registryMs are finite non-negative numbers', async () => {
  const agg = makeAgg();
  try {
    const body = await castExecuted(agg);
    const lb = body['latencyBreakdown'] as Record<string, unknown>;
    assert.ok(lb !== null && typeof lb === 'object' && !Array.isArray(lb),
      `cast:executed latencyBreakdown must be a plain object, got ${typeof lb}`);
    assertFiniteNonNeg(lb['scoringMs'], 'cast:executed latencyBreakdown.scoringMs');
    assertFiniteNonNeg(lb['executionMs'], 'cast:executed latencyBreakdown.executionMs');
    assertFiniteNonNeg(lb['registryMs'], 'cast:executed latencyBreakdown.registryMs');
  } finally {
    await agg.shutdown();
  }
});
