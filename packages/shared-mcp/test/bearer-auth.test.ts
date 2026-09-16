import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { checkBearerToken, writeUnauthorized } from '../src/bearer-auth.js';

function makeReq(authHeader?: string): IncomingMessage {
  return {
    headers: authHeader !== undefined ? { authorization: authHeader } : {},
  } as unknown as IncomingMessage;
}

test('checkBearerToken: no authorization header → false', () => {
  assert.equal(checkBearerToken(makeReq(), 'tok'), false);
});

test('checkBearerToken: correct Bearer token → true', () => {
  assert.equal(checkBearerToken(makeReq('Bearer mytoken'), 'mytoken'), true);
});

test('checkBearerToken: wrong token → false', () => {
  assert.equal(checkBearerToken(makeReq('Bearer wrongtoken'), 'mytoken'), false);
});

test('checkBearerToken: lowercase bearer scheme → true', () => {
  assert.equal(checkBearerToken(makeReq('bearer mytoken'), 'mytoken'), true);
});

test('checkBearerToken: uppercase BEARER scheme → true', () => {
  assert.equal(checkBearerToken(makeReq('BEARER mytoken'), 'mytoken'), true);
});

test('checkBearerToken: Basic auth scheme → false', () => {
  assert.equal(checkBearerToken(makeReq('Basic abc123'), 'abc123'), false);
});

test('checkBearerToken: Bearer with no token part → false', () => {
  // regex requires \S+ so "Bearer " (trailing space, no token) fails
  assert.equal(checkBearerToken(makeReq('Bearer '), 'any'), false);
});

test('writeUnauthorized: 401 + Content-Type: application/json + WWW-Authenticate: Bearer', async () => {
  const server = createServer((_req, res) => {
    writeUnauthorized(res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 401);
    assert.ok(
      res.headers.get('content-type')?.startsWith('application/json'),
      `content-type should be application/json, got: ${res.headers.get('content-type')}`,
    );
    assert.equal(res.headers.get('www-authenticate'), 'Bearer');
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, 'unauthorized');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
