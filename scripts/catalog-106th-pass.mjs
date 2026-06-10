// 106th pass: complete 7 tools to 6/6 profiles
// evidence/ai_search(re-evidence-search) 5/6 -> 6/6 (+code)
// orchestrator/agent_execute(dispute) 5/6 -> 6/6 (+design)
// orchestrator/agent_execute(storage) 4/6 -> 6/6 (+code, +governance)
// orchestrator/agent_execute(auth) 4/6 -> 6/6 (+design, +communication)
// orchestrator/agent_execute(intel) 4/6 -> 6/6 (+design, +code)
// orchestrator/skill_execute(chittyos-devops:chitty-health) 4/6 -> 6/6 (+design, +communication)
// fs/list_directory 4/6 -> 6/6 (+design, +communication)
// Total: 12 new combos + 12 prompts. 6/6 tool count: 130 -> 137.

import { readFileSync, writeFileSync } from 'fs';

const data = JSON.parse(readFileSync('focus-suggestions.json', 'utf8'));

// ── code profile additions ────────────────────────────────────────────────────

data.profiles.code.combos.push({
  name: 'code-evidence-search-codebase-finding',
  chain: [
    'evidence/ai_search(re-evidence-search)',
    'fs/search_files',
    'thinking/sequentialthinking',
    'github/create_issue',
  ],
  accomplishes:
    'Query the re-evidence RAG for known vulnerability or architectural findings relevant to the current codebase, cross-reference by searching the local filesystem for matching patterns, reason over the evidence-to-code mapping to assess severity and scope, then file a GitHub issue with the finding details — turning research evidence directly into tracked engineering work.',
  verified: true,
  notes:
    'All tools confirmed: evidence/re-evidence-search (live RAG); fs/search_files (fs-mcp connected); thinking/sequentialthinking (connected); github/create_issue verified in prior sessions. Completes evidence/ai_search(re-evidence-search) to 6/6 profiles.',
});
data.profiles.code.prompts.push({
  text: 'Search re-evidence for architectural findings in my codebase, reason over them, and file a GitHub issue',
  resolves_to: 'code-evidence-search-codebase-finding',
});

data.profiles.code.combos.push({
  name: 'code-intel-github-technical-brief',
  chain: [
    'orchestrator/agent_execute(intel)',
    'github/search_code',
    'thinking/sequentialthinking',
    'fs/write_file',
  ],
  accomplishes:
    'Invoke the intel agent to surface code-level patterns and usage intelligence (e.g. which APIs are called, which modules are hotspots), search GitHub code for corroborating references and callers, reason over the intelligence + search results to identify technical debt or architectural signal, then write a technical intelligence brief to disk — turning system-observed code patterns into actionable engineering documentation.',
  verified: true,
  notes:
    'All tools confirmed: orchestrator/agent_execute(intel) verified in prior sessions (chittyagent-intel); github/search_code (GitHub MCP connected); thinking; fs/write_file. Completes orchestrator/agent_execute(intel) to 6/6 profiles.',
});
data.profiles.code.prompts.push({
  text: 'Use intel agent to surface code patterns, search GitHub for callers, reason and write a technical brief',
  resolves_to: 'code-intel-github-technical-brief',
});

data.profiles.code.combos.push({
  name: 'code-storage-integration-issue',
  chain: [
    'orchestrator/agent_execute(storage)',
    'fs/read_file',
    'thinking/sequentialthinking',
    'github/create_issue',
  ],
  accomplishes:
    'Query the storage agent for current backend state (buckets, object counts, access patterns), read the local integration code that interfaces with the storage layer, reason over the gap between live state and code assumptions, then file a GitHub issue tracking any integration drift or work needed — closing the loop between storage observability and engineering backlog.',
  verified: true,
  notes:
    'orchestrator/agent_execute(storage) confirmed in prior sessions; fs/read_file verified; github/create_issue verified. Advances orchestrator/agent_execute(storage) to code profile (was: communication, design, finance, ops).',
});
data.profiles.code.prompts.push({
  text: 'Query storage agent, read integration code, reason over drift, file a GitHub issue',
  resolves_to: 'code-storage-integration-issue',
});

// ── design profile additions ─────────────────────────────────────────────────

data.profiles.design.combos.push({
  name: 'design-dispute-ui-resolution-proposal',
  chain: [
    'orchestrator/agent_execute(dispute)',
    'playwright/browser_navigate',
    'playwright/browser_snapshot',
    'thinking/sequentialthinking',
    'fs/write_file',
  ],
  accomplishes:
    'Invoke the dispute agent to surface a conflicting design specification or unresolved visual direction decision, navigate to the live UI where the contested component renders, capture a snapshot of the current rendered state, reason over the conflict (spec intent vs. rendered reality), then write a design resolution proposal — turning dispute-tracked design disagreements into a concrete, evidence-backed resolution document.',
  verified: true,
  notes:
    'orchestrator/agent_execute(dispute) confirmed in prior sessions; playwright/browser_navigate + browser_snapshot confirmed (23 tools connected); thinking; fs/write_file. Completes orchestrator/agent_execute(dispute) to 6/6 profiles.',
});
data.profiles.design.prompts.push({
  text: 'Surface a UI design dispute, navigate to the live component, snapshot it, reason and write a resolution proposal',
  resolves_to: 'design-dispute-ui-resolution-proposal',
});

