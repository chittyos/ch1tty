// Bundled config for the Worker. The stdio gateway loaded servers.json +
// focus-profiles.json from disk; a Worker has no filesystem, so the data is
// embedded here and validated at construction by config.ts / focus.ts.
//
// ONLY remote (HTTP/streamable-MCP) upstreams are included — a Worker cannot
// spawn stdio child processes. The following servers.json upstreams are dropped
// because they are type:"local" (stdio/npx) and have no portable remote MCP URL
// in the repo config. They are BLOCKERS, listed in the port report, NOT faked:
//   enabled locals : stripe, context7, thinking, fs, playwright
//   disabled locals: tasks, ledger, session, chittyevidence, chittymac,
//                    imessage, serena, quality, desktop, chrome, pdf
//   cowork (remote but loopback http://127.0.0.1:8850 — unreachable from a
//           Worker; dropped).
import type { ServerConfig } from './types.js';

/**
 * Remote upstreams, ported 1:1 from servers.json (enabled:true, type:"remote").
 * `authTokenKey` is resolved against the Worker env in remote-proxy.ts:
 * "chittymcp" -> env.CHITTY_MCP_TOKEN, etc. (see AUTH_TOKEN_ENV map there).
 * `envHeaders` map header-name -> env-var-name, resolved against the Worker env.
 */
export const REMOTE_SERVERS: ServerConfig[] = [
  {
    id: 'chittyos',
    name: 'ChittyOS Ecosystem',
    type: 'remote',
    access: 'readwrite',
    category: 'ecosystem',
    endpoint: 'https://mcp.chitty.cc/mcp',
    envHeaders: {
      'CF-Access-Client-Id': 'CHITTY_CF_ACCESS_CLIENT_ID',
      'CF-Access-Client-Secret': 'CHITTY_CF_ACCESS_CLIENT_SECRET',
    },
    authTokenKey: 'chittymcp',
    lazy: true,
    enabled: true,
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare Platform',
    type: 'remote',
    access: 'readwrite',
    category: 'ecosystem',
    endpoint: 'https://mcp.cloudflare.com/mcp',
    authTokenKey: 'cloudflare-mcp',
    lazy: true,
    enabled: true,
  },
  {
    id: 'cloudflare-builds',
    name: 'Cloudflare Workers Builds',
    type: 'remote',
    access: 'readwrite',
    category: 'ecosystem',
    endpoint: 'https://builds.mcp.cloudflare.com/mcp',
    authTokenKey: 'cloudflare-builds-mcp',
    lazy: true,
    enabled: true,
  },
  {
    id: 'evidence',
    name: 'Evidence Search',
    type: 'remote',
    access: 'read',
    category: 'search',
    endpoint: 'https://autorag.mcp.cloudflare.com/mcp',
    authTokenKey: 'chittyevidence-search',
    lazy: true,
    enabled: true,
  },
  {
    id: 'browser-rendering',
    name: 'Cloudflare Browser Rendering',
    type: 'remote',
    access: 'read',
    category: 'desktop',
    endpoint: 'https://browser.mcp.cloudflare.com/mcp',
    authTokenKey: 'cloudflare-browser-rendering',
    lazy: true,
    enabled: true,
  },
  {
    id: 'github',
    name: 'GitHub API',
    type: 'remote',
    access: 'readwrite',
    category: 'code',
    endpoint: 'https://api.githubcopilot.com/mcp/',
    envHeaders: { Authorization: 'GITHUB_MCP_AUTHORIZATION' },
    lazy: true,
    enabled: true,
  },
  {
    id: 'linear',
    name: 'Linear',
    type: 'remote',
    access: 'readwrite',
    category: 'code',
    endpoint: 'https://mcp.linear.app/mcp',
    authTokenKey: 'linear-mcp',
    lazy: true,
    enabled: true,
  },
  {
    id: 'notion',
    name: 'Notion',
    type: 'remote',
    access: 'readwrite',
    category: 'documents',
    endpoint: 'https://mcp.chitty.cc/notion/mcp',
    envHeaders: {
      'CF-Access-Client-Id': 'CHITTY_CF_ACCESS_CLIENT_ID',
      'CF-Access-Client-Secret': 'CHITTY_CF_ACCESS_CLIENT_SECRET',
    },
    authTokenKey: 'chittymcp',
    lazy: true,
    enabled: true,
  },
  {
    id: 'neon',
    name: 'Neon Database',
    type: 'remote',
    access: 'readwrite',
    category: 'ecosystem',
    endpoint: 'https://mcp.chitty.cc/neon/mcp',
    envHeaders: {
      'CF-Access-Client-Id': 'CHITTY_CF_ACCESS_CLIENT_ID',
      'CF-Access-Client-Secret': 'CHITTY_CF_ACCESS_CLIENT_SECRET',
    },
    authTokenKey: 'chittymcp',
    lazy: true,
    enabled: true,
  },
  {
    id: 'orchestrator',
    name: 'ChittyAgent Orchestrator',
    type: 'remote',
    access: 'readwrite',
    category: 'ecosystem',
    endpoint: 'https://orchestrator.chitty.cc/mcp',
    authTokenKey: 'chittymcp',
    lazy: false,
    enabled: true,
  },
  {
    id: 'connect',
    name: 'ChittyConnect (ChicoKeys)',
    type: 'remote',
    access: 'readwrite',
    category: 'ecosystem',
    endpoint: 'https://connect.chitty.cc/api/mcp',
    authTokenKey: 'chittymcp',
    lazy: false,
    enabled: true,
  },
];

