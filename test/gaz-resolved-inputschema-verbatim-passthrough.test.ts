/**
 * GAZ drift guard: freeze cast:plan resolved.inputSchema as a verbatim
 * pass-through from the backend tool definition.
 *
 * GI-7 asserts resolved.inputSchema is a non-null, non-array object but
 * does NOT assert that it equals the fixture's defined schema. A regression
 * that strips properties/required, flattens nested objects, or injects extra
 * keys (e.g. '$schema', 'additionalProperties') would pass GI-7 silently.
 *
 * Invariants frozen by GAZ:
 *   GAZ-1  resolved.inputSchema deep-equals the fixture schema verbatim
 *          (rich schema: type, properties with nested defs, required array)
 *   GAZ-2  resolved.inputSchema passes through a minimal {type:'object',
 *          properties:{}} schema without adding or stripping any keys
 *   GAZ-3  resolved.inputSchema preserves deeply nested property definitions
 *          (nested properties and descriptions survive round-trip)
 *   GAZ-4  resolved.inputSchema preserves additionalProperties: false when
 *          present in the fixture schema
 *   GAZ-5  when multiple tools exist in the registry, resolved.inputSchema
 *          matches the winning tool's schema, not any other tool's schema
 *
 * Source: src-stdio/aggregator.ts line ~1612 (`inputSchema: best.inputSchema`)
 * passes through from ToolEntry which was populated from the fixture backend.
 * This test confirms the value is structurally identical to the fixture value.
 *
 * Frozen 2026-09-25.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (resolved sub-object
 *     inputSchema, not the explanation sub-object)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Fixture schemas ───────────────────────────────────────────────────────────

/** Rich schema: type, properties (two fields), required array. */
const RICH_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    projectId: {
      type: 'string',
      description: 'The unique project identifier',
    },
    region: {
      type: 'string',
      description: 'AWS region code for the project',
    },
  },
  required: ['projectId'],
};

/** Minimal schema: type + empty properties, no required. */
const MINIMAL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {},
};

/** Deep nested schema: properties contain nested property definitions. */
const NESTED_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    config: {
      type: 'object',
      description: 'Connection configuration',
      properties: {
        host: { type: 'string', description: 'Database host' },
        port: { type: 'number', description: 'Database port' },
      },
    },
  },
  required: ['config'],
};

/** Schema with additionalProperties: false. */
const STRICT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Project name' },
  },
  additionalProperties: false,
};

/** Alternate schema — used in GAZ-5 for the non-winning tool. */
const ALT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    cardId: { type: 'string', description: 'Payment card identifier' },
  },
  required: ['cardId'],
};

// ── Config factory ────────────────────────────────────────────────────────────

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gaz-${Date.now()}-${++_seq}.jsonl`);
}

function makeConfig(id: string): ServerConfig {
  return {
    id,
    name: `${id} fixture`,
    type: 'remote',
    access: 'readwrite',
    category: 'code',
    endpoint: `https://${id}.fixture.test/mcp`,
    lazy: true,
  };
}

/** Invoke cast:plan and return the resolved sub-object. */
async function getResolved(agg: Aggregator, intent: string): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent, confirm: true });
  assert.equal(result.isError, undefined, `cast must not error for "${intent}": ${JSON.stringify(result.content)}`);
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(body['cast'], 'plan', `expected cast:plan, got cast:${body['cast']}`);
  const resolved = body['resolved'];
  assert.ok(
    resolved !== null && typeof resolved === 'object' && !Array.isArray(resolved),
    'resolved must be a plain object',
  );
  return resolved as Record<string, unknown>;
}

// ── GAZ-1: rich schema verbatim pass-through ──────────────────────────────────

