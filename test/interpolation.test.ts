import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import test from 'node:test';
import { interpolatePath } from '../src/config.js';

test('interpolatePath expands leading ~/ to home directory', () => {
  const result = interpolatePath('~/Documents/file.txt');
  assert.equal(result, `${homedir()}/Documents/file.txt`);
});

test('interpolatePath expands standalone ~', () => {
  const result = interpolatePath('~');
  assert.equal(result, homedir());
});

test('interpolatePath does not expand ~ in the middle of a path', () => {
  const result = interpolatePath('/some/~thing/path');
  assert.equal(result, '/some/~thing/path');
});

test('interpolatePath expands ${VAR} patterns', () => {
  process.env.CH1TTY_TEST_VAR = 'hello';
  try {
    const result = interpolatePath('/path/${CH1TTY_TEST_VAR}/file');
    assert.equal(result, '/path/hello/file');
  } finally {
    delete process.env.CH1TTY_TEST_VAR;
  }
});

test('interpolatePath expands bare $VAR patterns', () => {
  process.env.CH1TTY_TEST_BARE = 'world';
  try {
    const result = interpolatePath('/path/$CH1TTY_TEST_BARE/file');
    assert.equal(result, '/path/world/file');
  } finally {
    delete process.env.CH1TTY_TEST_BARE;
  }
});

test('interpolatePath throws when referencing an unset env var', () => {
  delete process.env.CH1TTY_UNDEFINED_VAR;
  assert.throws(
    () => interpolatePath('/path/${CH1TTY_UNDEFINED_VAR}/file'),
    /unset environment variable: CH1TTY_UNDEFINED_VAR/,
  );
});

test('interpolatePath leaves absolute paths unchanged', () => {
  const result = interpolatePath('/usr/local/bin/node');
  assert.equal(result, '/usr/local/bin/node');
});

test('interpolatePath combines ~ and env var expansion', () => {
  process.env.CH1TTY_TEST_COMBO = 'projects';
  try {
    const result = interpolatePath('~/${CH1TTY_TEST_COMBO}/repo');
    assert.equal(result, `${homedir()}/projects/repo`);
  } finally {
    delete process.env.CH1TTY_TEST_COMBO;
  }
});
