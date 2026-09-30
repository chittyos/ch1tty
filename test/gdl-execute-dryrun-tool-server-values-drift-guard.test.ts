/**
 * GDL drift guard: freeze that ch1tty/execute dryRun response `tool` and
 * `server` fields carry the correct split values — and together reconstruct
 * the original namespaced tool name passed by the caller.
 *
 * Source: handleExecute (src/aggregator.ts):
 *
 *   const sepIndex = toolName.indexOf('/');           // toolName = args.tool
 *   const serverId = toolName.slice(0, sepIndex);
 *   const name     = toolName.slice(sepIndex + 1);
 *
 *   return { content: [{ type: 'text', text: JSON.stringify({
 *     status: 'dry_run', server: serverId, tool: name, args: toolArgs, ...
 *   }) }] };
 *
 * `server` is the segment before the first '/', `tool` is the segment after.
 * Joining them with '/' must exactly reproduce the original namespaced name.
 * Any future change that stores the full namespaced name in `tool`, omits the
 * server prefix from `server`, swaps the two fields, or introduces extra
 * separators would silently break client routing that reconstructs the call
 * target from these fields.  This guard freezes the split semantics.
 *
 * Prior art:
 *   EC: required key names (status/server/tool/args); not value semantics.
 *   GL: value types of server/tool/latencyMs; not field content.
 *   GDC: key set of dryRun JSON; not field content.
 *   GDJ: top-level key count; not field content.
 *   GDK: args sub-object echo; not server/tool values.
 *   None of the above verify server or tool field values beyond typeof.
 *
 * GDL tests:
 *
 *   GDL-1  `tool` is the bare tool name (no serverId prefix, no '/')
 *   GDL-2  `server` is the serverId only (no '/' or tool name suffix)
 *   GDL-3  server + '/' + tool exactly reconstructs the original namespaced name
 *   GDL-4  both fields split correctly for a second, different server (stripe)
 *   GDL-5  `tool` contains no '/' character — no namespace leakage
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
  return join(tmpdir(), `ch1tty-gdl-${Date.now()}-${++_seq}.jsonl`);
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
 * Returns the full top-level object so tests can inspect `server` and `tool`.
 */
async function dryRunBody(
  agg: Aggregator,
  namespacedTool: string,
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/execute', { tool: namespacedTool, dryRun: true });
  assert.ok(!result.isError, `dryRun for "${namespacedTool}" must not return isError`);
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'dryRun must have at least 1 content item');
  const item = content[0];
  assert.equal(item.type, 'text', 'dryRun content[0] must be type:text');
  assert.ok(typeof item.text === 'string', 'dryRun content[0] text must be a string');
  return JSON.parse(item.text!) as Record<string, unknown>;
}

// ── GDL-1: `tool` is the bare tool name (no serverId prefix) ─────────────────

test('GDL-1: dryRun tool field is the bare tool name without server prefix', async () => {
  const agg = makeAgg();
  try {
    const body = await dryRunBody(agg, 'neon/list_projects');
    assert.equal(
      body.tool,
      'list_projects',
      `GDL-1: dryRun tool must be bare tool name "list_projects"; ` +
      `got ${JSON.stringify(body.tool)}. ` +
      'handleExecute sets tool = toolName.slice(sepIndex + 1) — the part after the first "/".',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDL-2: `server` is the serverId only (no tool name suffix) ───────────────

test('GDL-2: dryRun server field is the serverId only without tool name', async () => {
  const agg = makeAgg();
  try {
    const body = await dryRunBody(agg, 'neon/list_projects');
    assert.equal(
      body.server,
      'neon',
      `GDL-2: dryRun server must be serverId "neon"; ` +
      `got ${JSON.stringify(body.server)}. ` +
      'handleExecute sets server = toolName.slice(0, sepIndex) — the part before the first "/".',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDL-3: server + '/' + tool reconstructs the original namespaced name ─────

test('GDL-3: server + "/" + tool exactly reconstructs the original namespaced tool name', async () => {
  const agg = makeAgg();
  try {
    const namespacedTool = 'neon/list_projects';
    const body = await dryRunBody(agg, namespacedTool);
    const reconstructed = `${body.server}/${body.tool}`;
    assert.equal(
      reconstructed,
      namespacedTool,
      `GDL-3: server + "/" + tool must reconstruct the original namespaced name; ` +
      `expected "${namespacedTool}" but got "${reconstructed}" ` +
      `(server=${JSON.stringify(body.server)}, tool=${JSON.stringify(body.tool)}). ` +
      'The split at indexOf("/") must be perfectly invertible.',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDL-4: Both fields split correctly for a different server ────────────────

test('GDL-4: dryRun server and tool fields split correctly for stripe server', async () => {
  const agg = makeAgg();
  try {
    const namespacedTool = 'stripe/list_customers';
    const body = await dryRunBody(agg, namespacedTool);
    assert.equal(
      body.server,
      'stripe',
      `GDL-4: dryRun server must be "stripe" for stripe tool; ` +
      `got ${JSON.stringify(body.server)}`,
    );
    assert.equal(
      body.tool,
      'list_customers',
      `GDL-4: dryRun tool must be "list_customers" for stripe tool; ` +
      `got ${JSON.stringify(body.tool)}`,
    );
    const reconstructed = `${body.server}/${body.tool}`;
    assert.equal(
      reconstructed,
      namespacedTool,
      `GDL-4: server + "/" + tool must reconstruct "${namespacedTool}"; got "${reconstructed}"`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDL-5: `tool` contains no '/' character ──────────────────────────────────

test('GDL-5: dryRun tool field contains no "/" character (no namespace leakage)', async () => {
  const agg = makeAgg();
  try {
    const body = await dryRunBody(agg, 'neon/list_projects');
    assert.equal(
      typeof body.tool,
      'string',
      'GDL-5: tool field must be a string',
    );
    const toolStr = body.tool as string;
    assert.ok(
      !toolStr.includes('/'),
      `GDL-5: dryRun tool field must not contain "/" — ` +
      `got ${JSON.stringify(toolStr)}. ` +
      'A "/" in tool would mean the full namespaced name leaked into the tool field ' +
      'instead of the bare name after the split.',
    );
  } finally {
    await agg.shutdown();
  }
});
