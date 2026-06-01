/**
 * RR: SessionCoordinator — onToolCall edge cases, logDecision, logEvent, getSnapshot.
 *
 * What's covered here that is NOT covered by existing tests:
 *   - coordinator-route-intent.test.ts: exercises routeIntent (EmbeddingBrain/OllamaBrain path only).
 *   - coordinator-ollama-fallback.test.ts: exercises brain fallback order.
 *   - session-affinity.test.ts: exercises onToolCall happy-path via aggregator (tool with slash).
 *   - session-end-checkpoint.test.ts: exercises onSessionEnd + onToolCall as setup only.
 *   - stage-session.test.ts: exercises onSessionStart / stageSession.
 *
 *   ← None of the above tests:
 *       • onToolCall with a tool name that has no slash (the `if (sep > 0)` branch → no affinity)
 *       • onToolCall count accumulation in toolPatterns
 *       • getToolPatterns sort order + limit parameter
 *       • logDecision (all params, minimal params)
 *       • logEvent (with and without custom eventType)
 *       • getSnapshot fields (activeSessions, sessions array, boundEntity)
 *
 * All tests use a real in-process coordinator with no ecosystem backend (no network).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionCoordinator } from '../src/coordinator.js';

function makeCoord(): SessionCoordinator {
  const dlq = `/tmp/ch1tty-rr-${process.pid}-${Date.now()}.dlq`;
  return new SessionCoordinator({}, {}, dlq);
}

// ---------------------------------------------------------------------------
// onToolCall edge cases
// ---------------------------------------------------------------------------

test('onToolCall: tool with no slash → no serverAffinity entry, but toolPattern recorded', async () => {
  const coord = makeCoord();
  const sid = 'rr-no-slash';
  await coord.onSessionStart(sid, 'stdio');
  await Promise.resolve(); // let background stageSession microtask complete

  coord.onToolCall(sid, 'bare-tool-no-slash');

  // sep < 0 → skip serverAffinity update
  assert.equal(coord.getServerAffinity(sid).size, 0, 'no affinity when tool has no slash');

  // toolPattern IS still recorded
  const patterns = coord.getToolPatterns(sid);
  assert.equal(patterns.length, 1, 'one pattern recorded');
  assert.equal(patterns[0].tool, 'bare-tool-no-slash');
  assert.equal(patterns[0].count, 1);
});

test('onToolCall: repeated calls with same tool increment count and update lastUsed', async () => {
  const coord = makeCoord();
  const sid = 'rr-repeat';
  await coord.onSessionStart(sid, 'stdio');

  const t0 = Date.now();
  coord.onToolCall(sid, 'neon/run_sql');
  coord.onToolCall(sid, 'neon/run_sql');
  coord.onToolCall(sid, 'neon/run_sql');

  const patterns = coord.getToolPatterns(sid);
  assert.equal(patterns.length, 1, 'only one distinct tool');
  assert.equal(patterns[0].tool, 'neon/run_sql');
  assert.equal(patterns[0].count, 3, 'count = 3 after 3 calls');
  assert.ok(patterns[0].lastUsed >= t0, 'lastUsed updated');
});

test('onToolCall: multiple tools → getToolPatterns sorted by count descending', async () => {
  const coord = makeCoord();
  const sid = 'rr-multi-sort';
  await coord.onSessionStart(sid, 'stdio');

  coord.onToolCall(sid, 'github/search_code'); // count=1
  coord.onToolCall(sid, 'neon/run_sql');        // count=3
  coord.onToolCall(sid, 'neon/run_sql');
  coord.onToolCall(sid, 'neon/run_sql');
  coord.onToolCall(sid, 'tasks/list_tasks');    // count=2
  coord.onToolCall(sid, 'tasks/list_tasks');

  const patterns = coord.getToolPatterns(sid);
  assert.equal(patterns[0].tool, 'neon/run_sql', 'highest count first');
  assert.equal(patterns[0].count, 3);
  assert.equal(patterns[1].tool, 'tasks/list_tasks');
  assert.equal(patterns[1].count, 2);
  assert.equal(patterns[2].tool, 'github/search_code', 'lowest count last');
  assert.equal(patterns[2].count, 1);
});

test('onToolCall: getToolPatterns limit parameter is enforced', async () => {
  const coord = makeCoord();
  const sid = 'rr-limit';
  await coord.onSessionStart(sid, 'stdio');

  for (let i = 0; i < 5; i++) {
    coord.onToolCall(sid, `srv${i}/tool${i}`);
  }

  const patterns = coord.getToolPatterns(sid, 3);
  assert.equal(patterns.length, 3, 'limit=3 caps the result');
});

test('onToolCall: unknown sessionId is a safe no-op', () => {
  const coord = makeCoord();
  // No onSessionStart → ctx is undefined → onToolCall should return immediately
  assert.doesNotThrow(() => coord.onToolCall('ghost', 'neon/run_sql'));
  assert.equal(coord.getServerAffinity('ghost').size, 0);
  assert.deepEqual(coord.getToolPatterns('ghost'), []);
});

// ---------------------------------------------------------------------------
// logDecision
// ---------------------------------------------------------------------------

test('logDecision: full params → entry buffered in ledger', async () => {
  const coord = makeCoord();
  const sid = 'rr-decision-full';
  await coord.onSessionStart(sid, 'stdio');

  const before = coord.ledger.getStats().buffered;
  coord.logDecision(sid, 'use embedding brain', 'faster than ollama', 'routing');
  const after = coord.ledger.getStats().buffered;

  assert.ok(after > before, 'logDecision must buffer at least one ledger entry');
});

test('logDecision: minimal params (no reasoning or topic) → no throw, entry buffered', async () => {
  const coord = makeCoord();
  const sid = 'rr-decision-minimal';
  await coord.onSessionStart(sid, 'stdio');

  const before = coord.ledger.getStats().buffered;
  assert.doesNotThrow(() => coord.logDecision(sid, 'skip staging'));
  const after = coord.ledger.getStats().buffered;
  assert.ok(after > before, 'minimal logDecision still buffers entry');
});

test('logDecision: unknown sessionId buffers entry with undefined entityId (no throw)', () => {
  // recordToLedger is called even when ctx is undefined — ledger handles null entityId gracefully
  const coord = makeCoord();
  const before = coord.ledger.getStats().buffered;
  assert.doesNotThrow(() => coord.logDecision('no-such-session', 'arbitrary decision'));
  const after = coord.ledger.getStats().buffered;
  assert.ok(after > before, 'logDecision for unknown session still records to ledger');
});

// ---------------------------------------------------------------------------
// logEvent
// ---------------------------------------------------------------------------

test('logEvent: custom eventType is used', async () => {
  const coord = makeCoord();
  const sid = 'rr-event-custom';
  await coord.onSessionStart(sid, 'stdio');

  const before = coord.ledger.getStats().buffered;
  coord.logEvent(sid, 'focus switched to finance', 'focus_change', { from: 'ops', to: 'finance' });
  const after = coord.ledger.getStats().buffered;
  assert.ok(after > before, 'logEvent with custom eventType must buffer an entry');
});

test('logEvent: no eventType defaults to "event" (entry still buffered)', async () => {
  const coord = makeCoord();
  const sid = 'rr-event-default';
  await coord.onSessionStart(sid, 'stdio');

  const before = coord.ledger.getStats().buffered;
  coord.logEvent(sid, 'backend came online');
  const after = coord.ledger.getStats().buffered;
  assert.ok(after > before, 'logEvent without eventType must buffer an entry');
});

test('logEvent: metadata spread works without throw', async () => {
  const coord = makeCoord();
  const sid = 'rr-event-meta';
  await coord.onSessionStart(sid, 'stdio');

  assert.doesNotThrow(() =>
    coord.logEvent(sid, 'spawn complete', 'spawn', { server: 'tasks-mcp', pid: 12345, latency_ms: 42 }),
  );
});

// ---------------------------------------------------------------------------
// getSnapshot
// ---------------------------------------------------------------------------

test('getSnapshot: shape correct — activeSessions, sessions array, boundEntity=false without ecosystem', async () => {
  const coord = makeCoord();
  await coord.onSessionStart('snap-s1', 'stdio');
  await coord.onSessionStart('snap-s2', 'http');
  await Promise.resolve();

  coord.onToolCall('snap-s1', 'neon/run_sql');

  const snap = coord.getSnapshot();

  assert.equal(snap.activeSessions, 2, 'two active sessions');
  assert.equal(snap.boundEntity, false, 'no entity — no ecosystem backend bound');
  assert.equal(snap.sessions.length, 2, 'sessions array has two entries');

  const s1 = snap.sessions.find((s) => s.sessionId === 'snap-s1');
  assert.ok(s1, 'snap-s1 present');
  assert.equal(s1!.toolPatterns, 1, 'one tool pattern for snap-s1');

  const s2 = snap.sessions.find((s) => s.sessionId === 'snap-s2');
  assert.ok(s2, 'snap-s2 present');
  assert.equal(s2!.toolPatterns, 0, 'no tool calls for snap-s2');

  assert.ok(typeof snap.ledger === 'object', 'snap.ledger is present');
  assert.ok(typeof snap.brain === 'object', 'snap.brain is present');
  assert.ok(typeof snap.embeddingBrain === 'object', 'snap.embeddingBrain is present');
});

test('getSnapshot: empty coordinator → activeSessions=0, boundEntity=false', () => {
  const coord = makeCoord();
  const snap = coord.getSnapshot();

  assert.equal(snap.activeSessions, 0);
  assert.equal(snap.boundEntity, false);
  assert.deepEqual(snap.sessions, []);
});
