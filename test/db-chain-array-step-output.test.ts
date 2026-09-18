/**
 * DB — aggregator.ts handleCast() chain step-arg extraction: Array.isArray(parsed) true branch.
 *
 * Covered path (aggregator.ts lines 1480–1493):
 *   When `chain: true` is active and the previous step returns valid JSON whose
 *   top-level value is an Array, the extraction logic takes
 *     `const src = Array.isArray(parsed) ? parsed[0] : parsed`
 *   i.e. src = parsed[0] (the first element).  Existing tests only exercise
 *   the `false` arm (top-level object); the `true` arm (top-level array) has
 *   never been reached.
 *
 * Three sub-scenarios:
 *   1. Array-of-objects: `[{"tag":"v2.0","build":42}]`
 *      → src = {tag:"v2.0",build:42} (object) → scalar fields extracted.
 *      Step 2 receives { previousResult: <raw>, tag:"v2.0", build:42 }.
 *
 *   2. Array-of-strings: `["v2.0","v2.1"]`
 *      → src = "v2.0" (string, typeof !== "object") → no extraction.
 *      Step 2 receives { previousResult: <raw> } only.
 *
 *   3. Array-with-null-first: `[null]`
 *      → src = null → `src !== null` is false → no extraction.
 *      Step 2 receives { previousResult: <raw> } only.
 *
 * Nearest existing tests:
 *   - cast-chain-step-forward.test.ts    — step 0 output is a JSON object (not array)
 *   - bi-cast-chain-non-scalar-extraction.test.ts — step 0 object with non-scalar values
 *   - da-chain-nonjson-step-output.test.ts — step 0 output is plain text (JSON.parse throws)
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
  return join(tmpdir(), `ch1tty-db-${label}-${Date.now()}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

const SERVER_CONFIG: ServerConfig[] = [{
  id: 'deploy',
  name: 'Deploy',
  type: 'remote',
  access: 'readwrite',
  category: 'code',
  endpoint: 'https://deploy.example.com/mcp',
  lazy: true,
}];

const CATALOG_BASE = {
  code: {
    description: 'Deployment pipeline',
    combos: [{
      name: 'list-then-deploy',
      chain: ['deploy/list_artifacts', 'deploy/deploy_artifact'],
      accomplishes: 'list artifacts then deploy',
      verified: true,
    }],
    prompts: [],
  },
};

const STEP1_TOOL = {
  name: 'deploy_artifact',
  description: 'deploy a specific artifact',
  inputSchema: { type: 'object', properties: { tag: { type: 'string' }, build: { type: 'number' } } },
  response: { content: [{ type: 'text', text: 'deployed ok' }] },
} as const;

function makeAgg(step0ResponseText: string) {
  const backend = new FixtureBackend();
  backend.defineServer('deploy', {
    tools: [
      {
        name: 'list_artifacts',
        description: 'list available build artifacts',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: step0ResponseText }] },
      },
      STEP1_TOOL,
    ],
  });

  const dlq = dlqPath(step0ResponseText.slice(0, 8));
  const coordinator = new KeywordOnlyCoordinator({}, { enabled: false }, dlq);
  const agg = new Aggregator(SERVER_CONFIG, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq,
    suggestionsCatalog: CATALOG_BASE as never,
    coordinator,
    focus: 'code',
  });
  return { agg, backend };
}

// ---------------------------------------------------------------------------
// Scenario 1 — array of objects: first element fields ARE extracted as scalars
// ---------------------------------------------------------------------------
test('DB-1: chain step — JSON array output → src=parsed[0] → scalar fields extracted into step 2 args', async () => {
  const arrayJson = JSON.stringify([{ tag: 'v2.0', build: 42 }]);
  const { agg, backend } = makeAgg(arrayJson);

  await agg.callTool('ch1tty/cast', { intent: 'list then deploy', chain: true });

  const calls = backend.getCallLog();
  assert.equal(calls.length, 2, 'both chain steps executed');

  const step1 = calls[1];
  assert.equal(step1.tool, 'deploy_artifact', 'step 2 is deploy_artifact');
  assert.equal(step1.args.previousResult, arrayJson, 'raw JSON array forwarded as previousResult');
  assert.equal(step1.args.tag, 'v2.0', 'string field extracted from parsed[0]');
  assert.equal(step1.args.build, 42, 'number field extracted from parsed[0]');

  await agg.shutdown();
});

// ---------------------------------------------------------------------------
// Scenario 2 — array of strings: src=parsed[0]="v2.0", typeof src !== 'object'
//              → no extraction; step 2 receives previousResult only
// ---------------------------------------------------------------------------
test('DB-2: chain step — JSON array-of-strings → src is string, no extraction', async () => {
  const arrayJson = JSON.stringify(['v2.0', 'v2.1']);
  const { agg, backend } = makeAgg(arrayJson);

  await agg.callTool('ch1tty/cast', { intent: 'list then deploy', chain: true });

  const calls = backend.getCallLog();
  assert.equal(calls.length, 2, 'both chain steps executed');

  const step1 = calls[1];
  assert.equal(step1.args.previousResult, arrayJson, 'raw array string forwarded as previousResult');
  const extraKeys = Object.keys(step1.args).filter((k) => k !== 'previousResult');
  assert.deepEqual(extraKeys, [], 'no fields extracted when src is a string (not an object)');

  await agg.shutdown();
});

// ---------------------------------------------------------------------------
// Scenario 3 — array-with-null-first: src=null, `src !== null` is false
//              → no extraction; step 2 receives previousResult only
// ---------------------------------------------------------------------------
test('DB-3: chain step — JSON [null,...] → src=null, no extraction', async () => {
  const arrayJson = JSON.stringify([null, 'ignored']);
  const { agg, backend } = makeAgg(arrayJson);

  await agg.callTool('ch1tty/cast', { intent: 'list then deploy', chain: true });

  const calls = backend.getCallLog();
  assert.equal(calls.length, 2, 'both chain steps executed');

  const step1 = calls[1];
  assert.equal(step1.args.previousResult, arrayJson, 'raw array string forwarded as previousResult');
  const extraKeys = Object.keys(step1.args).filter((k) => k !== 'previousResult');
  assert.deepEqual(extraKeys, [], 'no fields extracted when src is null');

  await agg.shutdown();
});
