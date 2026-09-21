/**
 * GAE drift guard: freeze that cast:plan, cast:executed, and cast:discovered
 * prompts items' arguments arrays contain items with the correct key set and
 * value types.
 *
 * EO (plan/resolved) and EP (executed/discovered) each check:
 *   if ('arguments' in p) assert.ok(Array.isArray(p['arguments']))
 * Neither checks item key sets or value types within the array. A refactor
 * emitting arguments: [{}] (missing name), [{name: 123}] (wrong type),
 * [{name: 'x', extra: true}] (extra key), or [{name: 'x', required: 1}]
 * (required as number) would pass EO/EP silently but be caught by GAE.
 *
 * Arguments item type (PromptEntry.arguments[]):
 *   { name: string; description?: string; required?: boolean }
 * Permitted key set: { name, description, required } — no other keys.
 * Required key: name (always present, non-empty string).
 * Optional typed keys: description (string if present), required (boolean if present).
 *
 * GAC closed the description value gap for resources. GAD closed it for prompts.
 * GAE closes the arguments item shape gap for prompts.
 *
 * Tests:
 *
 *   GAE-1  cast:plan prompts: every arguments item has only permitted keys
 *           {name, description, required}; the `name` key is always present.
 *
 *   GAE-2  cast:plan prompts: arguments item value types — `name` is a
 *           non-empty string; `description` is a string when present;
 *           `required` is a boolean when present.
 *
 *   GAE-3  cast:executed prompts: same key set and value types as GAE-1/GAE-2.
 *
 *   GAE-4  cast:discovered prompts: same key set and value types.
 *
 *   GAE-5  cast:executed prompts: fixture arguments items are preserved exactly
 *           in output — name, description, and required values match the fixture.
 *
 * Fixtures:
 *
 *   GAE-1/2 use a 'gae-plan' server:
 *     - tool 'list_project_configs': description 'List project configurations by name'
 *       → scores 3/3 on 'list project configurations' → cast:plan (confirm:true).
 *     - prompt 'config_browser': arguments [{name:'format', description:
 *       'Output format for config listing', required:true}, {name:'limit',
 *       description:'Maximum number of configs to return', required:false}]
 *
 *   GAE-3/5 use a 'gae-exec' / 'gae-exec2' server:
 *     - tool 'fetch_project_configs': description 'Fetch project configurations list'
 *       → scores 4/4 on 'fetch project configurations list' → cast:executed.
 *     - prompt 'config_docs': arguments [{name:'query', description:'Search
 *       query for configs', required:true}]
 *
 *   GAE-4 uses a 'gae-disc' server:
 *     - tool 'write_log_data': description 'Write data to a local log file'
 *       → no overlap with 'browse documentation configurations catalog'
 *       → best === undefined → cast:discovered.
 *     - prompt 'doc_browser': description contains all 4 intent terms
 *       → score > 0.1 → appears in discovered. arguments: [{name:'topic',
 *       description:'Documentation topic to browse', required:false}]
 *
 * Source: src-stdio/aggregator.ts
 *   prompts map:     lines ~1399–1404  (related.prompts construction; arguments: p.arguments)
 *   listAllPrompts:  lines ~1957–1961  (arguments passed through unchanged)
 *   cast:plan path:  line  ~1617       (confirm:true branch)
 *   cast:executed:   line  ~1666       (execution result branch)
 *   cast:discovered: line  ~1439       (best===undefined branch)
 *
 * Frozen 2026-09-21.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (arguments item shapes, not explain)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Fixture argument constants (probed 2026-09-21) ───────────────────────────

const PLAN_ARG_1 = { name: 'format', description: 'Output format for config listing', required: true };
const PLAN_ARG_2 = { name: 'limit', description: 'Maximum number of configs to return', required: false };
const EXEC_ARG_1 = { name: 'query', description: 'Search query for configs', required: true };
const DISC_ARG_1 = { name: 'topic', description: 'Documentation topic to browse', required: false };

const ARGS_PERMITTED_KEYS: ReadonlySet<string> = new Set(['name', 'description', 'required']);

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gae-${Date.now()}-${++_seq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

function makeAgg(serverId: string, serverDef: Parameters<FixtureBackend['defineServer']>[1], category: string): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer(serverId, serverDef);
  return new Aggregator(
    [
      {
        id: serverId,
        name: `GAE ${serverId} Service`,
        type: 'remote',
        access: 'readwrite',
        category,
        endpoint: `https://${serverId}.example/mcp`,
        lazy: true,
      } as ServerConfig,
    ],
    {
      backendFactory: () => backend,
      embedEnabled: false,
      ledgerDlqPath: dlq(),
      coordinator: new KeywordOnlyCoordinator(),
    },
  );
}

function assertArgumentsItemShape(item: Record<string, unknown>, context: string): void {
  // Key set: only permitted keys; name is always present.
  for (const key of Object.keys(item)) {
    assert.ok(ARGS_PERMITTED_KEYS.has(key),
      `${context}: arguments item has unexpected key '${key}' (permitted: name, description, required)`);
  }
  assert.ok('name' in item,
    `${context}: arguments item must have 'name' key`);
  // Value types.
  assert.equal(typeof item['name'], 'string',
    `${context}: arguments item.name must be a string, got ${typeof item['name']}`);
  assert.ok((item['name'] as string).length > 0,
    `${context}: arguments item.name must be non-empty`);
  if ('description' in item) {
    assert.equal(typeof item['description'], 'string',
      `${context}: arguments item.description must be a string when present, got ${typeof item['description']}`);
  }
  if ('required' in item) {
    assert.equal(typeof item['required'], 'boolean',
      `${context}: arguments item.required must be a boolean when present, got ${typeof item['required']}`);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GAE-1: cast:plan prompts arguments items: only permitted keys present, name is always present', async () => {
  // EO checks Array.isArray(p['arguments']) when present but not item key sets.
  // GAE-1 freezes that no arguments item has extra keys and that name is always present.
  const agg = makeAgg('gae-plan', {
    tools: [
      {
        name: 'list_project_configs',
        description: 'List project configurations by name',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '{"configs":[]}' }] },
      },
    ],
    prompts: [
      {
        name: 'config_browser',
        description: 'Browse project configurations',
        arguments: [PLAN_ARG_1, PLAN_ARG_2],
      },
    ],
  }, 'search');
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list project configurations', confirm: true });
    assert.equal(result.isError, undefined, 'cast:plan must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'plan', `expected cast:plan, got cast:${String(body['cast'])}`);
    const prompts = body['prompts'] as Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(prompts) && prompts.length > 0,
      'cast:plan must include at least one prompts item (fixture defines one prompt)');

    for (const item of prompts) {
      if ('arguments' in item) {
        assert.ok(Array.isArray(item['arguments']),
          'prompts item.arguments must be an array when present');
        const args = item['arguments'] as Array<Record<string, unknown>>;
        for (const arg of args) {
          assertArgumentsItemShape(arg, 'GAE-1 cast:plan');
        }
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('GAE-2: cast:plan prompts arguments items: name is non-empty string, description is string, required is boolean', async () => {
  // EO does not check value types within arguments items.
  // GAE-2 freezes: name must be non-empty string; description must be string when
  // present; required must be boolean when present.
  const agg = makeAgg('gae-plan2', {
    tools: [
      {
        name: 'list_project_configs',
        description: 'List project configurations by name',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '{"configs":[]}' }] },
      },
    ],
    prompts: [
      {
        name: 'config_browser',
        description: 'Browse project configurations',
        arguments: [PLAN_ARG_1, PLAN_ARG_2],
      },
    ],
  }, 'search');
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list project configurations', confirm: true });
    assert.equal(result.isError, undefined, 'cast:plan must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'plan', `expected cast:plan, got cast:${String(body['cast'])}`);
    const prompts = body['prompts'] as Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(prompts) && prompts.length > 0,
      'cast:plan must include at least one prompts item');

    const promptsWithArgs = prompts.filter((p) => 'arguments' in p && Array.isArray(p['arguments']) && (p['arguments'] as unknown[]).length > 0);
    assert.ok(promptsWithArgs.length > 0,
      'expected at least one prompts item with a non-empty arguments array (fixture defines two)');

    for (const item of promptsWithArgs) {
      const args = item['arguments'] as Array<Record<string, unknown>>;
      for (const arg of args) {
        assertArgumentsItemShape(arg, 'GAE-2 cast:plan');
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('GAE-3: cast:executed prompts arguments items: only permitted keys, correct value types', async () => {
  // EP checks Array.isArray for cast:executed arguments. GAE-3 adds key set + value types.
  const agg = makeAgg('gae-exec', {
    tools: [
      {
        name: 'fetch_project_configs',
        description: 'Fetch project configurations list',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '{"items":[]}' }] },
      },
    ],
    prompts: [
      {
        name: 'config_docs',
        description: 'Browse project configurations documentation',
        arguments: [EXEC_ARG_1],
      },
    ],
  }, 'search');
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'fetch project configurations list' });
    assert.equal(result.isError, undefined, 'cast must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'executed',
      `expected cast:executed, got cast:${String(body['cast'])}`);
    const prompts = body['prompts'] as Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(prompts) && prompts.length > 0,
      'cast:executed must include at least one prompts item (fixture defines one prompt with arguments)');

    for (const item of prompts) {
      if ('arguments' in item) {
        assert.ok(Array.isArray(item['arguments']),
          'prompts item.arguments must be an array when present');
        const args = item['arguments'] as Array<Record<string, unknown>>;
        for (const arg of args) {
          assertArgumentsItemShape(arg, 'GAE-3 cast:executed');
        }
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('GAE-4: cast:discovered prompts arguments items: only permitted keys, correct value types', async () => {
  // EP checks Array.isArray for cast:discovered arguments. GAE-4 adds key set + value types.
  // Uses a tool with no keyword overlap so best === undefined → cast:discovered.
  const agg = makeAgg('gae-disc', {
    tools: [
      {
        name: 'write_log_data',
        description: 'Write data to a local log file',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
        response: { content: [{ type: 'text', text: '{"ok":true}' }] },
      },
    ],
    prompts: [
      {
        name: 'doc_browser',
        description: 'Browse documentation configurations catalog content',
        arguments: [DISC_ARG_1],
      },
    ],
  }, 'documents');
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'browse documentation configurations catalog' });
    assert.equal(result.isError, undefined, 'cast must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'discovered',
      `expected cast:discovered (tool 'write_log_data' has no overlap with intent), ` +
      `got cast:${String(body['cast'])}`);
    const prompts = body['prompts'] as Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(prompts) && prompts.length > 0,
      'cast:discovered must include at least one prompts item (fixture prompt matches all intent terms)');

    for (const item of prompts) {
      if ('arguments' in item) {
        assert.ok(Array.isArray(item['arguments']),
          'prompts item.arguments must be an array when present');
        const args = item['arguments'] as Array<Record<string, unknown>>;
        for (const arg of args) {
          assertArgumentsItemShape(arg, 'GAE-4 cast:discovered');
        }
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('GAE-5: cast:executed prompts: fixture arguments items are preserved exactly in output', async () => {
  // EP does not check that arguments item values are preserved from the fixture.
  // GAE-5 verifies name, description, and required pass through unchanged from
  // the fixture (arguments: p.arguments at aggregator.ts line ~1402).
  const agg = makeAgg('gae-exec2', {
    tools: [
      {
        name: 'fetch_project_configs',
        description: 'Fetch project configurations list',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '{"items":[]}' }] },
      },
    ],
    prompts: [
      {
        name: 'config_docs',
        description: 'Browse project configurations documentation',
        arguments: [EXEC_ARG_1],
      },
    ],
  }, 'search');
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'fetch project configurations list' });
    assert.equal(result.isError, undefined, 'cast must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'executed',
      `expected cast:executed, got cast:${String(body['cast'])}`);
    const prompts = body['prompts'] as Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(prompts) && prompts.length > 0,
      'cast:executed must include at least one prompts item');

    const promptsWithArgs = prompts.filter((p) => 'arguments' in p && Array.isArray(p['arguments']) && (p['arguments'] as unknown[]).length > 0);
    assert.ok(promptsWithArgs.length > 0,
      'expected at least one prompts item with a non-empty arguments array (fixture defines one with query arg)');

    for (const item of promptsWithArgs) {
      const args = item['arguments'] as Array<Record<string, unknown>>;
      const fixtureArgs = [EXEC_ARG_1];
      for (const fixtureArg of fixtureArgs) {
        const match = args.find((a) => a['name'] === fixtureArg.name);
        assert.ok(match !== undefined,
          `expected fixture argument '${fixtureArg.name}' in output arguments (passed through unchanged)`);
        assert.equal(match['description'], fixtureArg.description,
          `arguments item '${fixtureArg.name}'.description must equal fixture value ` +
          `'${fixtureArg.description}', got '${String(match['description'])}'`);
        assert.equal(match['required'], fixtureArg.required,
          `arguments item '${fixtureArg.name}'.required must equal fixture value ` +
          `${String(fixtureArg.required)}, got ${String(match['required'])}`);
      }
    }
  } finally {
    await agg.shutdown();
  }
});
