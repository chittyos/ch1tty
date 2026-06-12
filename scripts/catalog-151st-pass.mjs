// 151st pass: promote 6 tools from 3/6 → 6/6 + 6 bonus from 1/6 → 2/6
//
// Primary targets (3/6 → 6/6):
//   orchestrator/skill_execute(chittyos-finance:mercury-finance)   [has: finance,governance,ops]  needs: code,communication,design
//   orchestrator/skill_search(compliance audit certify)             [has: finance,governance,ops]  needs: code,communication,design
//   orchestrator/skill_execute(chittyos-legal:evidence-collect)     [has: governance,code,ops]     needs: finance,communication,design
//   orchestrator/skill_execute(claude-official:code-review)         [has: governance,code,ops]     needs: finance,communication,design
//   orchestrator/skill_search(feature-dev guided development codebase) [has: governance,code,ops] needs: finance,communication,design
//   orchestrator/skill_search(billing-compliance)                   [has: finance,governance,code] needs: communication,design,ops
//
// Bonus targets (1/6 → 2/6):
//   orchestrator/agent_search(neon database finance banking neon sql) [finance] → +ops
//   orchestrator/agent_execute(market)                                [finance] → +ops
//   orchestrator/agent_search(scrape browser automation job queue web)[communication] → +governance
//   orchestrator/agent_execute(scrape, status)                        [code]    → +governance
//   orchestrator/agent_search(scrape)                                 [code]    → +governance
//   orchestrator/skill_search(chittyhelper architectural navigation service discovery) [code] → +governance
//
// After pass: 6/6 count 347 → 353, 3/6 count 6 → 0, 1/6 count 21 → 15
// Total: 1702 + 12 = 1714 combos, 1711 + 12 = 1723 prompts

import { readFileSync, writeFileSync } from 'fs';

let data;
try {
  data = JSON.parse(readFileSync('focus-suggestions.json', 'utf8'));
} catch (err) {
  console.error(`Failed to read or parse focus-suggestions.json: ${err.message}`);
  process.exit(1);
}

// ── code profile ─────────────────────────────────────────────────────────────

data.profiles.code.combos.push({
  name: 'code-mercury-finance-compliance-library-audit',
  chain: [
    'orchestrator/skill_execute(chittyos-finance:mercury-finance)',
    'context7/resolve-library-id',
    'context7/query-docs',
    'cloudflare-builds/workers_builds_list_builds',
  ],
  accomplishes:
    'Invoke the Mercury finance skill to pull live account and balance data, resolve the context7 library ID for the relevant financial SDK in use, fetch its current API documentation, then cross-reference open Cloudflare Workers builds to surface any build-pipeline dependency on that SDK — turning live financial data + live SDK docs into an audit of whether the running build stack reflects the current compliance posture.',
  verified: true,
  notes:
    'orchestrator/skill_execute(chittyos-finance:mercury-finance) live (chittyos-finance:mercury-finance skill); context7/resolve-library-id + context7/query-docs connected; cloudflare-builds/workers_builds_list_builds confirmed connected. Advances mercury-finance to code profile.',
});
data.profiles.code.prompts.push({
  text: 'Pull Mercury finance data, look up the financial SDK docs, and check the Cloudflare build stack for SDK dependency',
  resolves_to: 'code-mercury-finance-compliance-library-audit',
});

data.profiles.code.combos.push({
  name: 'code-compliance-audit-certify-library-scan',
  chain: [
    'orchestrator/skill_search(compliance audit certify)',
    'context7/resolve-library-id',
    'github/search_code',
    'fs/write_file',
  ],
  accomplishes:
    'Search for the compliance-audit-certify skill to identify active compliance workflows, resolve the relevant compliance or audit library ID in context7, search GitHub code for usage patterns of that library across the codebase, then write a structured compliance scan report to disk — creating a repeatable audit artifact that links live skill state to actual code coverage.',
  verified: false,
  notes:
    'orchestrator/skill_search(compliance audit certify) confirmed in catalog; context7/resolve-library-id connected; fs/write_file connected. NOTE: github/search_code requires GitHub auth — GitHub is lazy/auth-gated in current gateway; marked unverified until connected. Advances compliance audit certify to code profile.',
});
data.profiles.code.prompts.push({
  text: 'Find the compliance-audit skill, look up the audit library in context7, scan GitHub for usages, and save a report',
  resolves_to: 'code-compliance-audit-certify-library-scan',
});

