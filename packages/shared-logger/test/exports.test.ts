/**
 * Export-surface drift guard for @ch1tty/shared-logger.
 *
 * These tests verify that the package's runtime exports and public API
 * match what the gateway and apps depend on. A rename or removal of any
 * symbol here is caught before callers break at build time. Add a test
 * when you add a new public symbol.
 *
 * Note: LogLevel is a type-only export and produces no runtime value —
 * it correctly does NOT appear in the runtime surface enumerated below.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as SharedLogger from '../src/index.js';
import { Logger } from '../src/index.js';

// ── Runtime export surface ────────────────────────────────────────────────────

test('package has exactly 2 runtime exports: Logger and log', () => {
  const keys = Object.keys(SharedLogger).sort();
  assert.deepEqual(keys, ['Logger', 'log'], `expected [Logger, log], got: ${JSON.stringify(keys)}`);
});

test('Logger is exported as a constructor function', () => {
  assert.equal(typeof SharedLogger.Logger, 'function');
});

test('log is exported as a Logger instance', () => {
  assert.ok(SharedLogger.log instanceof Logger, 'log must be an instance of Logger');
});

test('Logger re-export is the same identity as the direct import', () => {
  assert.equal(SharedLogger.Logger, Logger);
});

// ── Logger prototype method API ───────────────────────────────────────────────
// Gateway and apps call: logger.info(), logger.warn(), logger.error(),
// logger.debug(), logger.setLevel(), logger.childStderr()

test('Logger.prototype.info is a method', () => {
  assert.equal(typeof Logger.prototype.info, 'function');
});

test('Logger.prototype.warn is a method', () => {
  assert.equal(typeof Logger.prototype.warn, 'function');
});

test('Logger.prototype.error is a method', () => {
  assert.equal(typeof Logger.prototype.error, 'function');
});

test('Logger.prototype.debug is a method', () => {
  assert.equal(typeof Logger.prototype.debug, 'function');
});

test('Logger.prototype.setLevel is a method', () => {
  assert.equal(typeof Logger.prototype.setLevel, 'function');
});

test('Logger.prototype.childStderr is a method', () => {
  assert.equal(typeof Logger.prototype.childStderr, 'function');
});

// ── Logger instance API ───────────────────────────────────────────────────────

test('Logger instance: all 6 public methods present on new instance', () => {
  const logger = new Logger();
  assert.equal(typeof logger.info, 'function');
  assert.equal(typeof logger.warn, 'function');
  assert.equal(typeof logger.error, 'function');
  assert.equal(typeof logger.debug, 'function');
  assert.equal(typeof logger.setLevel, 'function');
  assert.equal(typeof logger.childStderr, 'function');
});

test('log singleton: all 6 public methods present', () => {
  assert.equal(typeof SharedLogger.log.info, 'function');
  assert.equal(typeof SharedLogger.log.warn, 'function');
  assert.equal(typeof SharedLogger.log.error, 'function');
  assert.equal(typeof SharedLogger.log.debug, 'function');
  assert.equal(typeof SharedLogger.log.setLevel, 'function');
  assert.equal(typeof SharedLogger.log.childStderr, 'function');
});

// ── Constructor: unknown CH1TTY_LOG_LEVEL falls back to info ─────────────────
// Branch: LEVEL_ORDER[envLevel] ?? LEVEL_ORDER.info — when the env value is
// not one of the 4 known levels, the ?? fallback kicks in and level stays info.

test('Logger: unknown CH1TTY_LOG_LEVEL env value falls back to info level', () => {
  const orig = process.env.CH1TTY_LOG_LEVEL;
  process.env.CH1TTY_LOG_LEVEL = 'badlevel';
  try {
    const logger = new Logger();
    // At info level: debug is suppressed, info is emitted
    const lines: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Buffer) => {
      lines.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    };
    try {
      logger.debug('should be suppressed');
      logger.info('should appear');
    } finally {
      process.stderr.write = origWrite;
    }
    assert.equal(lines.length, 1, 'only info should emit at info-fallback level');
    assert.ok(lines[0].includes('should appear'), `expected info message, got: ${lines[0]}`);
  } finally {
    if (orig === undefined) delete process.env.CH1TTY_LOG_LEVEL;
    else process.env.CH1TTY_LOG_LEVEL = orig;
  }
});
