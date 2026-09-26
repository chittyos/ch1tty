/**
 * GBT drift guard: freeze ch1tty/status `focus` sub-object exact key set.
 *
 * GM-1 asserts the top-level status key set includes `focus` as an always-present
 * key (value null or object). No test on main freezes:
 *   (a) that `status.focus` is exactly null when no process-level default focus
 *       is configured (a regression returning {} or a stale string would pass GM)
 *   (b) the exact key set of the focus sub-object when a default focus IS active
 *       ({active, categories, servers, boost} — exactly 4 keys, no more, no less)
 *   (c) value types of each sub-key
 *
 * `activeFocusSnapshot()` (aggregator.ts line ~189) returns
 *   { active: string, categories: string[], servers: string[], boost: number } | null
 *
 * GBT freezes:
 *   GBT-1  No process default focus → status.focus is exactly null
 *           (A regression returning {} or a stale object would pass GM-1 silently
 *            since GM only checks key presence, not value.)
 *
 *   GBT-2  Process default focus active → status.focus has EXACTLY 4 keys:
 *           {active, categories, servers, boost}
 *           (A regression adding e.g. `name`, `profile`, or `description` at this
 *            level would pass all prior tests silently.)
 *
 *   GBT-3  status.focus.active is a non-empty string equal to the profile name
 *           passed as the default focus.
 *           (A regression returning the profile object instead of its name, or
 *            returning the wrong profile name, would not be caught by GM.)
 *
 *   GBT-4  status.focus.categories is an array (possibly empty) and
 *           status.focus.servers is an array (possibly empty).
 *           (Value type freeze: neither can drift to a Set, object, or string.)
 *
 *   GBT-5  status.focus.boost is a finite positive number.
 *           Different focus profiles in the fixture use different boost values;
 *           the test asserts boost matches the profile's configured value.
 *
 * Frozen 2026-09-26.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only)
 *   - buildCastExplanation metric freeze: not applicable (status, not cast)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gbt-${Date.now()}-${++_seq}.jsonl`);
}

const BASE_CFG: ServerConfig[] = [
  { id: 'neon', name: 'Neon DB', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true },
  { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.test/mcp', lazy: true },
];

const FOCUS_PROFILES = {
  profiles: {
    finance: { categories: ['ecosystem' as const], servers: ['stripe'], boost: 0.7 },
    code:    { categories: ['code' as const],      servers: [],          boost: 0.5 },
  },
};

function makeAgg(defaultFocus?: string): Aggregator {
  return new Aggregator(BASE_CFG, {
    ledgerDlqPath: dlq(),
    backendFactory: () => new FixtureBackend([]),
    focusProfiles: FOCUS_PROFILES,
    suggestionsCatalog: {},
    ...(defaultFocus !== undefined ? { focus: defaultFocus } : {}),
  });
}

async function statusFocus(agg: Aggregator): Promise<unknown> {
  const result = await agg.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined, 'ch1tty/status must not return isError');
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  return body['focus'];
}

// ── GBT-1: no default focus → status.focus is exactly null ───────────────────

test('GBT-1: no process default focus → status.focus is exactly null', async () => {
  const agg = makeAgg(); // no focus option
  const focusVal = await statusFocus(agg);
  assert.equal(focusVal, null,
    `status.focus must be null when no default focus is configured, got ${JSON.stringify(focusVal)}`);
});

// ── GBT-2: default focus active → status.focus has exactly {active,categories,servers,boost} ──

test('GBT-2: process default focus active → status.focus has exactly 4 keys: active, categories, servers, boost', async () => {
  const agg = makeAgg('finance');
  const focusVal = await statusFocus(agg);
  assert.notEqual(focusVal, null, 'status.focus must be a non-null object when default focus is set');
  assert.ok(typeof focusVal === 'object' && focusVal !== null && !Array.isArray(focusVal),
    'status.focus must be a plain object');
  const keys = Object.keys(focusVal as object).sort();
  assert.deepEqual(keys, ['active', 'boost', 'categories', 'servers'],
    `status.focus must have exactly {active, categories, servers, boost}, got [${keys.join(', ')}]`);
});

// ── GBT-3: status.focus.active equals the configured profile name ─────────────

test('GBT-3: status.focus.active is a non-empty string equal to the profile name', async () => {
  const agg = makeAgg('code');
  const focusVal = await statusFocus(agg) as Record<string, unknown>;
  assert.ok(focusVal !== null && typeof focusVal === 'object',
    'status.focus must be non-null when default focus is set');
  assert.equal(typeof focusVal['active'], 'string',
    `status.focus.active must be a string, got ${typeof focusVal['active']}`);
  assert.ok((focusVal['active'] as string).length > 0,
    'status.focus.active must be a non-empty string');
  assert.equal(focusVal['active'], 'code',
    `status.focus.active must equal the configured profile name 'code', got '${focusVal['active']}'`);
});

// ── GBT-4: status.focus.categories and servers are arrays ────────────────────

test('GBT-4: status.focus.categories and status.focus.servers are both arrays', async () => {
  const agg = makeAgg('finance');
  const focusVal = await statusFocus(agg) as Record<string, unknown>;
  assert.ok(focusVal !== null && typeof focusVal === 'object',
    'status.focus must be non-null when default focus is set');
  assert.ok(Array.isArray(focusVal['categories']),
    `status.focus.categories must be an array, got ${typeof focusVal['categories']}`);
  assert.ok(Array.isArray(focusVal['servers']),
    `status.focus.servers must be an array, got ${typeof focusVal['servers']}`);
  // Verify values match the fixture profile
  assert.deepEqual(focusVal['categories'], ['ecosystem'],
    `status.focus.categories must equal the profile's categories`);
  assert.deepEqual(focusVal['servers'], ['stripe'],
    `status.focus.servers must equal the profile's servers`);
});

// ── GBT-5: status.focus.boost is a finite positive number matching the profile ─

test('GBT-5: status.focus.boost is a finite positive number matching the configured profile boost', async () => {
  const aggFinance = makeAgg('finance');
  const focusFinance = await statusFocus(aggFinance) as Record<string, unknown>;
  assert.ok(focusFinance !== null && typeof focusFinance === 'object',
    'status.focus must be non-null for finance profile');
  assert.equal(typeof focusFinance['boost'], 'number',
    `status.focus.boost must be a number, got ${typeof focusFinance['boost']}`);
  assert.ok(Number.isFinite(focusFinance['boost'] as number),
    `status.focus.boost must be finite, got ${focusFinance['boost']}`);
  assert.ok((focusFinance['boost'] as number) > 0,
    `status.focus.boost must be positive, got ${focusFinance['boost']}`);
  assert.equal(focusFinance['boost'], 0.7,
    `status.focus.boost must equal the profile's configured 0.7, got ${focusFinance['boost']}`);

  // Also verify the code profile has a different boost value, confirming per-profile fidelity
  const aggCode = makeAgg('code');
  const focusCode = await statusFocus(aggCode) as Record<string, unknown>;
  assert.equal(focusCode?.['boost'], 0.5,
    `status.focus.boost for 'code' profile must equal 0.5, got ${focusCode?.['boost']}`);
});
