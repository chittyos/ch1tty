/**
 * GAN drift guard: freeze the shape of prompts `arguments` field in cast responses.
 *
 * A PromptEntry may carry an `arguments` array:
 *   interface PromptEntry {
 *     name: string;
 *     description?: string;
 *     arguments?: Array<{ name: string; description?: string; required?: boolean }>;
 *   }
 * (packages/shared-types/src/index.ts)
 *
 * The aggregator passes `arguments` through verbatim via:
 *   related.prompts = scoredPrompts.map((p) => ({
 *     name: p.name,
 *     description: p.description,
 *     arguments: p.arguments,   // ← passthrough — no transformation
 *     score: p.score,
 *   }));
 * (src-stdio/aggregator.ts lines ~1399–1404)
 *
 * No prior G-series test exercises the `arguments` field — it appears in the
 * fixture definition and passes through, but has never been asserted.
 *
 * Invariants frozen by GAN:
 *   1. cast:executed  — `arguments` is an Array when present (not null, not a plain object).
 *   2. cast:executed  — each argument item has `name` as a non-empty string.
 *   3. cast:executed  — argument item `required` is boolean when present (not a string).
 *   4. cast:discovered — `arguments` is an Array when present; passthrough preserved.
 *   5. cast:plan (confirm:true) — `arguments` is an Array when present; passthrough preserved.
 *
 * Fixtures:
 *
 *   All tests use intent "list stripe payment invoice records" (5 terms).
 *
 *   TOOL_EXEC:   matched tool → cast:executed (GAN-1/2/3/5)
 *   TOOL_NOMATCH: unmatched tool → cast:discovered (GAN-4)
 *
 *   GAN prompts carry `arguments` with 3 argument items:
 *     { name: 'limit',    description: 'Max invoice records',          required: true  }
 *     { name: 'status',   description: 'Payment status filter stripe', required: false }
 *     { name: 'customer', description: 'Customer ID for list query',                  }  ← no `required`
 *
 *   The prompt description "List stripe payment invoice records by limit" hits all 5
 *   intent terms → score 1.0 → passes filter > 0.1 → appears in related.prompts.
 *
 * Source refs:
 *   listAllPrompts namespacing: src-stdio/aggregator.ts ~line 1957
 *   scoredPrompts construction: src-stdio/aggregator.ts ~lines 1316–1325
 *   related.prompts passthrough: src-stdio/aggregator.ts ~lines 1398–1404
 *   cast:executed path:         src-stdio/aggregator.ts ~line 1653
 *   cast:discovered path:       src-stdio/aggregator.ts ~line 1428
 *   cast:plan path:             src-stdio/aggregator.ts ~line 1599
 *
 * Frozen 2026-09-21.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (prompts arguments passthrough)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import { FixtureBackend } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gan-${Date.now()}-${++dlqSeq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

function makeAgg(
  serverId: string,
  tools: unknown[],
  prompts: unknown[],
): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer(serverId, { tools, prompts, resources: [] });
  const path = dlq();
  const config: ServerConfig[] = [
    {
      id: serverId,
      name: serverId,
      type: 'remote',
      access: 'readwrite',
      category: 'code',
      endpoint: 'https://unused.example.com/mcp',
      lazy: true,
    },
  ];
  return new Aggregator(config, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

async function cast(agg: Aggregator, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', args);
  assert.equal(result.isError, undefined, `cast must not error: ${JSON.stringify(result.content)}`);
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

// Intent: "list stripe payment invoice records" → 5 terms
const INTENT = 'list stripe payment invoice records';

// Tool that matches intent → cast:executed
const TOOL_EXEC = {
  name: 'list_stripe_payment_invoices',
  description: 'List stripe payment invoice records',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text', text: '{"invoices":[]}' }] },
};

// Tool that does NOT match → cast:discovered (no tools match, prompts do)
const TOOL_NOMATCH = {
  name: 'write_local_file',
  description: 'Write content to a local filesystem path',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
  response: { content: [{ type: 'text', text: '{"ok":true}' }] },
};

// Prompt with arguments — description hits all 5 intent terms
const PROMPT_WITH_ARGS = {
  name: 'list_invoices_prompt',
  description: 'List stripe payment invoice records by limit',
  arguments: [
    { name: 'limit',    description: 'Max invoice records to list',         required: true  },
    { name: 'status',   description: 'Payment status filter stripe invoices', required: false },
    { name: 'customer', description: 'Customer ID for invoice list query' },
  ],
};

// ── GAN-1: cast:executed — `arguments` is an Array when present ──────────────

test('GAN-1: cast:executed prompts item arguments is an Array when present', async () => {
  const agg = makeAgg('gan-exec-1', [TOOL_EXEC], [PROMPT_WITH_ARGS]);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const prompts = body['prompts'] as unknown[];
    assert.ok(Array.isArray(prompts) && prompts.length > 0, 'prompts must be a non-empty array');
    for (const item of prompts) {
      const p = item as Record<string, unknown>;
      if ('arguments' in p && p['arguments'] !== undefined) {
        assert.ok(
          Array.isArray(p['arguments']),
          `prompts item arguments must be an Array, got ${typeof p['arguments']}: ${JSON.stringify(p['arguments'])}`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GAN-2: cast:executed — each argument item has `name` as non-empty string ─

test('GAN-2: cast:executed prompts argument items each have name as a non-empty string', async () => {
  const agg = makeAgg('gan-exec-2', [TOOL_EXEC], [PROMPT_WITH_ARGS]);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const prompts = body['prompts'] as unknown[];
    assert.ok(Array.isArray(prompts) && prompts.length > 0, 'prompts must be non-empty');
    let foundArguments = false;
    for (const item of prompts) {
      const p = item as Record<string, unknown>;
      if (Array.isArray(p['arguments'])) {
        foundArguments = true;
        const args = p['arguments'] as unknown[];
        assert.ok(args.length > 0, 'arguments array must be non-empty when present');
        for (const arg of args) {
          const a = arg as Record<string, unknown>;
          assert.equal(
            typeof a['name'],
            'string',
            `argument item name must be typeof 'string', got ${typeof a['name']}`,
          );
          assert.ok(
            (a['name'] as string).length > 0,
            `argument item name must be non-empty, got empty string`,
          );
        }
      }
    }
    assert.ok(foundArguments, 'at least one prompts item must carry an arguments array');
  } finally {
    await agg.shutdown();
  }
});

// ── GAN-3: cast:executed — argument `required` is boolean when present ───────

test('GAN-3: cast:executed prompts argument required is boolean when present', async () => {
  const agg = makeAgg('gan-exec-3', [TOOL_EXEC], [PROMPT_WITH_ARGS]);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const prompts = body['prompts'] as unknown[];
    assert.ok(Array.isArray(prompts) && prompts.length > 0, 'prompts must be non-empty');
    for (const item of prompts) {
      const p = item as Record<string, unknown>;
      if (Array.isArray(p['arguments'])) {
        for (const arg of p['arguments'] as unknown[]) {
          const a = arg as Record<string, unknown>;
          if ('required' in a && a['required'] !== undefined) {
            assert.equal(
              typeof a['required'],
              'boolean',
              `argument required must be typeof 'boolean', got ${typeof a['required']}: ${JSON.stringify(a['required'])}`,
            );
          }
        }
      }
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GAN-4: cast:discovered — `arguments` is an Array when present ────────────

test('GAN-4: cast:discovered prompts item arguments is an Array when present', async () => {
  // TOOL_NOMATCH has no keyword overlap → best === undefined → cast:discovered
  const agg = makeAgg('gan-disc-4', [TOOL_NOMATCH], [PROMPT_WITH_ARGS]);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'discovered', `expected cast:discovered, got ${body['cast']}`);
    const prompts = body['prompts'] as unknown[];
    assert.ok(Array.isArray(prompts) && prompts.length > 0, 'discovered prompts must be a non-empty array');
    let foundArguments = false;
    for (const item of prompts) {
      const p = item as Record<string, unknown>;
      if ('arguments' in p && p['arguments'] !== undefined) {
        assert.ok(
          Array.isArray(p['arguments']),
          `discovered prompts item arguments must be an Array, got ${typeof p['arguments']}`,
        );
        foundArguments = true;
      }
    }
    assert.ok(foundArguments, 'at least one discovered prompts item must carry an arguments array');
  } finally {
    await agg.shutdown();
  }
});

// ── GAN-5: cast:plan — `arguments` is an Array when present ──────────────────

test('GAN-5: cast:plan prompts item arguments is an Array when present', async () => {
  const agg = makeAgg('gan-plan-5', [TOOL_EXEC], [PROMPT_WITH_ARGS]);
  try {
    const body = await cast(agg, { intent: INTENT, confirm: true });
    assert.equal(body['cast'], 'plan', `expected cast:plan, got ${body['cast']}`);
    const prompts = body['prompts'] as unknown[];
    assert.ok(Array.isArray(prompts) && prompts.length > 0, 'plan prompts must be a non-empty array');
    let foundArguments = false;
    for (const item of prompts) {
      const p = item as Record<string, unknown>;
      if ('arguments' in p && p['arguments'] !== undefined) {
        assert.ok(
          Array.isArray(p['arguments']),
          `plan prompts item arguments must be an Array, got ${typeof p['arguments']}`,
        );
        foundArguments = true;
      }
    }
    assert.ok(foundArguments, 'at least one plan prompts item must carry an arguments array');
  } finally {
    await agg.shutdown();
  }
});
