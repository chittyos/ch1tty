/**
 * GCO drift guard: freeze `ch1tty/search` tools[] entry `inFocus` field conditional.
 *
 * GCL-5 (in open PR #1545) already checks that inFocus:true appears for in-focus
 * server tools and is absent for out-of-focus tools in the same two-server response.
 * But no test on main freezes:
 *
 *   1. `inFocus: true` when focus active + tool in-focus — value is exactly `true`,
 *      not `1`, `"true"`, or any other truthy value.
 *   2. `inFocus` ABSENT (no key at all) on out-of-focus tools when focus is active —
 *      silently emitting `inFocus: false` would be invisible to GCL-5 since it
 *      checks absence-of-key, not the distinction between absent and false.
 *   3. `inFocus` ABSENT on ALL tools when NO focus is active.
 *   4. Focus profile specificity: switching from one profile to another changes
 *      which tools get `inFocus: true` — the wrong profile silently showing the
 *      same result is undetected without a cross-profile assertion.
 *   5. `inFocus: false` is NEVER emitted — the field must never appear with value
 *      false, 0, null, or any falsy value; it either equals exactly `true` or is
 *      absent entirely.
 *
 * Source: src/core.ts:581
 *   ...(focus && focused(t) ? { inFocus: true } : {})
 *
 * GCO freezes:
 *
 *   GCO-1  in-focus tools when focus active → inFocus === true (exactly, not truthy)
 *   GCO-2  out-of-focus tools when focus active → `inFocus` key absent (not false)
 *   GCO-3  `inFocus` absent on ALL tools when no focus active
 *   GCO-4  cross-profile: code focus → neon inFocus:true, stripe absent;
 *           finance focus → stripe inFocus:true, neon absent
 *   GCO-5  `inFocus` is NEVER emitted with a falsy value (false / 0 / null / "")
 *
 * Frozen 2026-09-27.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (search tools[] entry shape)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Server configs ─────────────────────────────────────────────────────────────

const STRIPE_CONFIG: ServerConfig = {
  id: 'stripe',
  name: 'Stripe',
  type: 'remote',
  access: 'readwrite',
  category: 'ecosystem',
  endpoint: 'https://stripe.com/mcp',
  lazy: true,
};

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

// finance: ecosystem category → matches stripe (ecosystem), not neon (code)
const FOCUS_PROFILES = {
  profiles: {
    finance: {
      description: 'Billing, payments, and financial ecosystem tools',
      categories: ['ecosystem' as const],
      servers: ['stripe'],
      boost: 0.5,
    },
    code: {
      description: 'Code, databases, and developer tools',
      categories: ['code' as const],
      servers: ['neon'],
      boost: 0.5,
    },
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gco-${Date.now()}-${++_seq}.jsonl`);
}

function makeAgg(configs: ServerConfig[]): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  return new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    suggestionsCatalog: {},
    focusProfiles: FOCUS_PROFILES,
  });
}

async function searchTools(
  agg: Aggregator,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const result = await agg.handleSearch(args as never);
  const text = (result.content[0] as { type: string; text: string }).text;
  const parsed = JSON.parse(text) as { tools: Record<string, unknown>[] };
  return parsed.tools;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test('GCO-1: in-focus tools when focus active → inFocus === true (exactly, not just truthy)', async () => {
  const agg = makeAgg([STRIPE_CONFIG, NEON_CONFIG]);
  try {
    // finance focus: stripe (ecosystem) is in-focus
    const tools = await searchTools(agg, { query: 'list', focus: 'finance' });
    const stripeTools = tools.filter((e) => e['server'] === 'stripe');
    assert.ok(stripeTools.length > 0, 'expected at least one stripe tool in results');
    for (const entry of stripeTools) {
      assert.ok('inFocus' in entry, `stripe tool must have inFocus key when finance focus active; entry: ${JSON.stringify(entry)}`);
      assert.strictEqual(
        entry['inFocus'],
        true,
        `inFocus must be exactly boolean true (not 1, "true", or other truthy); got: ${JSON.stringify(entry['inFocus'])}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('GCO-2: out-of-focus tools when focus active → inFocus key is ABSENT (not false or 0)', async () => {
  const agg = makeAgg([STRIPE_CONFIG, NEON_CONFIG]);
  try {
    // finance focus: neon (code) is out-of-focus
    const tools = await searchTools(agg, { query: 'list', focus: 'finance' });
    const neonTools = tools.filter((e) => e['server'] === 'neon');
    assert.ok(neonTools.length > 0, 'expected at least one neon tool in results');
    for (const entry of neonTools) {
      assert.ok(
        !('inFocus' in entry),
        `out-of-focus neon tool must have NO inFocus key (not false/0); keys: ${JSON.stringify(Object.keys(entry).sort())}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('GCO-3: no focus active → inFocus absent on ALL tools', async () => {
  const agg = makeAgg([STRIPE_CONFIG, NEON_CONFIG]);
  try {
    // no focus argument → no focus applied → inFocus must be absent on every entry
    const tools = await searchTools(agg, { query: 'list' });
    assert.ok(tools.length > 0, 'expected at least one tool in results');
    for (const entry of tools) {
      assert.ok(
        !('inFocus' in entry),
        `inFocus must be absent when no focus is active; server=${String(entry['server'])} keys: ${JSON.stringify(Object.keys(entry).sort())}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('GCO-4: cross-profile — code focus → neon:inFocus:true + stripe:absent; finance focus → stripe:inFocus:true + neon:absent', async () => {
  const agg = makeAgg([STRIPE_CONFIG, NEON_CONFIG]);
  try {
    // code focus: neon (code category) is in-focus, stripe (ecosystem) is out
    const codeTools = await searchTools(agg, { query: 'list', focus: 'code' });
    const neonWithCode = codeTools.filter((e) => e['server'] === 'neon');
    const stripeWithCode = codeTools.filter((e) => e['server'] === 'stripe');
    assert.ok(neonWithCode.length > 0, 'expected neon tools with code focus');
    assert.ok(stripeWithCode.length > 0, 'expected stripe tools with code focus');
    for (const entry of neonWithCode) {
      assert.strictEqual(entry['inFocus'], true, `neon must be inFocus:true with code profile; got ${JSON.stringify(entry['inFocus'])}`);
    }
    for (const entry of stripeWithCode) {
      assert.ok(!('inFocus' in entry), `stripe must NOT have inFocus key with code profile; keys: ${JSON.stringify(Object.keys(entry).sort())}`);
    }

    // finance focus: stripe is in-focus, neon is out
    const financeTools = await searchTools(agg, { query: 'list', focus: 'finance' });
    const stripeWithFinance = financeTools.filter((e) => e['server'] === 'stripe');
    const neonWithFinance = financeTools.filter((e) => e['server'] === 'neon');
    assert.ok(stripeWithFinance.length > 0, 'expected stripe tools with finance focus');
    assert.ok(neonWithFinance.length > 0, 'expected neon tools with finance focus');
    for (const entry of stripeWithFinance) {
      assert.strictEqual(entry['inFocus'], true, `stripe must be inFocus:true with finance profile; got ${JSON.stringify(entry['inFocus'])}`);
    }
    for (const entry of neonWithFinance) {
      assert.ok(!('inFocus' in entry), `neon must NOT have inFocus key with finance profile; keys: ${JSON.stringify(Object.keys(entry).sort())}`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('GCO-5: inFocus is NEVER emitted with a falsy value (false / 0 / null / "")', async () => {
  const agg = makeAgg([STRIPE_CONFIG, NEON_CONFIG]);
  try {
    // Check both focus-active and no-focus responses across both servers
    const withFocus = await searchTools(agg, { query: 'list', focus: 'finance' });
    const withoutFocus = await searchTools(agg, { query: 'list' });
    for (const entry of [...withFocus, ...withoutFocus]) {
      if ('inFocus' in entry) {
        // If the key is present, it must be exactly true — never false, 0, null, ""
        const val = entry['inFocus'];
        assert.strictEqual(
          val,
          true,
          `inFocus when present must be exactly true; got ${JSON.stringify(val)} for server=${String(entry['server'])}`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});