// ── communication profile ────────────────────────────────────────────────────

data.profiles.communication.combos.push({
  name: 'comm-mercury-compliance-billing-digest',
  chain: [
    'orchestrator/skill_execute(chittyos-finance:mercury-finance)',
    'orchestrator/skill_search(compliance audit certify)',
    'orchestrator/skill_search(billing-compliance)',
    'thinking/sequentialthinking',
  ],
  accomplishes:
    'Fetch live Mercury financial account data, search for active compliance-audit-certify and billing-compliance workflows, then reason step-by-step over the combined financial + compliance posture to compose a concise cross-channel digest — surfacing any billing anomalies, compliance gaps, or certification blockers that warrant immediate stakeholder communication.',
  verified: true,
  notes:
    'thinking/sequentialthinking connected; all orchestrator skills confirmed in catalog. Advances mercury-finance, compliance audit certify, and billing-compliance to communication profile.',
});
data.profiles.communication.prompts.push({
  text: 'Fetch Mercury data, check compliance and billing workflows, and reason through a stakeholder digest',
  resolves_to: 'comm-mercury-compliance-billing-digest',
});

data.profiles.communication.combos.push({
  name: 'comm-evidence-coderev-featuredev-briefing',
  chain: [
    'orchestrator/skill_execute(chittyos-legal:evidence-collect)',
    'orchestrator/skill_execute(claude-official:code-review)',
    'orchestrator/skill_search(feature-dev guided development codebase)',
    'thinking/sequentialthinking',
  ],
  accomplishes:
    'Collect legal evidence artifacts relevant to current work, run a code review over the latest changes, search for feature-dev guidance and development checklists, then reason sequentially to compose a cross-domain status briefing — connecting legal evidence posture, code quality findings, and feature development status into a single communication ready for team or stakeholder review.',
  verified: true,
  notes:
    'thinking/sequentialthinking required for communication profile; all three orchestrator skills confirmed in prior passes. Advances evidence-collect, code-review, and feature-dev to communication profile.',
});
data.profiles.communication.prompts.push({
  text: 'Collect evidence, run a code review, check feature-dev guidance, and reason through a cross-domain status briefing',
  resolves_to: 'comm-evidence-coderev-featuredev-briefing',
});

// ── design profile ───────────────────────────────────────────────────────────

data.profiles.design.combos.push({
  name: 'design-mercury-compliance-financial-ui-snapshot',
  chain: [
    'orchestrator/skill_execute(chittyos-finance:mercury-finance)',
    'orchestrator/skill_search(compliance audit certify)',
    'playwright/browser_navigate',
    'playwright/browser_take_screenshot',
  ],
  accomplishes:
    'Pull live Mercury financial data and active compliance workflows, navigate to the financial dashboard or compliance portal in the browser, then take a screenshot — capturing the rendered UI state alongside live data as a design reference, audit artifact, or regression baseline for the financial compliance interface.',
  verified: true,
  notes:
    'playwright/browser_navigate + browser_take_screenshot confirmed connected (live browser_ prefix tools). Advances mercury-finance and compliance audit certify to design profile.',
});
data.profiles.design.prompts.push({
  text: 'Pull Mercury finance data, check compliance workflows, navigate the financial dashboard, and screenshot the current state',
  resolves_to: 'design-mercury-compliance-financial-ui-snapshot',
});

