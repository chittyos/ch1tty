/**
 * Workstream Z: unit tests for apps/comms-mcp/src/dispatch.ts (McpClientDispatch).
 *
 * Tests the env-var resolution helpers and the McpClientDispatch class using an
 * injectable ConnectFn so no real network connections are made.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { envPrefix, backendConfig, getTimeoutMs, McpClientDispatch } from '../src/dispatch.ts';
import type { ConnectFn } from '../src/dispatch.ts';

// Short remote timeout so setTimeout timers inside call() don't hold the event loop.
// Each test that uses a custom timeout saves/restores this value.
process.env.CH1TTY_REMOTE_TIMEOUT_MS = '200';

// ── Env helpers ───────────────────────────────────────────────────────────────

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ── Mock Client ───────────────────────────────────────────────────────────────

type CallToolResult = { isError?: boolean; content?: unknown };

interface MockClientOpts {
  callTool?: (args: { name: string; arguments: Record<string, unknown> }) => Promise<CallToolResult>;
  close?: () => Promise<void>;
}

function makeMockClient(opts: MockClientOpts = {}): Client {
  return {
    callTool: opts.callTool ?? (async () => ({ content: [{ type: 'text', text: 'ok' }] })),
    close: opts.close ?? (async () => {}),
  } as unknown as Client;
}

/** Build a ConnectFn that records calls and returns a controllable client. */
function makeConnectFn(
  clientFactory: (endpoint: string, headers: Record<string, string>) => Client = makeMockClient,
): { fn: ConnectFn; calls: Array<{ endpoint: string; headers: Record<string, string> }> } {
  const calls: Array<{ endpoint: string; headers: Record<string, string> }> = [];
  const fn: ConnectFn = async (endpoint, headers) => {
    calls.push({ endpoint, headers });
    return clientFactory(endpoint, headers);
  };
  return { fn, calls };
}

// ── envPrefix ─────────────────────────────────────────────────────────────────

test('envPrefix: simple id → uppercase with COMMS_MCP_ prefix', () => {
  assert.equal(envPrefix('quo'), 'COMMS_MCP_QUO');
});

test('envPrefix: hyphenated id → underscores', () => {
  assert.equal(envPrefix('chittyagent-quo'), 'COMMS_MCP_CHITTYAGENT_QUO');
});

test('envPrefix: mixed case + hyphens', () => {
  assert.equal(envPrefix('My-Service-ID'), 'COMMS_MCP_MY_SERVICE_ID');
});

// ── backendConfig ─────────────────────────────────────────────────────────────

test('backendConfig: throws when ENDPOINT env var missing', () => {
  const id = 'test-backend-z1';
  delete process.env[`${envPrefix(id)}_ENDPOINT`];
  assert.throws(() => backendConfig(id), /no endpoint for backend 'test-backend-z1'/);
});

test('backendConfig: returns endpoint from env', () => {
  const id = 'test-backend-z2';
  withEnv({ [`${envPrefix(id)}_ENDPOINT`]: 'https://mcp.example.com/mcp', CF_ACCESS_CLIENT_ID: undefined, CF_ACCESS_CLIENT_SECRET: undefined }, () => {
    const cfg = backendConfig(id);
    assert.equal(cfg.endpoint, 'https://mcp.example.com/mcp');
    assert.equal(cfg.token, undefined);
    assert.equal(cfg.cfId, undefined);
    assert.equal(cfg.cfSecret, undefined);
  });
});

test('backendConfig: reads token from env', () => {
  const id = 'test-backend-z3';
  const p = envPrefix(id);
  withEnv({ [`${p}_ENDPOINT`]: 'https://ep.test', [`${p}_TOKEN`]: 'tok-abc' }, () => {
    const cfg = backendConfig(id);
    assert.equal(cfg.token, 'tok-abc');
  });
});

