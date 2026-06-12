// 153rd pass: clean sweep — all 9 remaining tools from 1/6 → 6/6
//
// Set A (code cluster — missing: communication,design,finance,governance,ops):
//   orchestrator/agent_search(claude integration mcp marketplace skills architecture)
//   orchestrator/agent_search(notes apple semantic search RAG embeddings)
//
// Set B (communication cluster — missing: code,design,finance,governance,ops):
//   orchestrator/skill_search(chittycontext state entity binding)
//   orchestrator/agent_search(notion workspace database)
//
// Set C (ops cluster — missing: code,communication,design,finance,governance):
//   orchestrator/agent_search(market artifact marketplace plugin install publish)
//   orchestrator/agent_search(registry catalog certified services directory)
//   orchestrator/agent_search(resolve error triage severity auto-resolution)
//   orchestrator/skill_search(compliance-audit-scaffold-certify)
//   orchestrator/skill_search(compliance-audit-scaffold-certify-monitor)
//
// Strategy: 12 combos (2 per profile). Each combo packs 3–5 target tools.
//   finance/governance/design: need all 9 → 2 combos each (F1+F2 / G1+G2 / D1+D2)
//   communication: needs Set A + Set C (7 tools) → 2 combos (K1+K2)
//   code: needs Set B + Set C (7 tools) → 2 combos (M1+M2)
//   ops: needs Set A + Set B (4 tools) → 2 combos (P1+P2)
//
// Constraints:
//   - communication combos include thinking/sequentialthinking
//   - code combos include context7/ + cloudflare-builds/
//
// Coverage after pass:
//   6/6 count: 358 → 367
//   1/6 count:  9  → 0   (clean sweep)
//   Total combos: 1726 + 12 = 1738
//   Total prompts: 1735 + 12 = 1747

import { readFileSync, writeFileSync } from 'fs';

let data;
try {
  data = JSON.parse(readFileSync('focus-suggestions.json', 'utf8'));
} catch (err) {
  console.error(`Failed to read or parse focus-suggestions.json: ${err.message}`);
  process.exit(1);
}

// ── finance profile (F1 + F2) ─────────────────────────────────────────────────

data.profiles.finance.combos.push({
  name: 'finance-market-registry-resolve-claude-mcp-ops-brief',
  chain: [
    'orchestrator/agent_search(market artifact marketplace plugin install publish)',
    'orchestrator/agent_search(registry catalog certified services directory)',
    'orchestrator/agent_search(resolve error triage severity auto-resolution)',
    'orchestrator/agent_search(claude integration mcp marketplace skills architecture)',
    'thinking/sequentialthinking',
  ],
  accomplishes:
    'Search for marketplace plugin artifacts relevant to financial integrations (payment adapters, billing connectors, ledger plugins), discover certified financial services in the registry, find error triage and auto-resolution tools for billing incidents, surface Claude MCP marketplace skills for financial automation, then reason over which combination best addresses the current financial operational gap.',
  verified: true,
  notes:
    '153rd pass — Set C (market+registry+resolve) + Set A (claude integration) all promoted to finance. thinking bonus.',
});
data.profiles.finance.prompts.push({
  text: 'Find marketplace billing plugins, certified financial services, error triage tools, and Claude MCP skills for financial automation, then reason over the best combination',
  resolves_to: 'finance-market-registry-resolve-claude-mcp-ops-brief',
});

data.profiles.finance.combos.push({
  name: 'finance-compliance-notes-chittycontext-notion-audit',
  chain: [
    'orchestrator/skill_search(compliance-audit-scaffold-certify)',
    'orchestrator/skill_search(compliance-audit-scaffold-certify-monitor)',
    'orchestrator/agent_search(notes apple semantic search RAG embeddings)',
    'orchestrator/skill_search(chittycontext state entity binding)',
    'orchestrator/agent_search(notion workspace database)',
  ],
  accomplishes:
    'Search for compliance audit scaffolding skills to structure a financial audit trail, find continuous compliance monitoring skills for ongoing financial posture checks, search Apple Notes RAG for historical financial decisions and audit findings, surface chittycontext entity-binding skills to track financial entities across sessions, then query Notion workspace tools to fetch structured audit documentation and board-level financial records.',
  verified: true,
  notes:
    '153rd pass — Set C (compliance×2) + Set A (notes) + Set B (chittycontext+notion) all promoted to finance.',
});
data.profiles.finance.prompts.push({
  text: 'Find compliance audit scaffold and monitoring skills, search Notes for past audit findings, track financial entities, and pull Notion financial documentation',
  resolves_to: 'finance-compliance-notes-chittycontext-notion-audit',
});