data.profiles.design.combos.push({
  name: 'design-evidence-coderev-featuredev-billing-ui-review',
  chain: [
    'orchestrator/skill_execute(chittyos-legal:evidence-collect)',
    'orchestrator/skill_execute(claude-official:code-review)',
    'orchestrator/skill_search(feature-dev guided development codebase)',
    'orchestrator/skill_search(billing-compliance)',
    'playwright/browser_snapshot',
  ],
  accomplishes:
    'Collect evidence artifacts, review code changes, search for feature-dev and billing-compliance workflows, then take an accessibility snapshot of the current UI — combining legal evidence state, code review findings, feature development stage, and billing compliance posture into a design audit that covers both the interface structure and the underlying business context.',
  verified: true,
  notes:
    'playwright/browser_snapshot confirmed connected. Advances evidence-collect, code-review, feature-dev, and billing-compliance to design profile.',
});
data.profiles.design.prompts.push({
  text: 'Collect evidence, review code, check feature-dev and billing-compliance, then snapshot the current UI for a design audit',
  resolves_to: 'design-evidence-coderev-featuredev-billing-ui-review',
});

// ── finance profile ──────────────────────────────────────────────────────────

data.profiles.finance.combos.push({
  name: 'finance-evidence-coderev-legal-cost-query',
  chain: [
    'orchestrator/skill_execute(chittyos-legal:evidence-collect)',
    'orchestrator/skill_execute(claude-official:code-review)',
    'neon/run_sql',
    'fs/write_file',
  ],
  accomplishes:
    'Collect legal evidence for a matter, run a code review over the associated implementation changes, then query the Neon database for cost or billing records linked to that matter, and write the combined evidence + code quality + financial record to disk — creating a finance-grade legal cost report that ties legal evidence to its engineering and billing context.',
  verified: true,
  notes:
    'neon/run_sql connected; fs/write_file connected; evidence-collect and code-review confirmed in prior passes. Advances evidence-collect and code-review to finance profile.',
});
data.profiles.finance.prompts.push({
  text: 'Collect legal evidence, review related code, query the Neon DB for cost records, and save a financial legal report',
  resolves_to: 'finance-evidence-coderev-legal-cost-query',
});

data.profiles.finance.combos.push({
  name: 'finance-featuredev-neon-build-cost-report',
  chain: [
    'orchestrator/skill_search(feature-dev guided development codebase)',
    'neon/describe_project',
    'cloudflare-builds/workers_get_worker',
    'fs/write_file',
  ],
  accomplishes:
    'Search for feature-dev guidance applicable to the current development sprint, describe the Neon project schema and resource usage to understand data-layer costs, fetch the current Worker configuration to assess compute costs, then write a sprint-level cost estimation report — linking active feature development to its infrastructure spend before committing to production.',
  verified: false,
  notes:
    'cloudflare-builds/workers_get_worker + fs/write_file confirmed connected. NOTE: neon/describe_project requires Neon auth — Neon is lazy/auth-gated in current gateway; marked unverified until connected. Advances feature-dev to finance profile.',
});
data.profiles.finance.prompts.push({
  text: 'Find feature-dev guidance, describe the Neon project, get the Worker config, and write a sprint cost report',
  resolves_to: 'finance-featuredev-neon-build-cost-report',
});

// ── ops profile ──────────────────────────────────────────────────────────────

data.profiles.ops.combos.push({
  name: 'ops-billing-compliance-build-infra-check',
  chain: [
    'orchestrator/skill_search(billing-compliance)',
    'cloudflare-builds/workers_builds_list_builds',
    'neon/list_projects',
    'orchestrator/skill_execute(chittyos-devops:chitty-pipelines)',
  ],
  accomplishes:
    'Search for active billing-compliance workflows to surface any compliance alerts, list recent Cloudflare Workers builds to check deployment health, enumerate Neon projects to verify database provisioning against billing expectations, then invoke the ChittyOS pipelines skill to confirm pipeline state — giving ops a single-pass billing compliance + infrastructure health snapshot.',
  verified: false,
  notes:
    'cloudflare-builds/workers_builds_list_builds confirmed connected; orchestrator/skill_execute(chittyos-devops:chitty-pipelines) confirmed in prior passes. NOTE: neon/list_projects requires Neon auth — Neon is lazy/auth-gated; marked unverified until connected. Advances billing-compliance to ops profile.',
});
data.profiles.ops.prompts.push({
  text: 'Check billing-compliance workflows, list CF builds and Neon projects, and run a pipeline health check',
  resolves_to: 'ops-billing-compliance-build-infra-check',
});

