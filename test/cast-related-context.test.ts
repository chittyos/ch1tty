/**
 * test(II): related-context surfacing in successful cast responses
 *
 * When cast resolves a tool (best !== null), the response also includes
 * `prompts` and `resources` fields for any prompts/resources that score
 * > 0.1 against the intent — even though a tool was found and executed.
 *
 * This is distinct from cast:discovered (aggregator.ts:894-906), which fires
 * only when NO tool matches. The related fields here (aggregator.ts:874-891)
 * are spread into BOTH cast:plan (line 932) and cast:executed (line 960)
 * responses. Previously untested: only the cast:discovered path had coverage
 * for prompts/resources; the successful-tool path had none.
 *
 * Tests:
 *   1.  cast:plan  + tool + prompt both match intent → `prompts` present in plan
 *   2.  cast:plan  + tool + resource both match intent → `resources` present in plan
 *   3.  cast:plan  + tool + prompt + resource all match → both `prompts` and `resources`
 *   4.  cast:plan  prompt with `arguments` → `arguments` preserved in prompts entry
 *   5.  cast:plan  resource with mimeType → `mimeType` preserved in resources entry
 *   6.  cast:executed + tool + prompt match → `prompts` in metadata content[0]
 *   7.  cast:executed + tool + resource match → `resources` in metadata content[0]
 *   8.  Prompt score ≤ 0.1 → `prompts` field absent even when prompts registered
 *   9.  Resource score ≤ 0.1 → `resources` field absent even when resources registered
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import { FixtureBackend } from './fixture-backend.js';
import type { PromptEntry, ResourceEntry, ServerConfig } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-related-${label}-${Date.now()}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

interface BackendDef {
  toolName: string;
  toolDesc: string;
  prompts?: PromptEntry[];
  resources?: ResourceEntry[];
}

function makeAgg(label: string, def: BackendDef): { agg: Aggregator; backend: FixtureBackend } {
  const backend = new FixtureBackend();
  const serverId = label;
  backend.defineServer(serverId, {
    tools: [{
      name: def.toolName,
      description: def.toolDesc,
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] },
    }],
    prompts: def.prompts ?? [],
    resources: def.resources ?? [],
  });
  const configs: ServerConfig[] = [{
    id: serverId,
    name: serverId,
    type: 'remote',
    access: 'readwrite',
    category: 'ecosystem',
    endpoint: `https://${serverId}.test/mcp`,
    lazy: true,
  }];
  const path = dlqPath(label);
  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: {},
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
  return { agg, backend };
}

function parsePlan(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  const first = result.content[0];
  assert.equal(first.type, 'text');
  const body = JSON.parse(first.text!);
  assert.equal(body.cast, 'plan', `expected cast:plan, got: ${JSON.stringify(body)}`);
  return body;
}

function parseExecutedMeta(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  const first = result.content[0];
  assert.equal(first.type, 'text');
  const body = JSON.parse(first.text!);
  assert.equal(body.cast, 'executed', `expected cast:executed, got: ${JSON.stringify(body)}`);
  return body;
}

// Intent: "sql query database" → terms: ["sql", "query", "database"] (all len ≥ 3)
// Tool matches all 3 → score 1.0; prompt matches 2/3 → score 0.67; resource matches 3/3 → score 1.0
const INTENT = 'sql query database';

const MATCHING_TOOL = {
  toolName: 'run_sql',
  toolDesc: 'Execute a SQL query against the database',
};

const MATCHING_PROMPT: PromptEntry = {
  name: 'sql-query-guide',
  description: 'Guide for writing efficient SQL queries',
};

const MATCHING_RESOURCE: ResourceEntry = {
  uri: 'docs://database-sql-reference',
  name: 'SQL Reference',
  description: 'Database SQL query reference guide',
};

// ── 1. cast:plan + tool + prompt → `prompts` in plan response ────────────────

test('cast:plan with tool + matching prompt → plan.prompts array present', async () => {
  const { agg } = makeAgg('plan-prompt', {
    ...MATCHING_TOOL,
    prompts: [MATCHING_PROMPT],
  });

  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, confirm: true });
  const plan = parsePlan(result);

  assert.ok(Array.isArray(plan.prompts), 'plan.prompts should be an array');
  assert.equal((plan.prompts as unknown[]).length, 1, 'one prompt matched');
  assert.equal((plan.prompts as Array<{ name: string }>)[0].name, `plan-prompt/${MATCHING_PROMPT.name}`, 'prompt name is namespaced');
});

// ── 2. cast:plan + tool + resource → `resources` in plan response ─────────────

test('cast:plan with tool + matching resource → plan.resources array present', async () => {
  const { agg } = makeAgg('plan-resource', {
    ...MATCHING_TOOL,
    resources: [MATCHING_RESOURCE],
  });

  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, confirm: true });
  const plan = parsePlan(result);

  assert.ok(Array.isArray(plan.resources), 'plan.resources should be an array');
  assert.equal((plan.resources as unknown[]).length, 1, 'one resource matched');
});

// ── 3. cast:plan + tool + prompt + resource → both fields present ─────────────

test('cast:plan with tool + prompt + resource → both plan.prompts and plan.resources present', async () => {
  const { agg } = makeAgg('plan-both', {
    ...MATCHING_TOOL,
    prompts: [MATCHING_PROMPT],
    resources: [MATCHING_RESOURCE],
  });

  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, confirm: true });
  const plan = parsePlan(result);

  assert.ok(Array.isArray(plan.prompts), 'plan.prompts present when both match');
  assert.ok(Array.isArray(plan.resources), 'plan.resources present when both match');
  assert.equal((plan.prompts as unknown[]).length, 1, 'one prompt');
  assert.equal((plan.resources as unknown[]).length, 1, 'one resource');
});

// ── 4. prompt.arguments preserved through related context ────────────────────

test('cast:plan prompt with arguments → arguments preserved in plan.prompts entry', async () => {
  const promptWithArgs: PromptEntry = {
    name: 'sql-template',
    description: 'Generate a SQL query template for the database',
    arguments: [
      { name: 'table', description: 'Target table name', required: true },
      { name: 'limit', description: 'Row limit', required: false },
    ],
  };
  const { agg } = makeAgg('plan-args', {
    ...MATCHING_TOOL,
    prompts: [promptWithArgs],
  });

  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, confirm: true });
  const plan = parsePlan(result);

  const entry = (plan.prompts as Array<{ name: string; arguments?: unknown }>)[0];
  assert.ok(Array.isArray(entry.arguments), 'arguments array present in prompt entry');
  assert.equal((entry.arguments as unknown[]).length, 2, 'both arguments preserved');
});

// ── 5. resource.mimeType preserved through related context ──────────────────

test('cast:plan resource with mimeType → mimeType preserved in plan.resources entry', async () => {
  const resourceWithMime: ResourceEntry = {
    uri: 'docs://sql-reference-pdf',
    name: 'SQL Reference PDF',
    description: 'Database SQL query reference guide',
    mimeType: 'application/pdf',
  };
  const { agg } = makeAgg('plan-mime', {
    ...MATCHING_TOOL,
    resources: [resourceWithMime],
  });

  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, confirm: true });
  const plan = parsePlan(result);

  const entry = (plan.resources as Array<{ mimeType?: string; score: number }>)[0];
  assert.equal(entry.mimeType, 'application/pdf', 'mimeType is preserved in plan.resources entry');
  assert.ok(typeof entry.score === 'number' && entry.score > 0.1, 'resource has score > 0.1 in plan');
});

// ── 6. cast:executed + tool + prompt → `prompts` in metadata content[0] ──────

test('cast:executed with tool + matching prompt → executed metadata includes prompts', async () => {
  const { agg } = makeAgg('exec-prompt', {
    ...MATCHING_TOOL,
    prompts: [MATCHING_PROMPT],
  });

  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, confirm: false });
  const meta = parseExecutedMeta(result);

  assert.ok(Array.isArray(meta.prompts), 'executed metadata includes prompts');
  assert.equal((meta.prompts as unknown[]).length, 1, 'one prompt in executed response');
  const entry = (meta.prompts as Array<{ name: string; score: number }>)[0];
  assert.ok(typeof entry.score === 'number' && entry.score > 0.1, 'prompt has score in executed metadata');
});

// ── 7. cast:executed + tool + resource → `resources` in metadata content[0] ──

test('cast:executed with tool + matching resource → executed metadata includes resources', async () => {
  const { agg } = makeAgg('exec-resource', {
    ...MATCHING_TOOL,
    resources: [MATCHING_RESOURCE],
  });

  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, confirm: false });
  const meta = parseExecutedMeta(result);

  assert.ok(Array.isArray(meta.resources), 'executed metadata includes resources');
  assert.equal((meta.resources as unknown[]).length, 1, 'one resource in executed response');
  const entry = (meta.resources as Array<{ uri: string; score: number }>)[0];
  assert.ok(entry.uri.includes('sql'), 'resource URI preserved in executed metadata');
  assert.ok(typeof entry.score === 'number' && entry.score > 0.1, 'resource has score in executed metadata');
});

// ── 8. prompt score ≤ 0.1 → `prompts` field absent ──────────────────────────

test('cast:plan prompt with no matching keywords → prompts field absent', async () => {
  // Prompt with no overlap with "sql query database"
  const unmatchedPrompt: PromptEntry = {
    name: 'deploy-runbook',
    description: 'Guide for deploying a service to production',
  };
  const { agg } = makeAgg('plan-noprompt', {
    ...MATCHING_TOOL,
    prompts: [unmatchedPrompt],
  });

  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, confirm: true });
  const plan = parsePlan(result);

  assert.equal(plan.prompts, undefined, 'plan.prompts absent when all prompts score ≤ 0.1');
});

// ── 9. resource score ≤ 0.1 → `resources` field absent ──────────────────────

test('cast:plan resource with no matching keywords → resources field absent', async () => {
  // Resource with no overlap with "sql query database"
  const unmatchedResource: ResourceEntry = {
    uri: 'build://deploy-artifacts',
    name: 'Deploy Artifacts',
    description: 'Compiled build outputs for deployment',
  };
  const { agg } = makeAgg('plan-noresource', {
    ...MATCHING_TOOL,
    resources: [unmatchedResource],
  });

  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, confirm: true });
  const plan = parsePlan(result);

  assert.equal(plan.resources, undefined, 'plan.resources absent when all resources score ≤ 0.1');
});
