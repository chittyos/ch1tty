/**
 * GDK drift guard: freeze that ch1tty/execute dryRun response `args` field
 * exactly echoes the caller-supplied args object — no extra keys, no mutation,
 * no omission of passed values.
 *
 * Source: handleExecute (src/aggregator.ts):
 *
 *   const toolArgs = (typeof args.args === 'object' && args.args !== null && !Array.isArray(args.args))
 *     ? args.args
 *     : {};
 *
 *   return { content: [{ type: 'text', text: JSON.stringify({
 *     status: 'dry_run', server, tool, args: toolArgs, ...
 *   }) }] };
 *
 * `toolArgs` is read directly from the caller's args.args.  The dryRun JSON
 * includes it verbatim.  Any future change that serialises the wrong args
 * reference, injects extra fields (e.g. timeout, sessionId, dryRun), or
 * mutates values (e.g. coercing types, trimming keys) would silently break
 * client previewing behaviour.  This guard freezes exact echo semantics.
 *
 * Prior art:
 *   EC: required key names (status/server/tool/args); not exact echo check.
 *   GL: value types of server/tool/latencyMs fields; not args content.
 *   GDC: key set of dryRun JSON; not args sub-object content.
 *   GDJ: top-level key count and names; not args sub-object content.
 *   None of the above check args deep-equality or absence-of-extra-fields.
 *
 * GDK tests:
 *
 *   GDK-1  args is exactly {} when caller passes no args (not null / undefined)
 *   GDK-2  args is deep-equal to the caller-supplied object (flat, primitives)
 *   GDK-3  args contains NO extra keys beyond what caller passed
 *          (dryRun / sessionId / timeout must not leak into args)
 *   GDK-4  args preserves nested objects without flattening
 *   GDK-5  args values are preserved as-passed: strings stay strings, numbers
 *          stay numbers, booleans stay booleans (no coercion)
 *
 * Frozen 2026-09-28.
 *
 * CLAUDE.md compliance:
 *   - Public MCP surface: unchanged (5 meta-tools: search/execute/status/reload/cast).
 *   - buildCastExplanation metric freeze: not applicable (execute path, not cast explain).
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gdk-${Date.now()}-${++_seq}.jsonl`);
}

const BASE_CONFIGS: ServerConfig[] = [
  { id: 'neon',   name: 'Neon DB', type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.tech/mcp',  lazy: true } as ServerConfig,
  { id: 'stripe', name: 'Stripe',  type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true } as ServerConfig,
];

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon',   FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
}

/**
 * Call execute with dryRun:true and return the parsed dryRun JSON object.
 * callerArgs is the `args` sub-object passed to the execute call.
 */
async function dryRunArgs(
  agg: Aggregator,
  tool: string,
  callerArgs?: Record<string, unknown>,
  extraCallArgs?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const callArgs: Record<string, unknown> = { tool, dryRun: true };
  if (callerArgs !== undefined) callArgs.args = callerArgs;
  if (extraCallArgs) Object.assign(callArgs, extraCallArgs);
  const result = await agg.callTool('ch1tty/execute', callArgs);
  assert.ok(!result.isError, `dryRun for "${tool}" must not return isError`);
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'dryRun must have at least 1 content item');
  const item = content[0];
  assert.equal(item.type, 'text', 'dryRun content[0] must be type:text');
  assert.ok(typeof item.text === 'string', 'dryRun content[0] text must be a string');
  const dr = JSON.parse(item.text!) as Record<string, unknown>;
  return dr.args as Record<string, unknown>;
}

// ── GDK-1: No args → args is exactly {} ──────────────────────────────────────

