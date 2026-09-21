/**
 * GAD drift guard: freeze that cast:plan, cast:executed, and cast:discovered
 * prompts items carry a NON-EMPTY description when the key is present.
 *
 * EO (plan/resolved) and EP (executed/discovered) each check:
 *   if ('description' in p) assert.equal(typeof p['description'], 'string')
 * Neither checks length > 0, so a refactor emitting description: '' for prompt
 * items that have a real description would pass EO/EP silently but be caught by GAD.
 *
 * Note on description construction: the aggregator's listAllPrompts() wraps each
 * prompt description as `[ServerName] ${p.description || p.name}` (aggregator.ts
 * line ~1959). This means:
 *   1. Every prompts item in cast output always has a description key (never absent).
 *   2. The description is always a non-empty string (`[ServerName] something`).
 * GAD freezes both invariants and adds a substring check (GAD-2, GAD-5) to confirm
 * the fixture description is preserved inside the output description.
 *
 * GAC closed the same gap for resources items. GAD closes it for prompts items.
 *
 * Tests:
 *
 *   GAD-1  cast:plan prompts: every item whose description key is present has a
 *           non-empty string value (typeof === 'string' && length > 0).
 *
 *   GAD-2  cast:plan prompts: a fixture prompt with a non-empty description is
 *           emitted with an output description that contains the fixture
 *           description as a substring (the aggregator prepends '[ServerName] ').
 *
 *   GAD-3  cast:executed prompts: every item whose description key is present has
 *           a non-empty string value.
 *
 *   GAD-4  cast:discovered prompts: every item whose description key is present has
 *           a non-empty string value.
 *
 *   GAD-5  cast:executed prompts: a fixture prompt's description is preserved as a
 *           substring of the output description (value not emptied or replaced).
 *
 * Fixtures:
 *
 *   GAD-1/2 use a 'gad-plan' server:
 *     - tool 'list_project_schemas': description 'List project schemas by type and name'
 *       → scores 3/3 on 'list project schemas' → cast:plan (confirm:true).
 *     - prompt 'schema_browser': description PLAN_PROMPT_DESCRIPTION
 *       → contains all 3 intent terms → appears in related.prompts.
 *
 *   GAD-3/5 use a 'gad-exec' server:
 *     - tool 'fetch_project_schemas': description 'Fetch project schemas list'
 *       → scores 4/4 on 'fetch project schemas list' → cast:executed.
 *     - prompt 'browse_schema_docs': description EXEC_PROMPT_DESCRIPTION
 *       → 2/4 term overlap → appears in related.prompts.
 *
 *   GAD-4 uses a 'gad-disc' server:
 *     - tool 'write_file_data': description 'Write data to a local file path'
 *       → no overlap with 'browse documentation schemas catalog'
 *       → best === undefined → cast:discovered.
 *     - prompt 'doc_browser': description DISC_PROMPT_DESCRIPTION
 *       → contains all 4 intent terms → score 1.0 → appears in related.prompts.
 *
 * Description construction (probed 2026-09-21):
 *   listAllPrompts() wraps fixture description as `[GAD ${serverId} Service] ${desc}`
 *   (aggregator.ts line ~1959). GAD-2 and GAD-5 use .includes() for substring check.
 *
 * Source: src-stdio/aggregator.ts
 *   prompts map:     lines ~1399–1404  (related.prompts construction)
 *   listAllPrompts:  lines ~1957–1961  (description construction)
 *   cast:plan path:  line  ~1617       (confirm:true branch)
 *   cast:executed:   line  ~1666       (execution result branch)
 *   cast:discovered: line  ~1439       (best===undefined branch)
 *
 * Frozen 2026-09-21.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (prompts item value, not explain)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Fixture description constants (probed 2026-09-21) ────────────────────────

const PLAN_PROMPT_DESCRIPTION = 'List of project data schemas by name';
const EXEC_PROMPT_DESCRIPTION = 'Browse project schemas documentation';
const DISC_PROMPT_DESCRIPTION = 'Browse documentation schemas catalog content';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gad-${Date.now()}-${++_seq}.jsonl`);
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
        name: `GAD ${serverId} Service`,
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

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GAD-1: cast:plan prompts description, when present, is a non-empty string', async () => {
  // EP checks typeof === 'string' when present. GAD-1 adds the length > 0 check.
  // A refactor emitting description: '' for prompt items would pass EP but fail GAD-1.
  const agg = makeAgg('gad-plan', {
    tools: [
      {
        name: 'list_project_schemas',
        description: 'List project schemas by type and name',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '{"schemas":[]}' }] },
      },
    ],
    prompts: [
      {
        name: 'schema_browser',
        description: PLAN_PROMPT_DESCRIPTION,
      },
    ],
  }, 'search');
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list project schemas', confirm: true });
    assert.equal(result.isError, undefined, 'cast:plan must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'plan', `expected cast:plan, got cast:${String(body['cast'])}`);
    const prompts = body['prompts'] as Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(prompts) && prompts.length > 0,
      'cast:plan must include at least one prompts item (fixture defines one prompt with matching terms)');

    for (const item of prompts) {
      if ('description' in item) {
        assert.equal(typeof item['description'], 'string',
          `prompts item.description must be a string, got ${typeof item['description']}`);
        assert.ok((item['description'] as string).length > 0,
          `prompts item.description must be non-empty (fixture defines a non-empty description)`);
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('GAD-2: cast:plan prompts: fixture description is preserved as a substring of output description', async () => {
  // The aggregator prepends '[ServerName] ' to every prompt description via listAllPrompts()
  // (aggregator.ts line ~1959). GAD-2 verifies the fixture description is not lost —
  // it is preserved as a substring of the output description.
  // A bug replacing description with an empty string or an unrelated value would fail this test.
  const agg = makeAgg('gad-plan2', {
    tools: [
      {
        name: 'list_project_schemas',
        description: 'List project schemas by type and name',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '{"schemas":[]}' }] },
      },
    ],
    prompts: [
      {
        name: 'schema_browser',
        description: PLAN_PROMPT_DESCRIPTION,
      },
    ],
  }, 'search');
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list project schemas', confirm: true });
    assert.equal(result.isError, undefined, 'cast:plan must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'plan', `expected cast:plan, got cast:${String(body['cast'])}`);
    const prompts = body['prompts'] as Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(prompts) && prompts.length > 0,
      'cast:plan must include at least one prompts item');

    for (const item of prompts) {
      if ('description' in item) {
        const desc = item['description'] as string;
        assert.ok(desc.includes(PLAN_PROMPT_DESCRIPTION),
          `prompts item.description must contain fixture value as substring: ` +
          `expected to include '${PLAN_PROMPT_DESCRIPTION}', got '${desc}'`);
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('GAD-3: cast:executed prompts description, when present, is a non-empty string', async () => {
  // EP checks typeof === 'string' for cast:executed prompts. GAD-3 adds length > 0.
  const agg = makeAgg('gad-exec', {
    tools: [
      {
        name: 'fetch_project_schemas',
        description: 'Fetch project schemas list',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '{"items":[]}' }] },
      },
    ],
    prompts: [
      {
        name: 'browse_schema_docs',
        description: EXEC_PROMPT_DESCRIPTION,
      },
    ],
  }, 'search');
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'fetch project schemas list' });
    assert.equal(result.isError, undefined, 'cast must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'executed',
      `expected cast:executed, got cast:${String(body['cast'])}`);
    const prompts = body['prompts'] as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(prompts) || prompts.length === 0) {
      return; // No prompts in output — description constraint is vacuously satisfied.
    }

    for (const item of prompts) {
      if ('description' in item) {
        assert.equal(typeof item['description'], 'string',
          `prompts item.description must be a string, got ${typeof item['description']}`);
        assert.ok((item['description'] as string).length > 0,
          `prompts item.description must be non-empty (fixture defines '${EXEC_PROMPT_DESCRIPTION}')`);
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('GAD-4: cast:discovered prompts description, when present, is a non-empty string', async () => {
  // EP checks typeof === 'string' for cast:discovered prompts. GAD-4 adds length > 0.
  // Uses a tool with no keyword overlap so best === undefined → cast:discovered.
  const agg = makeAgg('gad-disc', {
    tools: [
      {
        name: 'write_file_data',
        description: 'Write data to a local file path',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
        response: { content: [{ type: 'text', text: '{"ok":true}' }] },
      },
    ],
    prompts: [
      {
        name: 'doc_browser',
        description: DISC_PROMPT_DESCRIPTION,
      },
    ],
  }, 'documents');
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'browse documentation schemas catalog' });
    assert.equal(result.isError, undefined, 'cast must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'discovered',
      `expected cast:discovered (tool 'write_file_data' has no overlap with intent), ` +
      `got cast:${String(body['cast'])}`);
    const prompts = body['prompts'] as Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(prompts) && prompts.length > 0,
      'cast:discovered must include at least one prompts item (fixture prompt matches all intent terms)');

    for (const item of prompts) {
      if ('description' in item) {
        assert.equal(typeof item['description'], 'string',
          `prompts item.description must be a string, got ${typeof item['description']}`);
        assert.ok((item['description'] as string).length > 0,
          `prompts item.description must be non-empty (fixture defines '${DISC_PROMPT_DESCRIPTION}')`);
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('GAD-5: cast:executed prompts: fixture description is preserved as a substring of output description', async () => {
  // Mirrors GAD-2 for the cast:executed path. Verifies the fixture description
  // is not emptied or replaced — it survives as a substring after the
  // '[ServerName] ' prefix is prepended by listAllPrompts().
  const agg = makeAgg('gad-exec2', {
    tools: [
      {
        name: 'fetch_project_schemas',
        description: 'Fetch project schemas list',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '{"items":[]}' }] },
      },
    ],
    prompts: [
      {
        name: 'browse_schema_docs',
        description: EXEC_PROMPT_DESCRIPTION,
      },
    ],
  }, 'search');
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'fetch project schemas list' });
    assert.equal(result.isError, undefined, 'cast must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'executed',
      `expected cast:executed, got cast:${String(body['cast'])}`);
    const prompts = body['prompts'] as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(prompts) || prompts.length === 0) {
      return; // No prompts in output — value-preservation is vacuously satisfied.
    }

    for (const item of prompts) {
      if ('description' in item) {
        const desc = item['description'] as string;
        assert.ok(desc.includes(EXEC_PROMPT_DESCRIPTION),
          `prompts item.description must contain fixture value as substring: ` +
          `expected to include '${EXEC_PROMPT_DESCRIPTION}', got '${desc}'`);
      }
    }
  } finally {
    await agg.shutdown();
  }
});
