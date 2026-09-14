/**
 * test(AJ): extractRows() direct unit tests — comms-mcp/recent-log.ts
 *
 * `extractRows` is exported but has no direct tests; it is only exercised
 * implicitly through recentLog() integration paths. These tests cover every
 * branch of the function in isolation.
 *
 * Branches:
 *   1. Plain array → returned as-is (no copy)
 *   2. MCP content envelope: content[].type==='text' → parse JSON, recurse
 *   3. MCP content envelope with nested array → recursive resolution
 *   4. Common wrapper keys: messages, rows, results, data, items, threads
 *   5. Object with no recognized key or content → throws
 *   6. Non-object non-array (string, number, null) → throws
 *   7. Envelope with non-text content items only → throws (no usable text item)
 *   8. Envelope text item whose JSON parses to a wrapped object → recurses
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractRows } from '../src/recent-log.ts';

// ── 1. Plain array ────────────────────────────────────────────────────────────

describe('extractRows — plain array', () => {
  test('returns the same array reference', () => {
    const arr = [{ id: 'a' }, { id: 'b' }];
    const result = extractRows(arr);
    assert.strictEqual(result, arr, 'should return the exact same array');
  });

  test('empty array returns empty array', () => {
    const result = extractRows([]);
    assert.deepEqual(result, []);
  });
});

// ── 2. MCP content envelope ───────────────────────────────────────────────────

describe('extractRows — MCP content envelope', () => {
  test('extracts array from content[].text (JSON array)', () => {
    const rows = [{ external_id: 'msg-1' }, { external_id: 'msg-2' }];
    const envelope = {
      content: [{ type: 'text', text: JSON.stringify(rows) }],
    };
    const result = extractRows(envelope);
    assert.deepEqual(result, rows);
  });

  test('skips non-text content items and uses first text item', () => {
    const rows = [{ id: 'x' }];
    const envelope = {
      content: [
        { type: 'image', data: 'base64stuff' },
        { type: 'text', text: JSON.stringify(rows) },
      ],
    };
    const result = extractRows(envelope);
    assert.deepEqual(result, rows);
  });

  test('uses first text item when multiple text items exist', () => {
    const rows = [{ id: 'first' }];
    const envelope = {
      content: [
        { type: 'text', text: JSON.stringify(rows) },
        { type: 'text', text: JSON.stringify([{ id: 'second' }]) },
      ],
    };
    const result = extractRows(envelope);
    assert.deepEqual(result, rows);
  });
});

// ── 3. Recursive resolution ───────────────────────────────────────────────────

describe('extractRows — recursive resolution from envelope', () => {
  test('envelope text is a wrapped object → recurses to find array via wrapper key', () => {
    const rows = [{ id: 'r1' }];
    const inner = { messages: rows };
    const envelope = {
      content: [{ type: 'text', text: JSON.stringify(inner) }],
    };
    const result = extractRows(envelope);
    assert.deepEqual(result, rows);
  });

  test('envelope text is a plain array → returns it', () => {
    const rows = [{ id: 'r2' }, { id: 'r3' }];
    const envelope = {
      content: [{ type: 'text', text: JSON.stringify(rows) }],
    };
    const result = extractRows(envelope);
    assert.deepEqual(result, rows);
  });
});

// ── 4. Common wrapper keys ────────────────────────────────────────────────────

describe('extractRows — common wrapper keys', () => {
  for (const key of ['messages', 'rows', 'results', 'data', 'items', 'threads'] as const) {
    test(`returns array at key "${key}"`, () => {
      const arr = [{ id: key }];
      const result = extractRows({ [key]: arr });
      assert.deepEqual(result, arr, `key "${key}" should be returned`);
    });
  }

  test('first matching wrapper key wins when multiple are present', () => {
    // 'messages' comes first in the iteration order
    const messagesArr = [{ id: 'from-messages' }];
    const rowsArr = [{ id: 'from-rows' }];
    const result = extractRows({ messages: messagesArr, rows: rowsArr });
    assert.deepEqual(result, messagesArr, 'messages key should win');
  });
});

// ── 5. Unknown object → throws ────────────────────────────────────────────────

describe('extractRows — unknown object throws', () => {
  test('plain object with no recognized key throws', () => {
    assert.throws(
      () => extractRows({ unknown_key: [1, 2, 3], also_unknown: 'x' }),
      /unrecognized listMessages result shape/,
    );
  });

  test('object with content array but no text items throws', () => {
    assert.throws(
      () => extractRows({ content: [{ type: 'image', data: 'aaa' }] }),
      /unrecognized listMessages result shape/,
    );
  });

  test('object with empty content array throws', () => {
    assert.throws(
      () => extractRows({ content: [] }),
      /unrecognized listMessages result shape/,
    );
  });
});

// ── 6. Non-object non-array → throws ─────────────────────────────────────────

describe('extractRows — non-object non-array throws', () => {
  test('string throws', () => {
    assert.throws(
      () => extractRows('not an array'),
      /unrecognized listMessages result shape: string/,
    );
  });

  test('number throws', () => {
    assert.throws(
      () => extractRows(42),
      /unrecognized listMessages result shape: number/,
    );
  });

  test('null throws', () => {
    assert.throws(
      () => extractRows(null),
      /unrecognized listMessages result shape/,
    );
  });

  test('undefined throws', () => {
    assert.throws(
      () => extractRows(undefined),
      /unrecognized listMessages result shape/,
    );
  });
});
