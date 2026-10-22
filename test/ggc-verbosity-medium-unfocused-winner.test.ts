/**
 * GGC drift guard: freeze unfocusedWinner PRESENCE and ABSENCE for verbosity:'medium'
 * when a focus profile is active.
 *
 * Background
 * ----------
 * When explain:true is set on cast with verbosity:'medium' AND a focus profile is
 * active, buildCastExplanation() conditionally emits one field that GGA/GGB did
 * not isolate:
 *
 *   unfocusedWinner  (aggregator.ts, verbosity:'medium' focus block):
 *
 *       const unfocusedWinner = preFocusSorted !== undefined
 *         && preFocusSorted.length > 0
 *         && preFocusSorted[0].n !== best.namespacedName
 *         ? preFocusSorted[0].n
 *         : undefined;
 *       ...
 *       if (unfocusedWinner !== undefined)
 *         r.unfocusedWinner = unfocusedWinner;
 *
 *   unfocusedWinner is defined only when the focus boost changed the top spot:
 *   the tool that would have won WITHOUT the boost is different from the tool
 *   that actually won WITH the boost.
 *
 *   It is absent when the post-focus winner was already the pre-focus winner
 *   (focus was not decisive for the top position).
 *
 * GGA froze winnerFocusBoost / winnerScoreBase / candidatesInFocusCount /
 * inFocusFraction / focusMargin.  GGB froze focusRank / focusRankDelta /
 * focusConfidence.  GGC closes the remaining medium-focus gap for
 * unfocusedWinner — the only conditional focus field in that path still lacking
 * an isolated presence/absence guard.
 *
 * Why this matters
 * ----------------
 * A regression that:
 *
 *   (a) emits unfocusedWinner unconditionally (e.g. drops the
 *       `preFocusSorted[0].n !== best.namespacedName` guard), or
 *   (b) never emits it even when focus changes the winner (e.g. drops the
 *       `if (unfocusedWinner !== undefined)` emission guard in the medium path),
 *       or
 *   (c) emits the wrong tool name (e.g. emits the post-focus winner instead of
 *       the pre-focus winner)
 *
 * would pass every existing explanation test silently. ES/EV freeze the field
 * NAME and VALUE TYPE via bulk key-set or multi-field checks. GGC provides
 * targeted per-field presence/absence guards that draw attention directly to
 * this conditional field.
 *
 * GGC frozen invariants:
 *
 *   GGC-1  verbosity:'medium', focus:'code' active, cross-category fixture,
 *          INTENT_CROSS (focus changes winner) →
 *          explanation.unfocusedWinner IS PRESENT
 *          (presence guard; absent means the emission guard was dropped from
 *           the medium path or the preFocusSorted computation was removed)
 *
 *   GGC-2  verbosity:'medium', focus:'code' active, cross-category fixture,
 *          INTENT_NATIVE (focus does NOT change winner) →
 *          explanation.unfocusedWinner IS ABSENT
 *          (absence guard; present means the
 *           `preFocusSorted[0].n !== best.namespacedName` condition was dropped,
 *           causing unfocusedWinner to be emitted even when the winner was
 *           unchanged by focus)
 *
 *   GGC-3  verbosity:'medium', focus:'code' active, focus changes winner →
 *          explanation.unfocusedWinner is a non-empty string matching the
 *          namespaced tool name pattern "serverId/toolName"
 *          (format guard; guards against emitting undefined, null, or a bare
 *           tool name without the server segment)
 *
 *   GGC-4  verbosity:'medium', focus:'code' active, focus changes winner →
 *          explanation.unfocusedWinner === 'stripe/list_payment_projects'
 *          (value identity; the exact pre-focus winner's namespaced name must
 *           be preserved; a mismatch indicates the wrong tool was recorded —
 *           e.g. the post-focus winner was stored instead of the pre-focus one)
 *
 *   GGC-5  verbosity:'medium', focus:'code' active, focus changes winner →
 *          explanation.unfocusedWinner !== body.tool (cast winner's namespaced
 *          name)
 *          (displacement invariant; unfocusedWinner is the tool DISPLACED by
 *           focus, not the tool that won; equal values would indicate the
 *           assignment stored the wrong side of the comparison)
 *
 * Scoring derivation
 * ------------------
 * Keyword scorer: score = round((matchCount/terms + nameBonus) * 100) / 100
 *   terms = intent words with length > 2; nameBonus = 0.3 when any term
 *   exactly equals tool.name or tool.serverId.
 *
 * INTENT_CROSS = 'list all payment projects' (4 terms: list/all/payment/projects)
 *   stripe/list_payment_projects — haystack contains all 4 terms; nameBonus=0
 *     (no term exactly equals 'list_payment_projects' or 'stripe') → score 1.0
 *   neon/list_projects — haystack contains list/all/projects but NOT payment;
 *     nameBonus=0 → score 0.75
 *   Pre-focus: stripe > neon (1.0 > 0.75)
 *   Post-focus neon: 0.75 + boost(0.5) = 1.25 > 1.0 → neon wins
 *   ∴ unfocusedWinner = 'stripe/list_payment_projects'
 *
 * INTENT_NATIVE = 'list neon database projects' (4 terms: list/neon/database/projects)
 *   neon/list_projects — haystack contains all 4 terms; nameBonus=0.3 ('neon'
 *     exactly equals serverId 'neon') → score 1.3
 *   stripe/list_payment_projects — haystack contains list/projects but NOT
 *     neon/database; nameBonus=0 → score 0.5
 *   Pre-focus neon contribution: 1.3 − boost(0.5) = 0.8 > stripe 0.5
 *   ∴ pre-focus winner = neon = post-focus winner → unfocusedWinner absent
 *
 * Fixture: one FixtureBackend shared by two server configs (neon + stripe).
 * KeywordOnlyCoordinator disables the brain route for determinism.
 * confirm:true (dryRun) avoids any backend network call.
 * suggestionsCatalog:{} prevents disk-loaded focus-suggestions.json from
 * injecting additional suggestion resources as extra candidates.
 *
 * Frozen 2026-10-02.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file, no src changes)
 *   - buildCastExplanation metric freeze: not applicable — GGC freezes the
 *     PRESENCE, ABSENCE, and value identity of the existing conditional
 *     unfocusedWinner field in the verbosity:'medium' path; no new fields are
 *     added to buildCastExplanation
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-ggc-${Date.now()}-${++dlqSeq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

const CODE_FOCUS_PROFILES = {
  profiles: {
    code: {
      description: 'Code and databases',
      categories: ['code' as const],
      servers: ['neon'],
      boost: 0.5,
    },
  },
};

// Neon: in-focus (category:'code', servers:['neon'])
const NEON_CFG: ServerConfig = {
  id: 'neon',
  name: 'Neon DB',
  type: 'remote',
  access: 'readwrite',
  category: 'code',
  endpoint: 'https://neon.tech/mcp',
  lazy: true,
};

// Stripe: out-of-focus (category:'finance', not in servers list)
const STRIPE_CFG: ServerConfig = {
  id: 'stripe',
  name: 'Stripe Payments',
  type: 'remote',
  access: 'read',
  category: 'finance',
  endpoint: 'https://stripe.com/mcp',
  lazy: true,
};

// Neon tool: haystack = "neon/list_projects list all neon database projects
//   for an account Neon DB code"
// Matches list/all/neon/database/projects from any intent containing those words.
const TOOL_NEON_LIST_PROJECTS = {
  name: 'list_projects',
  description: 'List all neon database projects for an account',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text' as const, text: '{"projects":[]}' }] },
};

// Stripe tool: haystack = "stripe/list_payment_projects list all payment projects
//   from stripe accounts Stripe Payments stripe finance"
// Matches list/all/payment/projects from any intent containing those words.
const TOOL_STRIPE_LIST_PAYMENT_PROJECTS = {
  name: 'list_payment_projects',
  description: 'List all payment projects from Stripe accounts',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text' as const, text: '{"projects":[]}' }] },
};

// INTENT_CROSS: stripe scores 1.0 pre-focus, neon scores 0.75 pre-focus.
// Post-focus neon = 0.75+0.5 = 1.25 > 1.0 → neon wins; unfocusedWinner = stripe tool.
const INTENT_CROSS = 'list all payment projects';

// INTENT_NATIVE: neon scores 1.3 pre-focus (nameBonus from "neon"=serverId), stripe=0.5.
// Neon wins pre-focus and post-focus; unfocusedWinner is absent.
const INTENT_NATIVE = 'list neon database projects';

/** Two-server fixture: neon (code/in-focus) + stripe (finance/out-of-focus). */
function makeCrossAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', { tools: [TOOL_NEON_LIST_PROJECTS], prompts: [], resources: [] });
  backend.defineServer('stripe', { tools: [TOOL_STRIPE_LIST_PAYMENT_PROJECTS], prompts: [], resources: [] });
  const path = dlq();
  return new Aggregator([NEON_CFG, STRIPE_CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
    focusProfiles: CODE_FOCUS_PROFILES,
    focus: 'code',
    suggestionsCatalog: {},
  });
}

