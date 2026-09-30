/**
 * GAL drift guard: freeze prompts item `name` and `description` as non-empty strings
 * with namespacing invariants.
 *
 * GAI froze prompts score range, finitude, and sort order.
 * Neither froze the two primary identity fields — `name` and `description` —
 * that every prompts item must carry.
 *
 * Namespacing comes from listAllPrompts() (src-stdio/aggregator.ts ~line 1957):
 *   name:        `${config.id}${SEPARATOR}${p.name}`   → e.g. "gal-exec/cosmos_validator_docs"
 *   description: `[${config.name}] ${p.description || p.name}` → e.g. "[gal-exec] List cosmos..."
 * These namespaced values are then stored in the registry and surfaced verbatim via
 * related.prompts (lines ~1399–1404).
 *
 * Invariants frozen by GAL:
 *   1. Every prompts item `name` is typeof 'string' and has length > 0 (cast:executed).
 *   2. Every prompts item `description` is typeof 'string' and has length > 0 (cast:executed).
 *   3. `name` is namespaced as `{serverId}/{backendName}`;
 *      `description` starts with `[{serverName}] ` (config.name === serverId in makeAgg).
 *   4. Same invariants hold on cast:discovered (no tool match).
 *   5. Same invariants hold on cast:plan (confirm:true).
 *
 * Tests:
 *   GAL-1  cast:executed: every prompts item `name` is typeof 'string' and length > 0.
 *   GAL-2  cast:executed: every prompts item `description` is typeof 'string' and length > 0.
 *   GAL-3  cast:executed: `name` is `{serverId}/{backendName}`;
 *           `description` starts with `[{serverName}] `.
 *   GAL-4  cast:discovered: `name` and `description` are non-empty strings with namespacing.
 *   GAL-5  cast:plan (confirm:true): `name` and `description` are non-empty strings with
 *           namespacing.
 *
 * Fixtures use intent "list cosmos blockchain validators" (4 terms).
 * SEPARATOR = '/' (src-stdio/aggregator.ts line 36).
 *
 * Source: src-stdio/aggregator.ts
 *   listAllPrompts namespacing: lines ~1957–1961
 *   related.prompts construction: lines ~1399–1407
 *   cast:executed: line ~1666
 *   cast:discovered: line ~1439
 *   cast:plan: line ~1617
 *
 * Frozen 2026-09-21.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (prompts item fields, not explain)
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
  return join(tmpdir(), `ch1tty-gal-${Date.now()}-${++dlqSeq}.jsonl`);
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

async function cast(agg: Aggregator, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', args);
  assert.equal(result.isError, undefined, `cast must not error: ${JSON.stringify(result.content)}`);
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

// Intent: "list cosmos blockchain validators" → terms [list, cosmos, blockchain, validators] (4)
const INTENT = 'list cosmos blockchain validators';

// Shared fixtures for exec/plan paths
const EXEC_TOOL = {
  name: 'list_cosmos_blockchain_validators',
  description: 'List cosmos blockchain validators',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text', text: '["v1"]' }] },
};

const EXEC_PROMPTS = [
  {
    name: 'cosmos_validator_docs',
    description: 'Browse cosmos blockchain validators list',
  },
  {
    name: 'cosmos_status',
    description: 'Blockchain connection statistics',
  },
];

// ── GAL-1: cast:executed — name is a non-empty string ────────────────────────

test('GAL-1: cast:executed prompts items have name as a non-empty string', async () => {
  const agg = makeAgg('gal-exec-name', [EXEC_TOOL], EXEC_PROMPTS);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const prompts = body['prompts'] as unknown[];
    assert.ok(Array.isArray(prompts) && prompts.length > 0, 'prompts must be a non-empty array');
    for (const item of prompts) {
      const p = item as Record<string, unknown>;
      assert.equal(typeof p['name'], 'string',
        `prompts item name must be typeof 'string', got ${typeof p['name']}`);
      assert.ok((p['name'] as string).length > 0,
        `prompts item name must be non-empty`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GAL-2: cast:executed — description is a non-empty string ─────────────────

test('GAL-2: cast:executed prompts items have description as a non-empty string', async () => {
  const agg = makeAgg('gal-exec-desc', [EXEC_TOOL], EXEC_PROMPTS);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const prompts = body['prompts'] as unknown[];
    assert.ok(Array.isArray(prompts) && prompts.length > 0, 'prompts must be a non-empty array');
    for (const item of prompts) {
      const p = item as Record<string, unknown>;
      assert.equal(typeof p['description'], 'string',
        `prompts item description must be typeof 'string', got ${typeof p['description']}`);
      assert.ok((p['description'] as string).length > 0,
        `prompts item description must be non-empty`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GAL-3: cast:executed — name and description namespacing ──────────────────

test('GAL-3: cast:executed prompts name is {serverId}/{backendName} and description starts with [{serverName}] ', async () => {
  const SERVER_ID = 'gal-exec';
  const agg = makeAgg(SERVER_ID, [EXEC_TOOL], EXEC_PROMPTS);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const prompts = body['prompts'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(prompts) && prompts.length > 0, 'prompts must be a non-empty array');
    const registeredNames = new Set(EXEC_PROMPTS.map((p) => p.name));
    const PREFIX_NAME = `${SERVER_ID}/`;
    const PREFIX_DESC = `[${SERVER_ID}] `;
    for (const item of prompts) {
      const name = item['name'] as string;
      const desc = item['description'] as string;
      // name: {serverId}/{backendName}
      assert.ok(name.startsWith(PREFIX_NAME),
        `name '${name}' must start with '${PREFIX_NAME}' (SEPARATOR='/')`);
      const backendName = name.slice(PREFIX_NAME.length);
      assert.ok(registeredNames.has(backendName),
        `backend name portion '${backendName}' was not in the registered prompt names`);
      // description: [{serverName}] {description}
      assert.ok(desc.startsWith(PREFIX_DESC),
        `description '${desc}' must start with '${PREFIX_DESC}'`);
      const descBody = desc.slice(PREFIX_DESC.length);
      assert.ok(descBody.length > 0,
        `description body after prefix must be non-empty, got "${descBody}"`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GAL-4: cast:discovered — name and description non-empty with namespacing ──

test('GAL-4: cast:discovered prompts items have non-empty name and description with namespacing', async () => {
  // Tool with zero keyword overlap → best === undefined → cast:discovered
  const SERVER_ID = 'gal-disc';
  const agg = makeAgg(SERVER_ID, [
    {
      name: 'write_file_path',
      description: 'Write content to a local path',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      response: { content: [{ type: 'text', text: '{"ok":true}' }] },
    },
  ], [
    {
      name: 'cosmos_validator_browser',
      description: 'List cosmos blockchain validators catalog',
    },
    {
      name: 'cosmos_overview',
      description: 'Cosmos blockchain summary',
    },
  ]);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'discovered', `expected cast:discovered, got ${body['cast']}`);
    const prompts = body['prompts'] as unknown[];
    assert.ok(Array.isArray(prompts) && prompts.length > 0, 'discovered prompts must be non-empty array');
    const PREFIX_NAME = `${SERVER_ID}/`;
    const PREFIX_DESC = `[${SERVER_ID}] `;
    for (const item of prompts) {
      const p = item as Record<string, unknown>;
      const name = p['name'] as string;
      const desc = p['description'] as string;
      assert.equal(typeof name, 'string', `discovered prompts name must be string`);
      assert.ok(name.length > 0, 'discovered prompts name must be non-empty');
      assert.ok(name.startsWith(PREFIX_NAME),
        `discovered prompts name '${name}' must start with '${PREFIX_NAME}'`);
      assert.equal(typeof desc, 'string', `discovered prompts description must be string`);
      assert.ok(desc.length > 0, 'discovered prompts description must be non-empty');
      assert.ok(desc.startsWith(PREFIX_DESC),
        `discovered prompts description '${desc}' must start with '${PREFIX_DESC}'`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GAL-5: cast:plan — name and description non-empty with namespacing ────────

test('GAL-5: cast:plan prompts items have non-empty name and description with namespacing', async () => {
  const SERVER_ID = 'gal-plan';
  const agg = makeAgg(SERVER_ID, [
    {
      name: 'list_cosmos_blockchain_validators',
      description: 'List cosmos blockchain validators',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: '["v1"]' }] },
    },
  ], [
    {
      name: 'cosmos_validator_guide',
      description: 'Guide to cosmos blockchain validators listing',
    },
    {
      name: 'cosmos_count',
      description: 'Count cosmos blockchain totals',
    },
  ]);
  try {
    const body = await cast(agg, { intent: INTENT, confirm: true });
    assert.equal(body['cast'], 'plan', `expected cast:plan, got ${body['cast']}`);
    const prompts = body['prompts'] as unknown[];
    assert.ok(Array.isArray(prompts) && prompts.length > 0, 'plan prompts must be non-empty array');
    const PREFIX_NAME = `${SERVER_ID}/`;
    const PREFIX_DESC = `[${SERVER_ID}] `;
    for (const item of prompts) {
      const p = item as Record<string, unknown>;
      const name = p['name'] as string;
      const desc = p['description'] as string;
      assert.equal(typeof name, 'string', `plan prompts name must be string`);
      assert.ok(name.length > 0, 'plan prompts name must be non-empty');
      assert.ok(name.startsWith(PREFIX_NAME),
        `plan prompts name '${name}' must start with '${PREFIX_NAME}'`);
      assert.equal(typeof desc, 'string', `plan prompts description must be string`);
      assert.ok(desc.length > 0, 'plan prompts description must be non-empty');
      assert.ok(desc.startsWith(PREFIX_DESC),
        `plan prompts description '${desc}' must start with '${PREFIX_DESC}'`);
    }
  } finally {
    await agg.shutdown();
  }
});
