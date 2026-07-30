/**
 * Tests for ChittySecrets resolution in ChildManager.resolveEnv.
 *
 * Covers the `chittysecrets://` and `secrets://` URI schemes added in
 * "feat: resolve and inject chittysecrets references in child manager".
 * Tests the private resolveEnv method via (cm as any) — TypeScript `private`
 * is a compile-time-only constraint.
 */
import assert from 'node:assert/strict';
import { before, after, beforeEach, afterEach, describe, test } from 'node:test';
import { ChildManager } from '../src/child-manager.js';
import type { LocalServerConfig } from '../src/types.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const BASE_CONFIG: LocalServerConfig = {
  id: 'test-server',
  name: 'Test Server',
  type: 'local',
  access: 'readwrite',
  category: 'code',
  command: 'node',
};

function makeConfig(env: Record<string, string>): LocalServerConfig {
  return { ...BASE_CONFIG, env };
}

function mockFetchOk(value: string): typeof fetch {
  return async (_url, _init) => {
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ value }),
    } as unknown as Response;
  };
}

function mockFetchHttpError(status: number, body?: object): typeof fetch {
  return async (_url, _init) => {
    return {
      ok: false,
      status,
      statusText: 'Error',
      json: async () => body ?? {},
    } as unknown as Response;
  };
}

function mockFetchJsonError(errorMsg: string): typeof fetch {
  return async (_url, _init) => {
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ error: errorMsg }),
    } as unknown as Response;
  };
}

function mockFetchEmptyValue(): typeof fetch {
  return async (_url, _init) => {
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ value: '' }),
    } as unknown as Response;
  };
}

// ── Test suite ─────────────────────────────────────────────────────────────────

