/**
 * GBV drift guard: freeze `status.availableFocusProfiles` element values.
 *
 * FY-12 asserts `availableFocusProfiles` is a non-empty string array with
 * all non-empty strings. It does NOT assert that the values match the keys
 * of the injected `focusProfiles` map. A regression that adds phantom profiles,
 * omits existing ones, or duplicates entries would pass FY-12 undetected.
 *
 * GBV closes that gap:
 *
 *   GBV-1  Profiles map with 2 entries → array matches exactly (same set, no extras)
 *   GBV-2  Single profile injected → array has exactly one entry matching that name
 *   GBV-3  No duplicate entries in `availableFocusProfiles`
 *   GBV-4  Each entry appears as a key in the injected profiles map (no phantom profiles)
 *   GBV-5  When focus is active, `availableFocusProfiles` still lists all profile names
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
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import type { FocusProfiles } from '../src-stdio/focus.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

const CONFIGS: ServerConfig[] = [
  { id: 'neon',   name: 'Neon',   type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.tech/mcp',  lazy: true },
  { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true },
];

const TWO_PROFILE_FOCUS: FocusProfiles = {
  profiles: {
    code:     { description: 'Code tools',     categories: ['code' as const],      servers: ['neon'],   boost: 0.5 },
    finance:  { description: 'Finance tools',  categories: ['ecosystem' as const], servers: ['stripe'], boost: 0.6 },
  },
};

const ONE_PROFILE_FOCUS: FocusProfiles = {
  profiles: {
    governance: { description: 'Governance', categories: ['code' as const], servers: [], boost: 0.4 },
  },
};

let _seq = 0;
function makeAgg(focusProfiles: FocusProfiles, activeProfile?: string): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon',   FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  const opts: Record<string, unknown> = {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: join(tmpdir(), `ch1tty-gbv-${Date.now()}-${++_seq}.jsonl`),
    focusProfiles,
  };
  if (activeProfile !== undefined) {
    opts.focus = activeProfile;
  }
  return new Aggregator(CONFIGS, opts as Parameters<typeof Aggregator.prototype.callTool>[1]);
}

async function getProfiles(agg: Aggregator): Promise<string[]> {
  const result = await agg.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined, 'status must not error');
  const snap = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.ok(Array.isArray(snap.availableFocusProfiles), 'availableFocusProfiles must be an array');
  return snap.availableFocusProfiles as string[];
}

// ── GBV-1: 2-profile map → array matches exactly ─────────────────────────────

test('GBV-1: availableFocusProfiles exactly matches the 2-entry profiles map keys', async () => {
  const agg = makeAgg(TWO_PROFILE_FOCUS);
  try {
    const profiles = await getProfiles(agg);
    const expected = Object.keys(TWO_PROFILE_FOCUS.profiles).sort();
    assert.deepEqual([...profiles].sort(), expected,
      `expected exactly ${JSON.stringify(expected)}, got ${JSON.stringify(profiles)}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GBV-2: single profile injected → exactly one entry matching that name ─────

test('GBV-2: single profile injected → availableFocusProfiles has exactly one entry', async () => {
  const agg = makeAgg(ONE_PROFILE_FOCUS);
  try {
    const profiles = await getProfiles(agg);
    assert.equal(profiles.length, 1, `expected 1 profile, got ${profiles.length}`);
    assert.equal(profiles[0], 'governance',
      `expected "governance", got "${profiles[0]}"`);
  } finally {
    await agg.shutdown();
  }
});

// ── GBV-3: no duplicate entries ──────────────────────────────────────────────

test('GBV-3: availableFocusProfiles has no duplicate entries', async () => {
  const agg = makeAgg(TWO_PROFILE_FOCUS);
  try {
    const profiles = await getProfiles(agg);
    const unique = new Set(profiles);
    assert.equal(unique.size, profiles.length,
      `duplicate profiles found: ${JSON.stringify(profiles)}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GBV-4: each entry is a key in the injected profiles map (no phantoms) ─────

test('GBV-4: each availableFocusProfiles entry is a key in the injected profiles map', async () => {
  const agg = makeAgg(TWO_PROFILE_FOCUS);
  try {
    const profiles = await getProfiles(agg);
    const knownKeys = new Set(Object.keys(TWO_PROFILE_FOCUS.profiles));
    for (const p of profiles) {
      assert.ok(knownKeys.has(p),
        `phantom profile "${p}" is not in the injected profiles map`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GBV-5: active focus does not alter availableFocusProfiles ─────────────────

test('GBV-5: availableFocusProfiles is unchanged when a focus profile is active', async () => {
  const noFocusAgg  = makeAgg(TWO_PROFILE_FOCUS);
  const withFocusAgg = makeAgg(TWO_PROFILE_FOCUS, 'code');
  try {
    const noFocusProfiles  = await getProfiles(noFocusAgg);
    const withFocusProfiles = await getProfiles(withFocusAgg);
    assert.deepEqual([...withFocusProfiles].sort(), [...noFocusProfiles].sort(),
      'active focus must not add or remove entries from availableFocusProfiles');
  } finally {
    await noFocusAgg.shutdown();
    await withFocusAgg.shutdown();
  }
});
