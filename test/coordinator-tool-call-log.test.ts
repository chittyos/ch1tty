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
 *       • logDecision payload — event_type, decision, reasoning, topic
 *       • logEvent payload — custom eventType, default 'event', metadata spread
 *       • getSnapshot fields (activeSessions, sessions array, boundEntity)
 *
 * All tests use a real in-process coordinator with no ecosystem backend (no network).
 * Embedding warmup is disabled ({enabled:false}) so makeCoord() makes no outbound calls.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionCoordinator } from '../src/coordinator.js';
import type {
  Backend,
  BackendStatus,
  ContentItem,
  PromptEntry,
  ResourceEntry,
  ResourceTemplateEntry,
  ServerConfig,
  ToolCallResult,
  ToolEntry,
} from '../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCoord(): SessionCoordinator {
  const dlq = `/tmp/ch1tty-rr-${process.pid}-${Date.now()}.dlq`;
  // { enabled: false } on both configs disables OllamaBrain.warmup() and
  // EmbeddingBrain.warmup() outbound calls — keeps tests network-free even when
  // CH1TTY_USE_OLLAMA_BRAIN=1 or an Ollama/embed server is reachable.
  return new SessionCoordinator({ enabled: false }, { enabled: false }, dlq);
}

/**
 * Minimal Backend that captures every `chitty_ledger_record` call so tests
 * can assert on event_type + metadata without inspecting private ledger state.
 */
class LedgerCapture implements Backend {
  readonly ledgerCalls: Array<Record<string, unknown>> = [];

  async callTool(_sid: string, tool: string, args: Record<string, unknown> = {}): Promise<ToolCallResult> {
    if (tool === 'chitty_ledger_record') this.ledgerCalls.push(args);
    return { content: [{ type: 'text', text: 'null' }] };
  }

  registerServer(_cfg: ServerConfig): void {}
  isRegistered(_id: string): boolean { return true; }
  getStatus(_id: string): BackendStatus { return { connected: true, toolCount: 0, toolCacheAge: null }; }
  async listTools(_id: string): Promise<ToolEntry[]> { return []; }
  async listResources(_id: string): Promise<{ resources: ResourceEntry[]; templates: ResourceTemplateEntry[] }> {
    return { resources: [], templates: [] };
  }
  async readResource(_id: string, _uri: string): Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }> }> {
    return { contents: [] };
  }
  async listPrompts(_id: string): Promise<PromptEntry[]> { return []; }
  async getPrompt(_id: string, _name: string): Promise<{ description?: string; messages: Array<{ role: 'user' | 'assistant'; content: ContentItem }> }> {
    return { messages: [] };
  }
  async shutdown(): Promise<void> {}
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
// logDecision — payload verified via LedgerCapture flush
// ---------------------------------------------------------------------------

test('logDecision: full params — event_type=decision + all metadata fields flushed', async () => {
  const coord = makeCoord();
  const capture = new LedgerCapture();
  const sid = 'rr-decision-full';
  await coord.onSessionStart(sid, 'stdio');

  // Bind stub and drain the session_start entry so subsequent asserts are clean
  coord.ledger.bind(capture, 'ecosystem');
  await coord.ledger.flush();
  const callsBefore = capture.ledgerCalls.length;

  coord.logDecision(sid, 'use embedding brain', 'faster than ollama', 'routing');
  await coord.ledger.flush();

  const newCalls = capture.ledgerCalls.slice(callsBefore);
  const entry = newCalls.find((c) => c['event_type'] === 'decision');
  assert.ok(entry, 'a "decision" entry must be flushed');
  const meta = entry!['metadata'] as Record<string, unknown>;
  assert.equal(meta['decision'], 'use embedding brain');
  assert.equal(meta['reasoning'], 'faster than ollama');
  assert.equal(meta['topic'], 'routing');
});

