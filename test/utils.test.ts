import assert from 'node:assert/strict';
import test from 'node:test';
import { VERSION, withTimeout, normalizeToolResult } from '../src/utils.js';

// ─── withTimeout ─────────────────────────────────────────────────────────────

test('withTimeout resolves with the inner value before deadline', async () => {
  const result = await withTimeout(Promise.resolve(42), 100, 'fast');
  assert.equal(result, 42);
});

test('withTimeout rejects with labelled timeout message after deadline', async () => {
  const slow = new Promise<never>(() => {}); // never resolves
  await assert.rejects(
    withTimeout(slow, 20, 'myOp'),
    (err: Error) => {
      assert.ok(err.message.includes('myOp'), `message should include label: ${err.message}`);
      assert.ok(err.message.includes('timed out'), `message should say "timed out": ${err.message}`);
      assert.ok(err.message.includes('20ms'), `message should include timeout ms: ${err.message}`);
      return true;
    },
  );
});

test('withTimeout propagates inner rejection unchanged', async () => {
  const inner = Promise.reject(new Error('inner failure'));
  await assert.rejects(
    withTimeout(inner, 1000, 'op'),
    { message: 'inner failure' },
  );
});

test('withTimeout clears the timer when promise resolves', async () => {
  // Verify the resolve path clears the timeout — no dangling timer after completion.
  const p = new Promise<string>((resolve) => setTimeout(() => resolve('done'), 5));
  const result = await withTimeout(p, 200, 'clearcheck');
  assert.equal(result, 'done');
});

test('withTimeout clears the timer when inner promise rejects', async () => {
  const p = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('boom')), 5));
  await assert.rejects(withTimeout(p, 200, 'clearcheck-reject'), { message: 'boom' });
});

// ─── normalizeToolResult ─────────────────────────────────────────────────────

test('normalizeToolResult: content array with text item', () => {
  const result = normalizeToolResult({
    content: [{ type: 'text', text: 'hello' }],
  });
  assert.deepEqual(result, {
    content: [{ type: 'text', text: 'hello' }],
    isError: false,
  });
});

test('normalizeToolResult: content array with image item', () => {
  const result = normalizeToolResult({
    content: [{ type: 'image', data: 'base64==', mimeType: 'image/png' }],
  });
  assert.deepEqual(result, {
    content: [{ type: 'image', data: 'base64==', mimeType: 'image/png' }],
    isError: false,
  });
});

test('normalizeToolResult: content array with resource item', () => {
  const resource = { uri: 'file://a', mimeType: 'text/plain', text: 'body' };
  const result = normalizeToolResult({
    content: [{ type: 'resource', resource }],
  });
  assert.deepEqual(result, {
    content: [{ type: 'resource', resource }],
    isError: false,
  });
});

test('normalizeToolResult: unknown content type falls back to text', () => {
  const result = normalizeToolResult({
    content: [{ type: 'unknown', text: 'fallback' }],
  });
  assert.deepEqual(result.content, [{ type: 'text', text: 'fallback' }]);
});

test('normalizeToolResult: item with no text field yields empty string', () => {
  const result = normalizeToolResult({
    content: [{ type: 'other' }],
  });
  assert.deepEqual(result.content, [{ type: 'text', text: '' }]);
});

test('normalizeToolResult: isError true is preserved', () => {
  const result = normalizeToolResult({
    content: [{ type: 'text', text: 'err' }],
    isError: true,
  });
  assert.equal(result.isError, true);
});

test('normalizeToolResult: missing isError defaults to false', () => {
  const result = normalizeToolResult({
    content: [{ type: 'text', text: 'ok' }],
  });
  assert.equal(result.isError, false);
});

test('normalizeToolResult: legacy toolResult format wraps in text item', () => {
  const result = normalizeToolResult({ toolResult: { foo: 'bar' } });
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, 'text');
  const text = (result.content[0] as { type: 'text'; text: string }).text;
  assert.ok(text.includes('foo'), `JSON should contain key "foo": ${text}`);
  assert.ok(text.includes('bar'), `JSON should contain value "bar": ${text}`);
  assert.equal(result.isError, false);
});

test('normalizeToolResult: empty content array produces empty output', () => {
  const result = normalizeToolResult({ content: [] });
  assert.deepEqual(result, { content: [], isError: false });
});

test('normalizeToolResult: multiple mixed items in content array', () => {
  const result = normalizeToolResult({
    content: [
      { type: 'text', text: 'a' },
      { type: 'image', data: 'd', mimeType: 'image/jpeg' },
    ],
    isError: false,
  });
  assert.equal(result.content.length, 2);
  assert.equal(result.content[0].type, 'text');
  assert.equal(result.content[1].type, 'image');
});

// ─── VERSION ─────────────────────────────────────────────────────────────────

test('VERSION is a semver-formatted string', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});
