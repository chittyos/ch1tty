// Phase 4 decommission: /mcp returns 410 Gone for all request methods/variants.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMcpDeprecated } from '../src/mcp-deprecated.js';

const BASE = 'https://ch1tty.chitty.cc';

test('handleMcpDeprecated — GET returns 410 Gone', async () => {
  const req = new Request(`${BASE}/mcp`, { method: 'GET' });
  const res = handleMcpDeprecated(req);
  assert.equal(res.status, 410);
});

test('handleMcpDeprecated — POST returns 410 Gone', async () => {
  const req = new Request(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const res = handleMcpDeprecated(req);
  assert.equal(res.status, 410);
});

test('handleMcpDeprecated — DELETE returns 410 Gone', async () => {
  const req = new Request(`${BASE}/mcp`, { method: 'DELETE' });
  const res = handleMcpDeprecated(req);
  assert.equal(res.status, 410);
});

test('handleMcpDeprecated — response body has ENDPOINT_DECOMMISSIONED error code', async () => {
  const req = new Request(`${BASE}/mcp`, { method: 'POST' });
  const res = handleMcpDeprecated(req);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.error, 'ENDPOINT_DECOMMISSIONED');
  assert.ok(typeof body.message === 'string' && (body.message as string).length > 0);
});

test('handleMcpDeprecated — response body has migration guidance pointing to /mcp2', async () => {
  const req = new Request(`${BASE}/mcp`);
  const res = handleMcpDeprecated(req);
  const body = await res.json() as { migration?: { canonical?: string } };
  assert.equal(body.migration?.canonical, '/mcp2');
});

test('handleMcpDeprecated — Content-Type is application/json', async () => {
  const req = new Request(`${BASE}/mcp`);
  const res = handleMcpDeprecated(req);
  assert.ok(res.headers.get('content-type')?.startsWith('application/json'));
});

test('handleMcpDeprecated — Sunset header is present', async () => {
  const req = new Request(`${BASE}/mcp`);
  const res = handleMcpDeprecated(req);
  assert.ok(res.headers.has('sunset'), 'Sunset header should be present');
});

test('handleMcpDeprecated — Link header points to successor /mcp2', async () => {
  const req = new Request(`${BASE}/mcp`);
  const res = handleMcpDeprecated(req);
  const link = res.headers.get('link');
  assert.ok(link?.includes('/mcp2'), `Link header should reference /mcp2, got: ${link}`);
  assert.ok(link?.includes('successor-version'), `Link header should carry rel=successor-version, got: ${link}`);
});
