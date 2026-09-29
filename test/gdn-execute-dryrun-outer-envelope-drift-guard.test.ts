/**
 * GDN drift guard: freeze the outer MCP envelope of ch1tty/execute dryRun
 * responses.
 *
 * The dryRun path returns:
 *
 *   {
 *     content: [{ type: 'text', text: JSON.stringify({...}) }],
 *     isError: false,
 *   }
 *
 * Source: handleExecute (dist/aggregator.js) dryRun branch:
 *
 *   return {
 *     content: [{ type: 'text', text: JSON.stringify({ status: 'dry_run', ... }) }],
 *     isError: false,
 *   };
 *
 * The outer envelope (content array shape + isError) is the contract that MCP
 * clients rely on to distinguish a successful dryRun preview from an error
 * response.  GDA-GDM all parsed `content[0].text` as JSON and asserted on the
 * parsed body — none of them froze the outer wrapper.  A regression where
 * `isError` becomes `true`, `content.length` becomes 2, or `content[0].type`
 * becomes something other than `'text'` would silently break every MCP client
 * that checks `result.isError` before parsing the body.
 *
 * Prior art:
 *   GDA-GDM: parse `content[0].text` and assert on the body object — not the
 *            wrapper that carries it.
 *   EC, GDC, GDJ: key-set/key-count of the parsed body; not the outer wrapper.
 *   None of GDA-GDM freeze `isError`, `content` array type, `content.length`,
 *   `content[0].type`, or JSON parseability of `content[0].text`.
 *
 * GDN tests:
 *
 *   GDN-1  `isError` is exactly `false` (not `true`, not absent, not undefined)
 *   GDN-2  `content` is an Array (not null, not undefined, not a plain object)
 *   GDN-3  `content.length === 1` (dryRun embeds session ctx in JSON — no second
 *           metadata content item; real execute appends session ctx as item [1])
 *   GDN-4  `content[0].type === 'text'` (content item type is exactly 'text')
 *   GDN-5  `content[0].text` is valid JSON (the body is parseable with JSON.parse)
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

/** Returns a unique temp path for the ledger DLQ. */
function dlq(): string {
  return join(tmpdir(), `ch1tty-gdn-${Date.now()}-${++_seq}.jsonl`);
}

const BASE_CONFIGS: ServerConfig[] = [
  { id: 'neon',   name: 'Neon DB', type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.tech/mcp',  lazy: true } as ServerConfig,
  { id: 'stripe', name: 'Stripe',  type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true } as ServerConfig,
];

/** Creates a test Aggregator wired to FixtureBackend. */
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
 * Call execute with dryRun:true and return the raw MCP result object
 * (the outer envelope, not the parsed body).
 */
async function dryRunResult(
  agg: Aggregator,
  namespacedTool: string,
  extraArgs?: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }>; isError: boolean }> {
  const [serverId, name] = namespacedTool.split('/');
  const result = await agg.callTool('ch1tty/execute', {
    tool: namespacedTool,
    dryRun: true,
    ...extraArgs,
  });
  return result as { content: Array<{ type: string; text: string }>; isError: boolean };
}

// ── GDN-1: isError is exactly false ──────────────────────────────────────────

test('GDN-1: dryRun outer envelope isError is exactly false (not true, not absent)', async () => {
  const agg = makeAgg();
  try {
    const result = await dryRunResult(agg, 'neon/run_sql');
    assert.equal(
      result.isError,
      false,
      `GDN-1: dryRun result.isError must be exactly false; got ${JSON.stringify(result.isError)}. ` +
      'isError:true would cause MCP clients to treat a valid dryRun preview as a failed call.',
    );
    assert.notEqual(result.isError, undefined, 'GDN-1: isError must not be absent/undefined');
  } finally {
    await agg.shutdown();
  }
});

// ── GDN-2: content is an Array ────────────────────────────────────────────────

test('GDN-2: dryRun outer envelope content is an Array (not null, not a plain object)', async () => {
  const agg = makeAgg();
  try {
    const result = await dryRunResult(agg, 'stripe/list_customers');
    assert.ok(
      Array.isArray(result.content),
      `GDN-2: dryRun result.content must be an Array; got ${typeof result.content} ` +
      `(value: ${JSON.stringify(result.content)}). ` +
      'MCP clients iterate content[] — a non-array breaks the standard content loop.',
    );
    assert.notEqual(result.content, null, 'GDN-2: content must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GDN-3: content.length === 1 ───────────────────────────────────────────────

test('GDN-3: dryRun outer envelope content.length is exactly 1 (session ctx embedded in JSON, not appended as item [1])', async () => {
  const agg = makeAgg();
  try {
    // Test with no session (baseline)
    const resultNoSession = await dryRunResult(agg, 'neon/list_projects');
    assert.equal(
      resultNoSession.content.length,
      1,
      `GDN-3a: dryRun content.length must be 1 without session; ` +
      `got ${resultNoSession.content.length}. ` +
      'dryRun must never append a second content item for session metadata.',
    );

    // Test with an active session (session ctx must be embedded in the JSON, not appended)
    const sessionId = 'gdn-session-3';
    await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', sessionId });
    const resultWithSession = await dryRunResult(agg, 'neon/list_projects', { sessionId });
    assert.equal(
      resultWithSession.content.length,
      1,
      `GDN-3b: dryRun content.length must be 1 even with an active session; ` +
      `got ${resultWithSession.content.length}. ` +
      'dryRun session ctx is embedded inside the JSON body as "sessionContext" — ' +
      'it must not be appended as a second content item the way live-execute does.',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDN-4: content[0].type === 'text' ─────────────────────────────────────────

test('GDN-4: dryRun outer envelope content[0].type is exactly "text"', async () => {
  const agg = makeAgg();
  try {
    const result = await dryRunResult(agg, 'neon/run_sql');
    assert.equal(
      result.content[0]?.type,
      'text',
      `GDN-4: dryRun content[0].type must be exactly "text"; ` +
      `got ${JSON.stringify(result.content[0]?.type)}. ` +
      'MCP clients that do content[0].type === "text" before reading .text would ' +
      'silently miss the dryRun body if the type changes to "json" or "resource".',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDN-5: content[0].text is valid JSON ──────────────────────────────────────

test('GDN-5: dryRun outer envelope content[0].text is valid JSON (parseable with JSON.parse)', async () => {
  const agg = makeAgg();
  try {
    const result = await dryRunResult(agg, 'stripe/list_customers');
    const text = result.content[0]?.text;
    assert.equal(typeof text, 'string', `GDN-5: content[0].text must be a string; got ${typeof text}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text as string);
    } catch (e) {
      assert.fail(
        `GDN-5: content[0].text must be valid JSON; JSON.parse threw: ${(e as Error).message}. ` +
        `Raw text: ${String(text).slice(0, 200)}`,
      );
    }
    assert.equal(typeof parsed, 'object', `GDN-5: parsed content[0].text must be an object; got ${typeof parsed}`);
    assert.notEqual(parsed, null, 'GDN-5: parsed content[0].text must not be null');
  } finally {
    await agg.shutdown();
  }
});
