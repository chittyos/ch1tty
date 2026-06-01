import assert from 'node:assert/strict';
import { describe, test, beforeEach, afterEach } from 'node:test';
import { Logger } from '../src/logger.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

function captureStderr(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  (process.stderr as NodeJS.WriteStream & { write: typeof process.stderr.write }).write = (
    chunk: string | Uint8Array,
    ..._rest: unknown[]
  ) => {
    lines.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
    return true;
  };
  return { lines, restore: () => { process.stderr.write = original; } };
}

function makeLogger(overrides: Record<string, string | undefined> = {}): Logger {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const logger = new Logger();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return logger;
}

// ─── level filtering ─────────────────────────────────────────────────────────

describe('Logger level filtering', () => {
  let cap: ReturnType<typeof captureStderr>;
  beforeEach(() => { cap = captureStderr(); });
  afterEach(() => cap.restore());

  test('default level is info: debug messages are suppressed', () => {
    const logger = makeLogger({ CH1TTY_LOG_LEVEL: 'info', CH1TTY_LOG_FORMAT: undefined });
    logger.debug('should not appear');
    assert.equal(cap.lines.length, 0);
  });

  test('default level is info: info messages are written', () => {
    const logger = makeLogger({ CH1TTY_LOG_LEVEL: 'info', CH1TTY_LOG_FORMAT: undefined });
    logger.info('hello');
    assert.equal(cap.lines.length, 1);
    assert.ok(cap.lines[0].includes('hello'));
  });

  test('CH1TTY_LOG_LEVEL=debug allows debug messages', () => {
    const logger = makeLogger({ CH1TTY_LOG_LEVEL: 'debug', CH1TTY_LOG_FORMAT: undefined });
    logger.debug('verbose');
    assert.equal(cap.lines.length, 1);
    assert.ok(cap.lines[0].includes('verbose'));
  });

  test('CH1TTY_LOG_LEVEL=warn suppresses info messages', () => {
    const logger = makeLogger({ CH1TTY_LOG_LEVEL: 'warn', CH1TTY_LOG_FORMAT: undefined });
    logger.info('quiet');
    assert.equal(cap.lines.length, 0);
  });

  test('CH1TTY_LOG_LEVEL=warn allows warn messages', () => {
    const logger = makeLogger({ CH1TTY_LOG_LEVEL: 'warn', CH1TTY_LOG_FORMAT: undefined });
    logger.warn('loud');
    assert.equal(cap.lines.length, 1);
  });

  test('CH1TTY_LOG_LEVEL=error suppresses warn messages', () => {
    const logger = makeLogger({ CH1TTY_LOG_LEVEL: 'error', CH1TTY_LOG_FORMAT: undefined });
    logger.warn('muted');
    assert.equal(cap.lines.length, 0);
  });

  test('CH1TTY_LOG_LEVEL=error allows error messages', () => {
    const logger = makeLogger({ CH1TTY_LOG_LEVEL: 'error', CH1TTY_LOG_FORMAT: undefined });
    logger.error('boom');
    assert.equal(cap.lines.length, 1);
  });

  test('unknown CH1TTY_LOG_LEVEL falls back to info', () => {
    const logger = makeLogger({ CH1TTY_LOG_LEVEL: 'verbose', CH1TTY_LOG_FORMAT: undefined });
    logger.debug('suppressed');
    assert.equal(cap.lines.length, 0, 'debug should be suppressed at fallback info level');
    logger.info('visible');
    assert.equal(cap.lines.length, 1);
  });
});

// ─── text format ─────────────────────────────────────────────────────────────

describe('Logger text format (default)', () => {
  let cap: ReturnType<typeof captureStderr>;
  beforeEach(() => { cap = captureStderr(); });
  afterEach(() => cap.restore());

  test('uses [ch1tty] prefix with no server', () => {
    const logger = makeLogger({ CH1TTY_LOG_LEVEL: 'debug', CH1TTY_LOG_FORMAT: undefined });
    logger.info('test-msg');
    assert.equal(cap.lines.length, 1);
    assert.ok(cap.lines[0].startsWith('[ch1tty] '), `got: ${cap.lines[0]}`);
    assert.ok(cap.lines[0].includes('test-msg'));
  });

  test('uses [ch1tty:serverId] prefix when server is provided', () => {
    const logger = makeLogger({ CH1TTY_LOG_LEVEL: 'debug', CH1TTY_LOG_FORMAT: undefined });
    logger.info('test-msg', 'myserver');
    assert.equal(cap.lines.length, 1);
    assert.ok(cap.lines[0].startsWith('[ch1tty:myserver] '), `got: ${cap.lines[0]}`);
  });

  test('debug() writes at debug level', () => {
    const logger = makeLogger({ CH1TTY_LOG_LEVEL: 'debug', CH1TTY_LOG_FORMAT: undefined });
    logger.debug('dbg');
    assert.ok(cap.lines[0].includes('dbg'));
  });

  test('warn() writes at warn level', () => {
    const logger = makeLogger({ CH1TTY_LOG_LEVEL: 'debug', CH1TTY_LOG_FORMAT: undefined });
    logger.warn('wrn');
    assert.ok(cap.lines[0].includes('wrn'));
  });

  test('error() writes at error level', () => {
    const logger = makeLogger({ CH1TTY_LOG_LEVEL: 'debug', CH1TTY_LOG_FORMAT: undefined });
    logger.error('err');
    assert.ok(cap.lines[0].includes('err'));
  });

  test('output ends with newline', () => {
    const logger = makeLogger({ CH1TTY_LOG_LEVEL: 'debug', CH1TTY_LOG_FORMAT: undefined });
    logger.info('nl');
    assert.ok(cap.lines[0].endsWith('\n'), `got: ${JSON.stringify(cap.lines[0])}`);
  });
});

