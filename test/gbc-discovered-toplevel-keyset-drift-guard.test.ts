/**
 * GBC drift guard: freeze cast:discovered exact top-level key set.
 *
 * EF (cast-discovered-chain-shape-drift.test.ts) froze structural invariants for
 * cast:discovered using a PERMITTED superset check:
 *   DISCOVERED_PERMITTED = ['cast', 'hint', 'intent', 'latencyMs', 'prompts',
 *                           'resources', 'resolvedBy']
 * A regression adding or renaming a top-level key — e.g. accidentally including
 * cast:executed-only keys like `resolved`, `score`, `alternatives`, or leaking
 * an internal annotation key like `brainPath` or `matchRoute` — would pass EF's
 * superset check silently.
 *
 * GAX froze the prompts[] item key set within discovered; GBC freezes the OUTER
 * top-level envelope using deepEqual so the complete set is exact-frozen, not
 * just permitted-checked.
 *
 * GBC closes the gap:
 *
 *   GBC-1  Prompts-only base: EXACTLY {cast, hint, intent, latencyMs, prompts, resolvedBy}
 *          (no tools match, one prompt matches; no session, no explain, no focus)
 *
 *   GBC-2  Resources-only base: EXACTLY {cast, hint, intent, latencyMs, resolvedBy, resources}
 *          (no tools match, one resource matches; no session, no explain, no focus)
 *
 *   GBC-3  With sessionId: adds exactly `sessionContext` and no other key.
 *          (EF confirms sessionContext appears but never asserts it is the ONLY extra key.)
 *
 *   GBC-4  With explain:true: adds exactly `explanation` and no other key.
 *          (EF confirms explanation appears but never asserts it is the ONLY extra key.)
 *
 *   GBC-5  Does NOT contain cast:executed/plan/chain-only keys:
 *          `resolved`, `score`, `alternatives`, `args`, `summary`, `steps`, `catalog`.
 *          (No prior test asserts these keys are absent on the discovered path.)
 *
 * Source: src-stdio/aggregator.ts line ~1431 (cast:discovered body construction).
 *
 * Frozen 2026-09-25.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (discovered path, not explain sub-object)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Frozen exact key sets ──────────────────────────────────────────────────────

// Base set when a prompt (but no tools) matches the intent.
const DISCOVERED_KEYS_PROMPTS: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'prompts', 'resolvedBy',
];

// Base set when a resource (but no tools) matches the intent.
const DISCOVERED_KEYS_RESOURCES: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'resolvedBy', 'resources',
];

// Extras added conditionally.
const DISCOVERED_KEYS_WITH_SESSION: readonly string[] = [
  ...DISCOVERED_KEYS_PROMPTS, 'sessionContext',
];

const DISCOVERED_KEYS_WITH_EXPLAIN: readonly string[] = [
  ...DISCOVERED_KEYS_PROMPTS, 'explanation',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gbc-${Date.now()}-${++_seq}.jsonl`);
}

const PROMPTS_CONFIG: ServerConfig[] = [{
  id: 'billing',
  name: 'Billing',
  type: 'remote',
  access: 'readwrite',
  category: 'ecosystem',
  endpoint: 'https://billing.test/mcp',
  lazy: true,
}];

const RESOURCES_CONFIG: ServerConfig[] = [{
  id: 'docs',
  name: 'Docs',
  type: 'remote',
  access: 'read',
  category: 'documents',
  endpoint: 'https://docs.test/mcp',
  lazy: true,
}];

/**
 * Aggregator with a billing server that has ONE prompt matching the test intent
 * but a tool whose description has zero keyword overlap with that intent.
 * Intent: 'retrieve accounting invoice' (terms: retrieve, accounting, invoice)
 * Prompt: 'invoice_guide' / 'retrieve and format an accounting invoice for a customer' → score 1.0
 * Tool: 'process_transaction' / 'process a payment transaction for a purchase order' → score 0.0
 */
function makePromptsAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('billing', {
    tools: [{
      name: 'process_transaction',
      description: 'process a payment transaction for a purchase order',
      inputSchema: { type: 'object' },
      response: { content: [{ type: 'text', text: 'ok' }] },
    }],
    prompts: [{
      name: 'invoice_guide',
      description: 'retrieve and format an accounting invoice for a customer',
    }],
  });
  return new Aggregator(PROMPTS_CONFIG, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    suggestionsCatalog: {},
  });
}