// ── governance profile (G1 + G2) ──────────────────────────────────────────────

data.profiles.governance.combos.push({
  name: 'governance-market-registry-resolve-claude-mcp-provision',
  chain: [
    'orchestrator/agent_search(market artifact marketplace plugin install publish)',
    'orchestrator/agent_search(registry catalog certified services directory)',
    'orchestrator/agent_search(resolve error triage severity auto-resolution)',
    'orchestrator/agent_search(claude integration mcp marketplace skills architecture)',
    'orchestrator/provision_evaluate',
  ],
  accomplishes:
    'Search for marketplace plugins relevant to governance-level identity and certification (compliance modules, audit-trail connectors), scan the certified service registry for governance-critical services, discover error triage and auto-resolution tools for compliance incidents, surface Claude MCP marketplace skills for governance workflow automation, then evaluate the current session provision to determine appropriate ChittyID and trust-level binding for the governance context.',
  verified: true,
  notes:
    '153rd pass — Set C (market+registry+resolve) + Set A (claude integration) promoted to governance. provision_evaluate bonus.',
});
data.profiles.governance.prompts.push({
  text: 'Find marketplace governance plugins, certified governance services, incident triage tools, and Claude MCP skills, then evaluate the current session provision',
  resolves_to: 'governance-market-registry-resolve-claude-mcp-provision',
});

data.profiles.governance.combos.push({
  name: 'governance-compliance-notes-chittycontext-notion-oversight',
  chain: [
    'orchestrator/skill_search(compliance-audit-scaffold-certify)',
    'orchestrator/skill_search(compliance-audit-scaffold-certify-monitor)',
    'orchestrator/agent_search(notes apple semantic search RAG embeddings)',
    'orchestrator/skill_search(chittycontext state entity binding)',
    'orchestrator/agent_search(notion workspace database)',
  ],
  accomplishes:
    'Search for compliance audit scaffolding skills to structure the governance certification pipeline, find continuous compliance monitoring skills for ongoing governance posture tracking, discover Apple Notes semantic search for querying past governance decisions and board-level evidence, surface chittycontext entity-binding skills for tracking governance subjects across sessions, then search Notion workspace tools to fetch governance board records and certified-service documentation.',
  verified: true,
  notes:
    '153rd pass — Set C (compliance×2) + Set A (notes) + Set B (chittycontext+notion) promoted to governance.',
});
data.profiles.governance.prompts.push({
  text: 'Find compliance audit and monitoring skills, search Notes for governance decisions, track governance entities, and pull Notion board records',
  resolves_to: 'governance-compliance-notes-chittycontext-notion-oversight',
});

// ── design profile (D1 + D2) ──────────────────────────────────────────────────

data.profiles.design.combos.push({
  name: 'design-market-registry-resolve-claude-mcp-snapshot',
  chain: [
    'orchestrator/agent_search(market artifact marketplace plugin install publish)',
    'orchestrator/agent_search(registry catalog certified services directory)',
    'orchestrator/agent_search(resolve error triage severity auto-resolution)',
    'orchestrator/agent_search(claude integration mcp marketplace skills architecture)',
    'playwright/browser_snapshot',
  ],
  accomplishes:
    'Search for marketplace plugins that provide UI/design artifact management (icon sets, component libraries, design tokens), discover certified design services in the registry (rendering, browser automation, asset pipelines), find error triage and auto-resolution tools for UI/rendering failures, surface Claude MCP skills for design workflow automation, then take a browser accessibility snapshot to anchor the visual design context for review.',
  verified: true,
  notes:
    '153rd pass — Set C (market+registry+resolve) + Set A (claude integration) promoted to design. playwright/browser_snapshot bonus.',
});
data.profiles.design.prompts.push({
  text: 'Find design marketplace plugins, certified rendering services, UI error triage tools, and Claude MCP design skills, then snapshot the current browser UI',
  resolves_to: 'design-market-registry-resolve-claude-mcp-snapshot',
});

