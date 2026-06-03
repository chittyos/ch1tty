/**
 * XXX batch — 4 tests covering confirmed untested branches:
 *
 * 1. CircuitBreaker.recordSuccess: state exists but is already clean
 *    (failures=0, openUntil=0) → the `if (state && ...)` guard is false →
 *    silent no-op; state is unchanged.
 *
 * 2. CircuitBreaker.getState: circuit was tripped then its cooldown expired
 *    (openUntil > 0, Date.now() >= openUntil) before any isAllowed /
 *    recordSuccess clears it → open=false, failures still at threshold,
 *    cooldownRemaining=0.  This is the half-open "pending probe" snapshot.
 *
 * 3. cast: no_match + resolvedBy='brain' — coordinator returns a ghost tool
 *    name absent from the live registry; the .filter(t !== null) step strips
 *    it → scoredTools=[]; no prompts or resources match either → no_match
 *    result with resolvedBy:'brain'.
 *
 * 4. cast: discovered + resolvedBy='brain' — same ghost brain route so
 *    scoredTools=[], but the backend exposes a prompt whose name+description
 *    keyword-scores > 0.1 against the intent → discovered result with
 *    resolvedBy:'brain'.
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { CircuitBreaker } from '../src/circuit-breaker.js';
import { SessionCoordinator } from '../src/coordinator.js';
import { Aggregator } from '../src/aggregator.js';
import { FixtureBackend } from './fixture-backend.js';
import type { RoutedTool, ToolCandidate } from '../src/ollama-brain.js';
import type { ServerConfig } from '../src/types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Always routes to a ghost tool name that cannot exist in any real registry. */
class GhostBrainCoordinator extends SessionCoordinator {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override async routeIntent(_query: string, _candidates: ToolCandidate[]): Promise<RoutedTool[] | null> {
    return [{
      tool: { namespacedName: 'ghost/nonexistent', description: 'ghost' },
      confidence: 0.9,
      reason: 'synthetic test',
    }];
  }
}

function makeAgg(
  serverId: string,
  backend: FixtureBackend,
  coordinator: SessionCoordinator,
): Aggregator {
  const dlqPath = join(tmpdir(), `ch1tty-xxx-${Date.now()}-${Math.random()}.jsonl`);
  const config: ServerConfig = {
    id: serverId,
    name: serverId,
    type: 'remote',
    access: 'readwrite',
    category: 'ecosystem',
    endpoint: `https://${serverId}.test/mcp`,
    lazy: true,
  };
  return new Aggregator([config], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlqPath,
    suggestionsCatalog: {},
    coordinator,
  });
}

// ── 1. CircuitBreaker.recordSuccess: already-clean state → if-guard is false ─

test('CircuitBreaker.recordSuccess: state clean after prior recovery → second call is silent no-op', () => {
  const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 60_000 });

  // One failure → state created; then success → state.failures=0, openUntil=0
  cb.recordFailure('svc');
  cb.recordSuccess('svc');

  // Second recordSuccess: state exists but failures===0 AND openUntil===0 →
  // `if (state && (state.failures > 0 || state.openUntil > 0))` is false → no-op
  assert.doesNotThrow(() => cb.recordSuccess('svc'), 'second recordSuccess must not throw');

  const s = cb.getState('svc');
  assert.equal(s.failures, 0, 'failures unchanged at 0');
  assert.equal(s.open, false, 'circuit stays closed');
  assert.equal(s.cooldownRemaining, 0, 'no cooldown remaining');
});

// ── 2. CircuitBreaker.getState: cooldown expired → half-open snapshot ─────────

test('CircuitBreaker.getState: after cooldown expiry open=false, failures at threshold', async () => {
  const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 40 });

  cb.recordFailure('svc');
  cb.recordFailure('svc');  // trips: failures=2, openUntil set ~40ms ahead
  assert.equal(cb.isAllowed('svc'), false, 'circuit open immediately after tripping');

  // Wait past cooldown
  await new Promise<void>((resolve) => setTimeout(resolve, 70));

  // getState while openUntil > 0 but now < Date.now() — half-open state
  const s = cb.getState('svc');
  assert.equal(s.open, false, 'open=false once cooldown has expired');
  assert.equal(s.failures, 2, 'failures stays at threshold value (not reset by getState)');
  assert.equal(s.cooldownRemaining, 0, 'no remaining cooldown');
});

// ── 3. cast: no_match + resolvedBy='brain' ────────────────────────────────────

test('cast: no_match + resolvedBy="brain" when brain returns ghost tool and no surface matches', async () => {
  const backend = new FixtureBackend();
  backend.defineServer('ghost-svc', {
    tools: [{
      name: 'say_hello',
      description: 'greet a user with a friendly hello message',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: 'Hello!' }] },
    }],
    // No prompts, no resources
  });

  const dlqPath = join(tmpdir(), `ch1tty-xxx-nomatch-${Date.now()}.jsonl`);
  const coord = new GhostBrainCoordinator({}, { enabled: false }, dlqPath);
  const agg = makeAgg('ghost-svc', backend, coord);

  try {
    // Terms have zero overlap with say_hello's description and no prompts/resources exist
    const result = await agg.callTool('ch1tty/cast', { intent: 'xyzzy frobnicate plugh' });
    assert.ok(!result.isError, 'cast must not return isError');
    const data = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as Record<string, unknown>;
    assert.equal(data.cast, 'no_match', 'cast must be no_match when ghost tool + no fallback surface');
    assert.equal(data.resolvedBy, 'brain', 'resolvedBy must be "brain" when brain route fired');
  } finally {
    await agg.shutdown();
  }
});

// ── 4. cast: discovered + resolvedBy='brain' ──────────────────────────────────

test('cast: discovered + resolvedBy="brain" when ghost brain tool but matching prompt exists', async () => {
  const backend = new FixtureBackend();
  backend.defineServer('disc-svc', {
    tools: [{
      name: 'say_hello',
      description: 'greet a user with a friendly hello message',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: 'Hello!' }] },
    }],
    prompts: [
      { name: 'welcome_guide', description: 'welcome new user guide to get started' },
    ],
  });

  const dlqPath = join(tmpdir(), `ch1tty-xxx-disc-${Date.now()}.jsonl`);
  const coord = new GhostBrainCoordinator({}, { enabled: false }, dlqPath);
  const agg = makeAgg('disc-svc', backend, coord);

  try {
    // "welcome", "guide", "started" → score=1.0 for welcome_guide prompt (all 3 terms present)
    //                               → score=0 for say_hello tool (no overlap)
    // Brain returns ghost → scoredTools=[] → falls through to discovered
    const result = await agg.callTool('ch1tty/cast', { intent: 'welcome guide started' });
    assert.ok(!result.isError, 'cast must not return isError');
    const data = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as Record<string, unknown>;
    assert.equal(data.cast, 'discovered', 'cast must be discovered when ghost brain + matching prompt');
    assert.equal(data.resolvedBy, 'brain', 'resolvedBy must be "brain" when brain route fired');
    assert.ok(Array.isArray(data.prompts), 'discovered result must include matched prompts array');
    const prompts = data.prompts as Array<{ name: string }>;
    assert.ok(prompts[0].name.includes('welcome_guide'), 'welcome_guide prompt surfaced in discovered result');
  } finally {
    await agg.shutdown();
  }
});
