#!/usr/bin/env node
/**
 * Benchmark EmbeddingBrain against the same query/candidate set used by
 * scripts/bench-routing-model.mjs (the generative-routing benchmark).
 *
 * Runs the real EmbeddingBrain class against a real Ollama daemon (no mocks
 * per CLAUDE.md). Reports cold call, warm calls, cache-hit calls, and
 * end-to-end accuracy vs expected matches.
 *
 * Run:  npm run build && node scripts/bench-embedding-brain.mjs
 */

import { EmbeddingBrain } from '../dist/embedding-brain.js';

const CANDIDATES = [
  { namespacedName: 'ch1tty/status',                  category: 'meta',      description: 'Gateway status — servers, tool counts, uptime' },
  { namespacedName: 'ch1tty/reload',                  category: 'meta',      description: 'Hot-reload servers.json without restart' },
  { namespacedName: 'tasks/create_task',              category: 'tasks',     description: 'Create a new task in the ChittyAgent tasks queue' },
  { namespacedName: 'tasks/list_tasks',               category: 'tasks',     description: 'List tasks for a session, project, or owner' },
  { namespacedName: 'tasks/update_task',              category: 'tasks',     description: 'Update task status, owner, or metadata' },
  { namespacedName: 'docket/pull_docket',             category: 'legal',     description: 'Pull live Cook County Circuit Court docket for a case' },
  { namespacedName: 'docket/next_hearing',            category: 'legal',     description: 'Return next scheduled court hearing for a case' },
  { namespacedName: 'evidence/ingest_document',       category: 'legal',     description: 'Ingest a document into the ChittyEvidence pipeline with chain of custody' },
  { namespacedName: 'evidence/verify_fact',           category: 'legal',     description: 'Move a fact through the verification lifecycle (draft→verified→locked)' },
  { namespacedName: 'registry/list_services',         category: 'ecosystem', description: 'List all registered ChittyOS services with tiers and health status' },
  { namespacedName: 'registry/search_services',       category: 'ecosystem', description: 'Search the ChittyOS service registry by capability or domain' },
  { namespacedName: 'cloudflare/deploy_worker',       category: 'infra',     description: 'Deploy a Cloudflare Worker to staging or production' },
  { namespacedName: 'cloudflare/tail_worker',         category: 'infra',     description: 'Stream live logs from a deployed Cloudflare Worker' },
  { namespacedName: 'neon/run_sql',                   category: 'data',      description: 'Execute a SQL query against a Neon Postgres branch' },
  { namespacedName: 'neon/create_branch',             category: 'data',      description: 'Create an ephemeral Neon branch for a PR or experiment' },
  { namespacedName: 'notion/create_page',             category: 'docs',      description: 'Create a new page in a Notion workspace' },
  { namespacedName: 'notion/search',                  category: 'docs',      description: 'Search Notion pages and databases by keyword' },
  { namespacedName: 'gmail/send_email',               category: 'comms',     description: 'Send an email through the user\'s Gmail account' },
  { namespacedName: 'gmail/find_email',               category: 'comms',     description: 'Search Gmail for emails matching a query' },
  { namespacedName: 'doorloop/find_lease',            category: 'property',  description: 'Find a lease in DoorLoop by tenant, unit, or property' },
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

async function timed(label, fn) {
  const t0 = Date.now();
  const r = await fn();
  const ms = Date.now() - t0;
  return { ms, result: r };
}

(async () => {
  const brain = new EmbeddingBrain({ minSimilarity: 0.3, topK: 3 });
  console.log(`Model: ${brain.config.model}  URL: ${brain.config.url}`);

  console.log('\n=== Warmup ===');
  const warm = await timed('warmup', () => brain.warmup());
  console.log(`warmup: ${warm.ms}ms (ok=${warm.result})`);

  console.log('\n=== Cold cast (embeds 20 candidates + query) ===');
  const first = await timed('first', () => brain.route(QUERIES[0].q, CANDIDATES));
  const firstTop = first.result?.[0];
  const firstHit = firstTop && QUERIES[0].expect.includes(firstTop.tool.namespacedName);
  console.log(`  [${first.ms}ms] ${firstHit ? 'HIT ' : 'MISS'} top=${firstTop?.tool.namespacedName ?? '(none)'} sim=${firstTop?.confidence.toFixed(3) ?? 'n/a'}  query="${QUERIES[0].q}"`);

  console.log('\n=== Warm casts (candidates cached) ===');
  const results = [];
  for (let i = 1; i < QUERIES.length; i++) {
    const { q, expect } = QUERIES[i];
    const { ms, result } = await timed(q, () => brain.route(q, CANDIDATES));
    const top = result?.[0];
    const hit = top && expect.includes(top.tool.namespacedName);
    results.push({ ms, hit: !!hit, top: top?.tool.namespacedName ?? null });
    console.log(`  [${ms.toString().padStart(5)}ms] ${hit ? 'HIT ' : 'MISS'} top=${top?.tool.namespacedName ?? '(none)'} sim=${top?.confidence.toFixed(3) ?? 'n/a'}  query="${q}"`);
  }

  const warmLatencies = results.map((r) => r.ms).sort((a, b) => a - b);
  const median = warmLatencies[Math.floor(warmLatencies.length / 2)];
  const p90 = warmLatencies[Math.floor(warmLatencies.length * 0.9)];
  const max = warmLatencies[warmLatencies.length - 1];
  const hits = results.filter((r) => r.hit).length + (firstHit ? 1 : 0);
  const under500 = results.filter((r) => r.ms < 500).length + (first.ms < 500 ? 1 : 0);

  console.log('\n=== SUMMARY ===');
  console.log(`first (cold cache):  ${first.ms}ms`);
  console.log(`warm median:         ${median}ms`);
  console.log(`warm p90:            ${p90}ms`);
  console.log(`warm max:            ${max}ms`);
  console.log(`hits:                ${hits}/${QUERIES.length}`);
  console.log(`under_500ms:         ${under500}/${QUERIES.length}`);
  console.log(`stats:               ${JSON.stringify(brain.getStats())}`);
})();
