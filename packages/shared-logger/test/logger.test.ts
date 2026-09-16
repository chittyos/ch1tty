import assert from 'node:assert/strict';
import test from 'node:test';
import { Logger } from '../src/index.js';

function captureStderr(fn: () => void): string[] {
  const lines: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk: string | Buffer) => {
    lines.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  };
  try {
    fn();
  } finally {
    process.stderr.write = orig;
  }
  return lines;
}

// ── Text format (default) ──────────────────────────────────────────────────

test('text: info message uses [ch1tty] prefix', () => {
  delete process.env.CH1TTY_LOG_LEVEL;
  delete process.env.CH1TTY_LOG_FORMAT;
  const logger = new Logger();
  const lines = captureStderr(() => logger.info('hello'));
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes('[ch1tty]'), `expected [ch1tty] in: ${lines[0]}`);
  assert.ok(lines[0].includes('hello'));
});

test('text: info with server uses [ch1tty:serverId] prefix', () => {
  delete process.env.CH1TTY_LOG_LEVEL;
  delete process.env.CH1TTY_LOG_FORMAT;
  const logger = new Logger();
  const lines = captureStderr(() => logger.info('msg', 'myserver'));
  assert.equal(lines.length, 1);
  assert.ok(lines[0].startsWith('[ch1tty:myserver]'), `got: ${lines[0]}`);
});

test('text: debug suppressed at default info level', () => {
  delete process.env.CH1TTY_LOG_LEVEL;
  delete process.env.CH1TTY_LOG_FORMAT;
  const logger = new Logger();
  const lines = captureStderr(() => logger.debug('invisible'));
  assert.equal(lines.length, 0);
});

test('text: debug emitted when level=debug', () => {
  process.env.CH1TTY_LOG_LEVEL = 'debug';
  delete process.env.CH1TTY_LOG_FORMAT;
  const logger = new Logger();
  const lines = captureStderr(() => logger.debug('visible'));
  delete process.env.CH1TTY_LOG_LEVEL;
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes('visible'));
});

test('text: warn emitted at default info level', () => {
  delete process.env.CH1TTY_LOG_LEVEL;
  delete process.env.CH1TTY_LOG_FORMAT;
  const logger = new Logger();
  const lines = captureStderr(() => logger.warn('warning'));
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes('warning'));
});

test('text: error emitted at default info level', () => {
  delete process.env.CH1TTY_LOG_LEVEL;
  delete process.env.CH1TTY_LOG_FORMAT;
  const logger = new Logger();
  const lines = captureStderr(() => logger.error('boom'));
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes('boom'));
});

test('text: info suppressed when level=warn', () => {
  process.env.CH1TTY_LOG_LEVEL = 'warn';
  delete process.env.CH1TTY_LOG_FORMAT;
  const logger = new Logger();
  const lines = captureStderr(() => logger.info('quiet'));
  delete process.env.CH1TTY_LOG_LEVEL;
  assert.equal(lines.length, 0);
});

// ── JSON format ────────────────────────────────────────────────────────────

test('json: valid JSON entry with ts/level/msg', () => {
  delete process.env.CH1TTY_LOG_LEVEL;
  process.env.CH1TTY_LOG_FORMAT = 'json';
  const logger = new Logger();
  const lines = captureStderr(() => logger.info('test-msg'));
  delete process.env.CH1TTY_LOG_FORMAT;
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0].trim());
  assert.equal(entry.level, 'info');
  assert.equal(entry.msg, 'test-msg');
  assert.ok(typeof entry.ts === 'string');
});

test('json: server field present when server arg passed', () => {
  delete process.env.CH1TTY_LOG_LEVEL;
  process.env.CH1TTY_LOG_FORMAT = 'json';
  const logger = new Logger();
  const lines = captureStderr(() => logger.warn('srv-msg', 'myserver'));
  delete process.env.CH1TTY_LOG_FORMAT;
  const entry = JSON.parse(lines[0].trim());
  assert.equal(entry.server, 'myserver');
  assert.equal(entry.level, 'warn');
});

test('json: server field absent when no server arg', () => {
  delete process.env.CH1TTY_LOG_LEVEL;
  process.env.CH1TTY_LOG_FORMAT = 'json';
  const logger = new Logger();
  const lines = captureStderr(() => logger.info('no-server'));
  delete process.env.CH1TTY_LOG_FORMAT;
  const entry = JSON.parse(lines[0].trim());
  assert.equal(Object.prototype.hasOwnProperty.call(entry, 'server'), false);
});

