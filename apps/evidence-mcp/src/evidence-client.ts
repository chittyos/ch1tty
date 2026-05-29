export interface Document {
  id: string;
  canonical_uri: string;
  kind: string;
  title?: string;
  content?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at?: string;
}

export interface IngestDocumentInput {
  content: string;
  kind: string;
  title?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface ListDocumentsFilter {
  kind?: string;
  tag?: string;
  since?: string;
  cursor?: string;
  limit?: number;
}

export interface ListDocumentsResult {
  documents: Document[];
  next_cursor?: string;
  has_more: boolean;
}

export interface SearchDocumentsResult {
  documents: Document[];
  total: number;
}

export class EvidenceClient {
  private baseUrl: string;
  private token: string | undefined;

  constructor(baseUrl?: string, token?: string) {
    this.baseUrl = (baseUrl ?? process.env['CHITTY_EVIDENCE_URL'] ?? 'https://evidence.chitty.cc').replace(/\/$/, '');
    this.token = token ?? process.env['CHITTY_EVIDENCE_TOKEN'];
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
      throw new Error(`evidence API ${method} ${path} → ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  ingestDocument(input: IngestDocumentInput): Promise<Document> {
    return this.request<Document>('POST', '/api/evidence/documents', input);
  }

  listDocuments(filter?: ListDocumentsFilter): Promise<ListDocumentsResult> {
    const params = new URLSearchParams();
    if (filter?.kind) params.set('kind', filter.kind);
    if (filter?.tag) params.set('tag', filter.tag);
    if (filter?.since) params.set('since', filter.since);
    if (filter?.cursor) params.set('cursor', filter.cursor);
    if (filter?.limit !== undefined) params.set('limit', String(filter.limit));
    const qs = params.toString();
    return this.request<ListDocumentsResult>('GET', `/api/evidence/documents${qs ? `?${qs}` : ''}`);
  }

  getDocument(id: string): Promise<Document> {
    return this.request<Document>('GET', `/api/evidence/documents/${encodeURIComponent(id)}`);
  }

  searchDocuments(query: string, kind?: string, limit?: number): Promise<SearchDocumentsResult> {
    const params = new URLSearchParams({ q: query });
    if (kind) params.set('kind', kind);
    if (limit !== undefined) params.set('limit', String(limit));
    return this.request<SearchDocumentsResult>('GET', `/api/evidence/documents/search?${params.toString()}`);
  }

  getCanonicalUri(id: string): Promise<{ id: string; canonical_uri: string }> {
    return this.request<{ id: string; canonical_uri: string }>(
      'GET',
      `/api/evidence/canonical/${encodeURIComponent(id)}`,
    );
  }
}
