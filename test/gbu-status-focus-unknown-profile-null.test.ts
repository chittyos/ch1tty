/**
 * GBU drift guard: freeze ch1tty/status `focus` behavior when the process default
 * focus is set to an UNKNOWN profile name.
 *
 * Context:
 *   `activeFocusSnapshot()` (aggregator.ts line ~189) calls resolveFocus(), which
 *   returns `undefined` for any name not present in `focusProfiles.profiles`, logging
 *   a soft warning. The snapshot returns null in that case:
 *
 *     const profile = resolveFocus(this.focusProfiles, this.defaultFocus);
 *     if (!profile || !this.defaultFocus) return null;
 *
 *   GBT-1 and FY-7 both freeze `status.focus === null` only for the case where NO
 *   focus is configured (defaultFocus is undefined). Neither test covers the case
 *   where a focus name IS set but the profile name doesn't exist in the registry.
 *   These are behaviourally distinct paths through `activeFocusSnapshot()`.
 *
 * GBU freezes:
 *   GBU-1  Process default focus set to an unknown profile name →
 *           `status.focus` is exactly null (not an error object, not an object
 *           with the unknown name, not a partial {active, ...} with undefined fields)
 *
 *   GBU-2  Process default focus set to an unknown profile name →
 *           `status.availableFocusProfiles` lists only the REGISTERED profile names,
 *           NOT the unknown name (the unknown default doesn't pollute the catalog)
 *
 *   GBU-3  Process default focus set to an unknown profile name →
 *           `ch1tty/search` does NOT throw / return isError — the unknown focus is a
 *           soft no-op lens, so search still returns results
 *
 * Frozen 2026-09-30.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only)
 *   - buildCastExplanation metric freeze: not applicable (status + search, not cast explain)
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
  return join(tmpdir(), `ch1tty-gbu-${Date.now()}-${++_seq}.jsonl`);
}

const BASE_CFG: ServerConfig[] = [
  { id: 'neon',   name: 'Neon DB', type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.tech/mcp',  lazy: true },
  { id: 'stripe', name: 'Stripe',  type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.test/mcp', lazy: true },
];

const FOCUS_PROFILES = {
  profiles: {
    finance: { categories: ['ecosystem' as const], servers: ['stripe'], boost: 0.7 },
    code:    { categories: ['code' as const],      servers: [],          boost: 0.5 },
  },
};

function makeAgg(defaultFocus: string): Aggregator {
  return new Aggregator(BASE_CFG, {
    ledgerDlqPath: dlq(),
    backendFactory: () => new FixtureBackend([]),
    focusProfiles: FOCUS_PROFILES,
    suggestionsCatalog: {},
    embedEnabled: false,
    focus: defaultFocus,
  });
}

async function getStatus(agg: Aggregator): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined, 'ch1tty/status must not return isError');
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

// ── GBU-1: unknown default focus → status.focus is exactly null ──────────────

test('GBU-1: process default focus set to unknown profile → status.focus is exactly null', async () => {
  const agg = makeAgg('no-such-profile');
  try {
    const snap = await getStatus(agg);
    assert.equal(snap['focus'], null,
      `status.focus must be null when defaultFocus is an unknown profile name, got ${JSON.stringify(snap['focus'])}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GBU-2: unknown default focus → availableFocusProfiles unchanged ───────────

test('GBU-2: unknown default focus does not appear in status.availableFocusProfiles', async () => {
  const agg = makeAgg('definitely-not-a-profile');
  try {
    const snap = await getStatus(agg);
    assert.ok(Array.isArray(snap['availableFocusProfiles']),
      'availableFocusProfiles must be an array');
    const profiles = snap['availableFocusProfiles'] as string[];
    assert.ok(!profiles.includes('definitely-not-a-profile'),
      `unknown profile name must not appear in availableFocusProfiles, got [${profiles.join(', ')}]`);
    // Registered profiles ARE still present
    assert.ok(profiles.includes('finance'),
      `registered profile 'finance' must still be in availableFocusProfiles`);
    assert.ok(profiles.includes('code'),
      `registered profile 'code' must still be in availableFocusProfiles`);
  } finally {
    await agg.shutdown();
  }
});

// ── GBU-3: unknown default focus → search still works (soft no-op lens) ──────

test('GBU-3: unknown default focus does not cause ch1tty/search to error', async () => {
  const agg = makeAgg('imaginary-focus');
  try {
    const result = await agg.callTool('ch1tty/search', { query: 'test' });
    assert.equal(result.isError, undefined,
      'ch1tty/search must not return isError when defaultFocus is an unknown profile');
    assert.ok(result.content.length > 0,
      'ch1tty/search must return content when defaultFocus is an unknown profile');
  } finally {
    await agg.shutdown();
  }
});
