/**
 * GAX drift guard: freeze prompts item exact key set in cast:discovered.
 *
 * EP checked prompts items in cast:executed and cast:discovered with a
 * PERMITTED (not exact) assertion — allowing extra keys silently.
 * GAR added EXACT assertions for cast:executed and cast:plan.
 *
 * GAX is the symmetric exact-keyset freeze for cast:discovered — the
 * third mode where prompts items appear. A regression injecting an extra
 * key (e.g. 'serverId', 'namespace') into prompts items in the discovered
 * code path (aggregator line ~1439 `...related`) would pass EP silently.
 *
 * Invariants frozen by GAX:
 *   GAX-1  cast:discovered prompt WITHOUT arguments has exactly {description, name, score}
 *   GAX-2  cast:discovered prompt WITH arguments has exactly {arguments, description, name, score}
 *   GAX-3  every prompts item in cast:discovered passes the exact key set check (full sweep)
 *   GAX-4  cast:discovered prompts item description is always a non-empty string
 *   GAX-5  cast:discovered does NOT have prompts key when no prompts matched (resources-only)
 *
 * Source: aggregator line ~1399-1414 (related.prompts construction) and
 *   line ~1439 (...related spread into cast:discovered body).
 *
 * Frozen 2026-09-25.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (prompts item key set, not explain)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// Intent: tool scores 0, prompts score 1.0 → cast:discovered
// Terms (>2 chars): write, content, local, disk, storage
const INTENT = 'write content to local disk storage';

const PROMPTS_KEYS_NO_ARGS: readonly string[] = ['description', 'name', 'score'];
const PROMPTS_KEYS_WITH_ARGS: readonly string[] = ['arguments', 'description', 'name', 'score'];

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gax-${Date.now()}-${++dlqSeq}.jsonl`);
}

const GAX_PROMPTS_CONFIG: ServerConfig = {
  id: 'gax',
  name: 'GAX Fixture',
  type: 'remote',
  access: 'readwrite',
  category: 'ecosystem',
  endpoint: 'https://gax.fixture.test/mcp',
  lazy: true,
};

// GAX-1 through GAX-4: tool doesn't match, two prompts do (one w/o args, one w/ args)
function makePromptsDiscoveredAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('gax', {
    tools: [
      {
        name: 'stripe_payment',
        description: 'Process credit card payment with Stripe gateway billing',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '{"status":"ok"}' }] },
      },
    ],
    prompts: [
      { name: 'write-file', description: 'write content to local disk storage' },
      {
        name: 'disk-writer',
        description: 'write content local disk storage helper',
        arguments: [{ name: 'path', description: 'Destination file path', required: true }],
      },
    ],
    resources: [],
  });
  return new Aggregator([GAX_PROMPTS_CONFIG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
}

const GAX_RESOURCE_CONFIG: ServerConfig = {
  id: 'gax-r',
  name: 'GAX Resource',
  type: 'remote',
  access: 'readwrite',
  category: 'ecosystem',
  endpoint: 'https://gax-r.fixture.test/mcp',
  lazy: true,
};

// GAX-5: no backend prompts, resource matches → cast:discovered with resources, no prompts key
function makeResourcesOnlyAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('gax-r', {
    tools: [
      {
        name: 'stripe_payment',
        description: 'Process credit card payment with Stripe gateway billing',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '{"status":"ok"}' }] },
      },
    ],
    prompts: [],
    resources: [
      {
        uri: 'gax-r://write/content/local/disk/storage',
        name: 'write content local disk storage resource',
        description: 'write content to local disk storage',
        mimeType: 'text/plain',
      },
    ],
  });
  return new Aggregator([GAX_RESOURCE_CONFIG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
}

async function callCastDiscovered(agg: Aggregator): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT });
  assert.equal(result.isError, undefined, 'cast should not return isError');
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(body.cast, 'discovered',
    `expected cast:discovered but got cast:${body.cast} — fixture may not be triggering discovered path`);
  return body;
}

test('GAX-1: cast:discovered prompt WITHOUT arguments has exactly {description, name, score}', async () => {
  const agg = makePromptsDiscoveredAgg();
  try {
    const body = await callCastDiscovered(agg);
    const prompts = body.prompts as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(prompts) && prompts.length > 0, 'prompts array should be non-empty');
    const noArgs = prompts.find((p) => !('arguments' in p));
    assert.ok(noArgs !== undefined, 'should have at least one prompt without arguments');
    assert.deepEqual(Object.keys(noArgs).sort(), [...PROMPTS_KEYS_NO_ARGS].sort());
  } finally {
    await agg.shutdown();
  }
});

test('GAX-2: cast:discovered prompt WITH arguments has exactly {arguments, description, name, score}', async () => {
  const agg = makePromptsDiscoveredAgg();
  try {
    const body = await callCastDiscovered(agg);
    const prompts = body.prompts as Array<Record<string, unknown>>;
    const withArgs = prompts.find((p) => 'arguments' in p);
    assert.ok(withArgs !== undefined, 'should have at least one prompt with arguments');
    assert.deepEqual(Object.keys(withArgs).sort(), [...PROMPTS_KEYS_WITH_ARGS].sort());
  } finally {
    await agg.shutdown();
  }
});

test('GAX-3: every prompts item in cast:discovered has the correct exact key set', async () => {
  const agg = makePromptsDiscoveredAgg();
  try {
    const body = await callCastDiscovered(agg);
    const prompts = body.prompts as Array<Record<string, unknown>>;
    assert.ok(prompts.length > 0, 'prompts array should be non-empty for full sweep');
    for (const item of prompts) {
      const actual = Object.keys(item).sort();
      const expected = 'arguments' in item
        ? [...PROMPTS_KEYS_WITH_ARGS].sort()
        : [...PROMPTS_KEYS_NO_ARGS].sort();
      assert.deepEqual(actual, expected, `prompts item key set mismatch: got ${JSON.stringify(actual)}`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('GAX-4: cast:discovered prompts item description is always a non-empty string', async () => {
  const agg = makePromptsDiscoveredAgg();
  try {
    const body = await callCastDiscovered(agg);
    const prompts = body.prompts as Array<Record<string, unknown>>;
    for (const item of prompts) {
      assert.strictEqual(typeof item.description, 'string', 'description should be typeof string');
      assert.ok((item.description as string).length > 0, 'description should be non-empty');
    }
  } finally {
    await agg.shutdown();
  }
});

test('GAX-5: cast:discovered does NOT have prompts key when no prompts matched (resources-only discovery)', async () => {
  const agg = makeResourcesOnlyAgg();
  try {
    const body = await callCastDiscovered(agg);
    assert.ok(!('prompts' in body), 'prompts key should be absent in resources-only cast:discovered');
    assert.ok('resources' in body, 'resources key should be present (resources triggered discovery)');
  } finally {
    await agg.shutdown();
  }
});