// ─── JSON format ─────────────────────────────────────────────────────────────

describe('Logger JSON format (CH1TTY_LOG_FORMAT=json)', () => {
  let cap: ReturnType<typeof captureStderr>;
  beforeEach(() => { cap = captureStderr(); });
  afterEach(() => cap.restore());

  test('output is valid JSON', () => {
    const logger = makeLogger({ CH1TTY_LOG_LEVEL: 'debug', CH1TTY_LOG_FORMAT: 'json' });
    logger.info('hello');
    assert.equal(cap.lines.length, 1);
    const entry = JSON.parse(cap.lines[0]);
    assert.ok(entry);
  });

  test('JSON entry has ts, level, and msg fields', () => {
    const logger = makeLogger({ CH1TTY_LOG_LEVEL: 'debug', CH1TTY_LOG_FORMAT: 'json' });
    logger.info('check-fields');
    const entry = JSON.parse(cap.lines[0]);
    assert.ok(typeof entry.ts === 'string', 'ts should be a string');
    assert.equal(entry.level, 'info');
    assert.equal(entry.msg, 'check-fields');
  });

  test('JSON entry includes server field when provided', () => {
    const logger = makeLogger({ CH1TTY_LOG_LEVEL: 'debug', CH1TTY_LOG_FORMAT: 'json' });
    logger.warn('with-server', 'srv1');
    const entry = JSON.parse(cap.lines[0]);
    assert.equal(entry.server, 'srv1');
    assert.equal(entry.level, 'warn');
  });

  test('JSON entry omits server field when not provided', () => {
    const logger = makeLogger({ CH1TTY_LOG_LEVEL: 'debug', CH1TTY_LOG_FORMAT: 'json' });
    logger.info('no-server');
    const entry = JSON.parse(cap.lines[0]);
    assert.ok(!('server' in entry), 'server should not be present');
  });

  test('JSON entry spreads extra fields', () => {
    const logger = makeLogger({ CH1TTY_LOG_LEVEL: 'debug', CH1TTY_LOG_FORMAT: 'json' });
    logger.error('with-extra', undefined, { code: 42, subsystem: 'test' });
    const entry = JSON.parse(cap.lines[0]);
    assert.equal(entry.code, 42);
    assert.equal(entry.subsystem, 'test');
  });

  test('ts field is a valid ISO date string', () => {
    const before = Date.now();
    const logger = makeLogger({ CH1TTY_LOG_LEVEL: 'debug', CH1TTY_LOG_FORMAT: 'json' });
    logger.info('ts-check');
    const after = Date.now();
    const entry = JSON.parse(cap.lines[0]);
    const ts = new Date(entry.ts).getTime();
    assert.ok(ts >= before && ts <= after, `ts ${entry.ts} not in expected range`);
  });

  test('level filtering still applies in JSON mode', () => {
    const logger = makeLogger({ CH1TTY_LOG_LEVEL: 'warn', CH1TTY_LOG_FORMAT: 'json' });
    logger.info('suppressed');
    assert.equal(cap.lines.length, 0);
    logger.warn('visible');
    assert.equal(cap.lines.length, 1);
  });
});

// ─── childStderr ─────────────────────────────────────────────────────────────

describe('Logger.childStderr', () => {
  let cap: ReturnType<typeof captureStderr>;
  beforeEach(() => { cap = captureStderr(); });
  afterEach(() => cap.restore());

  test('text mode: writes raw chunk with server prefix', () => {
    const logger = makeLogger({ CH1TTY_LOG_LEVEL: 'debug', CH1TTY_LOG_FORMAT: undefined });
    logger.childStderr('svc1', Buffer.from('child output line\n'));
    assert.equal(cap.lines.length, 1);
    assert.ok(cap.lines[0].includes('[ch1tty:svc1]'), `got: ${cap.lines[0]}`);
    assert.ok(cap.lines[0].includes('child output line'));
  });

  test('JSON mode: routes through debug write as valid JSON', () => {
    const logger = makeLogger({ CH1TTY_LOG_LEVEL: 'debug', CH1TTY_LOG_FORMAT: 'json' });
    logger.childStderr('svc2', Buffer.from('child json line'));
    assert.equal(cap.lines.length, 1);
    const entry = JSON.parse(cap.lines[0]);
    assert.equal(entry.level, 'debug');
    assert.equal(entry.server, 'svc2');
    assert.equal(entry.msg, 'child json line');
  });

  test('JSON mode: childStderr trims trailing whitespace', () => {
    const logger = makeLogger({ CH1TTY_LOG_LEVEL: 'debug', CH1TTY_LOG_FORMAT: 'json' });
    logger.childStderr('svc3', Buffer.from('trimmed   \n'));
    const entry = JSON.parse(cap.lines[0]);
    assert.equal(entry.msg, 'trimmed');
  });

  test('JSON mode with level=warn: debug childStderr is suppressed', () => {
    const logger = makeLogger({ CH1TTY_LOG_LEVEL: 'warn', CH1TTY_LOG_FORMAT: 'json' });
    logger.childStderr('svc4', Buffer.from('suppressed'));
    assert.equal(cap.lines.length, 0);
  });
});
