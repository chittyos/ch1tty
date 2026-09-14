/**
 * BP — sim/fixture-backend.ts + src/openapi-spec.ts uncovered paths.
 *
 * sim/fixture-backend.ts: The FixtureBackend stubs (listResources, readResource,
 * listPrompts, getPrompt) are real Backend interface implementations but never
 * exercised by scenario/simulation tests that only drive search/cast/execute.
 * Also covers the callTool success path with args=undefined (args ?? {} branch).
 *
 * src/openapi-spec.ts: parseToolPath() has no existing test coverage.
 * Covers the matching branch (valid /tools/<id>/<name>) and the null branch.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { FixtureBackend } from '../sim/fixture-backend.js';
import { parseToolPath } from '../src/openapi-spec.js';

// ── sim/fixture-backend.ts — stub method coverage ─────────────────────────────

test('sim FixtureBackend.listResources() returns empty resources and templates', async () => {
  const fb = new FixtureBackend();
  // listResources takes no meaningful args (serverId ignored in sim backend)
  const result = await fb.listResources();
  assert.deepEqual(result, { resources: [], templates: [] });
});

test('sim FixtureBackend.readResource() returns empty contents', async () => {
  const fb = new FixtureBackend();
  const result = await fb.readResource();
  assert.deepEqual(result, { contents: [] });
});

test('sim FixtureBackend.listPrompts() returns empty array', async () => {
  const fb = new FixtureBackend();
  const result = await fb.listPrompts();
  assert.deepEqual(result, []);
});

test('sim FixtureBackend.getPrompt() returns empty messages', async () => {
  const fb = new FixtureBackend();
  const result = await fb.getPrompt();
  assert.deepEqual(result, { messages: [] });
});

// callTool success path with args=undefined covers the `args ?? {}` branch (line 263)
test('sim FixtureBackend.callTool() success — args undefined → ok envelope with empty args', async () => {
  const fb = new FixtureBackend();
  fb.registerServer({ id: 'stripe', name: 'Stripe', type: 'remote', access: 'read', category: 'ecosystem', endpoint: 'https://fixture.stripe' });
  const result = await fb.callTool('stripe', 'create_invoice', undefined);
  assert.equal(result.isError, undefined, 'success path must not set isError');
  assert.ok(result.content.length > 0, 'must return content');
  const text = result.content[0];
  assert.equal(text?.type, 'text', 'content must be text');
  if (text?.type === 'text') {
    const parsed = JSON.parse(text.text);
    assert.equal(parsed.args !== undefined ? JSON.stringify(parsed.args) : '{}', '{}', 'args defaults to {}');
  }
});

// ── src/openapi-spec.ts — parseToolPath coverage ──────────────────────────────

test('parseToolPath: valid /tools/<serverId>/<toolName> → returns namespaced name', () => {
  assert.equal(parseToolPath('/tools/stripe/create_invoice'), 'stripe/create_invoice');
  assert.equal(parseToolPath('/tools/neon/run_sql'), 'neon/run_sql');
  assert.equal(parseToolPath('/tools/ch1tty/cast'), 'ch1tty/cast');
});

test('parseToolPath: invalid paths → returns null', () => {
  assert.equal(parseToolPath('/tools/stripe'), null);            // no tool segment
  assert.equal(parseToolPath('/tools/a/b/c'), null);             // too many segments
  assert.equal(parseToolPath('/execute/stripe/create'), null);   // wrong prefix
  assert.equal(parseToolPath(''), null);                          // empty
  assert.equal(parseToolPath('/tools//create'), null);            // empty serverId
});
