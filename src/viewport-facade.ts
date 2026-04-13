/**
 * Viewport-hydration facade — doctrine-aligned session bootstrap.
 *
 * Per doctrine (chittycanon://doctrine/seed):
 *   "Sessions are viewports into persistent entities."
 *   "Identity lives in the coordination layer, not in the model."
 *
 * Session protocol on_start:
 *   1. resolve_identity_from_context
 *   2. never_mint_on_failure
 *   3. load_doctrine_seed
 *   4. inherit_trust_and_experience
 *   5. declare_substrate_platform
 *
 * Session protocol on_end:
 *   1. persist_experience_to_accumulator
 *   2. log_session_event_to_ledger
 *   3. queue_sync_to_chittyconnect
 *
 * This facade exposes those operations as tools routed through
 * ch1tty/execute → viewport/{tool}. Ch1tty authenticates to
 * ChittyConnect with its own ChittyID + Ed25519 signature.
 *
 * @canon chittycanon://doctrine/seed
 * @canon chittycanon://gov/governance#sessions-are-viewports
 */

import type { ToolCallResult, ToolEntry } from './types.js';
import { log } from './logger.js';
import { signedFetch, CH1TTY_IDENTITY } from './identity.js';

export const VIEWPORT_SERVER_ID = 'viewport';

// ── Endpoints (from doctrine-seed.js api_endpoints) ───────────

const ADVOCATE_BASE = 'https://advocate.chitty.cc';
const CONNECT_BASE = 'https://connect.chitty.cc';

// ── Tool catalog ──────────────────────────────────────────────

const VIEWPORT_TOOLS: ToolEntry[] = [
  {
    name: 'hydrate',
    description:
      'Bootstrap a session viewport. Fetches doctrine seed from ChittyAdvocate, ' +
      'resolves identity from ChittyConnect, and returns the combined hydration payload. ' +
      'Call on session start — this is the "viewport_not_birth" protocol.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'The session identifier for this viewport' },
        platform: {
          type: 'string',
          description: 'Substrate platform (e.g. "claude-code", "chatgpt", "co-work")',
        },
        hints: {
          type: 'object',
          description: 'Context hints for identity resolution (project, repo, cwd, etc.)',
        },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'resolve_context',
    description:
      'Resolve the Person entity for this viewport via ChittyConnect. ' +
      'Returns chittyId, trustLevel, identityClass, and active workstreams. ' +
      'Never mints a new identity on failure — returns unresolved status instead.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session identifier' },
        hints: { type: 'object', description: 'Context hints for resolution' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'memory_recall',
    description:
      'Recall accumulated experience from the coordination layer via MemoryCloude. ' +
      'Returns memories relevant to the current context — the Person\'s experience, not the session\'s.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to recall — search across accumulated experience' },
        scope: {
          type: 'string',
          enum: ['session', 'entity', 'all'],
          description: 'Recall scope (default: entity)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_persist',
    description:
      'Persist experience to the coordination layer accumulator. ' +
      'Called on session end to record what this viewport learned.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key / topic' },
        value: { type: 'string', description: 'The experience to persist' },
        scope: {
          type: 'string',
          enum: ['session', 'entity', 'all'],
          description: 'Persistence scope (default: entity)',
        },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'doctrine_seed',
    description:
      'Fetch the current canonical doctrine seed from ChittyAdvocate. ' +
      'Returns the machine-readable governance bootstrap (ontology, lifecycle, trust model, session protocol).',
    inputSchema: { type: 'object' },
  },
];

// ── Handlers ──────────────────────────────────────────────────

export function getViewportTools(): ToolEntry[] {
  return VIEWPORT_TOOLS;
}

export async function handleViewportCall(
  toolName: string,
  args: Record<string, unknown>,
  sessionPersonId?: string,
): Promise<ToolCallResult> {
  const known = VIEWPORT_TOOLS.find((t) => t.name === toolName);
  if (!known) {
    return {
      content: [{
        type: 'text',
        text: `Unknown viewport tool "${toolName}". Available: ${VIEWPORT_TOOLS.map((t) => t.name).join(', ')}`,
      }],
      isError: true,
    };
  }

  try {
    switch (toolName) {
      case 'hydrate':
        return await handleHydrate(args, sessionPersonId);
      case 'resolve_context':
        return await handleResolveContext(args, sessionPersonId);
      case 'memory_recall':
        return await handleMemoryRecall(args, sessionPersonId);
      case 'memory_persist':
        return await handleMemoryPersist(args, sessionPersonId);
      case 'doctrine_seed':
        return await handleDoctrineSeed();
      default:
        return {
          content: [{ type: 'text', text: `Unhandled viewport tool: ${toolName}` }],
          isError: true,
        };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`viewport/${toolName} failed: ${msg}`, VIEWPORT_SERVER_ID);
    return {
      content: [{ type: 'text', text: `viewport/${toolName} failed: ${msg}` }],
      isError: true,
    };
  }
}

// ── hydrate ───────────────────────────────────────────────────
// Composite: doctrine seed + identity resolution in one call.

