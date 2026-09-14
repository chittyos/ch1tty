/**
 * Workstream BI: aggregator.ts:1484 — false branch of the scalar-type guard in
 * cast chain extraction.
 *
 * When cast auto-chains two steps, step 2 receives { previousResult, ...extracted }
 * where extracted holds only scalar (string | number | boolean) fields parsed from
 * step 1's JSON output. The false branch — where a field value is an object, array,
 * or null — is skipped silently. This test proves non-scalar fields are NOT forwarded.
 *
 * Covered:
 *   1. Non-scalar field (object) is not extracted into step 2 args
 *   2. Non-scalar field (array) is not extracted into step 2 args
 *   3. Non-scalar field (null) is not extracted into step 2 args
 *   4. Scalar fields (string, number, boolean) beside non-scalars ARE extracted
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

// Stub out brain routing so tests are deterministic regardless of CH1TTY_USE_OLLAMA_BRAIN.
class NullRoutingCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-bi-${label}-${Date.now()}.jsonl`);
}

const NEON_CFG: ServerConfig = {
  id: 'neon',
  name: 'Neon Database',
  type: 'remote',
  access: 'readwrite',
  category: 'code',
  endpoint: 'https://neon.test/mcp',
};

const NEON_TOOLS: ToolEntry[] = [
  { name: 'run_sql', description: 'Run SQL on Neon', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_projects', description: 'List Neon projects', inputSchema: { type: 'object', properties: {} } },
];

const CHAIN_CATALOG = {
  code: {
    combos: [
      {
        name: 'sql-then-list',
        chain: ['neon/run_sql', 'neon/list_projects'],
        accomplishes: 'Run SQL query then list projects',
        verified: true,
      },
    ],
    prompts: [],
  },
};

const FOCUS_PROFILES = {
  profiles: {
    code: { description: 'Code tools', categories: ['code' as const], servers: ['neon'], boost: 0.5 },
  },
};

/**
 * Build an Aggregator with a backend whose step-1 tool returns JSON containing
 * the given fields. Captures the args each callTool invocation receives.
 */
function makeAggWithCapture(
  label: string,
  step1JsonPayload: Record<string, unknown>,
): { agg: Aggregator; capturedCalls: Array<{ tool: string; args: Record<string, unknown> }> } {
  const capturedCalls: Array<{ tool: string; args: Record<string, unknown> }> = [];

  const backend: Backend = {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: NEON_TOOLS.length, toolCacheAge: 0 }),
    listTools: async () => NEON_TOOLS,
    callTool: async (_id, tool, args): Promise<ToolCallResult> => {
      capturedCalls.push({ tool, args });
      if (tool === 'run_sql') {
        return { content: [{ type: 'text', text: JSON.stringify(step1JsonPayload) }] };
      }
      return { content: [{ type: 'text', text: 'list-result' }] };
    },
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };

  const dPath = dlqPath(label);
  const agg = new Aggregator([NEON_CFG], {
    focusProfiles: FOCUS_PROFILES,
    suggestionsCatalog: CHAIN_CATALOG,
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dPath,
    coordinator: new NullRoutingCoordinator({}, { enabled: false }, dPath),
  });

  return { agg, capturedCalls };
}

// ── 1. Object-valued field is NOT extracted ────────────────────────────────────

test('cast chain: object-valued field from step 1 JSON is not extracted into step 2 args', async () => {
  const { agg, capturedCalls } = makeAggWithCapture('1-obj', {
    id: 'proj-123',
    meta: { kind: 'project', region: 'us-east-1' }, // non-scalar: object
  });
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'run sql neon',
      focus: 'code',
      chain: true,
    });
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(parsed.cast, 'chain_executed', `expected chain_executed, got ${parsed.cast}`);

    const step2 = capturedCalls.find((c) => c.tool === 'list_projects');
    assert.ok(step2, 'list_projects (step 2) should have been called');
    assert.equal(step2.args['id'], 'proj-123', 'scalar string field id should be extracted');
    assert.equal('meta' in step2.args, false, 'object-valued field meta must NOT be extracted');
  } finally {
    await agg.shutdown();
  }
});

// ── 2. Array-valued field is NOT extracted ────────────────────────────────────

test('cast chain: array-valued field from step 1 JSON is not extracted into step 2 args', async () => {
  const { agg, capturedCalls } = makeAggWithCapture('2-arr', {
    name: 'my-db',
    tags: ['prod', 'us-east'],  // non-scalar: array
    active: true,
  });
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'run sql neon',
      focus: 'code',
      chain: true,
    });
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(parsed.cast, 'chain_executed', `expected chain_executed, got ${parsed.cast}`);

    const step2 = capturedCalls.find((c) => c.tool === 'list_projects');
    assert.ok(step2, 'list_projects (step 2) should have been called');
    assert.equal(step2.args['name'], 'my-db', 'scalar string field name should be extracted');
    assert.equal(step2.args['active'], true, 'scalar boolean field active should be extracted');
    assert.equal('tags' in step2.args, false, 'array-valued field tags must NOT be extracted');
  } finally {
    await agg.shutdown();
  }
});

// ── 3. Null-valued field is NOT extracted ─────────────────────────────────────

test('cast chain: null-valued field from step 1 JSON is not extracted into step 2 args', async () => {
  const { agg, capturedCalls } = makeAggWithCapture('3-null', {
    count: 42,
    cursor: null, // non-scalar: null
  });
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'run sql neon',
      focus: 'code',
      chain: true,
    });
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(parsed.cast, 'chain_executed', `expected chain_executed, got ${parsed.cast}`);

    const step2 = capturedCalls.find((c) => c.tool === 'list_projects');
    assert.ok(step2, 'list_projects (step 2) should have been called');
    assert.equal(step2.args['count'], 42, 'scalar number field count should be extracted');
    assert.equal('cursor' in step2.args, false, 'null-valued field cursor must NOT be extracted');
  } finally {
    await agg.shutdown();
  }
});

// ── 4. Mixed response: scalars extracted, non-scalars skipped ────────────────

test('cast chain: only scalar fields (string/number/boolean) extracted when mixed with non-scalars', async () => {
  const { agg, capturedCalls } = makeAggWithCapture('4-mixed', {
    id: 'row-7',          // string ← extracted
    size: 1024,           // number ← extracted
    active: false,        // boolean ← extracted
    config: { ttl: 60 }, // object ← skipped
    labels: ['a', 'b'],  // array ← skipped
    owner: null,          // null ← skipped
  });
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'run sql neon',
      focus: 'code',
      chain: true,
    });
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(parsed.cast, 'chain_executed');

    const step2 = capturedCalls.find((c) => c.tool === 'list_projects');
    assert.ok(step2, 'list_projects should have been called');
    const a = step2.args;
    // Scalars must be forwarded
    assert.equal(a['id'], 'row-7');
    assert.equal(a['size'], 1024);
    assert.equal(a['active'], false);
    // Non-scalars must NOT appear
    assert.equal('config' in a, false, 'object field must not be extracted');
    assert.equal('labels' in a, false, 'array field must not be extracted');
    assert.equal('owner' in a, false, 'null field must not be extracted');
  } finally {
    await agg.shutdown();
  }
});
