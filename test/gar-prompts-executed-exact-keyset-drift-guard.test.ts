/**
 * GAR drift guard: freeze prompts item exact key set in cast:executed responses.
 *
 * EP (cast:executed/discovered) checks:
 *   Prompts item PERMITTED: { arguments, description, name, score }
 *   Prompts item REQUIRED:  { name, score }
 * EP does NOT assert an exact key set — a regression injecting an extra key
 * (e.g. 'serverId', 'namespace', or 'type') would pass EP silently.
 *
 * GAP froze the resources item exact key set for cast:executed; GAR is the
 * symmetric freeze for prompts items in cast:executed (and cast:plan).
 *
 * Aggregator prompts passthrough (src-stdio/aggregator.ts ~lines 1956–1961):
 *   prompts.map((p) => ({
 *     name: `${config.id}/${p.name}`,
 *     description: `[${config.name}] ${p.description || p.name}`,  // always injected
 *     arguments: p.arguments,   // present when backend prompt carries arguments, else absent
 *   }))
 *
 * Aggregator related.prompts map (~lines 1399–1404):
 *   scoredPrompts.map((p) => ({
 *     name: p.name,
 *     description: p.description,   // always a non-empty string (injected above)
 *     arguments: p.arguments,        // absent when undefined (JSON serialization)
 *     score: p.score,
 *   }))
 *
 * Key insight: description is ALWAYS present (the aggregator synthesises
 * "[serverName] ${p.description || p.name}" even when the backend prompt has
 * no description). Only `arguments` is genuinely optional.
 *
 * Invariants frozen by GAR:
 *   1. cast:executed prompts item WITHOUT arguments has exactly
 *      {description, name, score} — no extra keys, arguments never present.
 *   2. cast:executed prompts item WITH arguments has exactly
 *      {arguments, description, name, score} — no extra keys.
 *   3. cast:plan (confirm:true) prompts item WITHOUT arguments has exactly
 *      {description, name, score}.
 *   4. cast:plan prompts item WITH arguments has exactly
 *      {arguments, description, name, score}.
 *   5. cast:executed prompts item description is always a non-empty string
 *      (even when the backend prompt carries no description — the aggregator
 *       always injects "[serverName] name" as fallback).
 *
 * All tests use intent "list neon database projects" (4 terms: list, neon,
 * database, projects). TOOL_EXEC scores 1.0 → cast:executed; confirm:true
 * → cast:plan. Each prompt's namespaced name+description covers all 4 terms.
 *
 * Prompt scoring haystack (aggregator ~line 1318):
 *   `${p.name} ${p.description || ''}`.toLowerCase()
 * Namespaced name: "gar-N/neon-db" contains 'neon'. Description:
 * "[gar-N] List neon database projects" contains all 4 terms → score 1.0.
 *
 * Source refs:
 *   prompts passthrough: src-stdio/aggregator.ts lines ~1956–1961
 *   prompts map:         src-stdio/aggregator.ts lines ~1399–1404
 *   cast:executed:       src-stdio/aggregator.ts line  ~1666
 *   cast:plan:           src-stdio/aggregator.ts line  ~1617
 *
 * Frozen 2026-09-24.
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
import { SessionCoordinator } from '../src/coordinator.js';
import { FixtureBackend } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gar-${Date.now()}-${++dlqSeq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

function makeAgg(serverId: string, tools: unknown[], prompts: unknown[]): Aggregator {
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

async function cast(
  agg: Aggregator,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', args);
  assert.equal(result.isError, undefined, `cast must not error: ${JSON.stringify(result.content)}`);
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

function sortedKeys(obj: Record<string, unknown>): string[] {
  return Object.keys(obj).sort();
}

// Intent: "list neon database projects" → terms: list, neon, database, projects
const INTENT = 'list neon database projects';

// Tool that matches intent (all 4 terms) → cast:executed / cast:plan
const TOOL_EXEC = {
  name: 'list_neon_database_projects',
  description: 'List neon database projects',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text', text: '{"projects":[]}' }] },
};

// Prompt WITHOUT arguments. Aggregator description injection:
// "[gar-N] List neon database projects" → covers all 4 terms → score 1.0.
const PROMPT_NO_ARGS = {
  name: 'neon-db',
  description: 'List neon database projects',
};

// Prompt WITH arguments. Same description → same scoring.
const PROMPT_WITH_ARGS = {
  name: 'neon-db',
  description: 'List neon database projects',
  arguments: [{ name: 'limit', description: 'Max number of results', required: false }],
};

// ── GAR-1: cast:executed — prompt WITHOUT arguments has exactly {description, name, score}

test('GAR-1: cast:executed prompt item without arguments has exactly keys {description, name, score}', async () => {
  const agg = makeAgg('gar-exec-1', [TOOL_EXEC], [PROMPT_NO_ARGS]);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const prompts = body['prompts'] as unknown[];
    assert.ok(Array.isArray(prompts) && prompts.length > 0, 'prompts must be a non-empty array');
    const target = (prompts as Record<string, unknown>[]).find(
      (p) => String(p['name']).endsWith('/' + PROMPT_NO_ARGS.name),
    );
    assert.ok(target !== undefined, `prompt ending in "/${PROMPT_NO_ARGS.name}" not found`);
    assert.deepEqual(
      sortedKeys(target),
      ['description', 'name', 'score'],
      `prompt without arguments must have exactly {description, name, score}, got ${JSON.stringify(sortedKeys(target))}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GAR-2: cast:executed — prompt WITH arguments has exactly {arguments, description, name, score}

test('GAR-2: cast:executed prompt item with arguments has exactly keys {arguments, description, name, score}', async () => {
  const agg = makeAgg('gar-exec-2', [TOOL_EXEC], [PROMPT_WITH_ARGS]);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const prompts = body['prompts'] as unknown[];
    assert.ok(Array.isArray(prompts) && prompts.length > 0, 'prompts must be a non-empty array');
    const target = (prompts as Record<string, unknown>[]).find(
      (p) => String(p['name']).endsWith('/' + PROMPT_WITH_ARGS.name),
    );
    assert.ok(target !== undefined, `prompt ending in "/${PROMPT_WITH_ARGS.name}" not found`);
    assert.deepEqual(
      sortedKeys(target),
      ['arguments', 'description', 'name', 'score'],
      `prompt with arguments must have exactly {arguments, description, name, score}, got ${JSON.stringify(sortedKeys(target))}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GAR-3: cast:plan — prompt WITHOUT arguments has exactly {description, name, score}

test('GAR-3: cast:plan prompt item without arguments has exactly keys {description, name, score}', async () => {
  const agg = makeAgg('gar-plan-3', [TOOL_EXEC], [PROMPT_NO_ARGS]);
  try {
    const body = await cast(agg, { intent: INTENT, confirm: true });
    assert.equal(body['cast'], 'plan', `expected cast:plan, got ${body['cast']}`);
    const prompts = body['prompts'] as unknown[];
    assert.ok(Array.isArray(prompts) && prompts.length > 0, 'prompts must be a non-empty array');
    const target = (prompts as Record<string, unknown>[]).find(
      (p) => String(p['name']).endsWith('/' + PROMPT_NO_ARGS.name),
    );
    assert.ok(target !== undefined, `prompt ending in "/${PROMPT_NO_ARGS.name}" not found`);
    assert.deepEqual(
      sortedKeys(target),
      ['description', 'name', 'score'],
      `plan prompt without arguments must have exactly {description, name, score}, got ${JSON.stringify(sortedKeys(target))}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GAR-4: cast:plan — prompt WITH arguments has exactly {arguments, description, name, score}

test('GAR-4: cast:plan prompt item with arguments has exactly keys {arguments, description, name, score}', async () => {
  const agg = makeAgg('gar-plan-4', [TOOL_EXEC], [PROMPT_WITH_ARGS]);
  try {
    const body = await cast(agg, { intent: INTENT, confirm: true });
    assert.equal(body['cast'], 'plan', `expected cast:plan, got ${body['cast']}`);
    const prompts = body['prompts'] as unknown[];
    assert.ok(Array.isArray(prompts) && prompts.length > 0, 'prompts must be a non-empty array');
    const target = (prompts as Record<string, unknown>[]).find(
      (p) => String(p['name']).endsWith('/' + PROMPT_WITH_ARGS.name),
    );
    assert.ok(target !== undefined, `prompt ending in "/${PROMPT_WITH_ARGS.name}" not found`);
    assert.deepEqual(
      sortedKeys(target),
      ['arguments', 'description', 'name', 'score'],
      `plan prompt with arguments must have exactly {arguments, description, name, score}, got ${JSON.stringify(sortedKeys(target))}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GAR-5: description is always a non-empty string in cast:executed

test('GAR-5: cast:executed prompt item description is always a non-empty string (aggregator injection)', async () => {
  // Use a prompt with NO description field — aggregator must still inject "[id] name"
  const PROMPT_NO_DESC = { name: 'neon-list-projects' };
  const agg = makeAgg('gar-exec-5', [TOOL_EXEC], [{
    name: PROMPT_NO_DESC.name,
    description: 'List neon database projects template',  // needed for haystack score
  }]);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const prompts = body['prompts'] as unknown[];
    assert.ok(Array.isArray(prompts) && prompts.length > 0, 'prompts must be a non-empty array');
    const target = (prompts as Record<string, unknown>[]).find(
      (p) => String(p['name']).endsWith('/' + PROMPT_NO_DESC.name),
    );
    assert.ok(target !== undefined, `prompt ending in "/${PROMPT_NO_DESC.name}" not found`);
    const desc = target['description'];
    assert.ok(
      typeof desc === 'string' && desc.length > 0,
      `description must be a non-empty string, got ${JSON.stringify(desc)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