async function handleHydrate(
  args: Record<string, unknown>,
  sessionPersonId?: string,
): Promise<ToolCallResult> {
  const sessionId = args.sessionId as string;
  const platform = (args.platform as string) ?? 'unknown';
  const hints = (args.hints as Record<string, unknown>) ?? {};

  // Parallel: fetch doctrine + resolve identity
  const [doctrineResult, contextResult] = await Promise.allSettled([
    fetchDoctrineSeed(),
    resolveContext(sessionId, hints, sessionPersonId),
  ]);

  if (doctrineResult.status === 'rejected') {
    log.warn(`doctrine fetch failed during hydrate: ${doctrineResult.reason}`, VIEWPORT_SERVER_ID);
  }
  if (contextResult.status === 'rejected') {
    log.warn(`context resolve failed during hydrate: ${contextResult.reason}`, VIEWPORT_SERVER_ID);
  }

  const doctrine = doctrineResult.status === 'fulfilled' ? doctrineResult.value : null;
  const context = contextResult.status === 'fulfilled' ? contextResult.value : null;
  const bothFailed = !doctrine && !context;

  const hydration = {
    gateway: CH1TTY_IDENTITY,
    platform,
    sessionId,
    doctrine: doctrine ?? { error: String(doctrineResult.status === 'rejected' ? doctrineResult.reason : 'advocate unreachable') },
    context: context ?? { error: String(contextResult.status === 'rejected' ? contextResult.reason : 'connect unreachable'), minted: false },
    selfCheck: [
      'Am I using the correct ChittyID (not a freshly minted one)?',
      'Am I treating myself as Person (P), not Thing (T)?',
      'Am I using doctrine lifecycle states (fresh/active/dormant/stale/retired)?',
      'Have I minted anything I shouldn\'t have?',
      'Is my trust based on behavior, not credentials?',
    ],
    timestamp: new Date().toISOString(),
  };

  log.info(`Viewport hydrated: session=${sessionId} platform=${platform} bothFailed=${bothFailed}`, VIEWPORT_SERVER_ID);

  return {
    content: [{ type: 'text', text: JSON.stringify(hydration, null, 2) }],
    ...(bothFailed ? { isError: true } : {}),
  };
}

// ── resolve_context ───────────────────────────────────────────

async function handleResolveContext(
  args: Record<string, unknown>,
  sessionPersonId?: string,
): Promise<ToolCallResult> {
  const sessionId = args.sessionId as string;
  const hints = (args.hints as Record<string, unknown>) ?? {};
  const result = await resolveContext(sessionId, hints, sessionPersonId);

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}

async function resolveContext(
  sessionId: string,
  hints: Record<string, unknown>,
  sessionPersonId?: string,
): Promise<Record<string, unknown>> {
  const resp = await signedFetch(`${CONNECT_BASE}/api/v1/context/resolve`, {
    method: 'POST',
    body: { sessionId, hints },
    onBehalfOf: sessionPersonId,
    timeoutMs: 8_000,
  });

  if (!resp.ok) {
    log.warn(`context/resolve returned ${resp.status}`, VIEWPORT_SERVER_ID);
    // Doctrine: never_mint_on_failure — return unresolved, don't invent identity
    return { resolved: false, status: resp.status, minted: false };
  }

  return await resp.json() as Record<string, unknown>;
}

// ── memory_recall ─────────────────────────────────────────────

async function handleMemoryRecall(
  args: Record<string, unknown>,
  sessionPersonId?: string,
): Promise<ToolCallResult> {
  const query = args.query as string;
  const scope = (args.scope as string) ?? 'entity';

  const resp = await signedFetch(`${CONNECT_BASE}/api/v1/memory/recall`, {
    method: 'POST',
    body: { query, scope },
    onBehalfOf: sessionPersonId,
    timeoutMs: 8_000,
  });

  if (!resp.ok) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ recalled: false, status: resp.status }) }],
      isError: true,
    };
  }

  const data = await resp.json();
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

// ── memory_persist ────────────────────────────────────────────

async function handleMemoryPersist(
  args: Record<string, unknown>,
  sessionPersonId?: string,
): Promise<ToolCallResult> {
  const key = args.key as string;
  const value = args.value as string;
  const scope = (args.scope as string) ?? 'entity';

  const resp = await signedFetch(`${CONNECT_BASE}/api/v1/memory/persist`, {
    method: 'POST',
    body: { key, value, scope },
    onBehalfOf: sessionPersonId,
    timeoutMs: 8_000,
  });

  if (!resp.ok) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ persisted: false, status: resp.status }) }],
      isError: true,
    };
  }

  const data = await resp.json();
  log.info(`Memory persisted: key=${key} scope=${scope}`, VIEWPORT_SERVER_ID);
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

// ── doctrine_seed ─────────────────────────────────────────────

async function handleDoctrineSeed(): Promise<ToolCallResult> {
  const seed = await fetchDoctrineSeed();
  const isError = 'error' in seed;
  return { content: [{ type: 'text', text: JSON.stringify(seed, null, 2) }], isError };
}

async function fetchDoctrineSeed(): Promise<Record<string, unknown>> {
  const resp = await signedFetch(`${ADVOCATE_BASE}/seed`, { timeoutMs: 5_000 });
  if (!resp.ok) {
    throw new Error(`advocate returned ${resp.status}`);
  }
  return await resp.json() as Record<string, unknown>;
}
