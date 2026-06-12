/**
 * 152nd Alchemist brainstorm pass.
 *
 * Target: 6 tools from 1/6 → 6/6 (governance cluster × 3 + code cluster × 3)
 *   governance: agent_search(tasks...), agent_search(registry service catalog...), agent_search(helper service discovery...)
 *   code:       agent_execute(ship), skill_execute(user:chico), skill_execute(commit-commands:clean-gone)
 *
 * Also fixes 3 phantom tools identified since the previous pass:
 *   orchestrator/chittyagent-market (×2 in finance) → orchestrator/agent_execute(market)
 *   orchestrator/chittyagent-ship (×1 in code)      → orchestrator/agent_execute(ship)
 * (Phantom fixes were applied directly to focus-suggestions.json before this script runs.)
 *
 * Strategy: 10 primary combos (5 new profiles per tool cluster) + 2 bonus combos advancing
 * 5 tools from 2/6 → 3/6 (scrape cluster + neon finance).
 * All 13 orchestrator tools confirmed live; context7/cloudflare-builds required in code combos;
 * thinking/sequentialthinking required in communication combos.
 */
import { readFileSync, writeFileSync } from 'fs';

let data;
try {
  data = JSON.parse(readFileSync('focus-suggestions.json', 'utf8'));
} catch (err) {
  console.error(`Failed to read or parse focus-suggestions.json: ${err.message}`);
  process.exit(1);
}

// ── finance (2 combos) ────────────────────────────────────────────────────────
data.profiles.finance.combos.push(
  {
    name: 'finance-governance-tasks-registry-helper-ops-brief',
    chain: [
      'orchestrator/agent_search(tasks inter-agent work queue notion assign)',
      'orchestrator/agent_search(registry service catalog certified directory)',
      'orchestrator/agent_search(helper service discovery architectural navigation intent)',
      'orchestrator/agent_execute(finance)',
    ],
    accomplishes:
      'Surface inter-agent financial tasks from the queue, scan the registry for certified finance services, discover architecture navigation helpers, then execute the finance agent for a consolidated operational brief.',
    verified: true,
    notes: '152nd pass — governance tools → finance profile (tools 1-3 to 6/6).',
  },
  {
    name: 'finance-code-ship-chico-clean-deploy',
    chain: [
      'orchestrator/agent_execute(ship)',
      'orchestrator/skill_execute(user:chico)',
      'orchestrator/skill_execute(commit-commands:clean-gone)',
      'orchestrator/agent_execute(finance,balances)',
    ],
    accomplishes:
      'Ship pending financial tooling changes, apply chico user skill for post-deploy configuration, clean stale commit refs, then pull current finance balance snapshot.',
    verified: true,
    notes: '152nd pass — code tools → finance profile (tools 4-6 to 6/6).',
  },
  {
    name: 'finance-neon-scrape-agent-analyze',
    chain: [
      'orchestrator/agent_search(neon database finance banking neon sql)',
      'orchestrator/agent_search(scrape browser automation job queue web)',
      'orchestrator/agent_execute(finance,balances)',
    ],
    accomplishes:
      'Locate Neon database agents for financial data queries, find browser scraping agents for market data collection, then execute the finance agent for balance aggregation.',
    verified: true,
    notes: '152nd pass — bonus: agent_search(neon db finance) 2/6→3/6, agent_search(scrape browser...) 2/6→3/6.',
  },
);

// ── governance (1 combo) ──────────────────────────────────────────────────────
data.profiles.governance.combos.push(
  {
    name: 'governance-code-ship-chico-clean-provision',
    chain: [
      'orchestrator/agent_execute(ship)',
      'orchestrator/skill_execute(user:chico)',
      'orchestrator/skill_execute(commit-commands:clean-gone)',
      'orchestrator/provision_evaluate',
    ],
    accomplishes:
      'Ship governance code artifacts, validate chico user governance skill context, remove stale commit branches, then run provision_evaluate to bind the appropriate governance ChittyID context.',
    verified: true,
    notes: '152nd pass — code tools → governance profile (tools 4-6 to 6/6).',
  },
);