describe('ChildManager — chittysecrets URI resolution', { concurrency: false }, () => {
  let savedFetch: typeof globalThis.fetch;
  let savedClientId: string | undefined;
  let savedClientSecret: string | undefined;
  let savedSecretsUrl: string | undefined;
  let cm: ChildManager;

  before(() => {
    savedFetch = globalThis.fetch;
    savedClientId = process.env.CF_ACCESS_CLIENT_ID;
    savedClientSecret = process.env.CF_ACCESS_CLIENT_SECRET;
    savedSecretsUrl = process.env.CHITTYSECRETS_URL;
  });

  after(() => {
    globalThis.fetch = savedFetch;
    if (savedClientId === undefined) delete process.env.CF_ACCESS_CLIENT_ID;
    else process.env.CF_ACCESS_CLIENT_ID = savedClientId;
    if (savedClientSecret === undefined) delete process.env.CF_ACCESS_CLIENT_SECRET;
    else process.env.CF_ACCESS_CLIENT_SECRET = savedClientSecret;
    if (savedSecretsUrl === undefined) delete process.env.CHITTYSECRETS_URL;
    else process.env.CHITTYSECRETS_URL = savedSecretsUrl;
  });

  beforeEach(() => {
    cm = new ChildManager();
    // Provide CF Access credentials so the happy path doesn't throw
    process.env.CF_ACCESS_CLIENT_ID = 'test-client-id';
    process.env.CF_ACCESS_CLIENT_SECRET = 'test-client-secret';
    delete process.env.CHITTYSECRETS_URL;
  });

  afterEach(() => {
    globalThis.fetch = savedFetch;
  });

  // ── resolveChittySecret happy path ──────────────────────────────────────────

  test('chittysecrets:// scheme — resolves secret value into env', async () => {
    globalThis.fetch = mockFetchOk('super-secret-value');
    const env = await (cm as any).resolveEnv(makeConfig({ MY_TOKEN: 'chittysecrets://my-token' }));
    assert.equal(env['MY_TOKEN'], 'super-secret-value');
  });

  test('secrets:// scheme — also resolves secret value into env', async () => {
    globalThis.fetch = mockFetchOk('other-secret');
    const env = await (cm as any).resolveEnv(makeConfig({ DB_PASS: 'secrets://db-password' }));
    assert.equal(env['DB_PASS'], 'other-secret');
  });

  test('secret value is trimmed before injection', async () => {
    globalThis.fetch = mockFetchOk('  padded-value  \n');
    const env = await (cm as any).resolveEnv(makeConfig({ KEY: 'chittysecrets://trimmed' }));
    assert.equal(env['KEY'], 'padded-value');
  });

  test('non-secret env values are preserved unchanged', async () => {
    globalThis.fetch = mockFetchOk('resolved');
    const env = await (cm as any).resolveEnv(makeConfig({
      PLAIN: 'plaintext',
      SECRET: 'chittysecrets://some-secret',
    }));
    assert.equal(env['PLAIN'], 'plaintext');
    assert.equal(env['SECRET'], 'resolved');
  });

  test('multiple secrets are all resolved via Promise.allSettled', async () => {
    const values: Record<string, string> = { 'api-key': 'key-val', 'db-pass': 'pass-val' };
    globalThis.fetch = async (_url: any, init: any) => {
      const body = JSON.parse((init as RequestInit).body as string);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ value: values[body.name] }),
      } as unknown as Response;
    };
    const env = await (cm as any).resolveEnv(makeConfig({
      API_KEY: 'chittysecrets://api-key',
      DB_PASS: 'secrets://db-pass',
    }));
    assert.equal(env['API_KEY'], 'key-val');
    assert.equal(env['DB_PASS'], 'pass-val');
  });

  // ── CHITTYSECRETS_URL override ───────────────────────────────────────────────

  test('CHITTYSECRETS_URL env var overrides the default endpoint', async () => {
    process.env.CHITTYSECRETS_URL = 'https://custom-secrets.example.com';
    let capturedUrl = '';
    globalThis.fetch = async (url: any, _init: any) => {
      capturedUrl = String(url);
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ value: 'v' }) } as unknown as Response;
    };
    await (cm as any).resolveEnv(makeConfig({ K: 'chittysecrets://k' }));
    assert.equal(capturedUrl, 'https://custom-secrets.example.com/mcp?action=reveal');
  });

  // ── CF Access credential forwarding ─────────────────────────────────────────

  test('CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET are sent as headers', async () => {
    process.env.CF_ACCESS_CLIENT_ID = 'cid-123';
    process.env.CF_ACCESS_CLIENT_SECRET = 'csec-456';
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = async (_url: any, init: any) => {
      capturedHeaders = (init as RequestInit).headers as Record<string, string>;
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ value: 'v' }) } as unknown as Response;
    };
    await (cm as any).resolveEnv(makeConfig({ K: 'chittysecrets://k' }));
    assert.equal(capturedHeaders['CF-Access-Client-Id'], 'cid-123');
    assert.equal(capturedHeaders['CF-Access-Client-Secret'], 'csec-456');
  });

  test('CHITTY_CF_ACCESS_CLIENT_ID fallback used when CF_ACCESS_CLIENT_ID absent', async () => {
    delete process.env.CF_ACCESS_CLIENT_ID;
    delete process.env.CF_ACCESS_CLIENT_SECRET;
    process.env.CHITTY_CF_ACCESS_CLIENT_ID = 'fallback-id';
    process.env.CHITTY_CF_ACCESS_CLIENT_SECRET = 'fallback-secret';
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = async (_url: any, init: any) => {
      capturedHeaders = (init as RequestInit).headers as Record<string, string>;
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ value: 'v' }) } as unknown as Response;
    };
    try {
      await (cm as any).resolveEnv(makeConfig({ K: 'chittysecrets://k' }));
      assert.equal(capturedHeaders['CF-Access-Client-Id'], 'fallback-id');
      assert.equal(capturedHeaders['CF-Access-Client-Secret'], 'fallback-secret');
    } finally {
      delete process.env.CHITTY_CF_ACCESS_CLIENT_ID;
      delete process.env.CHITTY_CF_ACCESS_CLIENT_SECRET;
    }
  });

  // ── Error paths — secret removed from env on failure (allSettled semantics) ─

  test('missing CF Access credentials — failed secret is removed from env', async () => {
    delete process.env.CF_ACCESS_CLIENT_ID;
    delete process.env.CF_ACCESS_CLIENT_SECRET;
    delete process.env.CHITTY_CF_ACCESS_CLIENT_ID;
    delete process.env.CHITTY_CF_ACCESS_CLIENT_SECRET;
    const env = await (cm as any).resolveEnv(makeConfig({
      PLAIN: 'keep-me',
      SECRET: 'chittysecrets://missing-creds',
    }));
    // Failed secret should be absent; plain value preserved
    assert.equal(env['PLAIN'], 'keep-me');
    assert.ok(!('SECRET' in env), 'Expected failed secret to be removed from env');
  });

  test('HTTP error response — failed secret is removed from env', async () => {
    globalThis.fetch = mockFetchHttpError(403, { error: 'Forbidden', reason: 'no access' });
    const env = await (cm as any).resolveEnv(makeConfig({
      GOOD: 'literal',
      BAD: 'chittysecrets://forbidden-secret',
    }));
    assert.equal(env['GOOD'], 'literal');
    assert.ok(!('BAD' in env), 'Expected HTTP-error secret to be removed from env');
  });

  test('HTTP error with error body detail — failed secret is removed', async () => {
    globalThis.fetch = mockFetchHttpError(500, { error: 'Internal Server Error', reason: 'oops' });
    const env = await (cm as any).resolveEnv(makeConfig({ K: 'chittysecrets://k' }));
    assert.ok(!('K' in env));
  });

  test('JSON error field in 200 response — failed secret is removed from env', async () => {
    globalThis.fetch = mockFetchJsonError('secret not found');
    const env = await (cm as any).resolveEnv(makeConfig({ K: 'chittysecrets://k' }));
    assert.ok(!('K' in env));
  });

  test('empty value in response — failed secret is removed from env', async () => {
    globalThis.fetch = mockFetchEmptyValue();
    const env = await (cm as any).resolveEnv(makeConfig({ K: 'chittysecrets://k' }));
    assert.ok(!('K' in env));
  });

  test('one secret fails, other succeeds — partial resolution', async () => {
    const values: Record<string, string> = { 'good-key': 'secret-val' };
    globalThis.fetch = async (_url: any, init: any) => {
      const body = JSON.parse((init as RequestInit).body as string);
      if (body.name === 'good-key') {
        return { ok: true, status: 200, statusText: 'OK', json: async () => ({ value: values['good-key'] }) } as unknown as Response;
      }
      return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) } as unknown as Response;
    };
    const env = await (cm as any).resolveEnv(makeConfig({
      GOOD: 'chittysecrets://good-key',
      BAD: 'chittysecrets://missing-key',
    }));
    assert.equal(env['GOOD'], 'secret-val');
    assert.ok(!('BAD' in env));
  });

  // ── No-op when no secret refs in env ────────────────────────────────────────

  test('env with no secret refs — fetch is never called', async () => {
    let fetchCalled = false;
    globalThis.fetch = async (..._args: any[]) => {
      fetchCalled = true;
      return {} as any;
    };
    const env = await (cm as any).resolveEnv(makeConfig({ PLAIN: 'value', OTHER: 'also-plain' }));
    assert.equal(env['PLAIN'], 'value');
    assert.equal(fetchCalled, false);
  });

  test('empty env — resolves cleanly', async () => {
    const env = await (cm as any).resolveEnv(makeConfig({}));
    assert.ok(typeof env === 'object');
  });
});