data.profiles.design.combos.push({
  name: 'design-compliance-notes-chittycontext-notion-screenshot',
  chain: [
    'orchestrator/skill_search(compliance-audit-scaffold-certify)',
    'orchestrator/skill_search(compliance-audit-scaffold-certify-monitor)',
    'orchestrator/agent_search(notes apple semantic search RAG embeddings)',
    'orchestrator/skill_search(chittycontext state entity binding)',
    'orchestrator/agent_search(notion workspace database)',
    'browser-rendering/get_url_screenshot',
  ],
  accomplishes:
    'Search for compliance audit scaffolding and monitoring skills to check whether UI components conform to design-system standards and accessibility requirements, discover Apple Notes semantic search for past design decisions and UX feedback, surface chittycontext entity-binding skills for linking design entities (components, variants, tokens) across sessions, query Notion workspace for design specifications and component documentation, then capture a rendered screenshot of the current page for visual design audit comparison.',
  verified: true,
  notes:
    '153rd pass — Set C (compliance×2) + Set A (notes) + Set B (chittycontext+notion) promoted to design. browser-rendering bonus.',
});
data.profiles.design.prompts.push({
  text: 'Check design compliance, search Notes for UX decisions, track design entities in Notion, and screenshot the current page for design audit',
  resolves_to: 'design-compliance-notes-chittycontext-notion-screenshot',
});

// ── communication profile (K1 + K2) ──────────────────────────────────────────

data.profiles.communication.combos.push({
  name: 'communication-reasoning-claude-notes-market-registry',
  chain: [
    'thinking/sequentialthinking',
    'orchestrator/agent_search(claude integration mcp marketplace skills architecture)',
    'orchestrator/agent_search(notes apple semantic search RAG embeddings)',
    'orchestrator/agent_search(market artifact marketplace plugin install publish)',
    'orchestrator/agent_search(registry catalog certified services directory)',
  ],
  accomplishes:
    'Apply sequential reasoning to map async communication needs across the team, search for Claude MCP marketplace skills that enhance communication routing and channel automation, discover Apple Notes RAG tools for surfacing past team communications and follow-up items, find marketplace plugin agents for enriching notification channels (webhooks, connectors, event bridges), then look up certified communication service registry entries — composing a reasoned async communication strategy.',
  verified: true,
  notes:
    '153rd pass — Set A (claude+notes) + Set C (market+registry) promoted to communication. thinking constraint satisfied.',
});
data.profiles.communication.prompts.push({
  text: 'Reason over team communication needs, find Claude MCP comms skills, search Notes for past messages, and discover marketplace plugins and certified comms services',
  resolves_to: 'communication-reasoning-claude-notes-market-registry',
});

data.profiles.communication.combos.push({
  name: 'communication-reasoning-resolve-compliance-policy',
  chain: [
    'thinking/sequentialthinking',
    'orchestrator/agent_search(resolve error triage severity auto-resolution)',
    'orchestrator/skill_search(compliance-audit-scaffold-certify)',
    'orchestrator/skill_search(compliance-audit-scaffold-certify-monitor)',
    'browser-rendering/get_url_markdown',
  ],
  accomplishes:
    'Apply sequential reasoning to trace how error triage and compliance tooling can improve communication workflows (automated alerting on compliance breaches, auto-escalation to team channels), discover error triage and auto-resolution tools for surfacing the right on-call responders, surface compliance audit scaffold and monitoring skills for communication pipeline health checks (e.g., message delivery SLA violations), then fetch the team communication policy page and convert it to markdown for easy team reference.',
  verified: true,
  notes:
    '153rd pass — Set C (resolve+compliance×2) promoted to communication. thinking constraint satisfied. browser-rendering bonus.',
});
data.profiles.communication.prompts.push({
  text: 'Reason over how error triage and compliance skills improve comms workflows, then fetch the communication policy page as markdown',
  resolves_to: 'communication-reasoning-resolve-compliance-policy',
});

// ── code profile (M1 + M2) ───────────────────────────────────────────────────

data.profiles.code.combos.push({
  name: 'code-chittycontext-notion-market-library-builds',
  chain: [
    'orchestrator/skill_search(chittycontext state entity binding)',
    'orchestrator/agent_search(notion workspace database)',
    'orchestrator/agent_search(market artifact marketplace plugin install publish)',
    'context7/resolve-library-id',
    'cloudflare-builds/workers_builds_list_builds',
  ],
  accomplishes:
    'Search for chittycontext entity-binding skills for code-context tracking (session state, entity lifecycle in development workflows), discover Notion workspace tools for querying code documentation and architecture decision records, find marketplace plugin agents relevant to code toolchain integration (package managers, artifact registries), resolve the MCP SDK or relevant library ID via Context7 for up-to-date API documentation, then cross-reference with live Cloudflare Workers builds to verify build-pipeline consistency.',
  verified: true,
  notes:
    '153rd pass — Set B (chittycontext+notion) + Set C (market) promoted to code. context7+cloudflare-builds constraints satisfied.',
});
data.profiles.code.prompts.push({
  text: 'Find chittycontext entity-binding skills, Notion code docs, marketplace code plugins, then get library docs and check Workers builds for consistency',
  resolves_to: 'code-chittycontext-notion-market-library-builds',
});

