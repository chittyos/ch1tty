import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SessionTracker } from '../src/session.js';

describe('SessionTracker', { concurrency: false }, () => {
  it('getOrCreate creates a new session with correct shape', () => {
    const tracker = new SessionTracker();
    const info = tracker.getOrCreate('s1', 'stdio').toInfo();
    assert.equal(info.id, 's1');
    assert.equal(info.transport, 'stdio');
    assert.equal(info.toolCalls, 0);
    assert.deepEqual(info.recentTools, []);
    assert.equal(tracker.count, 1);
  });

  it('getOrCreate returns the same session on repeated calls', () => {
    const tracker = new SessionTracker();
    const a = tracker.getOrCreate('s1', 'http');
    const b = tracker.getOrCreate('s1', 'http');
    assert.strictEqual(a, b);
    assert.equal(tracker.count, 1);
  });

  it('count reflects number of distinct active sessions', () => {
    const tracker = new SessionTracker();
    tracker.getOrCreate('s1', 'stdio');
    tracker.getOrCreate('s2', 'http');
    tracker.getOrCreate('s3', 'stdio');
    assert.equal(tracker.count, 3);
  });

  it('recordToolCall increments toolCalls and appends recentTools', () => {
    const tracker = new SessionTracker();
    tracker.getOrCreate('s1', 'stdio');
    tracker.recordToolCall('s1', 'ch1tty/search');
    tracker.recordToolCall('s1', 'ch1tty/execute');
    const info = tracker.getOrCreate('s1', 'stdio').toInfo();
    assert.equal(info.toolCalls, 2);
    assert.deepEqual(
      info.recentTools.map((r) => r.tool),
      ['ch1tty/search', 'ch1tty/execute'],
    );
  });

  it('recordToolCall on unknown sessionId is a safe no-op', () => {
    const tracker = new SessionTracker();
    assert.doesNotThrow(() => tracker.recordToolCall('ghost', 'ch1tty/status'));
    assert.equal(tracker.count, 0);
  });

  it('getRecentTools returns tool names for the session', () => {
    const tracker = new SessionTracker();
    tracker.getOrCreate('s1', 'stdio');
    tracker.recordToolCall('s1', 'ch1tty/cast');
    tracker.recordToolCall('s1', 'ch1tty/reload');
    const tools = tracker.getRecentTools('s1');
    assert.deepEqual(tools, ['ch1tty/cast', 'ch1tty/reload']);
  });

  it('getRecentTools returns [] for unknown sessionId', () => {
    const tracker = new SessionTracker();
    assert.deepEqual(tracker.getRecentTools('nobody'), []);
  });

  it('remove deletes the session and decrements count', () => {
    const tracker = new SessionTracker();
    tracker.getOrCreate('s1', 'stdio');
    tracker.getOrCreate('s2', 'http');
    assert.equal(tracker.count, 2);
    tracker.remove('s1');
    assert.equal(tracker.count, 1);
    assert.deepEqual(tracker.getRecentTools('s1'), []);
  });

  it('remove on unknown id is a safe no-op', () => {
    const tracker = new SessionTracker();
    assert.doesNotThrow(() => tracker.remove('ghost'));
    assert.equal(tracker.count, 0);
  });

  it('listSessions returns snapshot of all active sessions', () => {
    const tracker = new SessionTracker();
    tracker.getOrCreate('s1', 'stdio');
    tracker.getOrCreate('s2', 'http');
    tracker.recordToolCall('s1', 'ch1tty/search');
    const list = tracker.listSessions();
    assert.equal(list.length, 2);
    const ids = list.map((s) => s.id).sort();
    assert.deepEqual(ids, ['s1', 's2']);
    const s1 = list.find((s) => s.id === 's1')!;
    assert.equal(s1.toolCalls, 1);
  });

  it('recentTools cap: only last 50 tool calls are kept', () => {
    const tracker = new SessionTracker();
    tracker.getOrCreate('s1', 'stdio');
    for (let i = 0; i < 60; i++) {
      tracker.recordToolCall('s1', `ch1tty/tool-${i}`);
    }
    const info = tracker.getOrCreate('s1', 'stdio').toInfo();
    // toolCalls counts all 60
    assert.equal(info.toolCalls, 60);
    // toInfo() returns last 10 of the capped 50
    assert.equal(info.recentTools.length, 10);
    assert.equal(info.recentTools[0].tool, 'ch1tty/tool-50');
    assert.equal(info.recentTools[9].tool, 'ch1tty/tool-59');
  });
});
