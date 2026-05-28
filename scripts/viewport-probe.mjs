#!/usr/bin/env node
/**
 * viewport-probe.mjs — one-shot MCP digest fetcher for the SessionStart
 * viewport-hydration hook. Connects to mcp.chitty.cc/mcp via Streamable HTTP,
 * resolves the entity, recalls recent memory + active workstreams, and prints
 * a single JSON object to stdout describing what it found.
 *
 * Uses the canonical `viewport/*` namespace on ChittyMCP (chittyagent-viewport):
 *   - viewport/viewport_hydrate        — one round trip: doctrine seed +
 *                                        gateway identity + context resolve attempt
 *   - viewport/viewport_resolve_context — Person entity resolution via ChittyConnect
 *   - viewport/viewport_memory_recall   — entity-scoped memory recall
 *
 * Tools on ChittyMCP are namespaced `service/tool`; un-namespaced names are
 * rejected with `-32602: Tool must be namespaced`.
 *
 * It NEVER prints secrets. Output schema (stdout, single line JSON):
 *   { ok: true,  chitty_id, recent: [str], workstreams: [str] }
 *   { ok: false, error: "<short reason>", gateway_id?: "<id>" }
 *
 * All network work is bounded; the caller also wraps this in a wall-clock
 * `timeout`. Exit code is always 0 so the hook never crashes a session.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const ENDPOINT = process.env.CH1TTY_VIEWPORT_MCP_URL || 'https://mcp.chitty.cc/mcp';
const PROBE = process.env.CH1TTY_VIEWPORT_PROBE === '1'; // dump raw shapes
const REQ_TIMEOUT_MS = 6000;
const PLATFORM = process.env.CH1TTY_VIEWPORT_PLATFORM || 'claude-code';

// Namespaced tool names (service/tool) — un-namespaced calls are rejected.
const T_HYDRATE = 'viewport/viewport_hydrate';
const T_RESOLVE = 'viewport/viewport_resolve_context';
const T_RECALL = 'viewport/viewport_memory_recall';

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

/** Best-effort extraction of a parsed JSON (or raw string) from an MCP result. */
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
  // Recall success shape is not yet observed live (ChittyConnect 401s for CLI
  // creds). Defensively handle the common envelopes the service may use.
  let arr = null;
  if (Array.isArray(payload)) arr = payload;
  else if (Array.isArray(payload.memories)) arr = payload.memories;
  else if (Array.isArray(payload.results)) arr = payload.results;
  else if (Array.isArray(payload.items)) arr = payload.items;
  else if (Array.isArray(payload.data)) arr = payload.data;
  else if (Array.isArray(payload.recalled)) arr = payload.recalled;
  if (!arr) return [];
  return arr
    .map((m) => {
      if (typeof m === 'string') return m;
      if (m && typeof m === 'object') {
        return m.content || m.text || m.summary || m.value || m.title || m.key || null;
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
    return { payload: textPayload(res), isError: res?.isError === true };
  } catch (err) {
    if (PROBE) console.error(`[probe] ${name} failed: ${err?.message || err}`);
    return { payload: null, isError: true };
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

  // connect() has no built-in timeout, so race it — the endpoint can in theory
  // accept the POST but never frame a response.
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

  const sessionId = process.env.CLAUDE_SESSION_ID || `viewport-${Date.now()}`;

  // 1. Hydrate: single round trip giving gateway identity + doctrine + context
  //    resolution attempt. Real shape (observed live):
  //    { gateway:{chittyId,...}, doctrine:{...}, context:{resolved, chittyId?, status?}, ... }
  const { payload: hydrate } = await callSafe(client, T_HYDRATE, {
    sessionId,
    platform: PLATFORM,
  });
  if (PROBE) console.error('[probe] hydrate raw:', JSON.stringify(hydrate));

  const gatewayId = hydrate?.gateway?.chittyId || null;
  let ctx = hydrate?.context || null;

  // Fall back to a direct resolve if hydrate didn't carry a context block.
  if (!ctx) {
    const r = await callSafe(client, T_RESOLVE, { sessionId });
    ctx = r.payload || null;
    if (PROBE) console.error('[probe] resolve raw:', JSON.stringify(ctx));
  }

  // The user-entity chitty_id comes from the resolved context — NOT the gateway
  // (the gateway id is chittyagent-viewport's own Synthetic Person identity).
  const resolved = ctx && ctx.resolved === true;
  const chittyId = resolved
    ? (ctx.chittyId || ctx.chitty_id || ctx.id || null)
    : null;

  if (!chittyId) {
    // Real finding: ChittyConnect resolution failed. Surface the precise status
    // (e.g. 401 means the viewport worker lacks its ChittyConnect API key — a
    // server-side fix, not something a CLI session header can supply).
    const status = ctx && (ctx.status || ctx.detail) ? ` (status ${ctx.status ?? ''})`.trimEnd() : '';
    const reason = ctx
      ? `context unresolved via chittyconnect${status}`
      : 'no context returned';
    emit({ ok: false, error: reason, ...(gatewayId ? { gateway_id: gatewayId } : {}) });
    try { await client.close(); } catch {}
    return;
  }

  // 2 + 3. Recent memory + active workstreams, concurrent, entity-scoped.
  const [recentRes, wsRes] = await Promise.all([
    callSafe(client, T_RECALL, { entityId: chittyId, query: 'recent session context', limit: 5 }),
    callSafe(client, T_RECALL, { entityId: chittyId, query: 'active workstreams', limit: 10 }),
  ]);
  if (PROBE) {
    console.error('[probe] recall(recent) raw:', JSON.stringify(recentRes.payload));
    console.error('[probe] recall(workstreams) raw:', JSON.stringify(wsRes.payload));
  }

  // recalled:false => recall not available; treat as empty rather than failing
  // the whole probe (we still have a resolved chitty_id worth surfacing).
  const recentPayload = recentRes.isError ? null : recentRes.payload;
  const wsPayload = wsRes.isError ? null : wsRes.payload;

  emit({
    ok: true,
    chitty_id: chittyId,
    recent: toStringList(recentPayload, 5),
    workstreams: toStringList(wsPayload, 10),
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