test('logDecision: minimal params — decision present, no reasoning or topic in metadata', async () => {
  const coord = makeCoord();
  const capture = new LedgerCapture();
  const sid = 'rr-decision-minimal';
  await coord.onSessionStart(sid, 'stdio');

  coord.ledger.bind(capture, 'ecosystem');
  await coord.ledger.flush();
  const callsBefore = capture.ledgerCalls.length;

  coord.logDecision(sid, 'skip staging');
  await coord.ledger.flush();

  const entry = capture.ledgerCalls.slice(callsBefore).find((c) => c['event_type'] === 'decision');
  assert.ok(entry, 'decision entry must be flushed');
  const meta = entry!['metadata'] as Record<string, unknown>;
  assert.equal(meta['decision'], 'skip staging');
  assert.equal(meta['reasoning'], undefined, 'no reasoning key when not passed');
  assert.equal(meta['topic'], undefined, 'no topic key when not passed');
});

test('logDecision: unknown sessionId — entry still flushed with correct decision', async () => {
  // recordToLedger works even when ctx is undefined (entityId is undefined — ledger allows it)
  const coord = makeCoord();
  const capture = new LedgerCapture();
  coord.ledger.bind(capture, 'ecosystem');
  await coord.ledger.flush();
  const callsBefore = capture.ledgerCalls.length;

  coord.logDecision('no-such-session', 'arbitrary decision');
  await coord.ledger.flush();

  const entry = capture.ledgerCalls.slice(callsBefore).find((c) => c['event_type'] === 'decision');
  assert.ok(entry, 'logDecision for unknown session must still flush');
  const meta = entry!['metadata'] as Record<string, unknown>;
  assert.equal(meta['decision'], 'arbitrary decision');
});

// ---------------------------------------------------------------------------
// logEvent — payload verified via LedgerCapture flush
// ---------------------------------------------------------------------------

test('logEvent: custom eventType is used — event_type and metadata verified in flushed entry', async () => {
  const coord = makeCoord();
  const capture = new LedgerCapture();
  const sid = 'rr-event-custom';
  await coord.onSessionStart(sid, 'stdio');

  coord.ledger.bind(capture, 'ecosystem');
  await coord.ledger.flush();
  const callsBefore = capture.ledgerCalls.length;

  coord.logEvent(sid, 'focus switched to finance', 'focus_change', { from: 'ops', to: 'finance' });
  await coord.ledger.flush();

  const entry = capture.ledgerCalls.slice(callsBefore).find((c) => c['event_type'] === 'focus_change');
  assert.ok(entry, '"focus_change" event_type must be used');
  const meta = entry!['metadata'] as Record<string, unknown>;
  assert.equal(meta['action'], 'focus switched to finance');
  assert.equal(meta['from'], 'ops');
  assert.equal(meta['to'], 'finance');
});

test('logEvent: no eventType defaults to "event" — event_type verified in flushed entry', async () => {
  const coord = makeCoord();
  const capture = new LedgerCapture();
  const sid = 'rr-event-default';
  await coord.onSessionStart(sid, 'stdio');

  coord.ledger.bind(capture, 'ecosystem');
  await coord.ledger.flush();
  const callsBefore = capture.ledgerCalls.length;

  coord.logEvent(sid, 'backend came online');
  await coord.ledger.flush();

  const entry = capture.ledgerCalls.slice(callsBefore).find((c) => c['event_type'] === 'event');
  assert.ok(entry, 'default event_type must be "event"');
  const meta = entry!['metadata'] as Record<string, unknown>;
  assert.equal(meta['action'], 'backend came online');
});

test('logEvent: metadata spread — all extra fields present in flushed entry', async () => {
  const coord = makeCoord();
  const capture = new LedgerCapture();
  const sid = 'rr-event-meta';
  await coord.onSessionStart(sid, 'stdio');

  coord.ledger.bind(capture, 'ecosystem');
  await coord.ledger.flush();
  const callsBefore = capture.ledgerCalls.length;

  coord.logEvent(sid, 'spawn complete', 'spawn', { server: 'tasks-mcp', pid: 12345, latency_ms: 42 });
  await coord.ledger.flush();

  const entry = capture.ledgerCalls.slice(callsBefore).find((c) => c['event_type'] === 'spawn');
  assert.ok(entry, '"spawn" entry must be flushed');
  const meta = entry!['metadata'] as Record<string, unknown>;
  assert.equal(meta['server'], 'tasks-mcp');
  assert.equal(meta['pid'], 12345);
  assert.equal(meta['latency_ms'], 42);
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
