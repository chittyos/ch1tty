/**
 * GFA drift guard: freeze cast:executed and cast:chain_executed intent echo.
 *
 * Intent-echo coverage for other cast modes:
 *   — cast:no_match   GJ-9 freezes intent echo (added 2026-09-20)
 *   — cast:plan       GK-3 freezes intent echo (added 2026-09-20)
 *   — cast:resolved   GK-6 freezes intent echo (added 2026-09-20)
 *
 * Missing before GFA:
 *   — cast:executed       intent is a key (GBA, gv*) but VALUE TYPE never
 *     verified; echo invariant never frozen. A regression serialising intent
 *     as null, 0, or a stale string would pass all prior tests silently.
 *   — cast:chain_executed same gap — key presence frozen (GBA-1/2/3/4) but
 *     typeof and echo never asserted.
 *
 * Source: src-stdio/aggregator.ts
 *   line ~1180: const intent = typeof args.intent === 'string' ? args.intent.trim() : '';
 *   line ~1658: cast:executed response includes  intent  (raw trimmed variable)
 *   line ~1534: cast:chain_executed response includes  intent  (same variable)
 *
 * GFA closes those gaps:
 *
 *   GFA-1  cast:executed intent is a non-empty string
 *   GFA-2  cast:executed intent echoes the input intent string exactly
 *   GFA-3  cast:executed intent has leading/trailing whitespace stripped
 *   GFA-4  cast:chain_executed intent is a non-empty string
 *   GFA-5  cast:chain_executed intent echoes the input intent string exactly
 *
 * Frozen 2026-10-01.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level intent
 *     field, not explanation sub-object)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── cast:executed fixture ──────────────────────────────────────────────────────

const EXEC_CONFIGS: ServerConfig[] = [{
  id: 'neon',
  name: 'Neon DB',
  type: 'remote',
  access: 'readwrite',
  category: 'code',
  endpoint: 'https://neon.tech/mcp',
  lazy: true,
}];

let _execSeq = 0;
function makeExecAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  return new Aggregator(EXEC_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: join(tmpdir(), `ch1tty-gfa-exec-${Date.now()}-${++_execSeq}.jsonl`),
  });
}

async function castExecuted(agg: Aggregator, intent: string): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent });
  assert.equal(result.isError, undefined,
    `cast must not return isError for intent "${intent}": ${JSON.stringify(result.content)}`);
  const body = JSON.parse(
    (result.content as Array<{ type: string; text: string }>)[0]!.text,
  ) as Record<string, unknown>;
  assert.equal(body.cast, 'executed',
    `expected cast:executed, got cast:${String(body.cast)}`);
  return body;
}

// ── cast:chain_executed fixture ────────────────────────────────────────────────

const CHAIN_INTENT = 'list neon database projects';

const CHAIN_CATALOG = {
  code: {
    description: 'Code focus',
    combos: [{
      name: 'neon-list-create',
      chain: ['neon/list_projects', 'neon/create_project'],
      accomplishes: 'List then create a Neon database project',
      verified: true,
    }],
    prompts: [],
  },
};

const CHAIN_CONFIGS: ServerConfig[] = [{
  id: 'neon',
  name: 'Neon',
  type: 'remote',
  access: 'readwrite',
  category: 'database',
  endpoint: 'https://neon.example.com/mcp',
  lazy: true,
}];

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

let _chainSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gfa-chain-${Date.now()}-${++_chainSeq}.jsonl`);
}

function makeChainAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [
      {
        name: 'list_projects',
        description: 'list neon database projects',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: 'project-alpha' }] },
      },
      {
        name: 'create_project',
        description: 'create a neon database project',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
        response: { content: [{ type: 'text', text: 'created-project-beta' }] },
      },
    ],
  });
  const path = dlq();
  return new Aggregator(CHAIN_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: CHAIN_CATALOG,
    focus: 'code',
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

async function castChain(agg: Aggregator, intent: string): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent, chain: true });
  assert.equal(result.isError, undefined,
    `cast must not error for chain intent "${intent}": ${JSON.stringify(result.content)}`);
  const body = JSON.parse(
    (result.content as Array<{ type: string; text: string }>)[0]!.text,
  ) as Record<string, unknown>;
  assert.equal(body.cast, 'chain_executed',
    `expected chain_executed, got cast:${String(body.cast)}`);
  return body;
}

// ── GFA-1: cast:executed intent is a non-empty string ─────────────────────────

test('GFA-1: cast:executed intent is a non-empty string', async () => {
  const agg = makeExecAgg();
  const body = await castExecuted(agg, 'run sql query on database');
  assert.equal(typeof body.intent, 'string',
    `GFA-1: intent must be a string, got ${typeof body.intent}`);
  assert.ok((body.intent as string).length > 0,
    `GFA-1: intent must be a non-empty string, got ${JSON.stringify(body.intent)}`);
});

// ── GFA-2: cast:executed intent echoes the input intent exactly ───────────────

test('GFA-2: cast:executed intent echoes the input intent string exactly', async () => {
  const agg = makeExecAgg();
  const inputIntent = 'run sql query on database';
  const body = await castExecuted(agg, inputIntent);
  assert.equal(body.intent, inputIntent,
    `GFA-2: intent must echo the input exactly. Got "${String(body.intent)}", expected "${inputIntent}".`);
});

// ── GFA-3: cast:executed intent is trimmed (leading/trailing whitespace stripped) ─

test('GFA-3: cast:executed intent has leading and trailing whitespace stripped', async () => {
  const agg = makeExecAgg();
  const paddedIntent = '  run sql query on database  ';
  const trimmedIntent = paddedIntent.trim();
  const body = await castExecuted(agg, paddedIntent);
  assert.equal(body.intent, trimmedIntent,
    `GFA-3: intent must be trimmed. Got "${String(body.intent)}", expected "${trimmedIntent}".`);
});

// ── GFA-4: cast:chain_executed intent is a non-empty string ───────────────────

test('GFA-4: cast:chain_executed intent is a non-empty string', async () => {
  const agg = makeChainAgg();
  const body = await castChain(agg, CHAIN_INTENT);
  assert.equal(typeof body.intent, 'string',
    `GFA-4: chain_executed intent must be a string, got ${typeof body.intent}`);
  assert.ok((body.intent as string).length > 0,
    `GFA-4: chain_executed intent must be non-empty, got ${JSON.stringify(body.intent)}`);
});

// ── GFA-5: cast:chain_executed intent echoes the input intent exactly ─────────

test('GFA-5: cast:chain_executed intent echoes the input intent string exactly', async () => {
  const agg = makeChainAgg();
  const body = await castChain(agg, CHAIN_INTENT);
  assert.equal(body.intent, CHAIN_INTENT,
    `GFA-5: chain_executed intent must echo the input exactly. Got "${String(body.intent)}", expected "${CHAIN_INTENT}".`);
});