test('backendConfig: reads per-backend CF_ACCESS creds', () => {
  const id = 'test-backend-z4';
  const p = envPrefix(id);
  withEnv({
    [`${p}_ENDPOINT`]: 'https://ep.test',
    [`${p}_CF_ACCESS_CLIENT_ID`]: 'id-123',
    [`${p}_CF_ACCESS_CLIENT_SECRET`]: 'sec-456',
  }, () => {
    const cfg = backendConfig(id);
    assert.equal(cfg.cfId, 'id-123');
    assert.equal(cfg.cfSecret, 'sec-456');
  });
});

test('backendConfig: falls back to global CF_ACCESS env vars', () => {
  const id = 'test-backend-z5';
  const p = envPrefix(id);
  withEnv({
    [`${p}_ENDPOINT`]: 'https://ep.test',
    CF_ACCESS_CLIENT_ID: 'global-id',
    CF_ACCESS_CLIENT_SECRET: 'global-sec',
  }, () => {
    const cfg = backendConfig(id);
    assert.equal(cfg.cfId, 'global-id');
    assert.equal(cfg.cfSecret, 'global-sec');
  });
});

// ── getTimeoutMs ──────────────────────────────────────────────────────────────

test('getTimeoutMs: defaults to 120000 when env unset', () => {
  withEnv({}, () => {
    const saved = process.env.CH1TTY_REMOTE_TIMEOUT_MS;
    delete process.env.CH1TTY_REMOTE_TIMEOUT_MS;
    try { assert.equal(getTimeoutMs(), 120_000); }
    finally { if (saved !== undefined) process.env.CH1TTY_REMOTE_TIMEOUT_MS = saved; }
  });
});

test('getTimeoutMs: reads CH1TTY_REMOTE_TIMEOUT_MS', () => {
  withEnv({ CH1TTY_REMOTE_TIMEOUT_MS: '5000' }, () => {
    assert.equal(getTimeoutMs(), 5000);
  });
});

test('getTimeoutMs: ignores non-positive values, returns default', () => {
  withEnv({ CH1TTY_REMOTE_TIMEOUT_MS: '0' }, () => {
    assert.equal(getTimeoutMs(), 120_000);
  });
});

// ── McpClientDispatch: connection caching ────────────────────────────────────

test('connect: caches connections — same serverId returns same promise', async () => {
  const id = 'cache-test-z';
  const p = envPrefix(id);
  process.env[`${p}_ENDPOINT`] = 'https://mcp.example.com/mcp';
  try {
    const { fn, calls } = makeConnectFn();
    const dispatch = new McpClientDispatch(fn);
    const result1 = (dispatch as unknown as { connect: (id: string) => Promise<Client> }).connect(id);
    const result2 = (dispatch as unknown as { connect: (id: string) => Promise<Client> }).connect(id);
    assert.strictEqual(result1, result2, 'same Promise returned for same serverId');
    await result1;
    assert.equal(calls.length, 1, 'ConnectFn called only once');
  } finally {
    delete process.env[`${p}_ENDPOINT`];
  }
});

test('connect: evicts cache on failure', async () => {
  const id = 'fail-test-z';
  const p = envPrefix(id);
  process.env[`${p}_ENDPOINT`] = 'https://mcp.example.com/mcp';
  try {
    let callCount = 0;
    const fn: ConnectFn = async () => {
      callCount++;
      if (callCount === 1) throw new Error('connect failed');
      return makeMockClient();
    };
    const dispatch = new McpClientDispatch(fn);
    const priv = dispatch as unknown as { connect: (id: string) => Promise<Client> };
    await assert.rejects(() => priv.connect(id), /connect failed/);
    // After failure, cache is evicted — second call creates a new connection
    await priv.connect(id);
    assert.equal(callCount, 2);
  } finally {
    delete process.env[`${p}_ENDPOINT`];
  }
});

