import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker } from '../src/circuit-breaker.js';

describe('CircuitBreaker', { concurrency: false }, () => {
  it('allows calls for unknown server (no state)', () => {
    const cb = new CircuitBreaker();
    assert.equal(cb.isAllowed('srv-a'), true);
  });

  it('allows calls while failures are below threshold', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 60_000 });
    cb.recordFailure('srv');
    cb.recordFailure('srv');
    assert.equal(cb.isAllowed('srv'), true);
    const s = cb.getState('srv');
    assert.equal(s.failures, 2);
    assert.equal(s.open, false);
  });

  it('trips open at threshold and blocks calls', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 60_000 });
    cb.recordFailure('srv');
    cb.recordFailure('srv');
    cb.recordFailure('srv');
    assert.equal(cb.isAllowed('srv'), false);
    const s = cb.getState('srv');
    assert.equal(s.open, true);
    assert.ok(s.cooldownRemaining > 0);
  });

  it('allows half-open probe after cooldown expires', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 10 });
    cb.recordFailure('srv');
    cb.recordFailure('srv');
    assert.equal(cb.isAllowed('srv'), false);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(cb.isAllowed('srv'), true);
  });

  it('recordSuccess resets failures and closes circuit', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 60_000 });
    cb.recordFailure('srv');
    cb.recordFailure('srv');
    assert.equal(cb.isAllowed('srv'), false);
    cb.recordSuccess('srv');
    assert.equal(cb.isAllowed('srv'), true);
    const s = cb.getState('srv');
    assert.equal(s.failures, 0);
    assert.equal(s.open, false);
    assert.equal(s.cooldownRemaining, 0);
  });

  it('recordSuccess on non-existent server is a safe no-op', () => {
    const cb = new CircuitBreaker();
    assert.doesNotThrow(() => cb.recordSuccess('never-seen'));
    assert.equal(cb.isAllowed('never-seen'), true);
  });

  it('getState on unknown server returns closed defaults', () => {
    const cb = new CircuitBreaker();
    const s = cb.getState('ghost');
    assert.deepEqual(s, { failures: 0, open: false, cooldownRemaining: 0 });
  });

  it('reset clears all breaker state across servers', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 60_000 });
    cb.recordFailure('a');
    cb.recordFailure('a');
    cb.recordFailure('b');
    assert.equal(cb.isAllowed('a'), false);
    cb.reset();
    assert.equal(cb.isAllowed('a'), true);
    assert.equal(cb.getState('a').failures, 0);
    assert.equal(cb.getState('b').failures, 0);
  });

  it('independent circuits for different servers', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 60_000 });
    cb.recordFailure('bad');
    cb.recordFailure('bad');
    assert.equal(cb.isAllowed('bad'), false);
    assert.equal(cb.isAllowed('good'), true);
  });

  it('failures above threshold keep circuit open and increment count', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 60_000 });
    cb.recordFailure('srv');
    cb.recordFailure('srv');
    cb.recordFailure('srv'); // one more after trip
    const s = cb.getState('srv');
    assert.equal(s.failures, 3);
    assert.equal(s.open, true);
    assert.equal(cb.isAllowed('srv'), false);
  });
});
