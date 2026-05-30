// Security guard tests for CH1TTY_ALLOW_UNAUTH / CH1TTY_MCP_TOKEN binding behaviour.
// Verifies the fail-closed guard in HttpMcpServer.start():
//   - no token + non-loopback + no ALLOW_UNAUTH → rejects (refuses to bind)
//   - no token + non-loopback + ALLOW_UNAUTH=1  → binds (with warning)
//   - no token + loopback (127.0.0.1)           → binds (with warning)
//   - no token + loopback (localhost)            → binds (with warning)
//   - token set + non-loopback                  → binds (authenticated)
//   - env read at start() call time, not construction time

import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { Aggregator } from '../src/aggregator.js';
import { HttpMcpServer } from '../src/http-server.js';

let _seq = 0;
function makeDlq(): string {
  return join(tmpdir(), `ch1tty-auth-guard-${process.pid}-${++_seq}.dlq.jsonl`);
}

// Run sequentially — tests mutate process.env.CH1TTY_ALLOW_UNAUTH
test('HttpMcpServer auth guard (CH1TTY_ALLOW_UNAUTH)', { concurrency: false }, async (t) => {
  const ORIGINAL_ALLOW_UNAUTH = process.env['CH1TTY_ALLOW_UNAUTH'];
  const restoreEnv = () => {
    if (ORIGINAL_ALLOW_UNAUTH === undefined) delete process.env['CH1TTY_ALLOW_UNAUTH'];
    else process.env['CH1TTY_ALLOW_UNAUTH'] = ORIGINAL_ALLOW_UNAUTH;
  };

  await t.test('non-loopback + no token + no ALLOW_UNAUTH → rejects with informative message', async () => {
    const dlq = makeDlq();
    const agg = new Aggregator([], { ledgerDlqPath: dlq });
    const srv = new HttpMcpServer(agg, { port: 0, bindAddress: '0.0.0.0' });
    delete process.env['CH1TTY_ALLOW_UNAUTH'];
    try {
      await assert.rejects(
        () => srv.start(),
        (err: Error) => {
          assert.ok(err.message.includes('Refusing to bind'), `message should say 'Refusing to bind': ${err.message}`);
          assert.ok(err.message.includes('CH1TTY_MCP_TOKEN'), `message should mention 'CH1TTY_MCP_TOKEN': ${err.message}`);
          assert.ok(err.message.includes('CH1TTY_ALLOW_UNAUTH'), `message should mention 'CH1TTY_ALLOW_UNAUTH': ${err.message}`);
          return true;
        },
      );
    } finally {
      restoreEnv();
      await agg.shutdown();
      rmSync(dlq, { force: true });
    }
  });

  await t.test('non-loopback + no token + ALLOW_UNAUTH=1 → binds successfully', async () => {
    const dlq = makeDlq();
    const agg = new Aggregator([], { ledgerDlqPath: dlq });
    const srv = new HttpMcpServer(agg, { port: 0, bindAddress: '0.0.0.0' });
    process.env['CH1TTY_ALLOW_UNAUTH'] = '1';
    try {
      await srv.start();
      assert.ok(srv.getPort() > 0, `expected ephemeral port, got ${srv.getPort()}`);
      await srv.stop();
    } finally {
      restoreEnv();
      await agg.shutdown();
      rmSync(dlq, { force: true });
    }
  });

  await t.test('loopback 127.0.0.1 + no token → binds successfully', async () => {
    const dlq = makeDlq();
    const agg = new Aggregator([], { ledgerDlqPath: dlq });
    const srv = new HttpMcpServer(agg, { port: 0, bindAddress: '127.0.0.1' });
    delete process.env['CH1TTY_ALLOW_UNAUTH'];
    try {
      await srv.start();
      assert.ok(srv.getPort() > 0, `expected ephemeral port, got ${srv.getPort()}`);
      await srv.stop();
    } finally {
      restoreEnv();
      await agg.shutdown();
      rmSync(dlq, { force: true });
    }
  });

  await t.test('loopback "localhost" + no token → binds successfully', async () => {
    const dlq = makeDlq();
    const agg = new Aggregator([], { ledgerDlqPath: dlq });
    const srv = new HttpMcpServer(agg, { port: 0, bindAddress: 'localhost' });
    delete process.env['CH1TTY_ALLOW_UNAUTH'];
    try {
      await srv.start();
      assert.ok(srv.getPort() > 0, `expected ephemeral port, got ${srv.getPort()}`);
      await srv.stop();
    } finally {
      restoreEnv();
      await agg.shutdown();
      rmSync(dlq, { force: true });
    }
  });

  await t.test('non-loopback + token set → binds successfully', async () => {
    const dlq = makeDlq();
    const agg = new Aggregator([], { ledgerDlqPath: dlq });
    const srv = new HttpMcpServer(agg, { port: 0, bindAddress: '0.0.0.0', mcpToken: 'test-secret' });
    delete process.env['CH1TTY_ALLOW_UNAUTH'];
    try {
      await srv.start();
      assert.ok(srv.getPort() > 0, `expected ephemeral port, got ${srv.getPort()}`);
      await srv.stop();
    } finally {
      restoreEnv();
      await agg.shutdown();
      rmSync(dlq, { force: true });
    }
  });

  await t.test('ALLOW_UNAUTH guard reads env at start() time, not construction time', async () => {
    // Env not set when server is constructed — set it before start()
    const dlq = makeDlq();
    const agg = new Aggregator([], { ledgerDlqPath: dlq });
    const srv = new HttpMcpServer(agg, { port: 0, bindAddress: '0.0.0.0' });
    delete process.env['CH1TTY_ALLOW_UNAUTH'];
    process.env['CH1TTY_ALLOW_UNAUTH'] = '1'; // set after construction, before start
    try {
      await srv.start();
      assert.ok(srv.getPort() > 0, 'should bind when ALLOW_UNAUTH set at start() call time');
      await srv.stop();
    } finally {
      restoreEnv();
      await agg.shutdown();
      rmSync(dlq, { force: true });
    }
  });

  await t.test('non-loopback + no token + ALLOW_UNAUTH not "1" → rejects (must be exactly "1")', async () => {
    const dlq = makeDlq();
    const agg = new Aggregator([], { ledgerDlqPath: dlq });
    const srv = new HttpMcpServer(agg, { port: 0, bindAddress: '0.0.0.0' });
    process.env['CH1TTY_ALLOW_UNAUTH'] = 'true'; // wrong value
    try {
      await assert.rejects(
        () => srv.start(),
        (err: Error) => {
          assert.ok(err.message.includes('Refusing to bind'), `expected refusal for ALLOW_UNAUTH='true': ${err.message}`);
          return true;
        },
      );
    } finally {
      restoreEnv();
      await agg.shutdown();
      rmSync(dlq, { force: true });
    }
  });
});
