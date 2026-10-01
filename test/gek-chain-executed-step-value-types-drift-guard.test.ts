/**
 * GEK drift guard: freeze cast:chain_executed step item VALUE TYPES.
 *
 * GEH (geh-chain-executed-step-item-exact-keyset-drift-guard.test.ts) froze the
 * exact top-level KEY SET of each step item per branch:
 *   ok:true  → EXACTLY {content, ok, step, tool}
 *   ok:false → EXACTLY {error,   ok, step, tool}
 *
 * GEH does NOT assert VALUE TYPES. The remaining gap:
 *
 *   A regression that stores `content` as a stringified array instead of an
 *   array, or serialises `step` as a string ("0") rather than a number, or
 *   stores `ok` as 1/0 instead of true/false, passes GEH because GEH only
 *   compares Object.keys() against a frozen set.
 *
 * Source: src-stdio/aggregator.ts (chain_executed branch):
 *   ok:true  → steps.push({ step: i, tool: stepTool, ok: true,  content: r.content })
 *   ok:false → steps.push({ step: i, tool: stepTool, ok: false, error: errText })
 *
 * Expected types:
 *   content  — Array (the raw tool-response content array)
 *   ok       — boolean (strict true/false, not 1/0 or 'true'/'false')
 *   step     — number (integer ≥ 0)
 *   tool     — string (namespaced tool id)
 *   error    — string (error message text)
 *
 * GEK freezes:
 *
 *   GEK-1  ok:true  step — `content` is an Array
 *   GEK-2  ok:true  step — `ok`      is strict boolean true
 *   GEK-3  ok:true  step — `step`    is a number (integer)
 *   GEK-4  ok:true  step — `tool`    is a string
 *   GEK-5  ok:false step — `error`   is a string
 *
 * Fixture: identical to GEH — neon combo (list_projects → create_project).
 * Success path (GEK-1..4): both steps ok:true.
 * Partial-failure path (GEK-5): second step ok:false.
 *
 * Frozen 2026-09-30.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (step item value types,
 *     not the explanation sub-object)
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
  return join(tmpdir(), `ch1tty-gek-${Date.now()}-${++_seq}.jsonl`);
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

// ── GEK-1: ok:true step — content is an Array ────────────────────────────────

test('GEK-1: ok:true step item — content is an Array', async () => {
  const agg = makeSuccessChainAgg();
  try {
    const body = await castChainExecuted(agg);
    const steps = body['steps'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(steps) && steps.length > 0, 'GEK-1: steps must be a non-empty array');
    const okTrue = steps.filter((s) => s['ok'] === true);
    assert.ok(okTrue.length > 0, 'GEK-1: at least one ok:true step required');
    for (const s of okTrue) {
      assert.ok(
        Array.isArray(s['content']),
        `GEK-1: content must be an Array, got ${typeof s['content']}: ${JSON.stringify(s['content'])}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GEK-2: ok:true step — ok is strict boolean true ──────────────────────────

test('GEK-2: ok:true step item — ok is strict boolean true (not 1 or "true")', async () => {
  const agg = makeSuccessChainAgg();
  try {
    const body = await castChainExecuted(agg);
    const steps = body['steps'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(steps) && steps.length > 0, 'GEK-2: steps must be a non-empty array');
    const okTrue = steps.filter((s) => s['ok'] === true);
    assert.ok(okTrue.length > 0, 'GEK-2: at least one ok:true step required');
    for (const s of okTrue) {
      assert.strictEqual(
        s['ok'],
        true,
        `GEK-2: ok must be strict boolean true, got ${typeof s['ok']} ${JSON.stringify(s['ok'])}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GEK-3: ok:true step — step is a number ───────────────────────────────────

test('GEK-3: ok:true step item — step is a number (not a string)', async () => {
  const agg = makeSuccessChainAgg();
  try {
    const body = await castChainExecuted(agg);
    const steps = body['steps'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(steps) && steps.length > 0, 'GEK-3: steps must be a non-empty array');
    for (const s of steps) {
      assert.strictEqual(
        typeof s['step'],
        'number',
        `GEK-3: step must be a number, got ${typeof s['step']}: ${JSON.stringify(s['step'])}`,
      );
      assert.ok(
        Number.isInteger(s['step'] as number) && (s['step'] as number) >= 0,
        `GEK-3: step must be a non-negative integer, got ${JSON.stringify(s['step'])}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GEK-4: ok:true step — tool is a string ───────────────────────────────────

test('GEK-4: ok:true step item — tool is a non-empty string', async () => {
  const agg = makeSuccessChainAgg();
  try {
    const body = await castChainExecuted(agg);
    const steps = body['steps'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(steps) && steps.length > 0, 'GEK-4: steps must be a non-empty array');
    for (const s of steps) {
      assert.strictEqual(
        typeof s['tool'],
        'string',
        `GEK-4: tool must be a string, got ${typeof s['tool']}: ${JSON.stringify(s['tool'])}`,
      );
      assert.ok(
        (s['tool'] as string).length > 0,
        `GEK-4: tool must be a non-empty string, got empty string`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GEK-5: ok:false step — error is a string ─────────────────────────────────

test('GEK-5: ok:false step item — error is a string (not an Error object or null)', async () => {
  const agg = makePartialFailChainAgg();
  try {
    const body = await castChainExecuted(agg);
    const steps = body['steps'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(steps) && steps.length > 0, 'GEK-5: steps must be a non-empty array');
    const okFalse = steps.filter((s) => s['ok'] === false);
    assert.ok(okFalse.length > 0, 'GEK-5: at least one ok:false step required');
    for (const s of okFalse) {
      assert.strictEqual(
        typeof s['error'],
        'string',
        `GEK-5: error must be a string, got ${typeof s['error']}: ${JSON.stringify(s['error'])}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});
