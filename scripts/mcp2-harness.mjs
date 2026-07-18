#!/usr/bin/env node
// /mcp2 harness — boots `wrangler dev` locally and exercises the McpAgent
// transport end-to-end against the real Worker bundle (no mocks):
//   1. bearer check (401 without token when CH1TTY_MCP_TOKEN is set)
//   2. MCP initialize handshake (streamable HTTP)
//   3. tools/list — expects the 9 ch1tty meta-tools
//   4. tools/call ch1tty search — real registry search (network-dependent;
//      upstream failures degrade to an empty registry, still a valid result)
//
// Usage: node scripts/mcp2-harness.mjs [--url http://127.0.0.1:8787] [--token X]
// Without --url it spawns `wrangler dev` itself and tears it down after.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const argv = process.argv.slice(2);
function arg(name) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

const TOKEN = arg('token') ?? process.env.CH1TTY_MCP_TOKEN ?? 'harness-local-token';
const PORT = Number(arg('port') ?? 8799);
let baseUrl = arg('url');

const ACCEPT = 'application/json, text/event-stream';

function parseSse(text) {
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      try { return JSON.parse(line.slice(6)); } catch { /* keep looking */ }
    }
  }
  return null;
}

async function rpc(url, body, { sessionId, token = TOKEN } = {}) {
  const headers = {
    'content-type': 'application/json',
    accept: ACCEPT,
    authorization: `Bearer ${token}`,
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('text/event-stream') ? parseSse(text) : (() => { try { return JSON.parse(text); } catch { return null; } })();
  return { status: res.status, data, sessionId: res.headers.get('mcp-session-id') ?? sessionId, raw: text };
}

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

let dev = null;
async function startDev() {
  dev = spawn('npx', [
    'wrangler', 'dev', '--config', 'wrangler.harness.jsonc',
    '--port', String(PORT), '--ip', '127.0.0.1',
    '--var', `CH1TTY_MCP_TOKEN:${TOKEN}`,
  ], { cwd: new URL('..', import.meta.url).pathname, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' } });
  let out = '';
  dev.stdout.on('data', (d) => { out += String(d); });
  dev.stderr.on('data', (d) => { out += String(d); });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (res.ok) return `http://127.0.0.1:${PORT}`;
    } catch { /* not up yet */ }
    if (dev.exitCode !== null) break;
    await sleep(1000);
  }
  console.error('wrangler dev failed to become healthy. Output tail:');
  console.error(out.slice(-4000));
  process.exit(1);
}

try {
  if (!baseUrl) baseUrl = await startDev();
  const mcp2 = `${baseUrl}/mcp2`;

  // 1. Bearer check.
  const unauth = await fetch(mcp2, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: ACCEPT },
    body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'harness', version: '0' } } }),
  });
  check('bearer: request without token is rejected', unauth.status === 401, `status=${unauth.status}`);

  // 2. Initialize handshake.
  const init = await rpc(mcp2, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'mcp2-harness', version: '1.0.0' } },
  });
  const serverInfo = init.data?.result?.serverInfo;
  check('initialize: 200 + serverInfo.name=ch1tty', init.status === 200 && serverInfo?.name === 'ch1tty',
    `status=${init.status} serverInfo=${JSON.stringify(serverInfo)} sessionId=${init.sessionId}`);
  check('initialize: mcp-session-id issued', Boolean(init.sessionId), init.sessionId ?? 'none');
  const sessionId = init.sessionId;

  await rpc(mcp2, { jsonrpc: '2.0', method: 'notifications/initialized' }, { sessionId });

  // 3. tools/list.
  const list = await rpc(mcp2, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { sessionId });
  const tools = (list.data?.result?.tools ?? []).map((t) => t.name).sort();
  const expected = ['cast', 'code', 'execute', 'memory_ingest', 'memory_recall', 'memory_summary', 'provision', 'search', 'status'];
  check('tools/list: all 9 meta-tools present', expected.every((t) => tools.includes(t)), `got [${tools.join(', ')}]`);
  const listedSearch = (list.data?.result?.tools ?? []).find((t) => t.name === 'search');
  check('tools/list: search params carry descriptions',
    Boolean(listedSearch?.inputSchema?.properties?.query?.description),
    JSON.stringify(listedSearch?.inputSchema?.properties?.query ?? null));

  // 4. tools/call search (real registry — may be empty if upstreams unreachable).
  const search = await rpc(mcp2, {
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'search', arguments: { query: 'ledger' } },
  }, { sessionId });
  const content = search.data?.result?.content;
  const text = content?.[0]?.type === 'text' ? content[0].text : null;
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* leave null */ }
  check('tools/call search: returns structured result', search.status === 200 && parsed !== null && (typeof parsed.matches === 'number' || Array.isArray(parsed.servers)),
    text ? text.slice(0, 200).replace(/\n/g, ' ') : `status=${search.status} raw=${String(search.raw).slice(0, 200)}`);

  // 5. status meta-tool (pure-local, no upstream dependency).
  const status = await rpc(mcp2, {
    jsonrpc: '2.0', id: 4, method: 'tools/call',
    params: { name: 'status', arguments: {} },
  }, { sessionId });
  const stext = status.data?.result?.content?.[0]?.text ?? null;
  let snap = null;
  try { snap = JSON.parse(stext); } catch { /* leave null */ }
  check('tools/call status: gateway snapshot', snap?.gateway === 'ch1tty', stext ? stext.slice(0, 120).replace(/\n/g, ' ') : `status=${status.status}`);

  console.log(failures === 0 ? '\nAll /mcp2 harness checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  if (dev) dev.kill('SIGTERM');
}
