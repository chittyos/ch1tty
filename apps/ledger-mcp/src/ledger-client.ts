export interface LedgerEntry {
  id: string;
  namespace: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  sequence: number;
  created_at: string;
}

export interface AppendEntryInput {
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ListEntriesFilter {
  cursor?: string;
  limit?: number;
  since?: string;
}

export interface ListEntriesResult {
  entries: LedgerEntry[];
  next_cursor?: string;
  has_more: boolean;
}

export interface Namespace {
  name: string;
  entry_count: number;
  created_at: string;
  last_entry_at?: string;
}

export class LedgerClient {
  private baseUrl: string;
  private token: string | undefined;

  constructor(baseUrl?: string, token?: string) {
    this.baseUrl = (baseUrl ?? process.env['CHITTY_LEDGER_URL'] ?? 'https://ledger.chitty.cc').replace(/\/$/, '');
    this.token = token ?? process.env['CHITTY_LEDGER_TOKEN'];
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
      throw new Error(`ledger API ${method} ${path} → ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  listNamespaces(): Promise<Namespace[]> {
    return this.request<Namespace[]>('GET', '/api/ledger/namespaces');
  }

  listEntries(namespace: string, filter?: ListEntriesFilter): Promise<ListEntriesResult> {
    const params = new URLSearchParams();
    if (filter?.cursor) params.set('cursor', filter.cursor);
    if (filter?.limit !== undefined) params.set('limit', String(filter.limit));
    if (filter?.since) params.set('since', filter.since);
    const qs = params.toString();
    return this.request<ListEntriesResult>(
      'GET',
      `/api/ledger/${encodeURIComponent(namespace)}/entries${qs ? `?${qs}` : ''}`,
    );
  }

  getEntry(namespace: string, id: string): Promise<LedgerEntry> {
    return this.request<LedgerEntry>(
      'GET',
      `/api/ledger/${encodeURIComponent(namespace)}/entries/${encodeURIComponent(id)}`,
    );
  }

  appendEntry(namespace: string, input: AppendEntryInput): Promise<LedgerEntry> {
    return this.request<LedgerEntry>(
      'POST',
      `/api/ledger/${encodeURIComponent(namespace)}/entries`,
      input,
    );
  }
}
