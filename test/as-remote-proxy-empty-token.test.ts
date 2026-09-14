/**
 * AS: RemoteProxy — getAuthToken when TokenSource returns empty string.
 *
 * Covers remote-proxy.ts:113-114:
 *   if (!token) throw new Error(`token source returned empty value for key '${key}'`)
 *
 * The defensive guard fires when a custom TokenSource implementation returns
 * a falsy value rather than throwing.  The thrown Error is caught at line 122
 * and re-surfaces as auth_token_unavailable, identical to a CLI failure.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { RemoteProxy } from '../src/remote-proxy.js';
import type { TokenSource } from '../src/remote-proxy.js';

test('remote-proxy.ts:113-114 — getToken returns "" → auth_token_unavailable surfaced', async () => {
  const emptySource: TokenSource = {
    async getToken(_key: string): Promise<string> {
      return '';
    },
  };

  const proxy = new RemoteProxy(emptySource);
  try {
    proxy.registerServer({
      id: 'empty-tok',
      name: 'Empty Token',
      type: 'remote',
      access: 'read',
      category: 'code',
      endpoint: 'http://127.0.0.1:1/mcp',
      authTokenKey: 'some-key',
    });

    const result = await proxy.callTool('empty-tok', 'any_tool', {});

    assert.equal(result.isError, true, 'empty token must surface as isError:true');
    assert.match(
      result.content[0].text,
      /auth_token_unavailable/,
      `must surface auth_token_unavailable; got: ${result.content[0].text}`,
    );
  } finally {
    await proxy.shutdown();
  }
});