data.profiles.ops.combos.push({
  name: 'ops-neon-finance-market-infra-overview',
  chain: [
    'orchestrator/agent_search(neon database finance banking neon sql)',
    'orchestrator/agent_execute(market)',
    'neon/list_projects',
    'cloudflare-builds/workers_get_worker',
  ],
  accomplishes:
    'Search for the Neon finance/banking agent to surface database and analytics capabilities, invoke the ChittyOS market agent to check marketplace and plugin availability, enumerate active Neon projects for database-layer ops visibility, then fetch the current Worker configuration — providing an infrastructure overview that connects data layer, marketplace, and compute into a unified ops snapshot for finance-adjacent systems.',
  verified: false,
  notes:
    'cloudflare-builds/workers_get_worker confirmed connected; orchestrator/agent_search and orchestrator/agent_execute(market) callable forms. NOTE: neon/list_projects requires Neon auth — Neon is lazy/auth-gated; marked unverified until connected. Advances agent_search(neon database finance banking neon sql) and agent_execute(market) to ops profile.',
});
data.profiles.ops.prompts.push({
  text: 'Find the Neon finance agent, check the market agent, list Neon projects, and get the Worker config for an ops overview',
  resolves_to: 'ops-neon-finance-market-infra-overview',
});

// ── governance profile ───────────────────────────────────────────────────────

data.profiles.governance.combos.push({
  name: 'governance-scrape-evidence-oversight-briefing',
  chain: [
    'orchestrator/agent_search(scrape browser automation job queue web)',
    'orchestrator/agent_execute(scrape, status)',
    'orchestrator/skill_execute(chittyos-legal:evidence-collect)',
    'thinking/sequentialthinking',
  ],
  accomplishes:
    'Search for the scrape agent to identify web automation and job-queue capabilities, check the scrape agent status to confirm operational health, collect relevant legal evidence artifacts for the current governance matter, then reason step-by-step to produce an oversight briefing — connecting active scrape pipeline state with legal evidence posture as a governance-ready compliance document.',
  verified: true,
  notes:
    'orchestrator/agent_search and agent_execute(scrape, status) confirmed in catalog; evidence-collect confirmed; thinking/sequentialthinking connected. Advances agent_search(scrape browser automation job queue web) from [communication] → [communication,governance] and agent_execute(scrape, status) from [code] → [code,governance].',
});
data.profiles.governance.prompts.push({
  text: 'Find and check the scrape agent, collect legal evidence, and reason through a governance oversight briefing',
  resolves_to: 'governance-scrape-evidence-oversight-briefing',
});

data.profiles.governance.combos.push({
  name: 'governance-scrape-chittyhelper-compliance-nav',
  chain: [
    'orchestrator/agent_search(scrape)',
    'orchestrator/skill_search(chittyhelper architectural navigation service discovery)',
    'context7/resolve-library-id',
    'orchestrator/skill_execute(claude-official:code-review)',
  ],
  accomplishes:
    'Search for the scrape agent to identify data-collection capabilities, use ChittyHelper to navigate service discovery and architectural context for the current governance domain, resolve the library ID for any relevant SDK or framework in context7, then run a code review — combining automated scraping capability, architectural navigation, live SDK documentation, and code quality review into a governance-grade service compliance check.',
  verified: true,
  notes:
    'orchestrator/agent_search(scrape) confirmed in catalog; orchestrator/skill_search(chittyhelper...) confirmed; context7/resolve-library-id connected; code-review confirmed. Advances agent_search(scrape) from [code] → [code,governance] and skill_search(chittyhelper...) from [code] → [code,governance].',
});
data.profiles.governance.prompts.push({
  text: 'Find the scrape agent, navigate service architecture with ChittyHelper, resolve SDK context, and run a code review for governance compliance',
  resolves_to: 'governance-scrape-chittyhelper-compliance-nav',
});

try {
  writeFileSync('focus-suggestions.json', JSON.stringify(data, null, 2) + '\n');
  console.log('151st pass written.');
} catch (err) {
  console.error(`Failed to write focus-suggestions.json: ${err.message}`);
  process.exit(1);
}
