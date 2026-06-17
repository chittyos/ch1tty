/**
 * verbosity param on ch1tty/cast explain mode.
 *
 * verbosity: 'low'   → 9-10 essential fields only
 * verbosity: 'medium' → adds focus analysis + basic distribution stats
 * verbosity: 'full'  → all fields (default; backward compat)
 *
 * Coverage:
 *  1. verbosity: 'low' → explanation has method, candidateCount, topCandidates, rationale
 *  2. verbosity: 'low' → explanation has winnerScore, winnerServer when match found
 *  3. verbosity: 'low' → explanation has runnerUpScore, runnerUpTool when >= 2 candidates
 *  4. verbosity: 'low' → stat bloat absent (candidateScoreStdDev, medianCandidateScore absent)
 *  5. verbosity: 'low' + focus → focus, focusBoost, winnerInFocus present
 *  6. verbosity: 'low' + focus + >= 2 candidates → focusDecisive present
 *  7. verbosity: 'medium' → focus analysis fields present when focus active
 *  8. verbosity: 'medium' → distribution stats present (candidateScoreMean, medianCandidateScore, candidateScoreStdDev)
 *  9. verbosity: 'medium' → heavy stat bloat absent (candidateScoreVariance, winnerScoreZScore absent)
 * 10. verbosity: 'full' (explicit) → all fields present (same as default, backward compat)
 * 11. verbosity: 'low' + no_match → explanation present with empty topCandidates
 * 12. verbosity: 'medium' + no_match → explanation present with empty topCandidates
 * 13. omitted verbosity → same as 'full' (backward compat)
 * 14. verbosity: 'low' tool description documents verbosity param
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import { FixtureBackend } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-verbosity-${label}-${Date.now()}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

function makeAgg(opts: { focus?: string } = {}) {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [
      { name: 'list_projects', description: 'list neon database projects sql postgres', inputSchema: { type: 'object', properties: {} }, response: { content: [{ type: 'text', text: '["p1"]' }] } },
      { name: 'create_project', description: 'create a neon project database sql', inputSchema: { type: 'object', properties: {} }, response: { content: [{ type: 'text', text: '{"id":"p2"}' }] } },
    ],
  });

  const configs: ServerConfig[] = [{
    id: 'neon',
    name: 'Neon',
    type: 'remote',
    access: 'readwrite',
    category: 'ecosystem',
    endpoint: 'https://neon.tech/mcp',
    lazy: true,
  }];

  const dlq = dlqPath(`agg-${Date.now()}`);
  const coordinator = new KeywordOnlyCoordinator({}, { enabled: false }, dlq);

  const focusProfiles = opts.focus ? {
    profiles: {
      [opts.focus]: {
        categories: ['ecosystem' as const],
        servers: [] as string[],
        boost: 0.5,
      },
    },
  } : { profiles: {} };

  return {
    agg: new Aggregator(configs, {
      backendFactory: () => backend,
      embedEnabled: false,
      ledgerDlqPath: dlq,
      suggestionsCatalog: {},
      coordinator,
      ...(opts.focus ? { focus: opts.focus, focusProfiles } : {}),
    }),
  };
}

function parseCast(result: Awaited<ReturnType<Aggregator['callTool']>>) {
  const text = (result.content[0] as { type: string; text: string }).text;
  return JSON.parse(text) as Record<string, unknown>;
}

test('verbosity-1: low → essential fields present', async () => {
  const { agg } = makeAgg();
  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', explain: true, verbosity: 'low' });
  const body = parseCast(result);
  assert.strictEqual(body.cast, 'executed');
  const exp = body.explanation as Record<string, unknown>;
  assert.ok(exp, 'explanation should be present');
  assert.strictEqual(exp.method, 'keyword');
  assert.ok(typeof exp.candidateCount === 'number', 'candidateCount should be present');
  assert.ok(Array.isArray(exp.topCandidates), 'topCandidates should be present');
  assert.ok(typeof exp.rationale === 'string', 'rationale should be present');
  await agg.shutdown();
});

test('verbosity-2: low → winnerScore and winnerServer present when match found', async () => {
  const { agg } = makeAgg();
  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', explain: true, verbosity: 'low' });
  const body = parseCast(result);
  const exp = body.explanation as Record<string, unknown>;
  assert.ok(typeof exp.winnerScore === 'number', 'winnerScore should be present');
  assert.ok(typeof exp.winnerServer === 'string', 'winnerServer should be present');
  assert.strictEqual(exp.winnerServer, 'neon');
  await agg.shutdown();
});

test('verbosity-3: low → runnerUpScore and runnerUpTool present when >= 2 candidates', async () => {
  const { agg } = makeAgg();
  const result = await agg.callTool('ch1tty/cast', { intent: 'neon database projects', explain: true, verbosity: 'low' });
  const body = parseCast(result);
  const exp = body.explanation as Record<string, unknown>;
  if ((exp.candidateCount as number) >= 2) {
    assert.ok(typeof exp.runnerUpScore === 'number', 'runnerUpScore should be present');
    assert.ok(typeof exp.runnerUpTool === 'string', 'runnerUpTool should be present');
  }
  await agg.shutdown();
});

test('verbosity-4: low → stat bloat absent', async () => {
  const { agg } = makeAgg();
  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', explain: true, verbosity: 'low' });
  const body = parseCast(result);
  const exp = body.explanation as Record<string, unknown>;
  assert.ok(!('candidateScoreStdDev' in exp), 'candidateScoreStdDev should be absent in low');
  assert.ok(!('medianCandidateScore' in exp), 'medianCandidateScore should be absent in low');
  assert.ok(!('candidateScoreVariance' in exp), 'candidateScoreVariance should be absent in low');
  assert.ok(!('winnerScoreZScore' in exp), 'winnerScoreZScore should be absent in low');
  assert.ok(!('candidateScoreEntropy' in exp), 'candidateScoreEntropy should be absent in low');
  await agg.shutdown();
});

test('verbosity-5: low + focus → focus, focusBoost, winnerInFocus present', async () => {
  const { agg } = makeAgg({ focus: 'code' });
  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', explain: true, verbosity: 'low' });
  const body = parseCast(result);
  const exp = body.explanation as Record<string, unknown>;
  assert.strictEqual(exp.focus, 'code');
  assert.ok(typeof exp.focusBoost === 'number', 'focusBoost should be present');
  assert.ok(typeof exp.winnerInFocus === 'boolean', 'winnerInFocus should be present');
  await agg.shutdown();
});

test('verbosity-6: low + focus + >= 2 candidates → focusDecisive present', async () => {
  const { agg } = makeAgg({ focus: 'code' });
  const result = await agg.callTool('ch1tty/cast', { intent: 'neon database projects', explain: true, verbosity: 'low' });
  const body = parseCast(result);
  const exp = body.explanation as Record<string, unknown>;
  if ((exp.candidateCount as number) >= 2 && 'focus' in exp) {
    assert.ok(typeof exp.focusDecisive === 'boolean', 'focusDecisive should be present');
  }
  await agg.shutdown();
});

test('verbosity-7: medium + focus → focus analysis fields present', async () => {
  const { agg } = makeAgg({ focus: 'code' });
  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', explain: true, verbosity: 'medium' });
  const body = parseCast(result);
  const exp = body.explanation as Record<string, unknown>;
  assert.strictEqual(exp.focus, 'code');
  assert.ok(typeof exp.winnerFocusBoost === 'number', 'winnerFocusBoost should be present');
  assert.ok(typeof exp.winnerScoreBase === 'number', 'winnerScoreBase should be present');
  assert.ok(typeof exp.candidatesInFocusCount === 'number', 'candidatesInFocusCount should be present');
  assert.ok(typeof exp.inFocusFraction === 'number', 'inFocusFraction should be present');
  await agg.shutdown();
});

test('verbosity-8: medium → distribution stats present when >= 2 candidates', async () => {
  const { agg } = makeAgg();
  const result = await agg.callTool('ch1tty/cast', { intent: 'neon database projects', explain: true, verbosity: 'medium' });
  const body = parseCast(result);
  const exp = body.explanation as Record<string, unknown>;
  if ((exp.candidateCount as number) >= 2) {
    assert.ok(typeof exp.candidateScoreMean === 'number', 'candidateScoreMean should be present');
    assert.ok(typeof exp.candidateScoreSpread === 'number', 'candidateScoreSpread should be present');
    assert.ok(typeof exp.medianCandidateScore === 'number', 'medianCandidateScore should be present');
    assert.ok(typeof exp.candidateScoreStdDev === 'number', 'candidateScoreStdDev should be present');
  }
  await agg.shutdown();
});

test('verbosity-9: medium → heavy stat bloat absent', async () => {
  const { agg } = makeAgg();
  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', explain: true, verbosity: 'medium' });
  const body = parseCast(result);
  const exp = body.explanation as Record<string, unknown>;
  assert.ok(!('candidateScoreVariance' in exp), 'candidateScoreVariance should be absent in medium');
  assert.ok(!('winnerScoreZScore' in exp), 'winnerScoreZScore should be absent in medium');
  assert.ok(!('candidateScoreEntropy' in exp), 'candidateScoreEntropy should be absent in medium');
  assert.ok(!('candidateScoreHerfindahlIndex' in exp), 'candidateScoreHerfindahlIndex should be absent in medium');
  assert.ok(!('candidateGiniCoefficient' in exp), 'candidateGiniCoefficient should be absent in medium');
  await agg.shutdown();
});

test('verbosity-10: full (explicit) → statistical fields present', async () => {
  const { agg } = makeAgg();
  const result = await agg.callTool('ch1tty/cast', { intent: 'neon database projects', explain: true, verbosity: 'full' });
  const body = parseCast(result);
  assert.ok('explanation' in body, 'explanation should be present');
  const exp = body.explanation as Record<string, unknown>;
  assert.strictEqual(exp.method, 'keyword');
  if ((exp.candidateCount as number) >= 2) {
    assert.ok('candidateScoreStdDev' in exp, 'candidateScoreStdDev should be present in full');
    assert.ok('medianCandidateScore' in exp, 'medianCandidateScore should be present in full');
  }
  await agg.shutdown();
});

test('verbosity-11: low + no_match → explanation present with empty topCandidates', async () => {
  const { agg } = makeAgg();
  const result = await agg.callTool('ch1tty/cast', { intent: 'zzz unmatched xylophone banana', explain: true, verbosity: 'low' });
  const body = parseCast(result);
  assert.strictEqual(body.cast, 'no_match');
  assert.ok(body.explanation, 'explanation should be present on no_match');
  const exp = body.explanation as Record<string, unknown>;
  assert.deepStrictEqual(exp.topCandidates, [], 'topCandidates should be empty on no_match');
  assert.strictEqual(exp.method, 'keyword');
  await agg.shutdown();
});

test('verbosity-12: medium + no_match → explanation present with empty topCandidates', async () => {
  const { agg } = makeAgg();
  const result = await agg.callTool('ch1tty/cast', { intent: 'zzz unmatched xylophone banana', explain: true, verbosity: 'medium' });
  const body = parseCast(result);
  assert.strictEqual(body.cast, 'no_match');
  assert.ok(body.explanation, 'explanation should be present on no_match');
  const exp = body.explanation as Record<string, unknown>;
  assert.deepStrictEqual(exp.topCandidates, [], 'topCandidates should be empty on no_match');
  await agg.shutdown();
});

test('verbosity-13: omitted verbosity → same as full (backward compat)', async () => {
  const { agg } = makeAgg();
  const resultDefault = await agg.callTool('ch1tty/cast', { intent: 'neon database projects', explain: true });
  const resultFull = await agg.callTool('ch1tty/cast', { intent: 'neon database projects', explain: true, verbosity: 'full' });
  const bodyDefault = parseCast(resultDefault);
  const bodyFull = parseCast(resultFull);
  const expDefault = bodyDefault.explanation as Record<string, unknown>;
  const expFull = bodyFull.explanation as Record<string, unknown>;
  assert.deepStrictEqual(Object.keys(expDefault).sort(), Object.keys(expFull).sort(), 'omitted verbosity should produce same keys as full');
  await agg.shutdown();
});

test('verbosity-14: tool description documents verbosity param', async () => {
  const { agg } = makeAgg();
  const { tools } = await agg.listAllTools();
  const cast = tools.find((t) => t.name === 'ch1tty/cast');
  assert.ok(cast, 'ch1tty/cast tool not found');
  assert.ok(
    cast.description?.includes('verbosity'),
    `cast description should mention verbosity, got: ${cast.description?.slice(0, 600)}`,
  );
  await agg.shutdown();
});