interface CastBody {
  resolvedTool: string;
  explanation: Record<string, unknown>;
}

async function castMedium(agg: Aggregator, intent: string): Promise<CastBody> {
  const result = await agg.callTool('ch1tty/cast', {
    intent,
    confirm: true,
    explain: true,
    verbosity: 'medium',
  });
  const item = result.content[0];
  assert.ok(item && 'text' in item, 'content[0] must have text');
  const body = JSON.parse((item as { text: string }).text) as Record<string, unknown>;
  assert.ok(
    body['explanation'] !== null && typeof body['explanation'] === 'object' && !Array.isArray(body['explanation']),
    `explanation must be a non-null object, got ${JSON.stringify(body['explanation'])}`,
  );
  // confirm:true returns cast:'plan'; winner is under resolved.tool (not body.tool)
  const resolved = body['resolved'] as Record<string, unknown> | undefined;
  return {
    resolvedTool: resolved?.['tool'] as string,
    explanation: body['explanation'] as Record<string, unknown>,
  };
}

// ── GGC-1: unfocusedWinner IS PRESENT when focus changes the winner ────────────

test('GGC-1: verbosity:medium focus:code cross-category → explanation.unfocusedWinner IS PRESENT when focus changes winner', async () => {
  const agg = makeCrossAgg();
  try {
    const { explanation } = await castMedium(agg, INTENT_CROSS);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'unfocusedWinner'),
      true,
      `GGC-1: unfocusedWinner must be present in medium-verbosity explanation when focus promotes ` +
      `an in-focus tool over a higher-scoring out-of-focus tool; ` +
      `got keys=${JSON.stringify(Object.keys(explanation).sort())}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GGC-2: unfocusedWinner IS ABSENT when focus does NOT change the winner ─────

test('GGC-2: verbosity:medium focus:code native-intent → explanation.unfocusedWinner IS ABSENT when focus does not change winner', async () => {
  const agg = makeCrossAgg();
  try {
    const { explanation } = await castMedium(agg, INTENT_NATIVE);
    assert.equal(
      Object.prototype.hasOwnProperty.call(explanation, 'unfocusedWinner'),
      false,
      `GGC-2: unfocusedWinner must be ABSENT in medium-verbosity explanation when the in-focus tool ` +
      `was already the pre-focus winner (focus did not change the top spot); ` +
      `got unfocusedWinner=${JSON.stringify(explanation['unfocusedWinner'])}, ` +
      `keys=${JSON.stringify(Object.keys(explanation).sort())}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GGC-3: unfocusedWinner is a namespaced-name string when present ────────────

test('GGC-3: verbosity:medium focus:code cross-category → explanation.unfocusedWinner is a "serverId/toolName" string', async () => {
  const agg = makeCrossAgg();
  try {
    const { explanation } = await castMedium(agg, INTENT_CROSS);
    const uw = explanation['unfocusedWinner'];
    assert.ok(
      typeof uw === 'string' && uw.length > 0,
      `GGC-3: unfocusedWinner must be a non-empty string; got ${JSON.stringify(uw)}`,
    );
    const NAMESPACED = /^[^/]+\/[^/]+$/;
    assert.ok(
      NAMESPACED.test(uw as string),
      `GGC-3: unfocusedWinner must match the "serverId/toolName" pattern (one slash, no leading/trailing slash); ` +
      `got ${JSON.stringify(uw)}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GGC-4: unfocusedWinner equals the expected pre-focus winner ────────────────

test('GGC-4: verbosity:medium focus:code cross-category → explanation.unfocusedWinner === "stripe/list_payment_projects"', async () => {
  const agg = makeCrossAgg();
  try {
    const { explanation } = await castMedium(agg, INTENT_CROSS);
    assert.equal(
      explanation['unfocusedWinner'],
      'stripe/list_payment_projects',
      `GGC-4: unfocusedWinner must equal the pre-focus winner's namespaced name ` +
      `('stripe/list_payment_projects'); ` +
      `got ${JSON.stringify(explanation['unfocusedWinner'])}`,
    );
  } finally { await agg.shutdown(); }
});

// ── GGC-5: unfocusedWinner !== cast winner (displacement invariant) ────────────

test('GGC-5: verbosity:medium focus:code cross-category → explanation.unfocusedWinner !== cast winner tool name', async () => {
  const agg = makeCrossAgg();
  try {
    const { resolvedTool, explanation } = await castMedium(agg, INTENT_CROSS);
    const uw = explanation['unfocusedWinner'];
    assert.ok(
      typeof uw === 'string' && typeof resolvedTool === 'string',
      `GGC-5: both unfocusedWinner and cast winner (resolved.tool) must be strings; ` +
      `got unfocusedWinner=${JSON.stringify(uw)}, resolved.tool=${JSON.stringify(resolvedTool)}`,
    );
    assert.notEqual(
      uw,
      resolvedTool,
      `GGC-5: unfocusedWinner must differ from the cast winner (resolved.tool) — it is the tool ` +
      `DISPLACED by the focus boost, not the tool that won; ` +
      `both equal ${JSON.stringify(uw)}`,
    );
  } finally { await agg.shutdown(); }
});