/** Focus profiles — embedded verbatim from focus-profiles.json (profiles only). */
export const FOCUS_PROFILES_RAW = {
  profiles: {
    finance: {
      description: 'Billing, payments, ledger, and financial ecosystem tools',
      categories: ['ecosystem'],
      servers: ['stripe', 'tasks', 'ledger'],
      boost: 0.5,
    },
    governance: {
      description: 'ChittyOS ecosystem governance, identity, evidence, persistent state, sessions, and ledger',
      categories: ['ecosystem', 'documents'],
      servers: ['chittyos', 'neon', 'notion', 'evidence', 'chittyevidence', 'orchestrator', 'session', 'ledger', 'tasks', 'linear'],
      boost: 0.5,
    },
    design: {
      description: 'Browser rendering, automation, and desktop/visual work',
      categories: ['desktop'],
      servers: ['browser-rendering', 'playwright', 'cowork'],
      boost: 0.5,
    },
    code: {
      description: 'Software development — source control, issue tracking, deployment, library documentation, database, code quality, and technical documentation tools',
      categories: ['code'],
      servers: ['cloudflare', 'context7', 'neon', 'fs', 'quality', 'serena', 'notion', 'linear'],
      boost: 0.5,
    },
    communication: {
      description: 'Cross-channel messaging, notes, team communication, and follow-up task creation',
      categories: ['communication'],
      servers: ['notion', 'chittymac', 'imessage', 'tasks'],
      boost: 0.5,
    },
    ops: {
      description: 'Deployment, infrastructure monitoring, and DevOps tooling — Cloudflare Workers, database ops, source control, filesystem, and orchestration',
      categories: ['ecosystem', 'code'],
      servers: ['cloudflare', 'cloudflare-builds', 'neon', 'github', 'orchestrator', 'fs', 'quality'],
      boost: 0.5,
    },
  },
} as const;

/**
 * Maps servers.json `authTokenKey` -> Worker env binding name. The stdio
 * gateway ran `chitty-mcp-token <key>` (a subprocess broker lookup); a Worker
 * cannot spawn processes, so each broker key is delivered as a Secrets Store
 * binding / var and resolved by this map in remote-proxy.ts.
 */
export const AUTH_TOKEN_ENV: Record<string, string> = {
  'chittymcp': 'CHITTY_MCP_TOKEN',
  'cloudflare-mcp': 'CLOUDFLARE_MCP_TOKEN',
  'cloudflare-builds-mcp': 'CLOUDFLARE_BUILDS_MCP_TOKEN',
  'chittyevidence-search': 'CHITTYEVIDENCE_SEARCH_TOKEN',
  'cloudflare-browser-rendering': 'CLOUDFLARE_BROWSER_RENDERING_TOKEN',
  'linear-mcp': 'LINEAR_MCP_TOKEN',
};
