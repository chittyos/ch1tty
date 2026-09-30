/**
 * GDQ drift guard: freeze `ch1tty/execute` dryRun error-boundary semantics for
 * unknown server and malformed tool name inputs.
 *
 * The dryRun check in handleExecute (src-stdio/aggregator.ts ~line 919) only fires
 * AFTER the server lookup succeeds. Two earlier guards return isError:true before
 * any dryRun processing:
 *
 *   Guard A (line ~894): tool name has no '/' → isError:true, format-error message
 *   Guard B (line ~908): server not in registry → isError:true, unknown-server message
 *
 * No merged test covers these error paths with dryRun:true. EC/GL/GN/GDP always
 * supply a valid server id (neon, stripe). GDQ closes those gaps:
 *
 *   GDQ-1  unknown server + dryRun:true → isError === true
 *   GDQ-2  unknown server + dryRun:true → body text does NOT contain dry_run status
 *   GDQ-3  no-slash tool name + dryRun:true → isError === true
 *   GDQ-4  no-slash tool name + dryRun:true → error text references expected format
 *   GDQ-5  unknown server dryRun:true makes zero backend calls
 *
 * Contrast: GDP-1 shows known server + nonexistent tool → isError:false.
 * GDQ-1 establishes the complementary case: unknown server → isError:true,
 * proving that the dryRun path is gated behind server-registration, not tool-registration.
 *
 * Source: handleExecute in src-stdio/aggregator.ts (lines ~886–918).
 *
 * Frozen 2026-09-28.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (execute path, not cast explain)
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

/** Build a fresh Aggregator backed by FixtureBackend for each test. */
function makeAgg(): { agg: Aggregator; backend: FixtureBackend } {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  const dlq = join(tmpdir(), `ch1tty-gdq-${Date.now()}-${++_seq}.jsonl`);
  const agg = new Aggregator(
    [
      { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true } as ServerConfig,
      { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true } as ServerConfig,
    ],
    { backendFactory: () => backend, embedEnabled: false, ledgerDlqPath: dlq },
  );
  return { agg, backend };
}

/** Call ch1tty/execute with dryRun:true and return the raw ToolCallResult. */
async function callDryRun(agg: Aggregator, tool: string): Promise<{ isError?: boolean; content: Array<{ type: string; text?: string }> }> {
  return agg.callTool('ch1tty/execute', { tool, dryRun: true }) as Promise<{ isError?: boolean; content: Array<{ type: string; text?: string }> }>;
}

// ── GDQ-1: unknown server + dryRun:true → isError === true ───────────────────

test('GDQ-1: execute dryRun with unknown server returns isError true', async () => {
  const { agg } = makeAgg();
  try {
    const result = await callDryRun(agg, 'phantom_server_xyz/any_tool');
    assert.equal(
      (result as { isError?: boolean }).isError,
      true,
      'GDQ-1: dryRun with an unregistered server must return isError:true. ' +
        'The dryRun path is gated behind server-registration (line ~908 guard); ' +
        'it never fires for unknown servers. ' +
        'Contrast with GDP-1: known server + unknown tool → isError:false.',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDQ-2: unknown server dryRun body does NOT contain dry_run status ─────────

test('GDQ-2: execute dryRun with unknown server does not return dry_run status in body', async () => {
  const { agg } = makeAgg();
  try {
    const result = await callDryRun(agg, 'phantom_server_xyz/any_tool');
    assert.ok(
      Array.isArray(result.content) && result.content.length > 0,
      'GDQ-2: result must have at least one content item',
    );
    assert.equal(result.content[0].type, 'text', 'GDQ-2: content[0] must be type:text');
    const text = result.content[0].text ?? '';
    assert.ok(
      !text.includes('"dry_run"'),
      `GDQ-2: error response must not contain '"dry_run"' — got: "${text.slice(0, 120)}". ` +
        'The unknown-server guard fires before the dryRun branch, so no dry_run body is produced.',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDQ-3: no-slash tool name + dryRun:true → isError === true ───────────────

test('GDQ-3: execute dryRun with no-slash tool name returns isError true', async () => {
  const { agg } = makeAgg();
  try {
    const result = await callDryRun(agg, 'neon');
    assert.equal(
      (result as { isError?: boolean }).isError,
      true,
      'GDQ-3: dryRun with a tool name missing the serverId/ prefix must return isError:true. ' +
        'The format-validation guard (line ~894) fires before the dryRun path.',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDQ-4: no-slash tool name dryRun error text references expected format ───

test('GDQ-4: execute dryRun with no-slash tool name returns error text referencing serverId/toolName format', async () => {
  const { agg } = makeAgg();
  try {
    const result = await callDryRun(agg, 'neon');
    assert.ok(
      Array.isArray(result.content) && result.content.length > 0,
      'GDQ-4: result must have at least one content item',
    );
    const text = result.content[0].text ?? '';
    assert.ok(
      text.includes('serverId/toolName') || text.includes('serverId') || text.includes('/'),
      `GDQ-4: error text for missing-slash must reference the expected format; got: "${text.slice(0, 160)}". ` +
        'The format-error guard communicates the correct tool-name format to the caller.',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDQ-5: unknown server dryRun makes zero backend calls ────────────────────

test('GDQ-5: execute dryRun with unknown server makes zero backend calls', async () => {
  const { agg, backend } = makeAgg();
  try {
    const callsBefore = backend.getCallLog().length;
    // Use a valid fixture tool to ensure any backend call would be logged
    await callDryRun(agg, 'phantom_server_xyz/list_projects');
    // Also test with a valid neon tool under the unknown server namespace
    await callDryRun(agg, 'phantom_server_xyz/run_sql');
    const callsAfter = backend.getCallLog().length;
    assert.equal(
      callsAfter,
      callsBefore,
      `GDQ-5: dryRun with unknown server must not touch the backend. callLog grew from ${callsBefore} to ${callsAfter}. ` +
        'The server-not-found guard (line ~908) returns before any backend.callTool() is invoked.',
    );
  } finally {
    await agg.shutdown();
  }
});