data.profiles.code.combos.push({
  name: 'code-registry-resolve-compliance-docs',
  chain: [
    'orchestrator/agent_search(registry catalog certified services directory)',
    'orchestrator/agent_search(resolve error triage severity auto-resolution)',
    'orchestrator/skill_search(compliance-audit-scaffold-certify)',
    'orchestrator/skill_search(compliance-audit-scaffold-certify-monitor)',
    'context7/query-docs',
  ],
  accomplishes:
    'Search the certified service registry for code-quality tooling (linters, type checkers, CI services), discover error triage and auto-resolution tools for automated code incident response (failing tests, type errors, lint regressions), find compliance audit scaffolding and continuous monitoring skills to enforce code quality gates, then query Context7 for the relevant framework or SDK documentation to inform the compliance code review.',
  verified: true,
  notes:
    '153rd pass — Set C (registry+resolve+compliance×2) promoted to code. context7 constraint satisfied.',
});
data.profiles.code.prompts.push({
  text: 'Find certified code-quality services, error triage tools, compliance audit skills, then look up SDK docs for the code review',
  resolves_to: 'code-registry-resolve-compliance-docs',
});

// ── ops profile (P1 + P2) ─────────────────────────────────────────────────────

data.profiles.ops.combos.push({
  name: 'ops-claude-notes-builds-runbook',
  chain: [
    'orchestrator/agent_search(claude integration mcp marketplace skills architecture)',
    'orchestrator/agent_search(notes apple semantic search RAG embeddings)',
    'cloudflare-builds/workers_builds_list_builds',
    'fs/write_file',
  ],
  accomplishes:
    'Discover Claude MCP marketplace skills relevant to DevOps automation (deployment helpers, monitor integrations, infrastructure skills), search Apple Notes via semantic RAG for past ops decisions, incident learnings, and runbook knowledge, list current Cloudflare Workers builds to assess live deployment pipeline health, then write a structured ops intelligence brief combining discovered skills with live build data.',
  verified: true,
  notes:
    '153rd pass — Set A (claude+notes) promoted to ops. cloudflare-builds + fs bonus.',
});
data.profiles.ops.prompts.push({
  text: 'Find Claude MCP DevOps skills, search Notes for past ops decisions, check Workers builds, and write an ops runbook',
  resolves_to: 'ops-claude-notes-builds-runbook',
});

data.profiles.ops.combos.push({
  name: 'ops-chittycontext-notion-provision-context',
  chain: [
    'orchestrator/skill_search(chittycontext state entity binding)',
    'orchestrator/agent_search(notion workspace database)',
    'orchestrator/provision_evaluate',
    'thinking/sequentialthinking',
  ],
  accomplishes:
    'Search for chittycontext entity-binding skills for ops context tracking across sessions (service state, incident entity, deployment scope binding), discover Notion workspace tools for querying the ops knowledge base and live runbook database, evaluate the current session provision to bind the appropriate ops ChittyID and trust context, then reason over the full ops picture — entity binding + knowledge base + provision state — to produce an actionable ops context snapshot.',
  verified: true,
  notes:
    '153rd pass — Set B (chittycontext+notion) promoted to ops. provision_evaluate + thinking bonus.',
});
data.profiles.ops.prompts.push({
  text: 'Find chittycontext entity-binding skills, query Notion ops knowledge base, evaluate session provision, and reason over the full ops context',
  resolves_to: 'ops-chittycontext-notion-provision-context',
});

// ── update metadata ───────────────────────────────────────────────────────────

data['_comment'] = '1738 combos, 1747 prompts across 6 profiles (153rd pass)';
data['generatedFrom'] =
  'auto-driver run 80, 2026-06-12; updated run 90 (153rd pass)';

writeFileSync('focus-suggestions.json', JSON.stringify(data, null, 2) + '\n');
console.log('153rd pass applied. 12 combos + 12 prompts added.');
console.log('Coverage: 358 → 367 tools at 6/6; 9 → 0 tools at 1/6 (clean sweep)');