/**
 * Aggregator with a docs server that has ONE resource matching the test intent
 * but a tool whose description has zero keyword overlap with that intent.
 * Intent: 'financial ledger documentation' (terms: financial, ledger, documentation)
 * Resource: uri='docs://ledger/reference', description='Financial ledger documentation and reference guide' → score 1.0
 * Tool: 'send_notification' / 'send an email notification to a recipient inbox' → score 0.0
 */
function makeResourcesAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('docs', {
    tools: [{
      name: 'send_notification',
      description: 'send an email notification to a recipient inbox',
      inputSchema: { type: 'object' },
      response: { content: [{ type: 'text', text: 'ok' }] },
    }],
    resources: [{
      uri: 'docs://ledger/reference',
      name: 'Ledger Reference',
      description: 'Financial ledger documentation and reference guide',
    }],
  });
  return new Aggregator(RESOURCES_CONFIG, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    suggestionsCatalog: {},
  });
}

/** Cast and assert cast:discovered; return parsed body. */
async function discovered(
  agg: Aggregator,
  intent: string,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent, ...extra });
  assert.equal(result.isError, undefined, `cast must not return isError; got ${JSON.stringify(result)}`);
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥ 1 content item');
  assert.equal(content[0]!.type, 'text', 'content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(
    body['cast'],
    'discovered',
    `expected cast:discovered, got cast="${String(body['cast'])}" — fixture or intent mismatch`,
  );
  return body;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// Intent that matches the billing prompt but NOT the tool.
const PROMPT_INTENT = 'retrieve accounting invoice';

// Intent that matches the docs resource but NOT the tool.
const RESOURCE_INTENT = 'financial ledger documentation';

test('GBC-1: cast:discovered prompts-only base key set is exactly the frozen set', async () => {
  const agg = makePromptsAgg();
  const body = await discovered(agg, PROMPT_INTENT);
  const actual = Object.keys(body).sort();
  const expected = [...DISCOVERED_KEYS_PROMPTS].sort();
  assert.deepEqual(
    actual,
    expected,
    `cast:discovered prompts-only top-level keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
});

test('GBC-2: cast:discovered resources-only base key set is exactly the frozen set', async () => {
  const agg = makeResourcesAgg();
  const body = await discovered(agg, RESOURCE_INTENT);
  const actual = Object.keys(body).sort();
  const expected = [...DISCOVERED_KEYS_RESOURCES].sort();
  assert.deepEqual(
    actual,
    expected,
    `cast:discovered resources-only top-level keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
});

test('GBC-3: cast:discovered WITH sessionId adds exactly sessionContext and no other key', async () => {
  const agg = makePromptsAgg();
  const SESSION = 'gbc-test-session-1';
  // Warm the session with one prior call so coordinator.hasSession returns true.
  await agg.callTool('ch1tty/search', { query: 'invoice', sessionId: SESSION });
  const body = await discovered(agg, PROMPT_INTENT, { sessionId: SESSION });
  const actual = Object.keys(body).sort();
  const expected = [...DISCOVERED_KEYS_WITH_SESSION].sort();
  assert.deepEqual(
    actual,
    expected,
    `cast:discovered+sessionId top-level keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
});

test('GBC-4: cast:discovered WITH explain:true adds exactly explanation and no other key', async () => {
  const agg = makePromptsAgg();
  const body = await discovered(agg, PROMPT_INTENT, { explain: true });
  const actual = Object.keys(body).sort();
  const expected = [...DISCOVERED_KEYS_WITH_EXPLAIN].sort();
  assert.deepEqual(
    actual,
    expected,
    `cast:discovered+explain top-level keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
});

test('GBC-5: cast:discovered does NOT contain cast:executed/plan/chain-only keys', async () => {
  const agg = makePromptsAgg();
  const body = await discovered(agg, PROMPT_INTENT);
  const absent = ['resolved', 'score', 'alternatives', 'args', 'summary', 'steps', 'catalog'];
  for (const key of absent) {
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, key),
      `"${key}" must be absent in cast:discovered`,
    );
  }
});
