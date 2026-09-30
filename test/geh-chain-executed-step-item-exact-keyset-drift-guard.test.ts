/**
 * GEH drift guard: freeze cast:chain_executed step item exact top-level key set
 * for the ok:true and ok:false branches independently.
 *
 * EJ (ej-chain-executed-step-catalog-shape.test.ts) frozen 2026-09-19 guards:
 *   – step items have no UNEXPECTED keys (keys ⊆ PERMITTED)
 *   – step items have all REQUIRED keys (REQUIRED ⊆ keys)
 *   – catalog sub-object has exactly {accomplishes, chain, name}
 *
 * The step-item guard in EJ is a no-unexpected-keys + required-keys pair, NOT
 * an exact equality freeze. The remaining gap:
 *
 *   A regression that adds `error` to ok:true steps (both `content` AND `error`
 *   present), or adds `content` to ok:false steps (both present), passes EJ
 *   because the check only compares against PERMITTED = {content, error, ok, step, tool}.
 *   Exact equality is never asserted per branch.
 *
 * Source: src-stdio/aggregator.ts lines ~1501, ~1509:
 *   ok:false → steps.push({ step: i, tool: stepTool, ok: false, error: errText })
 *   ok:true  → steps.push({ step: i, tool: stepTool, ok: true,  content: r.content })
 *
 * GEH freezes:
 *
 *   GEH-1  ok:true step item has EXACTLY {content, ok, step, tool} — 4 keys.
 *          (EJ PERMITTED check passes if `error` is also present; deepEqual fails.)
 *
 *   GEH-2  ok:false step item has EXACTLY {error, ok, step, tool} — 4 keys.
 *          (EJ PERMITTED check passes if `content` is also present; deepEqual fails.)
 *
 *   GEH-3  ok:true step item: `error` key is ABSENT (dedicated absence guard;
 *          belt-and-suspenders alongside the deepEqual in GEH-1; catches the
 *          symmetric regression without needing to read the full key set).
 *
 *   GEH-4  ok:false step item: `content` key is ABSENT (symmetric to GEH-3).
 *
 *   GEH-5  In a multi-step chain all steps have `step` values [0, 1, …, N-1]
 *          — sequential, 0-based, ascending — no duplicate or skipped indices.
 *          (Type + ordering guard for the step index field.)
 *
 * Fixture: neon combo (list_projects → create_project) — same pattern as EJ.
 * Success path (GEH-1/3/5): both steps ok:true.
 * Partial-failure path (GEH-2/4): first step ok:true, second ok:false.
 *
 * Frozen 2026-09-30.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (step item key set,
 *     not explanation sub-object fields)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Frozen exact step item key sets ──────────────────────────────────────────

const STEP_OK_TRUE_KEYS: readonly string[] = ['content', 'ok', 'step', 'tool'];
const STEP_OK_FALSE_KEYS: readonly string[] = ['error', 'ok', 'step', 'tool'];

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-geh-${Date.now()}-${++_seq}.jsonl`);
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

function makeSuccessChainAgg(): Aggregator {
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

function makePartialFailChainAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [
      {
        name: 'list_projects',
        description: 'list neon projects',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '["proj-1"]' }] },
      },
      {
        name: 'create_project',
        description: 'create a neon project',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
        response: 'error',
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

// ── GEH-1: ok:true step item has EXACTLY {content, ok, step, tool} ────────────

test('GEH-1: ok:true step item has EXACTLY {content, ok, step, tool} — 4 keys', async () => {
  const agg = makeSuccessChainAgg();
  try {
    const body = await castChainExecuted(agg);
    const steps = body['steps'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(steps) && steps.length > 0, 'GEH-1: steps must be a non-empty array');
    const okTrue = steps.filter((s) => s['ok'] === true);
    assert.ok(okTrue.length > 0, 'GEH-1: at least one ok:true step is required');
    for (const s of okTrue) {
      const actual = Object.keys(s).sort();
      const expected = [...STEP_OK_TRUE_KEYS].sort();
      assert.deepEqual(
        actual,
        expected,
        `GEH-1: ok:true step item exact key set mismatch.\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GEH-2: ok:false step item has EXACTLY {error, ok, step, tool} ─────────────

test('GEH-2: ok:false step item has EXACTLY {error, ok, step, tool} — 4 keys', async () => {
  const agg = makePartialFailChainAgg();
  try {
    const body = await castChainExecuted(agg);
    const steps = body['steps'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(steps) && steps.length > 0, 'GEH-2: steps must be a non-empty array');
    const okFalse = steps.filter((s) => s['ok'] === false);
    assert.ok(okFalse.length > 0, 'GEH-2: at least one ok:false step is required');
    for (const s of okFalse) {
      const actual = Object.keys(s).sort();
      const expected = [...STEP_OK_FALSE_KEYS].sort();
      assert.deepEqual(
        actual,
        expected,
        `GEH-2: ok:false step item exact key set mismatch.\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GEH-3: ok:true step: `error` key is ABSENT ───────────────────────────────

test('GEH-3: ok:true step item: error key is ABSENT', async () => {
  const agg = makeSuccessChainAgg();
  try {
    const body = await castChainExecuted(agg);
    const steps = body['steps'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(steps) && steps.length > 0, 'GEH-3: steps must be non-empty');
    const okTrue = steps.filter((s) => s['ok'] === true);
    assert.ok(okTrue.length > 0, 'GEH-3: at least one ok:true step required');
    for (const s of okTrue) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(s, 'error'),
        false,
        `GEH-3: error must be absent on ok:true step; got keys: ${JSON.stringify(Object.keys(s))}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GEH-4: ok:false step: `content` key is ABSENT ────────────────────────────

test('GEH-4: ok:false step item: content key is ABSENT', async () => {
  const agg = makePartialFailChainAgg();
  try {
    const body = await castChainExecuted(agg);
    const steps = body['steps'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(steps) && steps.length > 0, 'GEH-4: steps must be non-empty');
    const okFalse = steps.filter((s) => s['ok'] === false);
    assert.ok(okFalse.length > 0, 'GEH-4: at least one ok:false step required');
    for (const s of okFalse) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(s, 'content'),
        false,
        `GEH-4: content must be absent on ok:false step; got keys: ${JSON.stringify(Object.keys(s))}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GEH-5: step values are sequential 0-based ascending integers ─────────────

test('GEH-5: step index values are 0-based ascending integers with no gaps or duplicates', async () => {
  const agg = makeSuccessChainAgg();
  try {
    const body = await castChainExecuted(agg);
    const steps = body['steps'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(steps) && steps.length > 0, 'GEH-5: steps must be non-empty');
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]!;
      assert.equal(
        typeof s['step'],
        'number',
        `GEH-5: step[${i}].step must be a number; got ${typeof s['step']}`,
      );
      assert.equal(
        s['step'],
        i,
        `GEH-5: step[${i}].step must equal ${i} (0-based ascending); got ${String(s['step'])}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});
