/**
 * CV: Direct branch coverage for resolveChittySecret's two post-OK error paths.
 *
 * Both branches (json.error truthy, !json.value truthy) are reachable only when
 * the HTTP response is 200 OK but the payload signals an application-level error.
 * The existing resolveEnv tests cover these paths indirectly via Promise.allSettled
 * (which swallows the throw). These tests call resolveChittySecret directly so V8
 * marks the throw statements as executed.
 */

import assert from 'node:assert/strict';
import { before, after, beforeEach, afterEach, describe, test } from 'node:test';
import { ChildManager } from '../src/child-manager.js';

describe('resolveChittySecret — json.error and !json.value direct branch coverage', { concurrency: false }, () => {
  let savedFetch: typeof globalThis.fetch;
  let savedClientId: string | undefined;
  let savedClientSecret: string | undefined;
  let cm: ChildManager;

  before(() => {
    savedFetch = globalThis.fetch;
    savedClientId = process.env.CF_ACCESS_CLIENT_ID;
    savedClientSecret = process.env.CF_ACCESS_CLIENT_SECRET;
  });

  after(() => {
    globalThis.fetch = savedFetch;
    if (savedClientId === undefined) delete process.env.CF_ACCESS_CLIENT_ID;
    else process.env.CF_ACCESS_CLIENT_ID = savedClientId;
    if (savedClientSecret === undefined) delete process.env.CF_ACCESS_CLIENT_SECRET;
    else process.env.CF_ACCESS_CLIENT_SECRET = savedClientSecret;
  });

  beforeEach(() => {
    cm = new ChildManager();
    process.env.CF_ACCESS_CLIENT_ID = 'test-client-id';
    process.env.CF_ACCESS_CLIENT_SECRET = 'test-client-secret';
  });

  afterEach(() => {
    globalThis.fetch = savedFetch;
  });

  test('json.error truthy in 200 response — throws ChittySecrets error', async () => {
    globalThis.fetch = async (_url: any, _init: any) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ error: 'secret not found' }),
    }) as unknown as Response;

    await assert.rejects(
      () => (cm as any).resolveChittySecret('my-secret'),
      (err: Error) => {
        assert.ok(err.message.includes('ChittySecrets error:'), `expected "ChittySecrets error:" in: ${err.message}`);
        assert.ok(err.message.includes('secret not found'), `expected "secret not found" in: ${err.message}`);
        return true;
      },
    );
  });

  test('!json.value (empty string) in 200 response — throws empty value error', async () => {
    globalThis.fetch = async (_url: any, _init: any) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ value: '' }),
    }) as unknown as Response;

    await assert.rejects(
      () => (cm as any).resolveChittySecret('my-secret'),
      (err: Error) => {
        assert.ok(err.message.includes('ChittySecrets returned empty value'), `expected "ChittySecrets returned empty value" in: ${err.message}`);
        assert.ok(err.message.includes('my-secret'), `expected secret name in: ${err.message}`);
        return true;
      },
    );
  });
});
