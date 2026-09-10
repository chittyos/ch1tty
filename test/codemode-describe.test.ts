/**
 * Unit tests for describeNamespaces() — pure function, no Cloudflare runtime needed.
 *
 * Coverage:
 *  1. Empty server list → ch1tty.* lines only, no server lines, correct footer
 *  2. Single server → adds one two-method line for that server
 *  3. Multiple servers → one line per server, in order
 *  4. Output always starts with the fixed header
 *  5. Output always ends with the fixed footer
 *  6. Each server line contains both .execute and .search signatures
 *  7. Server IDs with dots/hyphens in the name come through verbatim
 *  8. ch1tty.* lines appear exactly once regardless of server count
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { describeNamespaces } from '../src/codemode-describe.ts';

const HEADER = 'Available namespaces inside the code sandbox (call via Workers RPC):';
const CH1TTY_SEARCH = '  ch1tty.search(query: string): Promise<ToolDescriptor[]>;';
const CH1TTY_EXECUTE = '  ch1tty.execute(namespacedTool: string, args?: object): Promise<unknown>;';
const FOOTER = 'Write an async function body that returns the final value. No internet fetch — only these namespaces.';

test('describeNamespaces: empty server list — header, ch1tty lines, footer only', () => {
  const out = describeNamespaces([]);
  const lines = out.split('\n');
  assert.equal(lines[0], HEADER);
  assert.equal(lines[1], CH1TTY_SEARCH);
  assert.equal(lines[2], CH1TTY_EXECUTE);
  assert.equal(lines[3], FOOTER);
  assert.equal(lines.length, 4);
});

test('describeNamespaces: single server — adds one line with both .execute and .search', () => {
  const out = describeNamespaces(['github']);
  const lines = out.split('\n');
  assert.equal(lines.length, 5);
  const serverLine = lines[3];
  assert.ok(serverLine.includes('github.execute(toolName: string, args?: object): Promise<unknown>;'), serverLine);
  assert.ok(serverLine.includes('github.search(query: string): Promise<ToolDescriptor[]>;'), serverLine);
  assert.equal(lines[4], FOOTER);
});

test('describeNamespaces: multiple servers — one line per server in order', () => {
  const ids = ['github', 'stripe', 'cloudflare'];
  const out = describeNamespaces(ids);
  const lines = out.split('\n');
  // header(1) + ch1tty.search(1) + ch1tty.execute(1) + 3 servers + footer(1) = 7
  assert.equal(lines.length, 7);
  assert.ok(lines[3].startsWith('  github.execute'), lines[3]);
  assert.ok(lines[4].startsWith('  stripe.execute'), lines[4]);
  assert.ok(lines[5].startsWith('  cloudflare.execute'), lines[5]);
});

test('describeNamespaces: header is always the first line', () => {
  assert.equal(describeNamespaces([]).split('\n')[0], HEADER);
  assert.equal(describeNamespaces(['a', 'b', 'c']).split('\n')[0], HEADER);
});

test('describeNamespaces: footer is always the last line', () => {
  const noServers = describeNamespaces([]);
  const threeServers = describeNamespaces(['x', 'y', 'z']);
  assert.equal(noServers.split('\n').at(-1), FOOTER);
  assert.equal(threeServers.split('\n').at(-1), FOOTER);
});

test('describeNamespaces: server IDs with hyphens pass through verbatim', () => {
  const out = describeNamespaces(['my-service', 'cf-access']);
  assert.ok(out.includes('my-service.execute'), out);
  assert.ok(out.includes('cf-access.execute'), out);
});

test('describeNamespaces: ch1tty.search and ch1tty.execute appear exactly once regardless of server count', () => {
  for (const ids of [[], ['a'], ['a', 'b', 'c', 'd', 'e']]) {
    const out = describeNamespaces(ids);
    const searchCount = (out.match(/ch1tty\.search/g) ?? []).length;
    const executeCount = (out.match(/ch1tty\.execute/g) ?? []).length;
    assert.equal(searchCount, 1, `ch1tty.search count for ids=[${ids}]`);
    assert.equal(executeCount, 1, `ch1tty.execute count for ids=[${ids}]`);
  }
});

test('describeNamespaces: server line always contains both method signatures on a single line', () => {
  const out = describeNamespaces(['tasks']);
  const serverLine = out.split('\n').find((l) => l.includes('tasks.execute'));
  assert.ok(serverLine, 'expected a tasks server line');
  assert.ok(serverLine!.includes('tasks.execute(toolName: string, args?: object): Promise<unknown>;'));
  assert.ok(serverLine!.includes('tasks.search(query: string): Promise<ToolDescriptor[]>;'));
});
