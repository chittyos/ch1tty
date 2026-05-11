#!/usr/bin/env node
/**
 * Benchmark candidate routing models for OllamaBrain.
 *
 * Mirrors OllamaBrain.buildPrompt() exactly: same JSON-format request, same
 * temperature, same shape of candidates. Measures warm latency + correctness
 * across a battery of cast-style queries. No mocks — hits the real Ollama
 * daemon at CH1TTY_OLLAMA_URL.
 *
 * Run:  node scripts/bench-routing-model.mjs
 */

const OLLAMA_URL = process.env.CH1TTY_OLLAMA_URL ?? 'http://127.0.0.1:11434';

const MODELS = ['llama3.2:3b', 'qwen2.5-coder:3b'];

// Realistic candidate set — shape matches ch1tty's actual aggregated registry.
const CANDIDATES = [
  { name: 'ch1tty/status',                  cat: 'meta',      desc: 'Gateway status — servers, tool counts, uptime' },
  { name: 'ch1tty/reload',                  cat: 'meta',      desc: 'Hot-reload servers.json without restart' },
  { name: 'tasks/create_task',              cat: 'tasks',     desc: 'Create a new task in the ChittyAgent tasks queue' },
  { name: 'tasks/list_tasks',               cat: 'tasks',     desc: 'List tasks for a session, project, or owner' },
  { name: 'tasks/update_task',              cat: 'tasks',     desc: 'Update task status, owner, or metadata' },
  { name: 'docket/pull_docket',             cat: 'legal',     desc: 'Pull live Cook County Circuit Court docket for a case' },
  { name: 'docket/next_hearing',            cat: 'legal',     desc: 'Return next scheduled court hearing for a case' },
  { name: 'evidence/ingest_document',       cat: 'legal',     desc: 'Ingest a document into the ChittyEvidence pipeline with chain of custody' },
  { name: 'evidence/verify_fact',           cat: 'legal',     desc: 'Move a fact through the verification lifecycle (draft→verified→locked)' },
  { name: 'registry/list_services',         cat: 'ecosystem', desc: 'List all registered ChittyOS services with tiers and health status' },
  { name: 'registry/search_services',       cat: 'ecosystem', desc: 'Search the ChittyOS service registry by capability or domain' },
  { name: 'cloudflare/deploy_worker',       cat: 'infra',     desc: 'Deploy a Cloudflare Worker to staging or production' },
  { name: 'cloudflare/tail_worker',         cat: 'infra',     desc: 'Stream live logs from a deployed Cloudflare Worker' },
  { name: 'neon/run_sql',                   cat: 'data',      desc: 'Execute a SQL query against a Neon Postgres branch' },
  { name: 'neon/create_branch',             cat: 'data',      desc: 'Create an ephemeral Neon branch for a PR or experiment' },
  { name: 'notion/create_page',             cat: 'docs',      desc: 'Create a new page in a Notion workspace' },
  { name: 'notion/search',                  cat: 'docs',      desc: 'Search Notion pages and databases by keyword' },
  { name: 'gmail/send_email',               cat: 'comms',     desc: 'Send an email through the user\'s Gmail account' },
  { name: 'gmail/find_email',               cat: 'comms',     desc: 'Search Gmail for emails matching a query' },
  { name: 'doorloop/find_lease',            cat: 'property',  desc: 'Find a lease in DoorLoop by tenant, unit, or property' },
];

const QUERIES = [
  { q: 'show me the gateway status',                                        expect: ['ch1tty/status'] },
  { q: 'when is my next court date',                                         expect: ['docket/next_hearing', 'docket/pull_docket'] },
  { q: 'upload this PDF as evidence',                                        expect: ['evidence/ingest_document'] },
  { q: 'list all ChittyOS services that are healthy',                        expect: ['registry/list_services', 'registry/search_services'] },
  { q: 'run a SQL query to count user records',                              expect: ['neon/run_sql'] },
  { q: 'deploy the latest worker to production',                             expect: ['cloudflare/deploy_worker'] },
  { q: 'create a task to follow up on the Bianchi motion next Tuesday',      expect: ['tasks/create_task'] },
  { q: 'search my notion for the Q2 roadmap doc',                            expect: ['notion/search'] },
  { q: 'send an email confirming receipt to opposing counsel',               expect: ['gmail/send_email'] },
  { q: 'pull the docket for case 2024D007847',                               expect: ['docket/pull_docket'] },
];

