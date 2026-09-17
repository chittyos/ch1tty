/**
 * CN: CircuitBreaker branch gaps — redundant recordSuccess + getState after cooldown expiry
 *
 * Covers two branches in src-stdio/circuit-breaker.ts not reached by circuit-breaker.test.ts:
 *
 *   1. recordSuccess (line ~42): `if (state && (state.failures > 0 || state.openUntil > 0))`
 *      evaluating FALSE when state EXISTS but is already recovered (failures===0,
 *      openUntil===0).  A redundant success call after recovery must be a no-op:
 *      no log, no mutation, no throw.
 *
 *   2. getState (line ~71-72): `open = state.openUntil > 0 && Date.now() < state.openUntil`
 *      evaluating FALSE because the cooldown has expired (openUntil > 0 but
 *      Date.now() >= openUntil).  The server entry still exists in the map but
 *      the breaker is effectively half-open; getState must return open=false and
 *      cooldownRemaining=0 in this state.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker } from '../src/circuit-breaker.js';

describe('CircuitBreaker branch gaps (CN)', { concurrency: false }, () => {
  // ── Branch 1: redundant recordSuccess on already-recovered state ─────────────
  //
  // After recordFailure + recordSuccess the state entry is kept in the map but
  // has failures=0 and openUntil=0.  A second recordSuccess must not mutate state
  // or throw — the if(state && ...) condition is false.

  it('recordSuccess on already-recovered state (failures=0, openUntil=0) is a safe no-op', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 60_000 });

    // Drive to open then close (first recordSuccess).
    cb.recordFailure('srv');
    cb.recordFailure('srv');
    assert.equal(cb.isAllowed('srv'), false, 'breaker should be open after threshold');
    cb.recordSuccess('srv');
    assert.equal(cb.isAllowed('srv'), true, 'breaker should be closed after recordSuccess');

    const s1 = cb.getState('srv');
    assert.equal(s1.failures, 0, 'failures must be 0 after recovery');
    assert.equal(s1.open, false, 'breaker must be closed after recovery');

    // Redundant second recordSuccess: state exists but failures=0, openUntil=0.
    // The if(state && (state.failures > 0 || state.openUntil > 0)) block must be skipped.
    assert.doesNotThrow(() => cb.recordSuccess('srv'), 'redundant recordSuccess must not throw');

    // State must remain unchanged.
    const s2 = cb.getState('srv');
    assert.equal(s2.failures, 0, 'failures must still be 0 after redundant recordSuccess');
    assert.equal(s2.open, false, 'breaker must still be closed');
    assert.equal(s2.cooldownRemaining, 0, 'cooldownRemaining must still be 0');
    assert.equal(cb.isAllowed('srv'), true, 'isAllowed must still be true');
  });

  // ── Branch 2: getState after cooldown expiry ─────────────────────────────────
  //
  // When openUntil > 0 but Date.now() >= openUntil, open is computed as false
  // (cooldown expired).  cooldownRemaining is 0 via the ternary: `open ? ... : 0`.
  // The state entry still exists in the map with openUntil > 0, but the time
  // condition makes the half-open gate pass.

  it('getState with expired cooldown returns open=false and cooldownRemaining=0', () => {
    // Use a Date.now mock so the test is deterministic on slow or preempted runners.
    const FIXED_START = 1_000_000;
    const COOLDOWN_MS = 100;
    let mockNow = FIXED_START;
    const origDateNow = Date.now;
    Date.now = () => mockNow;
    try {
      const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: COOLDOWN_MS });

      cb.recordFailure('srv');
      cb.recordFailure('srv');
      // openUntil is now FIXED_START + COOLDOWN_MS; Date.now() is still FIXED_START.

      // Immediately after tripping: breaker is open.
      const sOpen = cb.getState('srv');
      assert.equal(sOpen.open, true, 'breaker should be open immediately after tripping');
      assert.ok(sOpen.cooldownRemaining > 0, 'cooldownRemaining should be positive while open');

      // Advance mock time past cooldown — no wall-clock delay needed.
      mockNow = FIXED_START + COOLDOWN_MS + 1;

      // getState AFTER expiry: openUntil is still > 0 in the map, but
      // Date.now() >= openUntil → open computed as false, cooldownRemaining = 0.
      const sExpired = cb.getState('srv');
      assert.equal(sExpired.failures, 2, 'failures must still be 2 (not reset by cooldown expiry)');
      assert.equal(sExpired.open, false, 'open must be false once cooldown expires');
      assert.equal(sExpired.cooldownRemaining, 0, 'cooldownRemaining must be 0 once cooldown expires');

      // isAllowed should also be true (half-open probe allowed).
      assert.equal(cb.isAllowed('srv'), true, 'half-open probe must be allowed after cooldown');
    } finally {
      Date.now = origDateNow;
    }
  });
});