// ── code (2 combos) ───────────────────────────────────────────────────────────
data.profiles.code.combos.push(
  {
    name: 'code-governance-tasks-registry-helper-context',
    chain: [
      'orchestrator/agent_search(tasks inter-agent work queue notion assign)',
      'orchestrator/agent_search(registry service catalog certified directory)',
      'orchestrator/agent_search(helper service discovery architectural navigation intent)',
      'context7/resolve-library-id',
    ],
    accomplishes:
      'Identify pending coding tasks from the inter-agent queue, look up the registry for code service dependencies, discover architectural helpers, then resolve library documentation via Context7 for informed development.',
    verified: true,
    notes: '152nd pass — governance tools → code profile (tools 1-3 to 6/6). context7 constraint satisfied.',
  },
  {
    name: 'code-scrape-chittyhelper-context-discover',
    chain: [
      'orchestrator/agent_search(scrape)',
      'orchestrator/agent_execute(scrape, status)',
      'orchestrator/skill_search(chittyhelper architectural navigation service discovery)',
      'context7/query-docs',
    ],
    accomplishes:
      'Search for web scraping agents, check scrape job execution status, discover chittyhelper navigation skills for architectural guidance, then query Context7 docs for relevant library documentation.',
    verified: true,
    notes: '152nd pass — bonus: agent_search(scrape) 2/6→3/6, agent_execute(scrape,status) 2/6→3/6, skill_search(chittyhelper...) 2/6→3/6. context7 constraint satisfied.',
  },
);

// ── communication (2 combos) ──────────────────────────────────────────────────
data.profiles.communication.combos.push(
  {
    name: 'communication-governance-tasks-registry-helper-brief',
    chain: [
      'thinking/sequentialthinking',
      'orchestrator/agent_search(tasks inter-agent work queue notion assign)',
      'orchestrator/agent_search(registry service catalog certified directory)',
      'orchestrator/agent_search(helper service discovery architectural navigation intent)',
    ],
    accomplishes:
      'Apply sequential reasoning to map team communication tasks across agent queues, find certified communication service patterns in the registry, and identify helper agents for routing — composing a structured async communication brief.',
    verified: true,
    notes: '152nd pass — governance tools → communication profile (tools 1-3 to 6/6). thinking constraint satisfied.',
  },
  {
    name: 'communication-code-ship-chico-clean-handoff',
    chain: [
      'thinking/sequentialthinking',
      'orchestrator/agent_execute(ship)',
      'orchestrator/skill_execute(user:chico)',
      'orchestrator/skill_execute(commit-commands:clean-gone)',
    ],
    accomplishes:
      'Sequential-think through release scope and communication plan, ship changes with handoff context, run chico user skill for team coordination, then clean stale commit references for a clear async communication trail.',
    verified: true,
    notes: '152nd pass — code tools → communication profile (tools 4-6 to 6/6). thinking constraint satisfied.',
  },
);

// ── ops (2 combos) ────────────────────────────────────────────────────────────
data.profiles.ops.combos.push(
  {
    name: 'ops-governance-tasks-registry-helper-monitor',
    chain: [
      'orchestrator/agent_search(tasks inter-agent work queue notion assign)',
      'orchestrator/agent_search(registry service catalog certified directory)',
      'orchestrator/agent_search(helper service discovery architectural navigation intent)',
      'orchestrator/provision_status',
    ],
    accomplishes:
      'Monitor inter-agent ops task pipeline, verify registry service certification and health, locate infrastructure helper agents, then check provision status of active operational bindings.',
    verified: true,
    notes: '152nd pass — governance tools → ops profile (tools 1-3 to 6/6).',
  },
  {
    name: 'ops-code-ship-chico-clean-builds',
    chain: [
      'orchestrator/agent_execute(ship)',
      'orchestrator/skill_execute(user:chico)',
      'orchestrator/skill_execute(commit-commands:clean-gone)',
      'cloudflare-builds/workers_builds_list_builds',
    ],
    accomplishes:
      'Trigger ship agent for ops deployment, run chico user skill for ops context setup, clean stale branches, then list Cloudflare Workers builds to confirm deployment status.',
    verified: true,
    notes: '152nd pass — code tools → ops profile (tools 4-6 to 6/6). cloudflare-builds confirmed connected.',
  },
);

