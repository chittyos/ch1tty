/**
 * GEH drift guard: freeze cast:chain_executed steps[] item EXACT key sets.
 *
 * EJ (ej-chain-executed-step-catalog-shape.test.ts) guards against unexpected
 * keys on step items with a PERMITTED superset check, but never exact-freezes
 * the key set per variant. A regression that adds or removes a field from
 * success or failure steps would pass EJ silently.
 *
 * Source: src-stdio/aggregator.ts lines ~1465, 1501, 1509:
 *   success step: { step: number, tool: string, ok: true,  content: unknown[] }
 *   failed  step: { step: number, tool: string, ok: false, error: string       }
 *
 * GBI freezes the top-level keys of chain_executed; GEH freezes the per-item
 * key sets inside steps[].
 *
 * GBI freezes:
 *
 *   GEH-1  success step has EXACTLY {step, tool, ok, content} — 4 keys;
 *          `error` is absent.
 *
 *   GEH-2  failed step has EXACTLY {step, tool, ok, error} — 4 keys;
 *          `content` is absent.
 *
 *   GEH-3  `content` on a success step is an Array; `error` on a failed step
 *          is a string.
 *
 *   GEH-4  `step` values are the 0-based sequential index of each chain step.
 *
 *   GEH-5  `tool` values match the catalog combo chain members exactly
 *          (namespace/name, not bare name).
 *
 * Frozen 2026-09-30.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (step item key set,
 *     not the explanation sub-object structure)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import { FixtureBackend } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

// ── Frozen exact key sets ──────────────────────────────────────────────────────

const STEP_SUCCESS_KEYS: readonly string[] = ['step', 'tool', 'ok', 'content'];
const STEP_FAILURE_KEYS: readonly string[] = ['step', 'tool', 'ok', 'error'];

// ── Helpers ───────────────────────────────────────────────────────────────────

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

const BASE_CONFIGS: ServerConfig[] = [
  {
    id: 'neon',
    name: 'Neon',
    type: 'remote',
    access: 'readwrite',
    category: 'ecosystem',
    endpoint: 'https://neon.tech/mcp',
    lazy: true,
  },
];

const CATALOG = {
  code: {
    description: 'Code focus',
    combos: [
      {
        name: 'neon-setup',
        chain: ['neon/list_projects', 'neon/create_project'],
        accomplishes: 'List existing Neon projects then create a new one',
        verified: true,
      },
    ],
    prompts: [],
  },
};

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-geh-${Date.now()}-${++_seq}.jsonl`);
}

/** Aggregator where both chain steps succeed (text content). */
function makeSuccessAgg(): Aggregator {
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
    prompts: [],
    resources: [],
  });
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    suggestionsCatalog: CATALOG,
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, dlq()),
  });
}

/** Aggregator where step 0 succeeds and step 1 fails (isError). */
function makePartialFailAgg(): Aggregator {
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
        description: 'create a neon project — will error',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
        response: { isError: true, content: [{ type: 'text', text: 'quota exceeded' }] },
      },
    ],
    prompts: [],
    resources: [],
  });
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    suggestionsCatalog: CATALOG,
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, dlq()),
  });
}

async function runChain(agg: Aggregator): Promise<unknown[]> {
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    chain: true,
    focus: 'code',
  });
  assert.equal(result.isError, undefined, 'cast must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥ 1 content item');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(body['cast'], 'chain_executed', `expected cast:chain_executed, got "${String(body['cast'])}"`);
  const steps = body['steps'];
  assert.ok(Array.isArray(steps), 'steps must be an array');
  return steps as unknown[];
}

function assertExactStepKeys(
  step: unknown,
  expected: readonly string[],
  label: string,
): void {
  const s = step as Record<string, unknown>;
  const actual = Object.keys(s).sort();
  const exp = [...expected].sort();
  assert.deepEqual(
    actual,
    exp,
    `${label}: step keys must be exactly ${JSON.stringify(exp)}; got ${JSON.stringify(actual)}`,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GEH — cast:chain_executed steps[] item exact key sets', () => {
  test('GEH-1: success step has EXACTLY {step, tool, ok, content} — error absent', async () => {
    const agg = makeSuccessAgg();
    const steps = await runChain(agg);
    assert.ok(steps.length >= 1, 'at least one step');
    for (let i = 0; i < steps.length; i++) {
      assertExactStepKeys(steps[i], STEP_SUCCESS_KEYS, `GEH-1 step[${i}]`);
    }
  });

  test('GEH-2: failed step has EXACTLY {step, tool, ok, error} — content absent', async () => {
    const agg = makePartialFailAgg();
    const steps = await runChain(agg);
    // step[0] succeeds, step[1] fails
    assert.equal(steps.length, 2, 'GEH-2: must have exactly 2 steps');
    assertExactStepKeys(steps[0], STEP_SUCCESS_KEYS, 'GEH-2 step[0] (success)');
    assertExactStepKeys(steps[1], STEP_FAILURE_KEYS, 'GEH-2 step[1] (failure)');
  });

  test('GEH-3: content is Array on success; error is string on failure', async () => {
    const agg = makePartialFailAgg();
    const steps = await runChain(agg);
    const s0 = steps[0] as Record<string, unknown>;
    const s1 = steps[1] as Record<string, unknown>;
    assert.equal(s0['ok'], true, 'GEH-3: step[0].ok must be true');
    assert.ok(Array.isArray(s0['content']), 'GEH-3: step[0].content must be an Array');
    assert.equal(s1['ok'], false, 'GEH-3: step[1].ok must be false');
    assert.equal(typeof s1['error'], 'string', 'GEH-3: step[1].error must be a string');
  });

  test('GEH-4: step values are 0-based sequential indices', async () => {
    const agg = makeSuccessAgg();
    const steps = await runChain(agg);
    assert.equal(steps.length, 2, 'GEH-4: must have exactly 2 steps');
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i] as Record<string, unknown>;
      assert.equal(s['step'], i, `GEH-4: step[${i}].step must equal ${i}`);
    }
  });

  test('GEH-5: tool values match catalog chain members exactly (namespaced)', async () => {
    const agg = makeSuccessAgg();
    const steps = await runChain(agg);
    const expectedChain = ['neon/list_projects', 'neon/create_project'];
    assert.equal(steps.length, expectedChain.length, 'GEH-5: step count must match catalog chain length');
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i] as Record<string, unknown>;
      assert.equal(s['tool'], expectedChain[i],
        `GEH-5: step[${i}].tool must be "${expectedChain[i]}"; got "${String(s['tool'])}"`);
    }
  });
});
