import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMcpRequest } from '../src/mcp-request-alias.js';

for (const name of ['ch1tty.ch1tty/cast', 'ch1tty.ch1tty.cast', 'ch1tty/ch1tty/cast', 'ch1tty.cast', 'cast', 'Ch1tty.ch1tty/cast']) {
  test(`MCP transport accepts known cast alias ${name}`, async () => {
    const body = { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: { intent: 'read-only fleet status', confirm: true } } };
    const req = new Request('https://host/mcp2', { method: 'POST', headers: { 'content-type': 'application/json', 'mcp-session-id': 'test-session', 'content-length': '999' }, body: JSON.stringify(body) });
    const normalized = await normalizeMcpRequest(req);
    assert.deepEqual(await normalized.json(), { ...body, params: { ...body.params, name: 'ch1tty/cast' } });
    assert.equal(normalized.headers.get('mcp-session-id'), 'test-session');
    assert.equal(normalized.headers.get('content-length'), null);
  });
}

test('stale status alias maps to canonical tool', async () => {
  const req = new Request('https://host/mcp2', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'tools/call', params: { name: 'gateway_status' } }) });
  const result = await normalizeMcpRequest(req);
  assert.equal((await result.json() as any).params.name, 'ch1tty/status');
});

for (const name of ['foreign/status', 'ch1tty/ch1ttyEvil/status', 'ch1tty.ch1tty/unknown', 'ch1tty/cast', 'reload', 'ch1tty.reload']) {
  test(`MCP transport preserves unknown or canonical name ${name}`, async () => {
    const req = new Request('https://host/mcp2', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'tools/call', params: { name } }) });
    assert.equal(await normalizeMcpRequest(req), req);
    assert.equal((await req.json() as any).params.name, name);
  });
}

test('non-call and malformed bodies remain available to SDK validation', async () => {
  for (const body of ['{', 'null', '[]', JSON.stringify({method:'tools/list'}), JSON.stringify({method:'tools/call',params:{name:42}})]) {
    const req = new Request('https://host/mcp2', { method:'POST', headers:{'content-type':'application/json'}, body });
    assert.equal(await normalizeMcpRequest(req), req);
    assert.equal(await req.text(), body);
  }
});

test('GET and non-JSON requests are untouched', async () => {
  for (const req of [new Request('https://host/mcp2'),new Request('https://host/mcp2',{method:'POST',body:'text'})]) assert.equal(await normalizeMcpRequest(req),req);
});
