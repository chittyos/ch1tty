import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

/**
 * GEI drift guard: freeze cast:chain_executed step item VALUE TYPES per branch.
 *
 * GEH froze the EXACT KEY SETS for ok:true and ok:false step items.
 * GEI freezes the runtime TYPES of each field:
 *
 *   ok:true  step → { content: Array, ok: boolean(true),  step: integer≥0, tool: non-empty string }
 *   ok:false step → { error:   string, ok: boolean(false), step: integer≥0, tool: non-empty string }
 *
 * Source: src-stdio/aggregator.ts
 *   ok:false → steps.push({ step: i, tool: stepTool, ok: false, error: errText })
 *   ok:true  → steps.push({ step: i, tool: stepTool, ok: true,  content: r.content })
 *
 * Remaining gap after GEH:
 *   EJ guards shape structure; GEH guards key sets; neither checks that
 *   `content` is an array (not a string or object), `ok` is a real boolean
 *   (not a truthy string), `step` is a non-negative integer, `tool` is a
 *   non-empty string. A refactor turning `r.content` into a plain string
 *   would pass both EJ and GEH silently.
 *
 * GEI-1  ok:true step.content is an Array (not string/null/object).
 * GEI-2  ok:true step.ok is boolean true (strict, not truthy).
 * GEI-3  ok:false step.error is a non-empty string.
 * GEI-4  ok:false step.ok is boolean false (strict, not falsy).
 * GEI-5  Every step.step is a non-negative safe integer; step.tool is a
 *        non-empty string (both branches in one sweep).
 *
 * Fixture: same neon combo (list_projects → create_project) as GEH.
 * Success path (GEI-1/2/5): both steps ok:true.
 * Partial-failure path (GEI-3/4/5): first step ok:true, second ok:false.
 *
 * Frozen 2026-09-30.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (step item field types)
 */

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gei-${Date.now()}-${++_seq}.jsonl`);
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

// ── GEI-1: ok:true step.content is an Array ───────────────────────────────────

test('GEI-1: ok:true step item.content is an Array (not string/null/object)', async () => {
  const agg = makeSuccessChainAgg();
  try {
    const body = await castChainExecuted(agg);
    const steps = body['steps'] as Array<Record<string, unknown>>;
    const okTrue = steps.filter((s) => s['ok'] === true);
    assert.ok(okTrue.length > 0, 'GEI-1: at least one ok:true step required');
    for (const s of okTrue) {
      assert.ok(
        Array.isArray(s['content']),
        `GEI-1: ok:true step.content must be Array, got ${typeof s['content']}: ${JSON.stringify(s['content'])}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GEI-2: ok:true step.ok is strict boolean true ─────────────────────────────

test('GEI-2: ok:true step item.ok is strict boolean true', async () => {
  const agg = makeSuccessChainAgg();
  try {
    const body = await castChainExecuted(agg);
    const steps = body['steps'] as Array<Record<string, unknown>>;
    const okTrue = steps.filter((s) => s['ok'] === true);
    assert.ok(okTrue.length > 0, 'GEI-2: at least one ok:true step required');
    for (const s of okTrue) {
      assert.strictEqual(
        s['ok'],
        true,
        `GEI-2: ok:true step.ok must be boolean true, got ${typeof s['ok']}(${String(s['ok'])})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GEI-3: ok:false step.error is a non-empty string ─────────────────────────

test('GEI-3: ok:false step item.error is a non-empty string', async () => {
  const agg = makePartialFailChainAgg();
  try {
    const body = await castChainExecuted(agg);
    const steps = body['steps'] as Array<Record<string, unknown>>;
    const okFalse = steps.filter((s) => s['ok'] === false);
    assert.ok(okFalse.length > 0, 'GEI-3: at least one ok:false step required');
    for (const s of okFalse) {
      assert.ok(
        typeof s['error'] === 'string' && s['error'].length > 0,
        `GEI-3: ok:false step.error must be non-empty string, got ${typeof s['error']}(${JSON.stringify(s['error'])})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GEI-4: ok:false step.ok is strict boolean false ───────────────────────────

test('GEI-4: ok:false step item.ok is strict boolean false', async () => {
  const agg = makePartialFailChainAgg();
  try {
    const body = await castChainExecuted(agg);
    const steps = body['steps'] as Array<Record<string, unknown>>;
    const okFalse = steps.filter((s) => s['ok'] === false);
    assert.ok(okFalse.length > 0, 'GEI-4: at least one ok:false step required');
    for (const s of okFalse) {
      assert.strictEqual(
        s['ok'],
        false,
        `GEI-4: ok:false step.ok must be boolean false, got ${typeof s['ok']}(${String(s['ok'])})`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GEI-5: every step.step is non-negative integer; step.tool is non-empty string ──

test('GEI-5: every step item has step≥0 integer and non-empty string tool (both branches)', async () => {
  const succAgg = makeSuccessChainAgg();
  const failAgg = makePartialFailChainAgg();
  try {
    const [bodySucc, bodyFail] = await Promise.all([
      castChainExecuted(succAgg),
      castChainExecuted(failAgg),
    ]);
    for (const [label, body] of [['success', bodySucc], ['partial-fail', bodyFail]] as const) {
      const steps = body['steps'] as Array<Record<string, unknown>>;
      assert.ok(Array.isArray(steps) && steps.length > 0, `GEI-5(${label}): steps must be non-empty array`);
      for (const s of steps) {
        const stepVal = s['step'];
        assert.ok(
          typeof stepVal === 'number' && Number.isInteger(stepVal) && stepVal >= 0,
          `GEI-5(${label}): step.step must be non-negative integer, got ${typeof stepVal}(${String(stepVal)})`,
        );
        const toolVal = s['tool'];
        assert.ok(
          typeof toolVal === 'string' && toolVal.length > 0,
          `GEI-5(${label}): step.tool must be non-empty string, got ${typeof toolVal}(${JSON.stringify(toolVal)})`,
        );
      }
    }
  } finally {
    await Promise.all([succAgg.shutdown(), failAgg.shutdown()]);
  }
});