test('connect: builds Authorization header from token', async () => {
  const id = 'auth-test-z';
  const p = envPrefix(id);
  process.env[`${p}_ENDPOINT`] = 'https://ep.test';
  process.env[`${p}_TOKEN`] = 'my-token';
  try {
    const { fn, calls } = makeConnectFn();
    const dispatch = new McpClientDispatch(fn);
    await (dispatch as unknown as { connect: (id: string) => Promise<Client> }).connect(id);
    assert.equal(calls[0]?.headers['Authorization'], 'Bearer my-token');
  } finally {
    delete process.env[`${p}_ENDPOINT`];
    delete process.env[`${p}_TOKEN`];
  }
});

test('connect: builds CF-Access headers', async () => {
  const id = 'cf-test-z';
  const p = envPrefix(id);
  process.env[`${p}_ENDPOINT`] = 'https://ep.test';
  process.env[`${p}_CF_ACCESS_CLIENT_ID`] = 'cf-id';
  process.env[`${p}_CF_ACCESS_CLIENT_SECRET`] = 'cf-sec';
  try {
    const { fn, calls } = makeConnectFn();
    const dispatch = new McpClientDispatch(fn);
    await (dispatch as unknown as { connect: (id: string) => Promise<Client> }).connect(id);
    assert.equal(calls[0]?.headers['CF-Access-Client-Id'], 'cf-id');
    assert.equal(calls[0]?.headers['CF-Access-Client-Secret'], 'cf-sec');
  } finally {
    delete process.env[`${p}_ENDPOINT`];
    delete process.env[`${p}_CF_ACCESS_CLIENT_ID`];
    delete process.env[`${p}_CF_ACCESS_CLIENT_SECRET`];
  }
});

test('connect: omits empty headers when no token/CF vars set', async () => {
  const id = 'no-auth-z';
  const p = envPrefix(id);
  process.env[`${p}_ENDPOINT`] = 'https://ep.test';
  const cfKeys = ['CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET', `${p}_TOKEN`, `${p}_CF_ACCESS_CLIENT_ID`, `${p}_CF_ACCESS_CLIENT_SECRET`];
  const saved: Record<string, string | undefined> = {};
  for (const k of cfKeys) { saved[k] = process.env[k]; delete process.env[k]; }
  try {
    const { fn, calls } = makeConnectFn();
    const dispatch = new McpClientDispatch(fn);
    await (dispatch as unknown as { connect: (id: string) => Promise<Client> }).connect(id);
    assert.ok(!('Authorization' in (calls[0]?.headers ?? {})), 'no Authorization header');
    assert.ok(!('CF-Access-Client-Id' in (calls[0]?.headers ?? {})), 'no CF-Access-Client-Id');
  } finally {
    delete process.env[`${p}_ENDPOINT`];
    for (const [k, v] of Object.entries(saved)) {
      if (v !== undefined) process.env[k] = v;
    }
  }
});

// ── McpClientDispatch: call ───────────────────────────────────────────────────

test('call: returns callTool result on success', async () => {
  const id = 'call-ok-z';
  const p = envPrefix(id);
  process.env[`${p}_ENDPOINT`] = 'https://ep.test';
  try {
    const expected = { content: [{ type: 'text', text: 'hello' }] };
    const client = makeMockClient({ callTool: async () => expected });
    const dispatch = new McpClientDispatch(async () => client);
    const result = await dispatch.call(id, 'some_tool', { a: 1 });
    assert.deepEqual(result, expected);
  } finally {
    delete process.env[`${p}_ENDPOINT`];
  }
});

test('call: throws on isError response', async () => {
  const id = 'call-err-z';
  const p = envPrefix(id);
  process.env[`${p}_ENDPOINT`] = 'https://ep.test';
  try {
    const client = makeMockClient({
      callTool: async () => ({ isError: true, content: [{ type: 'text', text: 'boom' }] }),
    });
    const dispatch = new McpClientDispatch(async () => client);
    await assert.rejects(() => dispatch.call(id, 'some_tool', {}), /isError/);
  } finally {
    delete process.env[`${p}_ENDPOINT`];
  }
});