function buildPrompt(query, candidates) {
  const list = candidates
    .map((c) => `- ${c.name} [${c.cat}]: ${c.desc.slice(0, 200)}`)
    .join('\n');
  const safeQuery = JSON.stringify(query);
  return `You are a tool router. Given a user query and a list of available tools, return only the tools whose purpose directly matches the query's intent.

Respond with a JSON object in this exact shape:
{"matches": [{"tool": "<namespacedName>", "confidence": <0.0-1.0>, "reason": "<one short phrase>"}]}

Rules:
- Use tool names exactly as listed. Never invent tools.
- confidence must be between 0.0 and 1.0.
- Return at most 5 matches. Return empty array if nothing fits.
- Do not include commentary outside the JSON object.

Tools:
${list}

Query: ${safeQuery}`;
}

async function generate(model, prompt, timeoutMs = 60000) {
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false, format: 'json', options: { temperature: 0.1 } }),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - t0;
    if (!res.ok) return { ok: false, latencyMs, error: `HTTP ${res.status}` };
    const payload = await res.json();
    return { ok: true, latencyMs, response: payload.response };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - t0, error: err.name === 'AbortError' ? 'timeout' : String(err) };
  } finally {
    clearTimeout(handle);
  }
}

function extractTopMatch(responseText) {
  try {
    const parsed = JSON.parse(responseText);
    const m = parsed?.matches;
    if (!Array.isArray(m) || m.length === 0) return null;
    const sorted = [...m].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    return sorted[0]?.tool ?? null;
  } catch {
    return null;
  }
}

async function warmup(model) {
  process.stdout.write(`Warming ${model}... `);
  const t0 = Date.now();
  const res = await generate(model, 'ok', 120000);
  console.log(`${res.ok ? 'ok' : 'FAILED: ' + res.error} (${Date.now() - t0}ms)`);
}

async function benchModel(model) {
  console.log(`\n=== ${model} ===`);
  await warmup(model);

  const results = [];
  for (const { q, expect } of QUERIES) {
    const prompt = buildPrompt(q, CANDIDATES);
    const r = await generate(model, prompt, 60000);
    if (!r.ok) {
      results.push({ q, latencyMs: r.latencyMs, top: null, hit: false, error: r.error });
      console.log(`  [${r.latencyMs.toString().padStart(5)}ms] FAIL (${r.error}): ${q}`);
      continue;
    }
    const top = extractTopMatch(r.response);
    const hit = top && expect.includes(top);
    results.push({ q, latencyMs: r.latencyMs, top, hit });
    console.log(`  [${r.latencyMs.toString().padStart(5)}ms] ${hit ? 'HIT ' : 'MISS'} top=${top ?? '(none)'}  query="${q}"`);
  }

  const ok = results.filter((r) => !r.error);
  const hits = results.filter((r) => r.hit).length;
  const lat = ok.map((r) => r.latencyMs).sort((a, b) => a - b);
  const median = lat.length ? lat[Math.floor(lat.length / 2)] : 0;
  const p90 = lat.length ? lat[Math.floor(lat.length * 0.9)] : 0;
  const max = lat.length ? lat[lat.length - 1] : 0;
  const under5s = ok.filter((r) => r.latencyMs < 5000).length;

  console.log(`  ── median=${median}ms  p90=${p90}ms  max=${max}ms  hits=${hits}/${QUERIES.length}  under_5s=${under5s}/${QUERIES.length}`);
  return { model, median, p90, max, hits, total: QUERIES.length, under5s };
}

(async () => {
  const summary = [];
  for (const model of MODELS) {
    summary.push(await benchModel(model));
  }
  console.log(`\n=== SUMMARY ===`);
  console.table(summary);
})();