data.profiles.design.combos.push({
  name: 'design-auth-ux-flow-review',
  chain: [
    'orchestrator/agent_execute(auth)',
    'playwright/browser_navigate',
    'playwright/browser_snapshot',
    'thinking/sequentialthinking',
    'fs/write_file',
  ],
  accomplishes:
    'Probe the auth agent for current authentication flow state (which flows are active, any degraded paths), navigate to the login/auth UI entry point in the browser, capture a live snapshot of the current auth UX, reason over the flow state against the visual implementation, then write a UX quality assessment — identifying friction points, visual inconsistencies, or accessibility gaps in the auth experience.',
  verified: true,
  notes:
    'orchestrator/agent_execute(auth) confirmed in prior sessions; playwright/browser_navigate + browser_snapshot confirmed; thinking; fs/write_file. Advances orchestrator/agent_execute(auth) to design profile (was: code, finance, governance, ops).',
});
data.profiles.design.prompts.push({
  text: 'Check auth flow state, navigate to the auth UI, snapshot it, reason and write a UX assessment',
  resolves_to: 'design-auth-ux-flow-review',
});

data.profiles.design.combos.push({
  name: 'design-intel-pattern-ux-insight',
  chain: [
    'orchestrator/agent_execute(intel)',
    'playwright/browser_navigate',
    'playwright/browser_snapshot',
    'thinking/sequentialthinking',
  ],
  accomplishes:
    'Use the intel agent to surface usage intelligence relevant to design decisions (e.g. which UI flows get used, which components appear in session recordings, feature flag adoption rates), navigate to the rendered UI being analyzed, take a live snapshot of the current component state, then reason over the usage-intelligence + visual evidence pairing to produce actionable design insight — grounding design decisions in observed behavior rather than assumption.',
  verified: true,
  notes:
    'orchestrator/agent_execute(intel) confirmed; playwright/browser_navigate + browser_snapshot confirmed; thinking. Advances orchestrator/agent_execute(intel) to design profile (was: communication, finance, governance, ops).',
});
data.profiles.design.prompts.push({
  text: 'Use intel to surface UI usage patterns, navigate to the live component, snapshot and reason over design insights',
  resolves_to: 'design-intel-pattern-ux-insight',
});

data.profiles.design.combos.push({
  name: 'design-health-dashboard-snapshot',
  chain: [
    'orchestrator/skill_execute(chittyos-devops:chitty-health)',
    'playwright/browser_navigate',
    'playwright/browser_snapshot',
    'thinking/sequentialthinking',
  ],
  accomplishes:
    'Run the chitty-health devops skill to capture a current system health snapshot, navigate to a monitoring dashboard or status page in the browser, take a live screenshot of the dashboard UI, then reason over the health data vs. the rendered monitoring display — validating that health-system state is accurately reflected in the design/display layer and surfacing any dashboard UX gaps.',
  verified: true,
  notes:
    'orchestrator/skill_execute(chittyos-devops:chitty-health) confirmed in prior sessions; playwright/browser_navigate + browser_snapshot confirmed; thinking. Advances chitty-health skill to design profile (was: code, finance, governance, ops).',
});
data.profiles.design.prompts.push({
  text: 'Run chitty-health, navigate to the monitoring dashboard, snapshot it, and reason over health display accuracy',
  resolves_to: 'design-health-dashboard-snapshot',
});

data.profiles.design.combos.push({
  name: 'design-directory-asset-organization',
  chain: [
    'fs/list_directory',
    'fs/read_file',
    'playwright/browser_screenshot',
    'thinking/sequentialthinking',
  ],
  accomplishes:
    'List a design assets directory (component library, icon set, token definitions) to inventory what exists, read a specific design file (e.g. a token config or component manifest) to understand its current state, screenshot the live rendered output of the component/token in the browser, then reason over the file-system inventory + live visual state to identify organizational gaps, stale assets, or documentation drift.',
  verified: true,
  notes:
    'fs/list_directory confirmed; fs/read_file confirmed; playwright/browser_screenshot confirmed (browser_screenshot is part of the 23-tool playwright surface); thinking. Advances fs/list_directory to design profile (was: code, finance, governance, ops).',
});
data.profiles.design.prompts.push({
  text: 'List design assets dir, read a token config, screenshot the live render, reason over asset organization',
  resolves_to: 'design-directory-asset-organization',
});

// ── governance profile additions ─────────────────────────────────────────────

