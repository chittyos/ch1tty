export type SessionStatus = 'active' | 'idle' | 'closed';

export interface Session {
  id: string;
  channel: string;
  user_id?: string;
  status: SessionStatus;
  context?: Record<string, unknown>;
  event_count: number;
  created_at: string;
  updated_at: string;
  closed_at?: string;
}

export interface SessionEvent {
  id: string;
  session_id: string;
  type: string;
  payload?: Record<string, unknown>;
  actor?: string;
  created_at: string;
}

export interface CreateSessionInput {
  channel: string;
  user_id?: string;
  context?: Record<string, unknown>;
}

export interface UpdateSessionInput {
  status?: SessionStatus;
  context?: Record<string, unknown>;
}

export interface ListSessionsFilter {
  channel?: string;
  user_id?: string;
  status?: SessionStatus;
  limit?: number;
}

export interface AppendEventInput {
  type: string;
  payload?: Record<string, unknown>;
  actor?: string;
}

export interface ListEventsResult {
  events: SessionEvent[];
  has_more: boolean;
  cursor?: string;
}

export class SessionClient {
  private baseUrl: string;
  private token: string | undefined;

  constructor(baseUrl?: string, token?: string) {
    this.baseUrl = (baseUrl ?? process.env['CHITTY_SESSION_URL'] ?? 'https://session.chitty.cc').replace(/\/$/, '');
    this.token = token ?? process.env['CHITTY_SESSION_TOKEN'];
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`session API ${method} ${path} → ${res.status}: ${text}`);
    }
    if (res.status === 204) return undefined as unknown as T;
    return res.json() as Promise<T>;
  }

  listSessions(filter?: ListSessionsFilter): Promise<Session[]> {
    const params = new URLSearchParams();
    if (filter?.channel) params.set('channel', filter.channel);
    if (filter?.user_id) params.set('user_id', filter.user_id);
    if (filter?.status) params.set('status', filter.status);
    if (filter?.limit !== undefined) params.set('limit', String(filter.limit));
    const qs = params.toString();
    return this.request<Session[]>('GET', `/api/sessions${qs ? `?${qs}` : ''}`);
  }

  getSession(id: string): Promise<Session> {
    return this.request<Session>('GET', `/api/sessions/${encodeURIComponent(id)}`);
  }

  createSession(input: CreateSessionInput): Promise<Session> {
    return this.request<Session>('POST', '/api/sessions', input);
  }

  updateSession(id: string, input: UpdateSessionInput): Promise<Session> {
    return this.request<Session>('PATCH', `/api/sessions/${encodeURIComponent(id)}`, input);
  }

  closeSession(id: string): Promise<Session> {
    return this.request<Session>('POST', `/api/sessions/${encodeURIComponent(id)}/close`);
  }

  appendEvent(sessionId: string, input: AppendEventInput): Promise<SessionEvent> {
    return this.request<SessionEvent>('POST', `/api/sessions/${encodeURIComponent(sessionId)}/events`, input);
  }

  listEvents(sessionId: string, opts?: { limit?: number; cursor?: string }): Promise<ListEventsResult> {
    const params = new URLSearchParams();
    if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts?.cursor) params.set('cursor', opts.cursor);
    const qs = params.toString();
    return this.request<ListEventsResult>('GET', `/api/sessions/${encodeURIComponent(sessionId)}/events${qs ? `?${qs}` : ''}`);
  }
}
