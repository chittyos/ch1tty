/**
 * CY batch — isConnectionError outer `return false` (line 82 of remote-proxy.ts)
 *
 * The `isConnectionError` function in src-stdio/remote-proxy.ts has this structure:
 *
 *   function isConnectionError(err: unknown): boolean {
 *     if (err instanceof Error) {
 *       if (err.message.includes('timed out after')) return true;
 *       if (err.message.includes('fetch failed')) return true;
 *       if (err.message.startsWith('auth_token_unavailable')) return true;
 *       if (err.message.includes('Streamable HTTP error:')) return true;
 *       if ('code' in err && typeof (err as { code?: unknown }).code === 'number') {
 *         return (err as { code: number }).code === -32000;
 *       }
 *       // Falls here when 'code' is absent OR code is not a number
 *     }
 *     return false;  // ← line 82 — previously uncovered
 *   }
 *
 * Trigger: register a server with an invalid endpoint so doConnect() calls
 * `new URL('not-a-valid-url')`, which throws `TypeError: Invalid URL`.
 * In Node.js, this TypeError carries `err.code = 'ERR_INVALID_URL'` (a string).
 *
 * Path through isConnectionError:
 *   `err instanceof Error`                          → true (TypeError extends Error)
 *   `err.message.includes('timed out after')`       → false
 *   `err.message.includes('fetch failed')`          → false
 *   `err.message.startsWith('auth_token_unavail…')` → false
 *   `err.message.includes('Streamable HTTP error:')` → false
 *   `'code' in err`                                 → true ('ERR_INVALID_URL' is present)
 *   `typeof code === 'number'`                      → false (code is a string)
 *   entire `if ('code' in err && …)` condition      → false → skip inner block
 *   fall through to                                 → `return false` at line 82
 *
 * When isConnectionError returns false, the `else` branch of each catch block calls
 * `breaker.recordSuccess` (NOT recordFailure). The default CircuitBreaker threshold in
 * RemoteProxy is 5 failures before the circuit opens. We call each method OVER_THRESHOLD
 * (6) times: if recordFailure were called instead, the circuit would open after 5 calls
 * and the 6th would return a "circuit open" response. Since recordSuccess is called each
 * time, the circuit stays healthy and all calls return the actual error text.
 *
 * Covered lines (remote-proxy.ts):
 *   82   isConnectionError: `return false` via non-numeric-code fallthrough
 *   273–282  listTools catch else → breaker.recordSuccess (circuit stays healthy)
 *   310–316  callTool catch else → breaker.recordSuccess (circuit stays healthy)
 *   434–443  listPrompts catch else → breaker.recordSuccess (circuit stays healthy)
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { RemoteProxy } from '../src/remote-proxy.js';

// Default CircuitBreaker threshold inside RemoteProxy is 5 failures.
// Calling OVER_THRESHOLD times ensures the circuit would be open if recordFailure
// had been called, but stays healthy if recordSuccess was called (line 82 path).
const OVER_THRESHOLD = 6;

// ---------------------------------------------------------------------------
// Test 1 — callTool: TypeError.code='ERR_INVALID_URL' (string) → line 82 → recordSuccess
// ---------------------------------------------------------------------------

test(
  'callTool: TypeError Invalid URL (string code) → isConnectionError returns false (line 82) → circuit stays healthy across ' + OVER_THRESHOLD + ' calls',
  async () => {
    const proxy = new RemoteProxy();
    proxy.registerServer({
      id: 'cy-ct',
      name: 'CY-callTool',
      type: 'remote',
      access: 'read',
      category: 'storage',
      endpoint: 'not-a-valid-url',
    });
    try {
      for (let i = 0; i < OVER_THRESHOLD; i++) {
        const result = await proxy.callTool('cy-ct', 'any_tool', {});
        assert.equal(result.isError, true, `call ${i + 1}: isError must be true`);
        const text = result.content[0].text as string;
        assert.match(
          text,
          /Remote call error/,
          `call ${i + 1}: expected "Remote call error" (line 82 path), got: ${text}`,
        );
        assert.ok(
          !text.includes('circuit open'),
          `call ${i + 1}: circuit must NOT be open — line 82 returns false → recordSuccess, not recordFailure: ${text}`,
        );
      }
    } finally {
      await proxy.shutdown();
    }
  },
);

// ---------------------------------------------------------------------------
// Test 2 — listTools: TypeError.code='ERR_INVALID_URL' (string) → line 82 → recordSuccess
// ---------------------------------------------------------------------------

test(
  'listTools: TypeError Invalid URL (string code) → isConnectionError returns false (line 82) → circuit stays healthy across ' + OVER_THRESHOLD + ' calls',
  async () => {
    const proxy = new RemoteProxy();
    proxy.registerServer({
      id: 'cy-lt',
      name: 'CY-listTools',
      type: 'remote',
      access: 'read',
      category: 'storage',
      endpoint: 'not-a-valid-url',
    });
    try {
      for (let i = 0; i < OVER_THRESHOLD; i++) {
        const tools = await proxy.listTools('cy-lt');
        assert.deepEqual(tools, [], `call ${i + 1}: listTools must return [] on connection error`);
      }
      // After OVER_THRESHOLD failed listTools calls, verify the circuit is still healthy:
      // if recordFailure had been called, the circuit would be open and callTool would
      // return "circuit open"; since recordSuccess was called (line 82 path), it still attempts.
      const result = await proxy.callTool('cy-lt', 'any_tool', {});
      assert.equal(result.isError, true);
      const text = result.content[0].text as string;
      assert.match(text, /Remote call error/, `circuit must still be healthy after listTools failures: ${text}`);
      assert.ok(!text.includes('circuit open'), `circuit must NOT be open after recordSuccess calls: ${text}`);
    } finally {
      await proxy.shutdown();
    }
  },
);

// ---------------------------------------------------------------------------
// Test 3 — listPrompts: TypeError.code='ERR_INVALID_URL' (string) → line 82 → recordSuccess
// ---------------------------------------------------------------------------

test(
  'listPrompts: TypeError Invalid URL (string code) → isConnectionError returns false (line 82) → circuit stays healthy across ' + OVER_THRESHOLD + ' calls',
  async () => {
    const proxy = new RemoteProxy();
    proxy.registerServer({
      id: 'cy-lp',
      name: 'CY-listPrompts',
      type: 'remote',
      access: 'read',
      category: 'storage',
      endpoint: 'not-a-valid-url',
    });
    try {
      for (let i = 0; i < OVER_THRESHOLD; i++) {
        const prompts = await proxy.listPrompts('cy-lp');
        assert.deepEqual(prompts, [], `call ${i + 1}: listPrompts must return [] on connection error`);
      }
      // Same circuit-health verification as Test 2.
      const result = await proxy.callTool('cy-lp', 'any_tool', {});
      assert.equal(result.isError, true);
      const text = result.content[0].text as string;
      assert.match(text, /Remote call error/, `circuit must still be healthy after listPrompts failures: ${text}`);
      assert.ok(!text.includes('circuit open'), `circuit must NOT be open after recordSuccess calls: ${text}`);
    } finally {
      await proxy.shutdown();
    }
  },
);
