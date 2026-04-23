/**
 * GPT Actions facade — translates OpenAPI REST calls into MCP tool calls.
 * Routes: /gpt-actions/session/get, /session/save, /decision-log/append,
 *         /projects/search, /tasks/list, /state/reconcile, /openapi.yaml
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Aggregator } from './aggregator.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
  res.end(JSON.stringify(data));
}

function envelope(ok: boolean, result: unknown, chittyId?: string): object {
  return { ok, result, chitty_id: chittyId ?? null, timestamp: new Date().toISOString() };
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

// Map GPT action → MCP tool call
const ACTION_MAP: Record<string, { tool: string; mapArgs: (body: Record<string, unknown>) => Record<string, unknown> }> = {
  '/session/get': {
    tool: 'chitty_memory_recall',
    mapArgs: (b) => ({ query: b.project_hint ?? 'session context', scope: 'session', conversation_id: b.conversation_id }),
  },
  '/session/save': {
    tool: 'chitty_memory_persist',
    mapArgs: (b) => ({
      key: `session:${b.conversation_id ?? 'unknown'}`,
      value: JSON.stringify({ summary: b.summary, open_questions: b.open_questions, active_entities: b.active_entities, tags: b.tags }),
      scope: 'session',
    }),
  },
  '/decision-log/append': {
    tool: 'chitty_chronicle_log',
    mapArgs: (b) => ({
      action: 'decision',
      details: JSON.stringify({ decision: b.decision, rationale: b.rationale, status: b.status ?? 'accepted', decided_by: b.decided_by ?? 'chatgpt' }),
      project_id: b.project_id,
      task_id: b.task_id,
    }),
  },
  '/projects/search': {
    tool: 'chitty_notion_query',
    mapArgs: (b) => ({ database_id: '999c414c', query: b.query, status: b.status ?? 'active' }),
  },
  '/tasks/list': {
    tool: 'chitty_task_list',
    mapArgs: (b) => ({ project_id: b.project_id, status: b.status ?? 'all' }),
  },
  '/state/reconcile': {
    tool: 'chitty_memory_recall',
    mapArgs: (b) => ({ query: `reconcile ${b.project_id ?? ''} ${b.current_summary ?? ''}`.trim(), scope: 'all' }),
  },
};

export function handleGptAction(
  aggregator: Aggregator,
  sessionId: string,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): boolean {
  // Strip /gpt-actions prefix
  const actionPath = path.replace(/^\/gpt-actions/, '');

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return true;
  }

  // OpenAPI spec
  if (actionPath === '' || actionPath === '/' || actionPath === '/openapi.yaml') {
    res.writeHead(200, { 'Content-Type': 'text/yaml', ...CORS_HEADERS });
    res.end(OPENAPI_SPEC);
    return true;
  }

  // Action routes
  const action = ACTION_MAP[actionPath];
  if (!action || req.method !== 'POST') {
    jsonResponse(res, 404, envelope(false, { error: 'Unknown action', path: actionPath }));
    return true;
  }

  // Async handler
  (async () => {
    try {
      const body = await readBody(req);
      const args = action.mapArgs(body);

      // Ensure session exists
      aggregator.sessions.getOrCreate(sessionId, 'http');

      const result = await aggregator.callTool(action.tool, args, sessionId);
      const content = result.content?.[0];
      let parsed: unknown;
      if (content && 'text' in content) {
        try { parsed = JSON.parse(content.text); } catch { parsed = content.text; }
      } else {
        parsed = result;
      }

      jsonResponse(res, 200, envelope(true, parsed, body.conversation_id as string));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      jsonResponse(res, 500, envelope(false, { error: msg }));
    }
  })();

  return true;
}

const OPENAPI_SPEC = `openapi: 3.1.0
info:
  title: ChittyMCP GPT Actions
  version: 1.0.0
  description: GPT-facing action facade for Chitty memory and project continuity.

servers:
  - url: https://tty.chitty.cc/gpt-actions

components:
  securitySchemes:
    OAuth2:
      type: oauth2
      flows:
        authorizationCode:
          authorizationUrl: https://tty.chitty.cc/v1/oauth/authorize
          tokenUrl: https://tty.chitty.cc/v1/oauth/token
          scopes: {}

  schemas:
    Envelope:
      type: object
      properties:
        ok: { type: boolean }
        chitty_id: { type: string, nullable: true }
        result: { type: object, additionalProperties: true }
        timestamp: { type: string }

security:
  - OAuth2: []

paths:
  /session/get:
    post:
      operationId: getSessionContext
      summary: Retrieve durable session context
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [conversation_id]
              properties:
                conversation_id: { type: string }
                project_hint: { type: string }
                include_tasks: { type: boolean, default: true }
                include_decisions: { type: boolean, default: true }
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Envelope" }

  /session/save:
    post:
      operationId: saveSessionContext
      summary: Save compressed session context
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [conversation_id, summary]
              properties:
                conversation_id: { type: string }
                project_id: { type: string }
                summary: { type: string }
                open_questions: { type: array, items: { type: string } }
                active_entities: { type: array, items: { type: string } }
                tags: { type: array, items: { type: string } }
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Envelope" }

  /decision-log/append:
    post:
      operationId: appendDecisionLog
      summary: Append a decision log entry
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [conversation_id, decision]
              properties:
                conversation_id: { type: string }
                project_id: { type: string }
                task_id: { type: string }
                decision: { type: string }
                rationale: { type: string }
                decided_by: { type: string, default: chatgpt }
                status: { type: string, enum: [proposed, accepted, rejected, superseded], default: accepted }
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Envelope" }

  /projects/search:
    post:
      operationId: searchProjects
      summary: Search existing projects
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [query]
              properties:
                query: { type: string }
                status: { type: string, enum: [active, archived, all], default: active }
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Envelope" }

  /tasks/list:
    post:
      operationId: listTasks
      summary: List tasks for a project
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [project_id]
              properties:
                project_id: { type: string }
                status: { type: string, enum: [pending, in_progress, completed, all], default: all }
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Envelope" }

  /state/reconcile:
    post:
      operationId: reconcileAgentState
      summary: Reconcile transient chat state with saved Chitty state
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [conversation_id]
              properties:
                conversation_id: { type: string }
                project_id: { type: string }
                current_summary: { type: string }
                current_open_items: { type: array, items: { type: string } }
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Envelope" }
`;
