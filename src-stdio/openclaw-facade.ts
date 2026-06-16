/**
 * OpenClaw facade — exposes Ch1tty capabilities as OpenClaw skills.
 * Routes: /openclaw/skills.json, /openclaw/invoke, /openclaw/status
 *
 * OpenClaw gateways discover skills via a manifest and invoke them
 * through a simple REST protocol. This facade translates those calls
 * into Ch1tty's slim-MCP aggregator.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Aggregator } from './aggregator.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-OpenClaw-Node-Id',
};

function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  /* c8 ignore next -- Node.js HTTP chunks are always Buffer, never string */
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

/** OpenClaw skill manifest — static capabilities Ch1tty exposes as skills */
const SKILL_MANIFEST = {
  skills: [
    {
      key: 'ch1tty-search',
      name: 'Ch1tty Search',
      description: 'Search the Ch1tty tool registry by keyword, server, or category',
      version: '4.0.0',
      metadata: {
        'openclaw.requires': [],
        'openclaw.install': null,
      },
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search keywords' },
          server: { type: 'string', description: 'Filter by server id' },
          category: { type: 'string', description: 'Filter by category' },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
      },
    },
    {
      key: 'ch1tty-execute',
      name: 'Ch1tty Execute',
      description: 'Execute any tool in the Ch1tty ecosystem by namespaced name. Use ch1tty-search first.',
      version: '4.0.0',
      metadata: {
        'openclaw.requires': [],
        'openclaw.install': null,
      },
      inputSchema: {
        type: 'object',
        properties: {
          tool: { type: 'string', description: 'Namespaced tool name (serverId/toolName)' },
          args: { type: 'object', description: 'Arguments to pass to the tool' },
        },
        required: ['tool'],
      },
    },
    {
      key: 'ch1tty-status',
      name: 'Ch1tty Status',
      description: 'Gateway status — connected servers, tool counts, uptime',
      version: '4.0.0',
      metadata: {
        'openclaw.requires': [],
        'openclaw.install': null,
      },
      inputSchema: { type: 'object' },
    },
    {
      key: 'ch1tty-session',
      name: 'Ch1tty Session',
      description: 'Recall or save session context across platforms',
      version: '4.0.0',
      metadata: {
        'openclaw.requires': [],
        'openclaw.install': null,
      },
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['recall', 'persist'], description: 'Recall or persist session state' },
          query: { type: 'string', description: 'Search query for recall, or key for persist' },
          value: { type: 'string', description: 'Value to persist (only for persist action)' },
          scope: { type: 'string', enum: ['session', 'entity', 'all'], default: 'session' },
        },
        required: ['action'],
      },
    },
  ],
};

/** Map OpenClaw skill key → Ch1tty tool + arg transformer */
const SKILL_MAP: Record<string, { tool: string; mapArgs: (body: Record<string, unknown>) => Record<string, unknown> }> = {
  'ch1tty-search': {
    tool: 'ch1tty/search',
    mapArgs: (b) => ({ query: b.query, server: b.server, category: b.category, limit: b.limit }),
  },
  'ch1tty-execute': {
    tool: 'ch1tty/execute',
    mapArgs: (b) => ({ tool: b.tool, args: b.args }),
  },
  'ch1tty-status': {
    tool: 'ch1tty/status',
    mapArgs: () => ({}),
  },
  'ch1tty-session': {
    tool: 'ch1tty/execute',
    mapArgs: (b) => {
      if (b.action === 'persist') {
        return { tool: 'chittyos/chitty_memory_persist', args: { key: b.query, value: b.value, scope: b.scope ?? 'session' } };
      }
      return { tool: 'chittyos/chitty_memory_recall', args: { query: b.query ?? 'session context', scope: b.scope ?? 'session' } };
    },
  },
};

export function handleOpenClawRoute(
  aggregator: Aggregator,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): boolean {
  const route = path.replace(/^\/openclaw/, '');

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return true;
  }

  // Skill manifest — OpenClaw gateways fetch this to discover capabilities
  if ((route === '' || route === '/' || route === '/skills.json') && req.method === 'GET') {
    jsonResponse(res, 200, SKILL_MANIFEST);
    return true;
  }

  // Status
  if (route === '/status' && req.method === 'GET') {
    try {
      const snapshot = aggregator.getStatusSnapshot();
      jsonResponse(res, 200, { ok: true, gateway: snapshot, channel: 'openclaw' });
    } catch {
      jsonResponse(res, 200, { ok: true, channel: 'openclaw' });
    }
    return true;
  }

  // Invoke a skill
  if (route === '/invoke' && req.method === 'POST') {
    (async () => {
      try {
        const body = await readBody(req);
        const skillKey = body.skill as string;
        if (!skillKey) {
          jsonResponse(res, 400, { ok: false, error: 'Missing "skill" field' });
          return;
        }

        const skill = SKILL_MAP[skillKey];
        if (!skill) {
          jsonResponse(res, 404, { ok: false, error: `Unknown skill: ${skillKey}`, available: Object.keys(SKILL_MAP) });
          return;
        }

        const nodeId = (req.headers['x-openclaw-node-id'] as string) || 'openclaw-default';
        const sessionId = `openclaw-${nodeId}`;
        aggregator.sessions.getOrCreate(sessionId, 'http');

        const args = skill.mapArgs(body.args as Record<string, unknown> ?? body);
        const result = await aggregator.callTool(skill.tool, args, sessionId);

        const content = result.content?.[0];
        let parsed: unknown;
        if (content && 'text' in content) {
          try { parsed = JSON.parse(content.text); } catch { parsed = content.text; }
        } else {
          parsed = result;
        }

        jsonResponse(res, 200, {
          ok: true,
          skill: skillKey,
          result: parsed,
          node_id: nodeId,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        jsonResponse(res, 500, { ok: false, error: msg });
      }
    })();
    return true;
  }

  jsonResponse(res, 404, { ok: false, error: 'Unknown OpenClaw route', path: route });
  return true;
}
