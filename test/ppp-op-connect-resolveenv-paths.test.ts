/**
 * PPP batch — 5 tests covering previously untested branches in child-manager.ts:
 *
 *  1. isOpAvailable(): OP_CONNECT_HOST + OP_CONNECT_TOKEN set, op whoami fails,
 *     op vault list ALSO fails (PATH clobbered) → inner catch fires → opAvailable=false.
 *     This is the "Connect Server mode attempted but unavailable" path
 *     (child-manager.ts lines ~99–107, inner catch branch).
 *
 *  2. isOpAvailable(): OP_CONNECT_HOST + OP_CONNECT_TOKEN set, op whoami fails,
 *     but op vault list SUCCEEDS (via a fake op binary) → opAvailable=true.
 *     This is the "Connect Server mode active" path (inner try succeeds).
 *
 *  3. resolveEnv(): config.env has an op:// key AND isOpAvailable() → false →
 *     the key is deleted from resolved before the env is returned.
 *     (child-manager.ts lines ~120–124: warn + delete loop).
 *
 *  4. resolveEnv(): config.env has an op:// key AND isOpAvailable() → true
 *     but the `op read` call fails → allSettled yields rejected entry →
 *     log.error fires and the key is NOT overwritten in resolved (stays as
 *     its raw op:// value). (child-manager.ts lines ~132–135: rejected branch).
 *
 *  5. resolveEnv(): config.env has an op:// key AND isOpAvailable() → true
 *     AND `op read` succeeds (fake binary echoes the secret) → allSettled
 *     yields fulfilled entry → resolved[key] updated to secret value.
 *     (child-manager.ts lines ~133–135: fulfilled branch).
 *
 * All tests access private methods via `as unknown as` casts, following the
 * established pattern in hhh-child-manager-http-gaps.test.ts.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChildManager } from '../src/child-manager.js';
import type { LocalServerConfig } from '../src/types.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function localCfg(
  id: string,
  env?: Record<string, string>,
): LocalServerConfig {
  return {
    id,
    name: id,
    type: 'local',
    access: 'readwrite',
    category: 'code',
    command: `/nonexistent/${id}`,
    args: [],
    ...(env ? { env } : {}),
  };
}

type CmPrivate = {
  isOpAvailable(): Promise<boolean>;
  resolveEnv(config: LocalServerConfig): Promise<Record<string, string>>;
  opAvailable: boolean | null;
};

function asPrivate(cm: ChildManager): CmPrivate {
  return cm as unknown as CmPrivate;
}

/** Create a temp dir with a fake `op` shell script. */
function fakeBinDir(whoamiExitCode: number, vaultListExitCode: number, readOutput: string): {
  dir: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-fake-op-'));
  const script = join(dir, 'op');
  // Base64-encode readOutput so the embedded shell literal is always safe,
  // regardless of single quotes or special characters in the value.
  const encoded = Buffer.from(readOutput, 'utf8').toString('base64');
  writeFileSync(
    script,
    `#!/bin/sh
case "$1" in
  whoami) exit ${whoamiExitCode} ;;
  vault)  exit ${vaultListExitCode} ;;
  read)   printf '%s' '${encoded}' | base64 -d; exit 0 ;;
  *)      exit 1 ;;
esac
`,
    'utf-8',
  );
  chmodSync(script, 0o755);
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ── 1. isOpAvailable: Connect Server mode attempted, vault list fails ─────────

test('isOpAvailable: OP_CONNECT vars set + op vault list fails → opAvailable=false', async () => {
  const origPath = process.env.PATH;
  const origHost = process.env.OP_CONNECT_HOST;
  const origToken = process.env.OP_CONNECT_TOKEN;

  process.env.PATH = '/nonexistent-bin-dir-ppp1';
  process.env.OP_CONNECT_HOST = 'https://connect.example.com';
  process.env.OP_CONNECT_TOKEN = 'fake-token-ppp1';

  const cm = new ChildManager();
  try {
    // op whoami → ENOENT (PATH clobbered)
    // OP_CONNECT_HOST + OP_CONNECT_TOKEN are set → inner if triggers
    // op vault list → ENOENT (same PATH) → inner catch → opAvailable = false
    const result = await asPrivate(cm).isOpAvailable();
    assert.equal(result, false, 'Connect Server mode: vault list fails → false');
    assert.equal(asPrivate(cm).opAvailable, false, 'opAvailable cached as false');
  } finally {
    if (origPath === undefined) delete process.env.PATH; else process.env.PATH = origPath;
    if (origHost === undefined) delete process.env.OP_CONNECT_HOST; else process.env.OP_CONNECT_HOST = origHost;
    if (origToken === undefined) delete process.env.OP_CONNECT_TOKEN; else process.env.OP_CONNECT_TOKEN = origToken;
    await cm.shutdown();
  }
});

// ── 2. isOpAvailable: Connect Server mode active, vault list succeeds ─────────

test('isOpAvailable: OP_CONNECT vars set + op vault list succeeds → opAvailable=true', async () => {
  // Create a fake `op` binary: whoami fails (exit 1), vault exits 0
  const { dir, cleanup } = fakeBinDir(1, 0, '');
  const origPath = process.env.PATH;
  const origHost = process.env.OP_CONNECT_HOST;
  const origToken = process.env.OP_CONNECT_TOKEN;

  process.env.PATH = `${dir}:${origPath ?? '/usr/bin'}`;
  process.env.OP_CONNECT_HOST = 'https://connect.example.com';
  process.env.OP_CONNECT_TOKEN = 'fake-token-ppp2';

  const cm = new ChildManager();
  try {
    // op whoami → exit 1 → outer catch fires
    // OP_CONNECT vars set → inner if: op vault list → exit 0 → opAvailable = true
    const result = await asPrivate(cm).isOpAvailable();
    assert.equal(result, true, 'Connect Server mode: vault list succeeds → true');
    assert.equal(asPrivate(cm).opAvailable, true, 'opAvailable cached as true');
  } finally {
    if (origPath === undefined) delete process.env.PATH; else process.env.PATH = origPath;
    if (origHost === undefined) delete process.env.OP_CONNECT_HOST; else process.env.OP_CONNECT_HOST = origHost;
    if (origToken === undefined) delete process.env.OP_CONNECT_TOKEN; else process.env.OP_CONNECT_TOKEN = origToken;
    cleanup();
    await cm.shutdown();
  }
});

// ── 3. resolveEnv: op:// key + isOpAvailable → false → key deleted ────────────

test('resolveEnv: op:// key when op unavailable → key removed from returned env', async () => {
  const cm = new ChildManager();
  // Force opAvailable=false to bypass the execFileAsync call entirely
  asPrivate(cm).opAvailable = false;

  const cfg = localCfg('ppp3-svc', {
    API_SECRET: 'op://vault/my-item/secret',
    PLAIN_KEY: 'plain-value',
  });

  try {
    const env = await asPrivate(cm).resolveEnv(cfg);
    // op:// key must be deleted (not passed as raw op:// string)
    assert.equal(env['API_SECRET'], undefined, 'op:// key must be removed when op is unavailable');
    // Non-op:// keys pass through unchanged
    assert.equal(env['PLAIN_KEY'], 'plain-value', 'non-op:// keys are preserved');
  } finally {
    await cm.shutdown();
  }
});

// ── 4. resolveEnv: op:// key + isOpAvailable → true + op read fails ──────────

test('resolveEnv: op:// key + op read fails → key stays as raw op:// value', async () => {
  // Fake op: whoami fails, read fails too (exit 1 for everything except vault)
  const origPath = process.env.PATH;
  // Use a PATH where `op` doesn't exist so `op read` will fail
  process.env.PATH = '/nonexistent-bin-dir-ppp4';

  const cm = new ChildManager();
  // Force opAvailable=true to skip isOpAvailable() network check; go straight to op read
  asPrivate(cm).opAvailable = true;

  const cfg = localCfg('ppp4-svc', {
    SECRET_KEY: 'op://vault/item/field',
    SAFE_KEY: 'literal-value',
  });

  try {
    // op read → ENOENT (PATH clobbered) → allSettled rejected entry →
    // log.error fires; resolved[SECRET_KEY] stays at 'op://vault/item/field'
    const env = await asPrivate(cm).resolveEnv(cfg);
    // The raw op:// string is kept because the rejection branch doesn't clear it
    assert.equal(env['SECRET_KEY'], 'op://vault/item/field', 'raw op:// value kept when read fails');
    assert.equal(env['SAFE_KEY'], 'literal-value', 'plain key unaffected');
  } finally {
    if (origPath === undefined) delete process.env.PATH; else process.env.PATH = origPath;
    await cm.shutdown();
  }
});

// ── 5. resolveEnv: op:// key + isOpAvailable → true + op read succeeds ────────

test('resolveEnv: op:// key + op read succeeds → key updated to resolved secret', async () => {
  // Fake op: whoami fails, read outputs 'super-secret'
  const { dir, cleanup } = fakeBinDir(1, 0, 'super-secret');
  const origPath = process.env.PATH;

  process.env.PATH = `${dir}:${origPath ?? '/usr/bin'}`;

  const cm = new ChildManager();
  // Force opAvailable=true so we skip whoami and go to op read directly
  asPrivate(cm).opAvailable = true;

  const cfg = localCfg('ppp5-svc', {
    DB_PASS: 'op://vault/db/password',
    PLAIN: 'unchanged',
  });

  try {
    const env = await asPrivate(cm).resolveEnv(cfg);
    // allSettled fulfilled entry → resolved['DB_PASS'] set to stdout.trim()
    assert.equal(env['DB_PASS'], 'super-secret', 'op:// key replaced by secret from op read');
    assert.equal(env['PLAIN'], 'unchanged', 'non-op:// key unaffected');
  } finally {
    if (origPath === undefined) delete process.env.PATH; else process.env.PATH = origPath;
    cleanup();
    await cm.shutdown();
  }
});