test('GDK-1: dryRun without caller args has args === {} (empty object, not null/undefined)', async () => {
  const agg = makeAgg();
  try {
    const argsField = await dryRunArgs(agg, 'neon/list_projects');
    assert.ok(
      argsField !== null && argsField !== undefined,
      'GDK-1: args field must not be null or undefined when no args are passed',
    );
    assert.equal(
      typeof argsField,
      'object',
      `GDK-1: args field must be an object; got ${typeof argsField}`,
    );
    assert.deepEqual(
      argsField,
      {},
      `GDK-1: args field must be exactly {} when no args are passed; got ${JSON.stringify(argsField)}. ` +
      'handleExecute defaults toolArgs to {} when args.args is absent.',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDK-2: args echoes flat caller args exactly ────────────────────────────────

test('GDK-2: dryRun args is deep-equal to caller-supplied flat args object', async () => {
  const agg = makeAgg();
  try {
    const supplied = { projectId: 'proj-abc', limit: 25, includeArchived: false };
    const argsField = await dryRunArgs(agg, 'neon/list_projects', supplied);
    assert.deepEqual(
      argsField,
      supplied,
      `GDK-2: dryRun args must deep-equal caller-supplied args; ` +
      `expected ${JSON.stringify(supplied)} but got ${JSON.stringify(argsField)}. ` +
      'handleExecute assigns toolArgs = args.args directly into the dryRun JSON.',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDK-3: No leak of dryRun/sessionId/timeout into args ─────────────────────

test('GDK-3: dryRun/sessionId/timeout must NOT appear inside dryRun args field', async () => {
  const agg = makeAgg();
  try {
    const supplied = { myKey: 'myValue' };
    const argsField = await dryRunArgs(agg, 'neon/list_projects', supplied, {
      sessionId: 'leak-test-session',
      timeout: 5000,
    });
    const FORBIDDEN = ['dryRun', 'sessionId', 'timeout', 'tool'];
    for (const key of FORBIDDEN) {
      assert.ok(
        !Object.prototype.hasOwnProperty.call(argsField, key),
        `GDK-3: dryRun args must not contain "${key}" — it is a call-level field, ` +
        `not a tool argument; got args=${JSON.stringify(argsField)}. ` +
        'toolArgs = args.args (the inner object), not the outer args passed to execute.',
      );
    }
    // The supplied key should still be present
    assert.ok(
      Object.prototype.hasOwnProperty.call(argsField, 'myKey'),
      `GDK-3: supplied key "myKey" must still appear in args; got ${JSON.stringify(argsField)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDK-4: Nested objects preserved without flattening ────────────────────────

test('GDK-4: dryRun args preserves nested object structure without flattening', async () => {
  const agg = makeAgg();
  try {
    const supplied = {
      filter: { status: 'active', tags: ['infra', 'prod'] },
      pagination: { limit: 10, offset: 0 },
    };
    const argsField = await dryRunArgs(agg, 'neon/list_projects', supplied);
    assert.deepEqual(
      argsField,
      supplied,
      `GDK-4: dryRun args must preserve nested objects; ` +
      `expected ${JSON.stringify(supplied)} but got ${JSON.stringify(argsField)}. ` +
      'JSON.stringify/parse round-trip must not flatten or lose nested values.',
    );
    // Explicitly check nested structure survives
    const af = argsField as typeof supplied;
    assert.deepEqual(
      af.filter,
      { status: 'active', tags: ['infra', 'prod'] },
      'GDK-4: nested filter object must survive verbatim',
    );
    assert.deepEqual(
      af.pagination,
      { limit: 10, offset: 0 },
      'GDK-4: nested pagination object must survive verbatim',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDK-5: Primitive value types are preserved ────────────────────────────────

test('GDK-5: dryRun args preserves string/number/boolean types without coercion', async () => {
  const agg = makeAgg();
  try {
    const supplied: Record<string, unknown> = {
      name: 'my-project',
      count: 42,
      active: true,
      score: 3.14,
      empty: '',
      zero: 0,
      falsy: false,
    };
    const argsField = await dryRunArgs(agg, 'neon/list_projects', supplied);
    assert.strictEqual(typeof argsField.name,   'string',  'GDK-5: string value must stay string');
    assert.strictEqual(typeof argsField.count,  'number',  'GDK-5: number value must stay number');
    assert.strictEqual(typeof argsField.active, 'boolean', 'GDK-5: boolean true must stay boolean');
    assert.strictEqual(typeof argsField.score,  'number',  'GDK-5: float value must stay number');
    assert.strictEqual(argsField.name,   'my-project', 'GDK-5: string value must be unchanged');
    assert.strictEqual(argsField.count,  42,            'GDK-5: integer value must be unchanged');
    assert.strictEqual(argsField.active, true,          'GDK-5: boolean true must be unchanged');
    assert.strictEqual(argsField.score,  3.14,          'GDK-5: float value must be unchanged');
    assert.strictEqual(argsField.empty,  '',            'GDK-5: empty string must be preserved');
    assert.strictEqual(argsField.zero,   0,             'GDK-5: zero must be preserved');
    assert.strictEqual(argsField.falsy,  false,         'GDK-5: boolean false must be preserved');
  } finally {
    await agg.shutdown();
  }
});
