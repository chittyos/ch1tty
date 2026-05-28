#!/usr/bin/env node
/**
 * viewport-probe.mjs — one-shot MCP digest fetcher for the SessionStart
 * viewport-hydration hook. Connects to mcp.chitty.cc/mcp via Streamable HTTP,
 * resolves the entity, recalls recent memory + active workstreams, and prints
 * a single JSON object to stdout describing what it found.
 *
 * It NEVER prints secrets. Output schema (stdout, single line JSON):
 *   { ok: true,  chitty_id, recent: [str], workstreams: [str] }
 *   { ok: false, error: "<short reason>" }
 *
 * All network work is bounded; the caller also wraps this in a wall-clock
 * `timeout`. Exit code is always 0 so the hook never crashes a session.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const ENDPOINT = process.env.CH1TTY_VIEWPORT_MCP_URL || 'https://mcp.chitty.cc/mcp';
const PROBE = process.env.CH1TTY_VIEWPORT_PROBE === '1'; // dump raw shapes
const REQ_TIMEOUT_MS = 4500;

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

/** Best-effort extraction of a flat string list from an MCP tool result. */
function textPayload(result) {
  const c = result?.content;
  if (!Array.isArray(c)) return null;
  const t = c.find((x) => x && x.type === 'text');
  if (!t) return null;
  try {
    return JSON.parse(t.text);
  } catch {
    return t.text; // raw string fallback
  }
}

function toStringList(payload, max) {
  if (!payload) return [];
  // Common shapes: {results:[...]}, {memories:[...]}, [...], {items:[...]}
  let arr = null;
  if (Array.isArray(payload)) arr = payload;
  else if (Array.isArray(payload.results)) arr = payload.results;
  else if (Array.isArray(payload.memories)) arr = payload.memories;
  else if (Array.isArray(payload.items)) arr = payload.items;
  else if (Array.isArray(payload.data)) arr = payload.data;
  if (!arr) return [];
  return arr
    .map((m) => {
      if (typeof m === 'string') return m;
      if (m && typeof m === 'object') {
        return m.content || m.text || m.summary || m.value || m.key || m.title || null;
      }
      return null;
    })
    .filter((s) => typeof s === 'string' && s.trim().length > 0)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .slice(0, max);
}

async function callSafe(client, name, args) {
  try {
    const res = await client.callTool({ name, arguments: args }, undefined, {
      timeout: REQ_TIMEOUT_MS,
    });
    return textPayload(res);
  } catch (err) {
    if (PROBE) console.error(`[probe] ${name} failed: ${err?.message || err}`);
    return null;
  }
}

async function main() {
  const headers = {};
  const id = process.env.CHITTY_CF_ACCESS_CLIENT_ID;
  const sec = process.env.CHITTY_CF_ACCESS_CLIENT_SECRET;
  const bearer = process.env.CHITTY_MCP_BEARER; // optional, injected by hook
  if (id && sec) {
    headers['CF-Access-Client-Id'] = id;
    headers['CF-Access-Client-Secret'] = sec;
  }
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`;

  if (!id || !sec) {
    emit({ ok: false, error: 'CF Access creds unset' });
    return;
  }

  const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
    requestInit: { headers },
  });
  const client = new Client({ name: 'viewport-hydration', version: '1.0.0' }, { capabilities: {} });

  // The MCP endpoint can stall indefinitely after auth (accepts the POST but
  // never frames a response). connect() has no built-in timeout, so race it.
  try {
    await Promise.race([
      client.connect(transport),
      new Promise((_, rej) => setTimeout(() => rej(new Error('connect timeout 3s')), 3000)),
    ]);
  } catch (err) {
    emit({ ok: false, error: `gateway unreachable (${String(err?.message || err).slice(0, 50)})` });
    try { await client.close(); } catch {}
    return;
  }

  // 1. Resolve entity
  const resolved = await callSafe(client, 'context_resolve', {
    session_id: process.env.CLAUDE_SESSION_ID || `viewport-${Date.now()}`,
  });
  if (PROBE) console.error('[probe] context_resolve raw:', JSON.stringify(resolved));

  const chittyId =
    (resolved && (resolved.chitty_id || resolved.chittyId || resolved.id)) || null;

  if (!chittyId) {
    emit({ ok: false, error: 'no chitty_id resolved' });
    try { await client.close(); } catch {}
    return;
  }

  // 2 + 3. Recent memory + active workstreams, concurrent
  const [recentRaw, wsRaw] = await Promise.all([
    callSafe(client, 'chitty_memory_recall', { query: 'recent session context', limit: 5 }),
    callSafe(client, 'chitty_memory_recall', { query: 'active workstreams', limit: 10 }),
  ]);
  if (PROBE) {
    console.error('[probe] recall(recent) raw:', JSON.stringify(recentRaw));
    console.error('[probe] recall(workstreams) raw:', JSON.stringify(wsRaw));
  }

  emit({
    ok: true,
    chitty_id: chittyId,
    recent: toStringList(recentRaw, 5),
    workstreams: toStringList(wsRaw, 10),
  });

  try { await client.close(); } catch {}
}

main()
  .catch((err) => {
    emit({ ok: false, error: `probe error (${String(err?.message || err).slice(0, 60)})` });
  })
  .finally(() => {
    // Force exit — SDK transport may hold the event loop open.
    setTimeout(() => process.exit(0), 50).unref();
  });