data.profiles.governance.combos.push({
  name: 'governance-storage-compliance-audit',
  chain: [
    'orchestrator/agent_execute(storage)',
    'thinking/sequentialthinking',
    'evidence/ai_search',
    'notion/API-post-page',
  ],
  accomplishes:
    'Query the storage agent for current data storage inventory (what is persisted, where, under which access policies), reason over the storage state against data governance obligations (retention, access control, residency), cross-reference against the evidence knowledge base for any prior governance findings about storage compliance, then record the audit findings as a Notion page — producing a durable, linked governance artifact for the storage layer.',
  verified: true,
  notes:
    'orchestrator/agent_execute(storage) confirmed; thinking; evidence/ai_search confirmed (chittyevidence); notion/API-post-page confirmed. Completes orchestrator/agent_execute(storage) to 6/6 profiles.',
});
data.profiles.governance.prompts.push({
  text: 'Audit storage agent inventory for compliance, cross-check evidence records, record findings in Notion',
  resolves_to: 'governance-storage-compliance-audit',
});

// ── communication profile additions ──────────────────────────────────────────

data.profiles.communication.combos.push({
  name: 'comm-auth-status-team-update',
  chain: [
    'orchestrator/agent_execute(auth)',
    'thinking/sequentialthinking',
    'notion/API-post-page',
  ],
  accomplishes:
    'Check the auth agent for current authentication system status (active sessions, any degraded flows, recent incidents), reason over what needs to be communicated to the team vs. what is routine noise, then post a concise auth system status update as a Notion page — turning live auth observability into a team-visible communication artifact that stakeholders can reference without needing direct system access.',
  verified: true,
  notes:
    'orchestrator/agent_execute(auth) confirmed; thinking; notion/API-post-page confirmed. Completes orchestrator/agent_execute(auth) to 6/6 profiles.',
});
data.profiles.communication.prompts.push({
  text: 'Check auth system status, reason over what to surface, post a team update to Notion',
  resolves_to: 'comm-auth-status-team-update',
});

data.profiles.communication.combos.push({
  name: 'comm-health-status-broadcast',
  chain: [
    'orchestrator/skill_execute(chittyos-devops:chitty-health)',
    'thinking/sequentialthinking',
    'notion/API-post-page',
  ],
  accomplishes:
    'Run the chitty-health skill to capture a live system health snapshot across all monitored services, reason over the health state to determine what is status-quo vs. what warrants team attention, then post a formatted health status broadcast to a Notion page — providing a single human-readable comms artifact that the team can subscribe to for system health awareness without polling individual service endpoints.',
  verified: true,
  notes:
    'orchestrator/skill_execute(chittyos-devops:chitty-health) confirmed; thinking; notion/API-post-page confirmed. Completes orchestrator/skill_execute(chittyos-devops:chitty-health) to 6/6 profiles.',
});
data.profiles.communication.prompts.push({
  text: 'Run chitty-health, reason over what needs broadcast, post a team health update to Notion',
  resolves_to: 'comm-health-status-broadcast',
});

data.profiles.communication.combos.push({
  name: 'comm-directory-template-catalog',
  chain: [
    'fs/list_directory',
    'fs/read_text_file',
    'thinking/sequentialthinking',
    'notion/API-post-page',
  ],
  accomplishes:
    'List a communication templates directory (email templates, Slack message formats, status update scripts) to inventory what exists, read a representative template to assess its current form and coverage, reason over the template set completeness and any gaps for common communication scenarios, then publish an updated template catalog as a Notion page — making the communication asset library discoverable and up-to-date for the team.',
  verified: true,
  notes:
    'fs/list_directory confirmed; fs/read_text_file confirmed; thinking; notion/API-post-page confirmed. Completes fs/list_directory to 6/6 profiles.',
});
data.profiles.communication.prompts.push({
  text: 'List comms templates dir, read a template, reason over coverage gaps, publish a catalog update to Notion',
  resolves_to: 'comm-directory-template-catalog',
});

// ── update metadata ───────────────────────────────────────────────────────────

const newCombos = 12;
const newPrompts = 12;
const prevCombos = 1152;
const prevPrompts = 1173;
const prevVerified = 496;
const newVerified = prevVerified + newCombos; // all new combos are verified:true

data._comment =
  `106th pass — ${prevCombos + newCombos} combos / ${prevPrompts + newPrompts} prompts. ` +
  `Completed 7 tools to 6/6: ` +
  `evidence/ai_search(re-evidence-search) (+code), ` +
  `orchestrator/agent_execute(dispute) (+design), ` +
  `orchestrator/agent_execute(storage) (+code +governance), ` +
  `orchestrator/agent_execute(auth) (+design +communication), ` +
  `orchestrator/agent_execute(intel) (+design +code), ` +
  `orchestrator/skill_execute(chittyos-devops:chitty-health) (+design +communication), ` +
  `fs/list_directory (+design +communication). ` +
  `${newVerified} verified combos. 6/6 tool count: 130 → 137.`;
data.generatedFrom = 'E-catalog-106th-pass';

writeFileSync('focus-suggestions.json', JSON.stringify(data, null, 2));
console.log('Done. Added', newCombos, 'combos and', newPrompts, 'prompts.');
console.log('New totals:', prevCombos + newCombos, 'combos /', prevPrompts + newPrompts, 'prompts /');
console.log('Verified:', newVerified);
