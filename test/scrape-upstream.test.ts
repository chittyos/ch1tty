import assert from 'node:assert/strict';
import test from 'node:test';
import { REMOTE_SERVERS } from '../src/config-data.js';

test('worker registry includes canonical durable scrape-agent upstream', () => {
  const scrape = REMOTE_SERVERS.find((server) => server.id === 'scrape');
  assert.ok(scrape, 'scrape upstream must be embedded in the Worker registry');
  assert.equal(scrape.type, 'remote');
  assert.equal(scrape.endpoint, 'https://agent.chitty.cc/scrape/mcp');
  assert.equal(scrape.authTokenKey, 'chittymcp');
  assert.equal(scrape.access, 'read');
});

test('worker registry does not add ChittyFinance without an actor propagation path', () => {
  assert.equal(REMOTE_SERVERS.some((server) => server.id === 'finance'), false);
});
