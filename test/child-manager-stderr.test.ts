/**
 * child-manager.ts:175 — stderr data handler coverage.
 *
 * Spawns a real Node.js child that writes to stderr immediately at startup.
 * Verifies that the data handler registered in doSpawn() forwards each chunk
 * to log.childStderr() — the only uncovered line in child-manager.ts.
 *
 * The script is a .mjs (ES module) so it can use top-level await to idle
 * while the parent receives the stderr data before connect() times out.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Set before import — ChildManager reads this at call time (not module load).
// 2 000 ms gives the child script 800 ms to write stderr before we hit timeout.
process.env.CH1TTY_SPAWN_TIMEOUT_MS = '2000';

const { ChildManager } = await import('../src/child-manager.js');
import { log } from '../src/logger.js';
import type { LocalServerConfig } from '../src/types.js';

const dir = mkdtempSync(join(tmpdir(), 'ch1tty-cm-stderr-'));
after(() => rmSync(dir, { recursive: true, force: true }));

test('doSpawn: stderr data from child process is forwarded via log.childStderr', async (t) => {
  // Script writes a recognisable marker to stderr then idles 800 ms so the
  // parent has time to receive the data event before the process exits.
  const script = join(dir, 'emit-stderr.mjs');
  writeFileSync(
    script,
    [
      'process.stderr.write("child-test-stderr-line\\n");',
      'await new Promise(r => setTimeout(r, 800));',
      'process.exit(0);',
    ].join('\n'),
  );

  // Spy on log.childStderr — same singleton used by ChildManager (ESM cache).
  const logged: Array<{ id: string; data: string }> = [];
  const origChildStderr = log.childStderr.bind(log);
  log.childStderr = (id: string, chunk: Buffer) => {
    logged.push({ id, data: chunk.toString() });
    origChildStderr(id, chunk);
  };
  t.after(() => {
    log.childStderr = origChildStderr;
  });

  const cm = new ChildManager();
  const config: LocalServerConfig = {
    id: 'cm-stderr-test',
    name: 'Stderr Test Server',
    type: 'local',
    access: 'readwrite',
    category: 'code',
    command: 'node',
    args: [script],
  };
  cm.registerServer(config);

  // listTools → spawn → doSpawn:
  //   1. Transport created with stderr: 'pipe' → transport.stderr is a PassThrough
  //   2. if (stderr) TRUE branch taken → handler registered on PassThrough
  //   3. client.connect() awaits MCP initialize (never arrives)
  //   4. During the await, child writes stderr → PassThrough emits 'data'
  //      → handler fires → log.childStderr() called  ← line 175 covered
  //   5. After 800 ms child exits → connect() eventually fails → listTools returns []
  await cm.listTools('cm-stderr-test').catch(() => {});

  // Give the event loop a moment to drain any remaining pipe events.
  await new Promise<void>((r) => setTimeout(r, 150));

  assert.ok(
    logged.some((e) => e.id === 'cm-stderr-test' && e.data.includes('child-test-stderr-line')),
    `log.childStderr was not called with expected data. Captured: ${JSON.stringify(logged)}`,
  );

  await cm.shutdown();
});
