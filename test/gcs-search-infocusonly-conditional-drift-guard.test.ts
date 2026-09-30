/**
 * GCS drift guard: freeze ch1tty/search top-level `inFocusOnly` CONDITIONAL.
 *
 * search-in-focus-only.test.ts (behavioral) covers functional scenarios for the
 * inFocusOnly filter. Test R-4 there checks `data.inFocusOnly === true` in one
 * specific scenario (filtered path, finance focus, invoices query).
 *
 * No test on main freezes:
 *   - ABSENT (not `false`, not `null`, not `0`) when inFocusOnly param is NOT given
 *   - ABSENT when `inFocusOnly: false` is explicitly passed (even with focus active)
 *   - ABSENT when `inFocusOnly: true` but no focus profile is active (no-op path)
 *   - ABSENT on the discovery path (no-query search) when inFocusOnly is not given
 *   - Exactly boolean `true` (not `1`, not `"true"`, not a truthy object) when present
 *
 * Source: dist/aggregator.js lines ~645, ~657, ~747 —
 *   `...(inFocusOnly && focus ? { inFocusOnly: true } : {})`
 * The field is only emitted as the literal boolean `true`; it is NEVER emitted
 * as `false` — absent means off, present means on.
 *
 * GCS closes those gaps:
 *
 *   GCS-1  `inFocusOnly: true` param + focus active (filtered path) →
 *           response body has `inFocusOnly` key AND value === true (strict boolean)
 *   GCS-2  `inFocusOnly: true` param + NO focus active →
 *           response body does NOT have `inFocusOnly` key (no-op path)
 *   GCS-3  `inFocusOnly: false` param + focus active →
 *           response body does NOT have `inFocusOnly` key (never emitted as false)
 *   GCS-4  No `inFocusOnly` param + focus active →
 *           response body does NOT have `inFocusOnly` key (default absent)
 *   GCS-5  `inFocusOnly: true` + focus active, discovery path (no query) →
 *           response body has `inFocusOnly` key AND value === true (strict boolean)
 *           (discovery path uses the same emission guard as the filtered path)
 *
 * Frozen 2026-09-27.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (search, not cast explain)
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
  return join(tmpdir(), `ch1tty-gcs-${Date.now()}-${++_seq}.jsonl`);
}

const BASE_CONFIGS: ServerConfig[] = [
  { id: 'neon',   name: 'Neon DB', type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.tech/mcp',  lazy: true },
  { id: 'stripe', name: 'Stripe',  type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true },
];

const FOCUS_PROFILES = {
  profiles: {
    code: {
      description: 'Software development tools',
      categories: ['code' as const],
      servers: ['neon'],
      boost: 0.5,
    },
  },
};

function makeAgg(opts: { withFocus?: boolean } = {}): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon',   FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    ...(opts.withFocus
      ? { focus: 'code', focusProfiles: FOCUS_PROFILES }
      : {}),
  });
}

async function search(agg: Aggregator, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/search', args);
  assert.equal(result.isError, undefined, 'search must not error');
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

// ── GCS-1: inFocusOnly: true + focus active → present as exact boolean true ───

test('GCS-1 search inFocusOnly:true + focus active → response.inFocusOnly === true (strict boolean)', async () => {
  const agg = makeAgg({ withFocus: true });
  try {
    const body = await search(agg, { query: 'database', inFocusOnly: true });
    assert.ok(
      'inFocusOnly' in body,
      'inFocusOnly key must be present in response when param=true and focus active',
    );
    assert.equal(
      body['inFocusOnly'],
      true,
      `inFocusOnly must be exactly boolean true, got ${JSON.stringify(body['inFocusOnly'])}`,
    );
    assert.equal(
      typeof body['inFocusOnly'],
      'boolean',
      `inFocusOnly must be typeof boolean (not number 1, string "true", or object), got ${typeof body['inFocusOnly']}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GCS-2: inFocusOnly: true + NO focus active → key ABSENT ──────────────────

test('GCS-2 search inFocusOnly:true + NO focus active → inFocusOnly key absent (no-op path)', async () => {
  const agg = makeAgg({ withFocus: false });
  try {
    const body = await search(agg, { query: 'database', inFocusOnly: true });
    assert.ok(
      !('inFocusOnly' in body),
      `inFocusOnly must be ABSENT in response when focus is not active (no-op path), got ${JSON.stringify(body['inFocusOnly'])}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GCS-3: inFocusOnly: false + focus active → key ABSENT (never emitted false)

test('GCS-3 search inFocusOnly:false + focus active → inFocusOnly key absent (never emitted as false)', async () => {
  const agg = makeAgg({ withFocus: true });
  try {
    const body = await search(agg, { query: 'database', inFocusOnly: false });
    assert.ok(
      !('inFocusOnly' in body),
      `inFocusOnly must NOT appear in response when param is false — field is never emitted as false, got ${JSON.stringify(body['inFocusOnly'])}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GCS-4: no inFocusOnly param + focus active → key ABSENT (default off) ─────

test('GCS-4 search no inFocusOnly param + focus active → inFocusOnly key absent by default', async () => {
  const agg = makeAgg({ withFocus: true });
  try {
    const body = await search(agg, { query: 'database' });
    assert.ok(
      !('inFocusOnly' in body),
      `inFocusOnly must be ABSENT when param is not given (default: off), got ${JSON.stringify(body['inFocusOnly'])}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GCS-5: inFocusOnly: true + focus active, discovery path (no query) ────────

test('GCS-5 search inFocusOnly:true + focus active on discovery path (no query) → inFocusOnly === true', async () => {
  const agg = makeAgg({ withFocus: true });
  try {
    // No query → discovery/server-summary path; inFocusOnly still applies
    const body = await search(agg, { inFocusOnly: true });
    assert.ok(
      'inFocusOnly' in body,
      'inFocusOnly key must be present on discovery path when param=true and focus active',
    );
    assert.equal(
      body['inFocusOnly'],
      true,
      `inFocusOnly must be exactly boolean true on discovery path, got ${JSON.stringify(body['inFocusOnly'])}`,
    );
  } finally {
    await agg.shutdown();
  }
});
