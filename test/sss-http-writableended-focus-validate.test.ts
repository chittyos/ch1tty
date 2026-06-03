/**
 * SSS batch — 3 previously untested branches:
 *
 * 1. http-server.ts handleMcp catch block (lines 180-182):
 *    `else if (!res.writableEnded) { res.end(); }` — fires when
 *    transport.handleRequest() writes HTTP response headers (headersSent becomes
 *    true) and then throws. The catch block skips the 500 JSON path (headers
 *    already sent) and calls res.end() to close the stream cleanly.
 *    Tested by patching StreamableHTTPServerTransport.prototype.handleRequest to
 *    call res.writeHead(200) then throw; createMcpServer is also patched to a
 *    no-op fake so connect() carries no SDK side-effects.
 *
 * 2. focus.ts validateProfile line 53:
 *    `if (!isRecord(raw)) throw new Error(`${prefix} must be an object`)` — fires
 *    when a profile entry's value is not a plain object (null, string, array, …).
 *    All WW and focus.test.ts tests supply an actual object for every profile value;
 *    none ever passes null or another non-object type for the profile itself.
 *
 * 3. focus.ts loadFocusProfilesFromPath lines 143-147:
 *    `catch (err) { throw new Error(`Invalid focus profiles at ${path}: ${err}`) }`
 *    — fires when the file contains valid JSON but validateFocusProfiles() rejects
 *    its content. Every existing loadFocusProfilesFromPath test uses either a
 *    missing file (ENOENT path), a bad-JSON file (JSON.parse path), or the real
 *    focus-profiles.json (success path). None writes a valid JSON file with
 *    structurally invalid profiles to hit this validation-error wrap.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Aggregator } from '../src/aggregator.js';
import { HttpMcpServer } from '../src/http-server.js';
import { validateFocusProfiles, loadFocusProfilesFromPath } from '../src/focus.js';

let _seq = 0;
function dlqPath(): string {
  return join(tmpdir(), `ch1tty-sss-${process.pid}-${++_seq}.dlq.jsonl`);
}

// ── 1. http-server.ts: catch else if (!res.writableEnded) → res.end() ─────────

test('http handleMcp catch: handleRequest writes headers then throws → else writableEnded → res.end()', async () => {
  // Each test file runs in its own process (node --test), so patching the prototype
  // here cannot interfere with other test files.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto = StreamableHTTPServerTransport.prototype as any;
  const origHandleRequest = proto.handleRequest as unknown;

  // Patch: write headers (headersSent → true) then throw.
  // handleMcp catch: !res.headersSent → false (skip 500);
  //                  !res.writableEnded → true → res.end() ← the branch under test.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  proto.handleRequest = async (_req: unknown, res: any) => {
    res.writeHead(200);
    throw new Error('simulated post-header failure');
  };

  const dlq = dlqPath();
  const aggregator = new Aggregator([], { ledgerDlqPath: dlq });
  const httpServer = new HttpMcpServer(aggregator, { port: 0, bindAddress: '127.0.0.1' });

  // Patch createMcpServer to a no-op so connect() carries no SDK state side-effects.
  (httpServer as unknown as { createMcpServer: unknown }).createMcpServer = () => ({
    setRequestHandler: () => {},
    connect: async () => {},
    close: async () => {},
  });

  await httpServer.start();
  try {
    const res = await fetch(`http://127.0.0.1:${httpServer.getPort()}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: {
          protocolVersion: '2025-11-25', capabilities: {},
          clientInfo: { name: 'sss-test', version: '1.0.0' },
        },
      }),
    });

    // Patched handleRequest wrote 200 headers, then threw.
    // The real catch in handleMcp called res.end() — response completes cleanly.
    assert.equal(res.status, 200, 'response must complete (status from writeHead) — no hang, no crash');
  } finally {
    proto.handleRequest = origHandleRequest;
    await httpServer.stop();
    await aggregator.shutdown();
    rmSync(dlq, { force: true });
  }
});

// ── 2. focus.ts validateProfile: profile value is not a Record → throws ───────

test('validateFocusProfiles: profile value is null → validateProfile !isRecord → "must be an object"', () => {
  // profiles.x is null — not a Record — fires the !isRecord(raw) guard in validateProfile.
  assert.throws(
    () => validateFocusProfiles({ profiles: { x: null } }),
    /profiles\.x must be an object/,
    'a null profile value must throw with the profile name in the message',
  );
});

// ── 3. focus.ts loadFocusProfilesFromPath: valid JSON, invalid profiles ────────

test('loadFocusProfilesFromPath: valid JSON with invalid profile content → "Invalid focus profiles at..."', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-sss-'));
  const fp = join(dir, 'focus-profiles.json');

  try {
    // Valid JSON: parsed succeeds. But validateFocusProfiles throws because
    // 'x' declares no categories or servers → "must declare at least one".
    // loadFocusProfilesFromPath wraps that in "Invalid focus profiles at <path>: ..."
    writeFileSync(fp, JSON.stringify({ profiles: { x: { description: 'empty lens' } } }), 'utf-8');

    assert.throws(
      () => loadFocusProfilesFromPath(fp),
      /Invalid focus profiles at/,
      'valid JSON with invalid profile structure must throw "Invalid focus profiles at..."',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
