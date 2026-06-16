import { log } from './logger.js';

export interface ToolUseRecord {
  tool: string;
  ts: number;
}

export interface SessionInfo {
  id: string;
  transport: 'stdio' | 'http';
  startedAt: number;
  lastActivityAt: number;
  toolCalls: number;
  recentTools: ToolUseRecord[];
}

const MAX_RECENT_TOOLS = 50;

class Session {
  readonly id: string;
  readonly transport: 'stdio' | 'http';
  readonly startedAt: number;
  lastActivityAt: number;
  toolCalls = 0;
  recentTools: ToolUseRecord[] = [];

  constructor(id: string, transport: 'stdio' | 'http') {
    this.id = id;
    this.transport = transport;
    this.startedAt = Date.now();
    this.lastActivityAt = Date.now();
  }

  recordToolCall(tool: string): void {
    this.toolCalls++;
    this.lastActivityAt = Date.now();
    this.recentTools.push({ tool, ts: Date.now() });
    if (this.recentTools.length > MAX_RECENT_TOOLS) {
      this.recentTools = this.recentTools.slice(-MAX_RECENT_TOOLS);
    }
  }

  toInfo(): SessionInfo {
    return {
      id: this.id,
      transport: this.transport,
      startedAt: this.startedAt,
      lastActivityAt: this.lastActivityAt,
      toolCalls: this.toolCalls,
      recentTools: this.recentTools.slice(-10),
    };
  }
}

export class SessionTracker {
  private sessions = new Map<string, Session>();

  /** Create or return existing session. */
  getOrCreate(id: string, transport: 'stdio' | 'http'): Session {
    let session = this.sessions.get(id);
    if (!session) {
      session = new Session(id, transport);
      this.sessions.set(id, session);
      log.info(`Session started`, undefined, { sessionId: id, transport });
    }
    return session;
  }

  /** Record a tool call for a session. */
  recordToolCall(sessionId: string, tool: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.recordToolCall(tool);
    }
  }

  /** Get recent tool names for a session (for contextual search). */
  getRecentTools(sessionId: string): string[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return session.recentTools.map((r) => r.tool);
  }

  /** Remove a session. */
  remove(id: string): void {
    if (this.sessions.delete(id)) {
      log.info(`Session ended`, undefined, { sessionId: id });
    }
  }

  /** Snapshot of all active sessions. */
  listSessions(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => s.toInfo());
  }

  /** Count of active sessions. */
  get count(): number {
    return this.sessions.size;
  }
}