test('call: forwards tool name and args to callTool', async () => {
  const id = 'call-fwd-z';
  const p = envPrefix(id);
  process.env[`${p}_ENDPOINT`] = 'https://ep.test';
  try {
    const received: Array<{ name: string; arguments: Record<string, unknown> }> = [];
    const client = makeMockClient({
      callTool: async (a) => { received.push(a as { name: string; arguments: Record<string, unknown> }); return { content: [] }; },
    });
    const dispatch = new McpClientDispatch(async () => client);
    await dispatch.call(id, 'my_tool', { x: 42, y: 'hello' });
    assert.equal(received[0]?.name, 'my_tool');
    assert.deepEqual(received[0]?.arguments, { x: 42, y: 'hello' });
  } finally {
    delete process.env[`${p}_ENDPOINT`];
  }
});

test('call: times out when callTool hangs', async () => {
  const id = 'call-timeout-z';
  const p = envPrefix(id);
  process.env[`${p}_ENDPOINT`] = 'https://ep.test';
  process.env.CH1TTY_REMOTE_TIMEOUT_MS = '50'; // short timeout for test
  // Use a deferred so we can unblock the event loop after the test.
  let unblock!: (v: CallToolResult) => void;
  const pending = new Promise<CallToolResult>((res) => { unblock = res; });
  try {
    const client = makeMockClient({ callTool: async () => pending });
    const dispatch = new McpClientDispatch(async () => client);
    await assert.rejects(() => dispatch.call(id, 'slow_tool', {}), /timed out/);
  } finally {
    unblock({ content: [] }); // release the pending promise so the event loop can drain
    delete process.env[`${p}_ENDPOINT`];
    process.env.CH1TTY_REMOTE_TIMEOUT_MS = '200'; // restore module-level default
  }
});

// ── McpClientDispatch: close ──────────────────────────────────────────────────

test('close: calls close on all connected clients', async () => {
  const ids = ['close-a-z', 'close-b-z'];
  const closedClients: string[] = [];
  for (const id of ids) process.env[`${envPrefix(id)}_ENDPOINT`] = 'https://ep.test';
  try {
    let idx = 0;
    const dispatch = new McpClientDispatch(async () => {
      const name = ids[idx++] ?? 'unknown';
      return makeMockClient({ close: async () => { closedClients.push(name); } });
    });
    for (const id of ids) await dispatch.call(id, 'tool', {});
    await dispatch.close();
    assert.equal(closedClients.length, 2);
  } finally {
    for (const id of ids) delete process.env[`${envPrefix(id)}_ENDPOINT`];
  }
});

test('close: tolerates client close errors (best-effort)', async () => {
  const id = 'close-err-z';
  process.env[`${envPrefix(id)}_ENDPOINT`] = 'https://ep.test';
  try {
    const client = makeMockClient({ close: async () => { throw new Error('close failed'); } });
    const dispatch = new McpClientDispatch(async () => client);
    await dispatch.call(id, 'tool', {});
    await assert.doesNotReject(() => dispatch.close(), 'close should not propagate errors');
  } finally {
    delete process.env[`${envPrefix(id)}_ENDPOINT`];
  }
});

test('close: clears client map so subsequent calls reconnect', async () => {
  const id = 'close-clear-z';
  process.env[`${envPrefix(id)}_ENDPOINT`] = 'https://ep.test';
  try {
    let connectCount = 0;
    const dispatch = new McpClientDispatch(async () => { connectCount++; return makeMockClient(); });
    await dispatch.call(id, 'tool', {});
    await dispatch.close();
    await dispatch.call(id, 'tool', {});
    assert.equal(connectCount, 2, 'should connect again after close');
  } finally {
    delete process.env[`${envPrefix(id)}_ENDPOINT`];
  }
});