test('GAZ-1: cast:plan resolved.inputSchema deep-equals fixture rich schema (verbatim pass-through)', async () => {
  const backend = new FixtureBackend();
  // Clone when registering so RICH_SCHEMA stays pristine; any in-place mutation by the
  // aggregator would diverge the fixture copy from the original, making deepEqual fail.
  backend.defineServer('neon', {
    tools: [{
      name: 'list_projects',
      description: 'list neon database projects in the account',
      inputSchema: structuredClone(RICH_SCHEMA),
      response: { content: [{ type: 'text', text: '["proj-1","proj-2"]' }] },
    }],
  });
  const agg = new Aggregator([makeConfig('neon')], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
  try {
    const resolved = await getResolved(agg, 'list database projects');
    assert.deepEqual(
      resolved['inputSchema'],
      RICH_SCHEMA,
      'resolved.inputSchema must be the verbatim fixture schema (no additions, no stripping)',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GAZ-2: minimal schema verbatim pass-through ───────────────────────────────

test('GAZ-2: cast:plan resolved.inputSchema deep-equals fixture minimal schema (no additions)', async () => {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [{
      name: 'list_projects',
      description: 'list neon database projects in the account',
      inputSchema: structuredClone(MINIMAL_SCHEMA),
      response: { content: [{ type: 'text', text: '["proj-1"]' }] },
    }],
  });
  const agg = new Aggregator([makeConfig('neon')], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
  try {
    const resolved = await getResolved(agg, 'list database projects');
    assert.deepEqual(
      resolved['inputSchema'],
      MINIMAL_SCHEMA,
      'resolved.inputSchema must equal the minimal fixture schema exactly',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GAZ-3: deeply nested schema verbatim pass-through ─────────────────────────

test('GAZ-3: cast:plan resolved.inputSchema preserves deeply nested property definitions', async () => {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [{
      name: 'list_projects',
      description: 'list neon database projects in the account',
      inputSchema: structuredClone(NESTED_SCHEMA),
      response: { content: [{ type: 'text', text: '["proj-1"]' }] },
    }],
  });
  const agg = new Aggregator([makeConfig('neon')], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
  try {
    const resolved = await getResolved(agg, 'list database projects');
    assert.deepEqual(
      resolved['inputSchema'],
      NESTED_SCHEMA,
      'resolved.inputSchema must preserve nested property definitions verbatim',
    );
    // Also verify nested structure is present (extra guard against shallow clone)
    const schema = resolved['inputSchema'] as Record<string, unknown>;
    const props = schema['properties'] as Record<string, unknown>;
    const config = props['config'] as Record<string, unknown>;
    assert.ok(
      typeof config['properties'] === 'object' && config['properties'] !== null,
      'config.properties must survive as a nested object (not flattened)',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GAZ-4: additionalProperties: false preserved ──────────────────────────────

test('GAZ-4: cast:plan resolved.inputSchema preserves additionalProperties: false', async () => {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [{
      name: 'list_projects',
      description: 'list neon database projects in the account',
      inputSchema: structuredClone(STRICT_SCHEMA),
      response: { content: [{ type: 'text', text: '["proj-1"]' }] },
    }],
  });
  const agg = new Aggregator([makeConfig('neon')], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
  try {
    const resolved = await getResolved(agg, 'list database projects');
    assert.deepEqual(
      resolved['inputSchema'],
      STRICT_SCHEMA,
      'resolved.inputSchema must preserve additionalProperties: false verbatim',
    );
    const schema = resolved['inputSchema'] as Record<string, unknown>;
    assert.equal(
      schema['additionalProperties'],
      false,
      'additionalProperties: false must be present and false (not stripped)',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GAZ-5: correct tool's schema when multiple tools in registry ───────────────

test('GAZ-5: resolved.inputSchema matches winning tool schema, not any other tool in registry', async () => {
  const backend = new FixtureBackend();
  // charge_payment (ALT_SCHEMA) is registered FIRST so a registry[0]-always bug
  // would return ALT_SCHEMA and fail the assertions below.
  backend.defineServer('neon', {
    tools: [
      {
        name: 'charge_payment',
        description: 'charge stripe payment card billing transaction',
        inputSchema: structuredClone(ALT_SCHEMA),
        response: { content: [{ type: 'text', text: '{"status":"ok"}' }] },
      },
      {
        name: 'list_projects',
        description: 'list neon database projects in the account',
        inputSchema: structuredClone(RICH_SCHEMA),
        response: { content: [{ type: 'text', text: '["proj-1"]' }] },
      },
    ],
  });
  const agg = new Aggregator([makeConfig('neon')], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
  try {
    // Intent resolves to list_projects (database/projects terms dominate over stripe/payment)
    const resolved = await getResolved(agg, 'list database projects neon');
    // Confirm winner is list_projects, not the first-registered charge_payment
    assert.equal(
      resolved['tool'],
      'neon/list_projects',
      'winning tool must be neon/list_projects (not the first-registered charge_payment)',
    );
    assert.deepEqual(
      resolved['inputSchema'],
      RICH_SCHEMA,
      'resolved.inputSchema must match the winning tool (list_projects), not charge_payment',
    );
    assert.notDeepEqual(
      resolved['inputSchema'],
      ALT_SCHEMA,
      'resolved.inputSchema must NOT be the non-winning tool (charge_payment) schema',
    );
  } finally {
    await agg.shutdown();
  }
});
