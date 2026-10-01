/**
 * GEU drift guard: freeze cast:chain_executed steps↔catalog.chain structural
 * correlation — steps.length must equal catalog.chain.length and each
 * steps[i].tool must equal catalog.chain[i].
 *
 * Prior coverage:
 *   GEH (geh-chain-executed-step-item-exact-keyset-drift-guard.test.ts)
 *       froze the exact key set of each step item per ok/error branch.
 *   GEK (gek-chain-executed-step-value-types-drift-guard.test.ts)
 *       froze step item value types (content is Array, ok is boolean,
 *       step is number, tool is string).
 *   GBA (gba-chain-executed-toplevel-keyset-drift-guard.test.ts)
 *       froze the top-level key set of cast:chain_executed (steps is present).
 *
 * Gap: no test freezes the STRUCTURAL CORRELATION between the steps array
 * and the catalog.chain array:
 *
 *   (a) steps.length === catalog.chain.length
 *       A regression that truncates steps early (returns the first N-1 entries,
 *       aborts on the last ok step, or skips the final chain item) would be
 *       invisible to all prior tests because they only assert per-item shapes.
 *
 *   (b) steps[i].tool === catalog.chain[i] for all i
 *       A regression that assigns the wrong tool name to a step entry — by
 *       swapping resolved names, off-by-one indexing in the push, or
 *       re-sorting — would pass GEH and GEK because they do not compare
 *       the tool string against the catalog spec.
 *
 * Source: src-stdio/aggregator.ts lines 1463–1549:
 *   for (let i = 0; i < catalogCombo.chain.length; i++) {
 *     const stepTool = catalogCombo.chain[i];
 *     ...
 *     steps.push({ step: i, tool: stepTool, ok: ..., ... });
 *   }
 *   ...
 *   catalog: { name: catalogCombo.name, chain: catalogCombo.chain,
 *              accomplishes: catalogCombo.accomplishes },
 *   steps,
 *
 * GEU freezes:
 *
 *   GEU-1  For a 2-step chain: steps.length === 2 (equals catalog.chain.length).
 *          A truncation that returns only 1 step would be caught.
 *
 *   GEU-2  For a 2-step chain: steps[0].tool === catalog.chain[0] — the first
 *          step entry records the first chain tool, not a transposed value.
 *
 *   GEU-3  For a 2-step chain: steps[1].tool === catalog.chain[1] — the second
 *          step entry records the second chain tool.
 *
 *   GEU-4  For a 3-step chain: steps.length === 3 (equals catalog.chain.length).
 *          Exercises the length invariant with a longer chain.
 *
 *   GEU-5  For a 3-step chain: steps[i].tool === catalog.chain[i] for all i in
 *          [0, 1, 2] — positional correspondence holds across all three entries.
 *
 * Setup: keyword-only coordinator (no brain), code focus, FixtureBackend tools
 * return resource content (not text) so chain steps always emit ok:true without
 * triggering the chainSummary path.
 *
 * Frozen 2026-10-01.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (steps/catalog
 *     structural correlation, not explanation sub-object fields)
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
  return join(tmpdir(), `ch1tty-geu-${Date.now()}-${++_seq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

// ── 2-step chain fixture ──────────────────────────────────────────────────────

const CATALOG_2 = {
  code: {
    description: 'Code focus',
    combos: [{
      name: 'neon-list-create',
      chain: ['neon/list_projects', 'neon/create_project'],
      accomplishes: 'List then create a Neon project',
      verified: true,
    }],
    prompts: [],
  },
};

const FOCUS_PROFILES_CODE = {
  profiles: {
    code: { categories: ['code' as const], servers: ['neon'], boost: 0.5 },
  },
};

const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true,
};

function make2StepAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [
      {
        name: 'list_projects',
        description: 'list neon database projects',
        inputSchema: { type: 'object', properties: {} },
        response: {
          content: [{ type: 'resource', resource: { uri: 'neon://projects', name: 'projects' } }],
        },
      },
      {
        name: 'create_project',
        description: 'create a neon database project',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
        response: {
          content: [{ type: 'resource', resource: { uri: 'neon://project/new', name: 'new-project' } }],
        },
      },
    ],
  });
  const path = dlq();
  return new Aggregator([NEON_CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: CATALOG_2,
    focusProfiles: FOCUS_PROFILES_CODE,
    focus: 'code',
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

// ── 3-step chain fixture ──────────────────────────────────────────────────────

const CATALOG_3 = {
  code: {
    description: 'Code focus',
    combos: [{
      name: 'neon-three-step',
      chain: ['neon/list_projects', 'neon/create_project', 'neon/get_project'],
      accomplishes: 'List, create, then fetch a Neon project',
      verified: true,
    }],
    prompts: [],
  },
};

function make3StepAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [
      {
        name: 'list_projects',
        description: 'list neon database projects',
        inputSchema: { type: 'object', properties: {} },
        response: {
          content: [{ type: 'resource', resource: { uri: 'neon://projects', name: 'projects' } }],
        },
      },
      {
        name: 'create_project',
        description: 'create a neon database project',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
        response: {
          content: [{ type: 'resource', resource: { uri: 'neon://project/new', name: 'new-project' } }],
        },
      },
      {
        name: 'get_project',
        description: 'get a neon database project by id',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
        response: {
          content: [{ type: 'resource', resource: { uri: 'neon://project/abc', name: 'project-abc' } }],
        },
      },
    ],
  });
  const path = dlq();
  return new Aggregator([NEON_CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: CATALOG_3,
    focusProfiles: FOCUS_PROFILES_CODE,
    focus: 'code',
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

// ── Shared helper ─────────────────────────────────────────────────────────────

async function chainExecuted(agg: Aggregator): Promise<{
  steps: Array<{ step: number; tool: string; ok: boolean; content?: unknown[]; error?: string }>;
  catalog: { name: string; chain: string[]; accomplishes: string };
}> {
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon database projects',
    chain: true,
  });
  assert.equal(result.isError, undefined, `cast must not error: ${JSON.stringify(result.content)}`);
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥ 1 content item');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(
    body['cast'],
    'chain_executed',
    `expected cast:chain_executed, got cast="${String(body['cast'])}"`,
  );
  return {
    steps: body['steps'] as Array<{ step: number; tool: string; ok: boolean; content?: unknown[]; error?: string }>,
    catalog: body['catalog'] as { name: string; chain: string[]; accomplishes: string },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GEU-1: 2-step chain — steps.length equals catalog.chain.length (both == 2)', async () => {
  const agg = make2StepAgg();
  try {
    const { steps, catalog } = await chainExecuted(agg);
    assert.equal(
      steps.length,
      catalog.chain.length,
      `steps.length (${steps.length}) must equal catalog.chain.length (${catalog.chain.length})`,
    );
    assert.equal(steps.length, 2, `expected exactly 2 steps for 2-step chain, got ${steps.length}`);
  } finally {
    await agg.shutdown();
  }
});

test('GEU-2: 2-step chain — steps[0].tool equals catalog.chain[0]', async () => {
  const agg = make2StepAgg();
  try {
    const { steps, catalog } = await chainExecuted(agg);
    assert.ok(steps.length >= 1, 'must have at least 1 step (GEU-1 precondition)');
    assert.equal(
      steps[0]!.tool,
      catalog.chain[0],
      `steps[0].tool ("${steps[0]!.tool}") must equal catalog.chain[0] ("${catalog.chain[0]}")`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GEU-3: 2-step chain — steps[1].tool equals catalog.chain[1]', async () => {
  const agg = make2StepAgg();
  try {
    const { steps, catalog } = await chainExecuted(agg);
    assert.ok(steps.length >= 2, 'must have at least 2 steps (GEU-1 precondition)');
    assert.equal(
      steps[1]!.tool,
      catalog.chain[1],
      `steps[1].tool ("${steps[1]!.tool}") must equal catalog.chain[1] ("${catalog.chain[1]}")`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GEU-4: 3-step chain — steps.length equals catalog.chain.length (both == 3)', async () => {
  const agg = make3StepAgg();
  try {
    const { steps, catalog } = await chainExecuted(agg);
    assert.equal(
      steps.length,
      catalog.chain.length,
      `steps.length (${steps.length}) must equal catalog.chain.length (${catalog.chain.length})`,
    );
    assert.equal(steps.length, 3, `expected exactly 3 steps for 3-step chain, got ${steps.length}`);
  } finally {
    await agg.shutdown();
  }
});

test('GEU-5: 3-step chain — steps[i].tool equals catalog.chain[i] for all i in [0, 1, 2]', async () => {
  const agg = make3StepAgg();
  try {
    const { steps, catalog } = await chainExecuted(agg);
    assert.ok(steps.length >= 3, 'must have 3 steps (GEU-4 precondition)');
    for (let i = 0; i < 3; i++) {
      assert.equal(
        steps[i]!.tool,
        catalog.chain[i],
        `steps[${i}].tool ("${steps[i]!.tool}") must equal catalog.chain[${i}] ("${catalog.chain[i]}") — positional correspondence`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});