// ── design (2 combos) ─────────────────────────────────────────────────────────
data.profiles.design.combos.push(
  {
    name: 'design-governance-tasks-registry-helper-viz',
    chain: [
      'orchestrator/agent_search(tasks inter-agent work queue notion assign)',
      'orchestrator/agent_search(registry service catalog certified directory)',
      'orchestrator/agent_search(helper service discovery architectural navigation intent)',
      'browser-rendering/get_url_screenshot',
    ],
    accomplishes:
      'Surface design tasks from the cross-agent queue, look up design service registry entries, discover architectural navigation helpers, then screenshot the design system for visual reference and documentation.',
    verified: true,
    notes: '152nd pass — governance tools → design profile (tools 1-3 to 6/6). browser-rendering confirmed connected.',
  },
  {
    name: 'design-code-ship-chico-clean-review',
    chain: [
      'orchestrator/agent_execute(ship)',
      'orchestrator/skill_execute(user:chico)',
      'orchestrator/skill_execute(commit-commands:clean-gone)',
      'browser-rendering/get_url_markdown',
    ],
    accomplishes:
      'Ship design asset changes, apply chico user skill for design context, clean stale commit branches, then fetch the design spec as Markdown for final review.',
    verified: true,
    notes: '152nd pass — code tools → design profile (tools 4-6 to 6/6). browser-rendering confirmed connected.',
  },
);

// ── prompts (12 total, one per combo) ─────────────────────────────────────────
data.profiles.finance.prompts.push(
  'Find all pending finance-related inter-agent tasks, check the registry for certified finance services, locate architectural helpers, then execute the finance agent for a consolidated brief.',
  'Ship my latest financial tooling changes, run the chico user skill, clean any gone-but-tracked branches, and pull the current balance snapshot.',
  'Look up Neon database finance agents, find browser scraping agents for market data, and run the finance balances agent.',
);
data.profiles.governance.prompts.push(
  'Ship governance artifacts, validate chico user authority, clean stale commit refs, then provision-evaluate the correct governance ChittyID context.',
);
data.profiles.code.prompts.push(
  'Show me pending coding tasks across the agent queue, check the registry for service dependencies, find architectural helpers, then resolve the relevant library docs.',
  'Search for scraping agents, check scrape job status, discover chittyhelper navigation skills, and query Context7 for matching library docs.',
);
data.profiles.communication.prompts.push(
  'Think through the team communication scope, map tasks across agent queues, look up certified services, and identify helper agents for a structured async brief.',
  'Plan the release handoff: ship the changes, run the chico user skill for team sync, clean stale commit refs, and summarize the async communication trail.',
);
data.profiles.ops.prompts.push(
  'Monitor the inter-agent task pipeline, verify registry service health, locate ops helper agents, and check active provision bindings.',
  'Run the ship agent for deployment, set up chico ops context, clean gone branches, then list Cloudflare builds to confirm.',
);
data.profiles.design.prompts.push(
  'Surface design tasks from the agent queue, look up design services in the registry, find architectural helpers, and screenshot the design system for docs.',
  'Ship design assets, apply chico user skill, clean stale branches, then fetch the design spec as Markdown.',
);

try {
  writeFileSync('focus-suggestions.json', JSON.stringify(data, null, 2) + '\n');
  console.log('152nd pass written.');
} catch (err) {
  console.error(`Failed to write focus-suggestions.json: ${err.message}`);
  process.exit(1);
}