test('json: extra fields merged into entry', () => {
  delete process.env.CH1TTY_LOG_LEVEL;
  process.env.CH1TTY_LOG_FORMAT = 'json';
  const logger = new Logger();
  const lines = captureStderr(() => logger.error('err', undefined, { code: 42, reason: 'test' }));
  delete process.env.CH1TTY_LOG_FORMAT;
  const entry = JSON.parse(lines[0].trim());
  assert.equal(entry.code, 42);
  assert.equal(entry.reason, 'test');
  assert.equal(entry.level, 'error');
});

test('json: debug suppressed at default info level', () => {
  delete process.env.CH1TTY_LOG_LEVEL;
  process.env.CH1TTY_LOG_FORMAT = 'json';
  const logger = new Logger();
  const lines = captureStderr(() => logger.debug('nope'));
  delete process.env.CH1TTY_LOG_FORMAT;
  assert.equal(lines.length, 0);
});

// ── setLevel ───────────────────────────────────────────────────────────────

test('setLevel: promotes debug to visible', () => {
  delete process.env.CH1TTY_LOG_LEVEL;
  delete process.env.CH1TTY_LOG_FORMAT;
  const logger = new Logger();
  logger.setLevel('debug');
  const lines = captureStderr(() => logger.debug('now visible'));
  assert.equal(lines.length, 1);
});

test('setLevel: silences info when set to warn', () => {
  delete process.env.CH1TTY_LOG_LEVEL;
  delete process.env.CH1TTY_LOG_FORMAT;
  const logger = new Logger();
  logger.setLevel('warn');
  const lines = captureStderr(() => logger.info('silenced'));
  assert.equal(lines.length, 0);
});

test('setLevel: unknown level ignored, prior level retained', () => {
  delete process.env.CH1TTY_LOG_LEVEL;
  delete process.env.CH1TTY_LOG_FORMAT;
  const logger = new Logger();
  logger.setLevel('verbose');
  const lines = captureStderr(() => logger.debug('still suppressed'));
  assert.equal(lines.length, 0);
});

test('setLevel: undefined level ignored', () => {
  delete process.env.CH1TTY_LOG_LEVEL;
  delete process.env.CH1TTY_LOG_FORMAT;
  const logger = new Logger();
  logger.setLevel(undefined);
  const lines = captureStderr(() => logger.info('still emitted'));
  assert.equal(lines.length, 1);
});

test('setLevel: uppercase level string accepted', () => {
  delete process.env.CH1TTY_LOG_LEVEL;
  delete process.env.CH1TTY_LOG_FORMAT;
  const logger = new Logger();
  logger.setLevel('DEBUG');
  const lines = captureStderr(() => logger.debug('uppercase-debug'));
  assert.equal(lines.length, 1);
});

// ── childStderr ────────────────────────────────────────────────────────────

test('childStderr text: writes server-prefixed output', () => {
  delete process.env.CH1TTY_LOG_LEVEL;
  delete process.env.CH1TTY_LOG_FORMAT;
  const logger = new Logger();
  const lines = captureStderr(() => logger.childStderr('mySrv', Buffer.from('child output\n')));
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes('[ch1tty:mySrv]'), `got: ${lines[0]}`);
  assert.ok(lines[0].includes('child output'));
});

test('childStderr json: writes debug entry with trimmed chunk', () => {
  delete process.env.CH1TTY_LOG_LEVEL;
  process.env.CH1TTY_LOG_FORMAT = 'json';
  const logger = new Logger();
  logger.setLevel('debug');
  const lines = captureStderr(() => logger.childStderr('srvX', Buffer.from('line\n')));
  delete process.env.CH1TTY_LOG_FORMAT;
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0].trim());
  assert.equal(entry.level, 'debug');
  assert.equal(entry.msg, 'line');
  assert.equal(entry.server, 'srvX');
});

test('childStderr json: suppressed at info level (debug < info)', () => {
  delete process.env.CH1TTY_LOG_LEVEL;
  process.env.CH1TTY_LOG_FORMAT = 'json';
  const logger = new Logger();
  const lines = captureStderr(() => logger.childStderr('srvY', Buffer.from('silent\n')));
  delete process.env.CH1TTY_LOG_FORMAT;
  assert.equal(lines.length, 0);
});
