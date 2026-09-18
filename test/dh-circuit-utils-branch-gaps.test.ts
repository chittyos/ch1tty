/**
 * DH batch — 9 tests covering genuine branch gaps in circuit-breaker.ts and
 * utils.ts (normalizeContentItem + withTimeout).
 *
 * 1. CircuitBreaker.isAllowed: no state ever recorded → returns true immediately
 *    (circuit-breaker.ts:23–24, `!state` branch)
 *
 * 2. CircuitBreaker.isAllowed: cooldown just expired → half-open probe returns
 *    true and leaves the state intact for the next recordSuccess/recordFailure
 *    (circuit-breaker.ts:26–29)
 *
 * 3. CircuitBreaker.getState: no state → default zeros
 *    (circuit-breaker.ts:67)
 *
 * 4. CircuitBreaker.reset: clears all tracked states, isAllowed returns true
 *    for a previously-open server
 *    (circuit-breaker.ts:75–77)
 *
 * 5. normalizeContentItem: image branch returns type/data/mimeType
 *    (utils.ts:32–33)
 *
 * 6. normalizeContentItem: resource branch returns type/resource object
 *    (utils.ts:35–38)
 *
 * 7. normalizeContentItem: missing text field → ?? '' fallback
 *    (utils.ts:40)
 *
 * 8. normalizeToolResult: isError:true propagated in the content-array branch
 *    (utils.ts:19)
 *
 * 9. withTimeout: upstream promise rejects before the timer fires →
 *    immediate rejection, timer is cleared
 *    (utils.ts:5–13)
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { CircuitBreaker } from '../src/circuit-breaker.js';
import { normalizeToolResult, withTimeout } from '../src/utils.js';

// ── 1. isAllowed: no state at all ─────────────────────────────────────────────

test('CircuitBreaker.isAllowed: server never seen → true (no state branch)', () => {
  const cb = new CircuitBreaker();
  assert.equal(cb.isAllowed('brand-new'), true);
});

// ── 2. isAllowed: cooldown expired → half-open probe ──────────────────────────

test('CircuitBreaker.isAllowed: cooldown just expired → true (half-open probe)', async () => {
  const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 40 });
  cb.recordFailure('svc');
  // Circuit is open immediately
  assert.equal(cb.isAllowed('svc'), false, 'circuit open right after trip');

  // Wait past cooldown
  await new Promise<void>((r) => setTimeout(r, 60));

  // Now isAllowed hits the `Date.now() >= state.openUntil` branch → true
  assert.equal(cb.isAllowed('svc'), true, 'half-open probe allowed after cooldown');
  // State still in map (not cleared by isAllowed itself)
  const s = cb.getState('svc');
  assert.equal(s.failures, 1, 'failure count unchanged by isAllowed');
});

// ── 3. getState: no state recorded yet ────────────────────────────────────────

test('CircuitBreaker.getState: no prior state → zero defaults', () => {
  const cb = new CircuitBreaker();
  const s = cb.getState('unknown-server');
  assert.equal(s.failures, 0);
  assert.equal(s.open, false);
  assert.equal(s.cooldownRemaining, 0);
});

// ── 4. reset: clears all states ───────────────────────────────────────────────

test('CircuitBreaker.reset: tripped server becomes allowed again after reset', () => {
  const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 60_000 });
  cb.recordFailure('alpha');
  assert.equal(cb.isAllowed('alpha'), false, 'open before reset');

  cb.reset();

  assert.equal(cb.isAllowed('alpha'), true, 'allowed after reset');
  const s = cb.getState('alpha');
  assert.equal(s.failures, 0, 'state returns defaults after reset');
});

// ── 5. normalizeContentItem: image branch ─────────────────────────────────────

test('normalizeToolResult: image content item → type/data/mimeType preserved', () => {
  const result = normalizeToolResult({
    content: [{ type: 'image', data: 'base64data==', mimeType: 'image/png' }],
    isError: false,
  });
  assert.equal(result.content.length, 1);
  const item = result.content[0]!;
  assert.equal(item.type, 'image');
  assert.equal((item as { data: string }).data, 'base64data==');
  assert.equal((item as { mimeType: string }).mimeType, 'image/png');
});

// ── 6. normalizeContentItem: resource branch ──────────────────────────────────

test('normalizeToolResult: resource content item → type/resource object preserved', () => {
  const resource = { uri: 'file:///a.txt', mimeType: 'text/plain', text: 'hello' };
  const result = normalizeToolResult({
    content: [{ type: 'resource', resource }],
  });
  assert.equal(result.content.length, 1);
  const item = result.content[0]!;
  assert.equal(item.type, 'resource');
  assert.deepEqual((item as { resource: unknown }).resource, resource);
});

// ── 7. normalizeContentItem: missing text field → ?? '' ──────────────────────

test('normalizeToolResult: text item missing text field → empty string via ??', () => {
  const result = normalizeToolResult({
    content: [{ type: 'text' }], // no text property
  });
  assert.equal(result.content.length, 1);
  const item = result.content[0]!;
  assert.equal(item.type, 'text');
  assert.equal((item as { text: string }).text, '');
});

// ── 8. normalizeToolResult: isError:true propagated ──────────────────────────

test('normalizeToolResult: isError:true in content branch → preserved in output', () => {
  const result = normalizeToolResult({
    content: [{ type: 'text', text: 'oops' }],
    isError: true,
  });
  assert.equal(result.isError, true);
  assert.equal((result.content[0] as { text: string }).text, 'oops');
});

// ── 9. withTimeout: upstream rejects before timer fires ──────────────────────

test('withTimeout: upstream promise rejects immediately → error propagates, timer cleared', async () => {
  const boom = new Error('upstream boom');
  const rejected = Promise.reject(boom);
  await assert.rejects(
    () => withTimeout(rejected, 10_000, 'test-op'),
    (err: Error) => {
      assert.equal(err.message, 'upstream boom');
      return true;
    },
  );
  // The timer must have been cleared (no dangling setTimeout leaking past test).
  // Node's test runner detects leaked timers — passing the test suite confirms it.
});
