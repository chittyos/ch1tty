/**
 * DA — aggregator.ts handleCast() chain step-arg extraction catch {}.
 *
 * Covered path (aggregator.ts lines 1480–1492):
 *   When `chain: true` is active, `previousStepOutput !== null`, and
 *   `JSON.parse(previousStepOutput)` throws (output is plain text, not JSON),
 *   the `catch {}` silently swallows the SyntaxError. `extracted` stays `{}`,
 *   so step N receives `{ previousResult: "<plain-text>" }` with no extra fields.
 *
 * Nearest existing tests that almost cover this path (but don't reach the catch):
 *   - cast-chain-step-forward.test.ts — step responses always return valid JSON
 *   - bi-cast-chain-non-scalar-extraction.test.ts — uses valid JSON (non-scalar
 *     types within the parsed object), never triggers JSON.parse failure
 *
 * Verification strategy:
 *   1. Step 0 tool returns plain-text output ("Build complete: abc123") — not JSON.
 *   2. The chain continues to step 1 (no abort on parse failure).
 *   3. Step 1 receives exactly `{ previousResult: "Build complete: abc123" }`
 *      and NO extra extracted fields (only what the plain-text fallback provides).
 *   4. Overall result reports `cast: "chain_executed"` confirming the chain ran.
 */

import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import { FixtureBackend } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-da-${label}-${Date.now()}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

// Step 0: returns plain text — NOT valid JSON. Triggers the catch {} at line 1490.
const TOOL_STEP0 = {
  name: 'run_build',
  description: 'run the build pipeline and report status',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text', text: 'Build complete: abc123' }] },
} as const;

// Step 1: accepts args; we inspect what args it received.
const TOOL_STEP1 = {
  name: 'deploy_artifact',
  description: 'deploy the build artifact to production',
  inputSchema: { type: 'object', properties: { previousResult: { type: 'string' } } },
  response: { content: [{ type: 'text', text: 'deployed' }] },
} as const;

const CATALOG = {
  code: {
    description: 'Build and deploy',
    combos: [{
      name: 'build-deploy',
      chain: ['ci/run_build', 'ci/deploy_artifact'],
      accomplishes: 'run build then deploy',
      verified: true,
    }],
    prompts: [],
  },
};

const SERVER_CONFIG: ServerConfig[] = [{
  id: 'ci',
  name: 'CI',
  type: 'remote',
  access: 'readwrite',
  category: 'code',
  endpoint: 'https://ci.example.com/mcp',
  lazy: true,
}];

function makeAgg() {
  const backend = new FixtureBackend();
  backend.defineServer('ci', { tools: [TOOL_STEP0, TOOL_STEP1] });

  const dlq = dlqPath(`${Date.now()}`);
  const coordinator = new KeywordOnlyCoordinator({}, { enabled: false }, dlq);
  const agg = new Aggregator(SERVER_CONFIG, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq,
    suggestionsCatalog: CATALOG as never,
    coordinator,
    focus: 'code',
  });
  return { agg, backend };
}

test('DA: chain step — non-JSON plain-text output → catch {} suppressed, step 1 receives previousResult only', async () => {
  const { agg, backend } = makeAgg();

  const result = await agg.callTool('ch1tty/cast', {
    intent: 'run build',
    chain: true,
  });

  const calls = backend.getCallLog();
  assert.equal(calls.length, 2, 'both chain steps executed (catch did not abort the chain)');

  const step0 = calls[0];
  assert.equal(step0.tool, 'run_build', 'step 0 is run_build');

  const step1 = calls[1];
  assert.equal(step1.tool, 'deploy_artifact', 'step 1 is deploy_artifact');

  // The plain-text output of step 0 must arrive as previousResult
  assert.equal(
    step1.args.previousResult,
    'Build complete: abc123',
    'step 1 receives step 0 plain-text output as previousResult',
  );

  // The catch {} path leaves extracted = {} — no extra fields should be present
  const extraKeys = Object.keys(step1.args).filter((k) => k !== 'previousResult');
  assert.deepEqual(extraKeys, [], 'no extracted scalar fields added when step output is non-JSON');

  // Chain completed — result reports chain_executed
  const resultText = JSON.stringify(result);
  assert.ok(
    resultText.includes('chain_executed') || resultText.includes('"cast"'),
    `result should indicate chain executed; got: ${resultText.slice(0, 200)}`,
  );

  await agg.shutdown();
});
