/**
 * Workstream BN: branch-coverage gaps in FileDlqStore.readEntries()
 * (src-stdio/ledger.ts lines 66-71).
 *
 * The happy path (valid JSON objects) is covered by ar-aggregator-ledger-logger-gaps.test.ts.
 * These four branches remain uncovered:
 *
 *   1. Inner catch (line 70)   — malformed JSON line is silently skipped.
 *   2. v === null (line 69)    — JSON literal `null` is not an object; skipped.
 *   3. typeof v !== 'object'   — JSON primitive (string/number/boolean); skipped.
 *   4. Array.isArray(v)        — JSON array; skipped.
 *
 * Strategy: write a temp JSONL file that mixes all four non-object line types with
 * one valid object entry, then assert readEntries() returns only the valid object.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';

import { FileDlqStore } from '../src-stdio/ledger.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'bn-dlq-test-'));
}

test('BN-1: FileDlqStore.readEntries — malformed JSON line is skipped (inner catch)', () => {
  const dir = makeTempDir();
  try {
    const dlqPath = join(dir, 'dlq.jsonl');
    // One malformed line, one valid object
    writeFileSync(dlqPath, 'not-json!!!\n{"event_type":"tool_call"}\n', 'utf8');
    const store = new FileDlqStore(dlqPath);
    const result = store.readEntries();
    assert.equal(result.length, 1, 'only the valid object should be returned');
    assert.deepEqual((result[0] as Record<string, unknown>)['event_type'], 'tool_call');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('BN-2: FileDlqStore.readEntries — JSON null line is skipped (v === null branch)', () => {
  const dir = makeTempDir();
  try {
    const dlqPath = join(dir, 'dlq.jsonl');
    // JSON null is valid JSON but not an object
    writeFileSync(dlqPath, 'null\n{"event_type":"tool_call"}\n', 'utf8');
    const store = new FileDlqStore(dlqPath);
    const result = store.readEntries();
    assert.equal(result.length, 1, 'null JSON value must be skipped');
    assert.deepEqual((result[0] as Record<string, unknown>)['event_type'], 'tool_call');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('BN-3: FileDlqStore.readEntries — JSON primitives (string/number/boolean) are skipped', () => {
  const dir = makeTempDir();
  try {
    const dlqPath = join(dir, 'dlq.jsonl');
    // Three JSON primitives + one valid object
    writeFileSync(
      dlqPath,
      '"a string"\n42\ntrue\n{"event_type":"tool_call"}\n',
      'utf8',
    );
    const store = new FileDlqStore(dlqPath);
    const result = store.readEntries();
    assert.equal(result.length, 1, 'string/number/boolean JSON values must be skipped');
    assert.deepEqual((result[0] as Record<string, unknown>)['event_type'], 'tool_call');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('BN-4: FileDlqStore.readEntries — JSON array lines are skipped (Array.isArray branch)', () => {
  const dir = makeTempDir();
  try {
    const dlqPath = join(dir, 'dlq.jsonl');
    // JSON array is typeof 'object' but Array.isArray → skipped
    writeFileSync(dlqPath, '[1,2,3]\n{"event_type":"tool_call"}\n', 'utf8');
    const store = new FileDlqStore(dlqPath);
    const result = store.readEntries();
    assert.equal(result.length, 1, 'JSON array lines must be skipped');
    assert.deepEqual((result[0] as Record<string, unknown>)['event_type'], 'tool_call');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
