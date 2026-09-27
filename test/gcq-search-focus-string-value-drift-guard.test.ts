/**
 * GCQ drift guard: freeze `ch1tty/search` top-level `focus` field value.
 *
 * GCK (in open PR) already checks that `focus` appears in the top-level key set when
 * a profile is active. GCQ complements it by asserting the *value* contract:
 *
 *   1. `focus` is absent from the response when no profile is active (no `focus` arg,
 *      no process default).
 *   2. `focus` is present and equals the supplied profile name when `focus: 'code'`
 *      is passed — the field echoes the caller-supplied name, not a normalised or
 *      internal representation.
 *   3. `focus` value is exactly a `string` — not a boolean, object, or anything else.
 *   4. `focus` value exact equality: the returned string matches the input character
 *      for character (case-sensitive, no trimming artefacts visible to the caller).
 *   5. `focus: 'none'` explicitly suppresses focus → `focus` key absent from response.
 *
 * Source: src-stdio/aggregator.ts ~862
 *   ...(focusName ? { focus: focusName } : {}),
 *
 * `focusName` is set by resolveActiveFocus (lines ~165–185):
 *   - truthy string arg   → name = trimmed string (persisted as session focus)
 *   - "none" / ""         → name = undefined (clears session focus)
 *   - no arg              → session-sticky focus ?? process default (CH1TTY_FOCUS)
 *   Unknown profile → focusName still set (log.warn issued), but `focus` variable
 *   (FocusProfile) is undefined; the top-level `focus` field is still emitted because
 *   the gate is `focusName`, not `focus`.
 *
 * GCQ freezes:
 *
 *   GCQ-1  no focus arg, no process default → `focus` key absent
 *   GCQ-2  focus: 'code' → `focus` key present with value 'code'
 *   GCQ-3  `focus` value is typeof 'string' (not boolean / object / number)
 *   GCQ-4  `focus` echoes the exact caller-supplied name string
 *   GCQ-5  focus: 'none' → `focus` key absent (explicit suppression)
 *
 * Frozen 2026-09-27.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (search top-level field)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Server configs ─────────────────────────────────────────────────────────────

const NEON_CONFIG: ServerConfig = {
  id: 'neon',
  name: 'Neon',
  type: 'remote',
  access: 'readwrite',
  category: 'code',
  endpoint: 'https://neon.tech/mcp',
  lazy: true,
};

// ── Focus profiles ─────────────────────────────────────────────────────────────

// 'code' profile: matches neon (category: 'code')
// 'finance' profile: does not match neon (different category + server)
const FOCUS_PROFILES = {
  profiles: {
    code: {
      description: 'Software development tools',
      categories: ['code' as const],
      servers: ['neon'],
      boost: 0.5,
    },
    finance: {
      description: 'Billing and financial tools',
      categories: ['ecosystem' as const],
      servers: ['stripe'],
      boost: 0.5,
    },
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gcq-${Date.now()}-${++_seq}.jsonl`);
}

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  return new Aggregator([NEON_CONFIG], {
    focusProfiles: FOCUS_PROFILES,
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
}

async function search(
  agg: Aggregator,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await agg.callTool('ch1tty/search', args);
  const text = (res.content as Array<{ type: string; text: string }>)[0]?.text ?? '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GCQ-1: no focus arg, no process default → focus key absent from top-level response', async () => {
  const agg = makeAgg();
  // No `focus` arg, no defaultFocus set on Aggregator → focusName = undefined
  const resp = await search(agg, { query: 'neon' });
  assert.ok(!Object.prototype.hasOwnProperty.call(resp, 'focus'),
    `focus should be absent when no focus is active, got focus=${JSON.stringify(resp.focus)}`);
  await agg.shutdown();
});

test('GCQ-2: focus: "code" → focus key present with value "code"', async () => {
  const agg = makeAgg();
  const resp = await search(agg, { query: 'neon', focus: 'code' });
  assert.ok(Object.prototype.hasOwnProperty.call(resp, 'focus'),
    'focus should be present when a named profile is supplied');
  assert.strictEqual(resp.focus, 'code',
    `focus should equal 'code', got ${JSON.stringify(resp.focus)}`);
  await agg.shutdown();
});

test('GCQ-3: focus value is typeof "string" (not boolean, object, or number)', async () => {
  const agg = makeAgg();
  const resp = await search(agg, { query: 'neon', focus: 'code' });
  assert.ok(Object.prototype.hasOwnProperty.call(resp, 'focus'), 'expected focus to be present');
  assert.strictEqual(typeof resp.focus, 'string',
    `focus must be a string, got ${typeof resp.focus}`);
  // Explicit non-string checks
  assert.notStrictEqual(resp.focus, true as unknown as string);
  assert.notStrictEqual(resp.focus, false as unknown as string);
  assert.notStrictEqual(resp.focus, 1 as unknown as string);
  assert.notStrictEqual(resp.focus, null as unknown as string);
  await agg.shutdown();
});

test('GCQ-4: focus echoes the exact caller-supplied name string (case-sensitive)', async () => {
  const agg = makeAgg();
  // 'code' supplied — must come back as exactly 'code', not 'Code' or normalised
  const respCode = await search(agg, { query: 'neon', focus: 'code' });
  assert.strictEqual(respCode.focus, 'code',
    `expected focus to echo 'code' exactly, got ${JSON.stringify(respCode.focus)}`);
  // 'finance' supplied — must come back as exactly 'finance'
  const respFinance = await search(agg, { query: 'neon', focus: 'finance' });
  assert.ok(Object.prototype.hasOwnProperty.call(respFinance, 'focus'),
    'focus should be present when finance profile is supplied');
  assert.strictEqual(respFinance.focus, 'finance',
    `expected focus to echo 'finance' exactly, got ${JSON.stringify(respFinance.focus)}`);
  // Verify they are distinct — not the same value regardless of which profile was given
  assert.notStrictEqual(respCode.focus, respFinance.focus,
    'code and finance focus values should differ');
  await agg.shutdown();
});

test('GCQ-5: focus: "none" explicitly suppresses focus → focus key absent from response', async () => {
  const agg = makeAgg();
  // Confirm active focus emits the key first
  const respWithFocus = await search(agg, { query: 'neon', focus: 'code' });
  assert.ok(Object.prototype.hasOwnProperty.call(respWithFocus, 'focus'),
    'expected focus key present when code profile active');
  // Suppress with 'none' — focusName becomes undefined → key absent
  const respNone = await search(agg, { query: 'neon', focus: 'none' });
  assert.ok(!Object.prototype.hasOwnProperty.call(respNone, 'focus'),
    `focus should be absent when focus: 'none' is passed, got focus=${JSON.stringify(respNone.focus)}`);
  // Empty string behaves the same way as 'none'
  const respEmpty = await search(agg, { query: 'neon', focus: '' });
  assert.ok(!Object.prototype.hasOwnProperty.call(respEmpty, 'focus'),
    `focus should be absent when focus: '' is passed, got focus=${JSON.stringify(respEmpty.focus)}`);
  await agg.shutdown();
});
