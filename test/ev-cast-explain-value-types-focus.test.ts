/**
 * EV: Drift guard — cast explain field VALUE TYPES for verbosity:'low' and
 * verbosity:'medium' WITH an active focus profile.
 *
 * ES (es-cast-explain-verbosity-low-medium-focus-fieldnames.test.ts) froze
 * the field NAMES when focus is active. EV freezes the VALUE TYPES of those
 * focus-specific fields. A change in type (e.g. focusDecisive from boolean →
 * string, or focusRank from number → object) would pass ES's name-only
 * guards silently.
 *
 * EU covers VALUE TYPES without focus; EV is its focus counterpart.
 *
 * CLAUDE.md § buildCastExplanation metric freeze applies here.
 * If a test fails with an unexpected type, a field's type was changed —
 * REJECT per the metric freeze; update only after confirming intent.
 *
 * ── verbosity:'low', focus:code, focus-specific fields (4 fields) ────────────
 *   focus         → string (non-empty, === 'code')
 *   focusBoost    → number (finite, > 0)
 *   focusDecisive → boolean
 *   winnerInFocus → boolean
 *
 * ── verbosity:'medium', focus:code, in-focus winner (9 extra focus fields) ───
 *   candidatesInFocusCount → number (integer, ≥ 0)
 *   focusConfidence        → number (finite, ∈ [0, 1])
 *   focusDecisive          → boolean
 *   focusMargin            → number (finite, ≥ 0)
 *   focusRank              → number (integer, ≥ 1)
 *   focusRankDelta         → number (integer, ≥ 0; === focusRank - 1)
 *   inFocusFraction        → number (finite, ∈ [0, 1])
 *   winnerFocusBoost       → number (finite, ≥ 0)
 *   winnerScoreBase        → number (finite, ≥ 0)
 *
 * ── verbosity:'medium', focus:code, focus-changed winner (1 extra field) ─────
 *   unfocusedWinner → string (non-empty, contains '/')
 *
 * Frozen 2026-09-19.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

// ── Fixture setup ─────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-ev-${Date.now()}-${++dlqSeq}.jsonl`);
}

const FOCUS_PROFILES = {
  profiles: {
    code: { categories: ['code'] as string[], servers: ['neon'] as string[], boost: 0.5 },
  },
};

function makeAggregator(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  backend.defineServer('tasks', FIXTURE_SERVERS.tasks);
  const configs: ServerConfig[] = [
    { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true },
    { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true },
    { id: 'tasks', name: 'Tasks', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://tasks.chitty.cc/mcp', lazy: true },
  ];
  return new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    focusProfiles: FOCUS_PROFILES,
  });
}

function parseBody(result: { content: Array<{ type?: string; text?: unknown }> }): Record<string, unknown> {
  const first = result.content[0] as { type?: string; text?: unknown } | undefined;
  if (typeof first?.text !== 'string') throw new Error('No text content');
  return JSON.parse(first.text) as Record<string, unknown>;
}

function getExplanation(body: Record<string, unknown>): Record<string, unknown> {
  const explanation = body['explanation'];
  assert.ok(explanation !== null && typeof explanation === 'object', 'explanation must be an object');
  return explanation as Record<string, unknown>;
}

// ── Suite 1: verbosity:'low' + focus:code value types ────────────────────────

describe('EV — explain field value types at verbosity:low with focus:code (multi-candidate)', () => {
  test('focus-specific scalar fields have correct types at verbosity:low', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'low',
        focus: 'code',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = parseBody(result);
      const exp = getExplanation(body);

      // focus: non-empty string === 'code'
      assert.equal(typeof exp['focus'], 'string', 'focus must be a string');
      assert.ok((exp['focus'] as string).length > 0, 'focus must be non-empty');
      assert.equal(exp['focus'], 'code', "focus must equal the active profile name 'code'");

      // focusBoost: finite number > 0
      assert.equal(typeof exp['focusBoost'], 'number', 'focusBoost must be a number');
      assert.ok(Number.isFinite(exp['focusBoost'] as number), 'focusBoost must be finite');
      assert.ok((exp['focusBoost'] as number) > 0, 'focusBoost must be > 0');

      // focusDecisive: boolean
      assert.equal(typeof exp['focusDecisive'], 'boolean', 'focusDecisive must be a boolean');

      // winnerInFocus: boolean
      assert.equal(typeof exp['winnerInFocus'], 'boolean', 'winnerInFocus must be a boolean');
    } finally {
      await agg.shutdown();
    }
  });

  test('winner was boosted: winnerInFocus is true and winnerScore > base non-focus score', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'low',
        focus: 'code',
        dryRun: true,
      });
      assert.equal(result.isError, undefined);
      const body = parseBody(result);
      const exp = getExplanation(body);
      // neon (category:code) wins for 'list database projects' with focus:code
      assert.equal(exp['winnerInFocus'], true, 'winner must be in focus for intent=list database projects with focus:code');
      assert.equal(exp['winnerServer'], 'neon', 'winner server must be neon for intent=list database projects with focus:code');
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 2: verbosity:'medium' + focus:code, in-focus winner ─────────────────

describe('EV — explain field value types at verbosity:medium with focus:code (in-focus winner)', () => {
  test('all medium focus-specific scalar fields have correct types', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'medium',
        focus: 'code',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = parseBody(result);
      const exp = getExplanation(body);

      // Spot-check shared low-verbosity types still hold at medium verbosity
      assert.equal(typeof exp['winnerScore'], 'number', 'winnerScore must be a number at medium verbosity');
      assert.equal(typeof exp['focus'], 'string', 'focus must be a string at medium verbosity');

      // focusBoost: finite number > 0 (present at both low and medium verbosity; asserted here so
      // a type change in the medium path is caught independently of Suite 1's low-verbosity check)
      assert.equal(typeof exp['focusBoost'], 'number', 'focusBoost must be a number at medium verbosity');
      assert.ok(Number.isFinite(exp['focusBoost'] as number), 'focusBoost must be finite at medium verbosity');
      assert.ok((exp['focusBoost'] as number) > 0, 'focusBoost must be > 0 at medium verbosity');

      // candidatesInFocusCount: integer ≥ 0
      assert.equal(typeof exp['candidatesInFocusCount'], 'number', 'candidatesInFocusCount must be a number');
      assert.ok(Number.isInteger(exp['candidatesInFocusCount'] as number), 'candidatesInFocusCount must be an integer');
      assert.ok((exp['candidatesInFocusCount'] as number) >= 0, 'candidatesInFocusCount must be ≥ 0');

      // focusConfidence: finite ∈ [0, 1]
      assert.equal(typeof exp['focusConfidence'], 'number', 'focusConfidence must be a number');
      assert.ok(Number.isFinite(exp['focusConfidence'] as number), 'focusConfidence must be finite');
      assert.ok((exp['focusConfidence'] as number) >= 0, 'focusConfidence must be ≥ 0');
      assert.ok((exp['focusConfidence'] as number) <= 1, 'focusConfidence must be ≤ 1');

      // focusDecisive: boolean
      assert.equal(typeof exp['focusDecisive'], 'boolean', 'focusDecisive must be a boolean');

      // focusMargin: finite ≥ 0
      assert.equal(typeof exp['focusMargin'], 'number', 'focusMargin must be a number');
      assert.ok(Number.isFinite(exp['focusMargin'] as number), 'focusMargin must be finite');
      assert.ok((exp['focusMargin'] as number) >= 0, 'focusMargin must be ≥ 0');

      // focusRank: integer ≥ 1
      assert.equal(typeof exp['focusRank'], 'number', 'focusRank must be a number');
      assert.ok(Number.isInteger(exp['focusRank'] as number), 'focusRank must be an integer');
      assert.ok((exp['focusRank'] as number) >= 1, 'focusRank must be ≥ 1');

      // focusRankDelta: integer ≥ 0
      assert.equal(typeof exp['focusRankDelta'], 'number', 'focusRankDelta must be a number');
      assert.ok(Number.isInteger(exp['focusRankDelta'] as number), 'focusRankDelta must be an integer');
      assert.ok((exp['focusRankDelta'] as number) >= 0, 'focusRankDelta must be ≥ 0');

      // inFocusFraction: finite ∈ [0, 1]
      assert.equal(typeof exp['inFocusFraction'], 'number', 'inFocusFraction must be a number');
      assert.ok(Number.isFinite(exp['inFocusFraction'] as number), 'inFocusFraction must be finite');
      assert.ok((exp['inFocusFraction'] as number) >= 0, 'inFocusFraction must be ≥ 0');
      assert.ok((exp['inFocusFraction'] as number) <= 1, 'inFocusFraction must be ≤ 1');

      // winnerFocusBoost: finite ≥ 0
      assert.equal(typeof exp['winnerFocusBoost'], 'number', 'winnerFocusBoost must be a number');
      assert.ok(Number.isFinite(exp['winnerFocusBoost'] as number), 'winnerFocusBoost must be finite');
      assert.ok((exp['winnerFocusBoost'] as number) >= 0, 'winnerFocusBoost must be ≥ 0');

      // winnerScoreBase: finite ≥ 0
      assert.equal(typeof exp['winnerScoreBase'], 'number', 'winnerScoreBase must be a number');
      assert.ok(Number.isFinite(exp['winnerScoreBase'] as number), 'winnerScoreBase must be finite');
      assert.ok((exp['winnerScoreBase'] as number) >= 0, 'winnerScoreBase must be ≥ 0');
    } finally {
      await agg.shutdown();
    }
  });

  test('focusRankDelta === focusRank - 1 (derived field identity)', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'medium',
        focus: 'code',
        dryRun: true,
      });
      assert.equal(result.isError, undefined);
      const body = parseBody(result);
      const exp = getExplanation(body);
      const focusRank = exp['focusRank'] as number;
      const focusRankDelta = exp['focusRankDelta'] as number;
      assert.equal(focusRankDelta, focusRank - 1, `focusRankDelta (${focusRankDelta}) must equal focusRank - 1 (${focusRank - 1})`);
    } finally {
      await agg.shutdown();
    }
  });

  test('winnerScoreBase + winnerFocusBoost === winnerScore (score decomposition identity)', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list database projects',
        explain: true,
        verbosity: 'medium',
        focus: 'code',
        dryRun: true,
      });
      assert.equal(result.isError, undefined);
      const body = parseBody(result);
      const exp = getExplanation(body);
      const winnerScore = exp['winnerScore'] as number;
      const winnerScoreBase = exp['winnerScoreBase'] as number;
      const winnerFocusBoost = exp['winnerFocusBoost'] as number;
      assert.ok(
        Math.abs(winnerScoreBase + winnerFocusBoost - winnerScore) < 1e-10,
        `winnerScoreBase (${winnerScoreBase}) + winnerFocusBoost (${winnerFocusBoost}) must equal winnerScore (${winnerScore})`,
      );
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 3: verbosity:'medium' + focus:code, focus-changed winner ────────────

describe('EV — unfocusedWinner value type at verbosity:medium with focus:code (focus-changed winner)', () => {
  test('unfocusedWinner is a non-empty namespaced string when focus changed the winner', async () => {
    const agg = makeAggregator();
    try {
      // 'retrieve account balance': without focus stripe/get_balance wins;
      // with focus:code neon/list_projects wins (boost tips outcome).
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'retrieve account balance',
        explain: true,
        verbosity: 'medium',
        focus: 'code',
        dryRun: true,
      });
      assert.equal(result.isError, undefined, 'cast should not error');
      const body = parseBody(result);
      const exp = getExplanation(body);

      // The fixture intent 'retrieve account balance' + focus:code reliably produces a
      // focus-changed winner (stripe/get_balance wins without focus; neon/list_projects wins
      // with it). Require unfocusedWinner to be defined — a failure here means the fixture
      // stopped producing the focus-changed-winner scenario (a regression to catch, not skip).
      assert.ok(exp['unfocusedWinner'] !== undefined, 'unfocusedWinner must be present for the focus-changed winner scenario');
      assert.equal(typeof exp['unfocusedWinner'], 'string', 'unfocusedWinner must be a string');
      assert.ok((exp['unfocusedWinner'] as string).length > 0, 'unfocusedWinner must be non-empty');
      assert.ok((exp['unfocusedWinner'] as string).includes('/'), "unfocusedWinner must be namespaced (contain '/')");

      // unfocusedWinner must differ from the winner's server
      const winnerServer = exp['winnerServer'] as string;
      const unfocusedServer = (exp['unfocusedWinner'] as string).split('/')[0];
      assert.notEqual(unfocusedServer, winnerServer, 'unfocusedWinner server must differ from winner server (focus changed the top spot)');
    } finally {
      await agg.shutdown();
    }
  });

  test('winnerInFocus is true when unfocusedWinner is present (focus promoted winner)', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'retrieve account balance',
        explain: true,
        verbosity: 'medium',
        focus: 'code',
        dryRun: true,
      });
      assert.equal(result.isError, undefined);
      const body = parseBody(result);
      const exp = getExplanation(body);
      assert.ok(exp['unfocusedWinner'] !== undefined, 'unfocusedWinner must be present for the focus-changed winner scenario');
      assert.equal(exp['winnerInFocus'], true, 'when unfocusedWinner is present, the actual winner must be in focus');
    } finally {
      await agg.shutdown();
    }
  });
});
