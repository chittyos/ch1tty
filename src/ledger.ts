// Ledger — durable, batched event sink, ported from src/ledger.ts.
//
// The original buffered in memory and "flushed" to the ecosystem backend... but
// its flush loop body was literally `try { undefined }` — flushedCount never
// incremented and nothing was ever written (a pre-existing stub in the source).
// This port implements the REAL flush per the approved DO architecture:
//   - record()  → INSERT into DO SQLite (this.ctx.storage.sql), durable across
//                 requests/hibernation. The tool_call coalescing + batch-upgrade
//                 semantics from the original are preserved.
//   - alarm()   → flush() reads unflushed rows and emits each as a structured
//                 console.log event tagged `ch1tty_ledger`. Workers observability
//                 forwards these to the `chittytrack` tail_consumer (the
//                 Alchemist ingest path), then rows are marked flushed.
// SQLite IS the write-ahead buffer; nothing is dropped on eviction (the original
// dropped oldest at 500 and DLQ'd on shutdown — durable storage removes that
// failure mode entirely).
//
// @canon chittycanon://gov/governance#ledger-is-append-only

export interface LedgerEntry {
  event_type: string;
  entity_id?: string;
  session_id: string;
  metadata: Record<string, unknown>;
  timestamp: string;
}

export interface LedgerStats {
  buffered: number;       // unflushed rows in SQLite
  flushed: number;        // cumulative flushed
  dropped: number;        // always 0 — durable storage, nothing is dropped
  flushErrors: number;
  lastFlushAt: string | null;
  flushIntervalMs: number;
  dlqPath: string;        // n/a in Worker — kept for status-shape compatibility
  dlqEntries: number;     // always 0
}

const FLUSH_INTERVAL_MS = 10_000;
const BATCH_SIZE = 100;
const COALESCE_WINDOW_MS = 2000;

export class LedgerClient {
  private sql: SqlStorage;
  private totalFlushed = 0;
  private flushErrors = 0;
  private lastFlushAt: Date | null = null;

  constructor(sql: SqlStorage) {
    this.sql = sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        entity_id TEXT,
        session_id TEXT NOT NULL,
        metadata TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        flushed INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  /** Append an entry. tool_call events coalesce into a tool_call_batch within a 2s window. */
  record(sessionId: string, eventType: string, metadata: Record<string, unknown>, entityId?: string): void {
    if (eventType === 'tool_call') {
      const last = this.lastUnflushed();
      if (last && last.session_id === sessionId &&
          Date.now() - new Date(last.timestamp).getTime() < COALESCE_WINDOW_MS) {
        const tool = metadata.tool as string | undefined;
        if (last.event_type === 'tool_call_batch') {
          const meta = JSON.parse(last.metadata) as { tools: string[]; count: number };
          if (tool && !meta.tools.includes(tool)) {
            meta.tools.push(tool);
            meta.count = meta.tools.length;
          }
          this.updateRow(last.id, 'tool_call_batch', meta);
          return;
        }
        if (last.event_type === 'tool_call') {
          const prevTool = (JSON.parse(last.metadata) as { tool?: string }).tool;
          const meta = {
            tools: [prevTool, tool].filter(Boolean),
            count: 2,
            session_id: sessionId,
            entity_id: entityId,
          };
          this.updateRow(last.id, 'tool_call_batch', meta);
          return;
        }
      }
    }

    this.sql.exec(
      `INSERT INTO ledger (event_type, entity_id, session_id, metadata, timestamp, flushed) VALUES (?, ?, ?, ?, ?, 0)`,
      eventType,
      entityId ?? null,
      sessionId,
      JSON.stringify(metadata),
      new Date().toISOString(),
    );
  }

  private lastUnflushed(): { id: number; event_type: string; session_id: string; metadata: string; timestamp: string } | null {
    const rows = this.sql
      .exec<{ id: number; event_type: string; session_id: string; metadata: string; timestamp: string }>(
        `SELECT id, event_type, session_id, metadata, timestamp FROM ledger WHERE flushed = 0 ORDER BY id DESC LIMIT 1`,
      )
      .toArray();
    return rows[0] ?? null;
  }

  private updateRow(id: number, eventType: string, metadata: Record<string, unknown>): void {
    this.sql.exec(
      `UPDATE ledger SET event_type = ?, metadata = ?, timestamp = ? WHERE id = ?`,
      eventType,
      JSON.stringify(metadata),
      new Date().toISOString(),
      id,
    );
  }

  /**
   * Flush unflushed rows to the chittytrack tail consumer. Emits each row as a
   * structured console event; Workers observability forwards it to the
   * `chittytrack` tail_consumer (configured in wrangler.jsonc). Returns flushed count.
   */
  async flush(): Promise<number> {
    const rows = this.sql
      .exec<{ id: number; event_type: string; entity_id: string | null; session_id: string; metadata: string; timestamp: string }>(
        `SELECT id, event_type, entity_id, session_id, metadata, timestamp FROM ledger WHERE flushed = 0 ORDER BY id ASC LIMIT ?`,
        BATCH_SIZE,
      )
      .toArray();
    if (rows.length === 0) return 0;

    try {
      for (const row of rows) {
        // Structured event — chittytrack tail consumer ingests this from the
        // observability stream (the real Alchemist ingest path).
        console.log(JSON.stringify({
          ch1tty_ledger: true,
          event_type: row.event_type,
          entity_id: row.entity_id ?? undefined,
          session_id: row.session_id,
          metadata: JSON.parse(row.metadata),
          timestamp: row.timestamp,
        }));
      }
      const ids = rows.map((r) => r.id);
      const placeholders = ids.map(() => '?').join(',');
      this.sql.exec(`UPDATE ledger SET flushed = 1 WHERE id IN (${placeholders})`, ...ids);
      // Prune flushed history to bound storage (keep recent 500 for audit).
      this.sql.exec(`DELETE FROM ledger WHERE flushed = 1 AND id NOT IN (SELECT id FROM ledger WHERE flushed = 1 ORDER BY id DESC LIMIT 500)`);
      this.totalFlushed += rows.length;
      this.lastFlushAt = new Date();
      return rows.length;
    } catch {
      this.flushErrors++;
      return 0;
    }
  }

  /** Force-flush everything (used on shutdown-equivalent paths). */
  async flushAll(): Promise<number> {
    let total = 0;
    for (;;) {
      const n = await this.flush();
      if (n === 0) break;
      total += n;
    }
    return total;
  }

  getStats(): LedgerStats {
    const buffered = this.sql.exec<{ c: number }>(`SELECT COUNT(*) AS c FROM ledger WHERE flushed = 0`).toArray()[0]?.c ?? 0;
    return {
      buffered,
      flushed: this.totalFlushed,
      dropped: 0,
      flushErrors: this.flushErrors,
      lastFlushAt: this.lastFlushAt?.toISOString() ?? null,
      flushIntervalMs: FLUSH_INTERVAL_MS,
      dlqPath: 'sqlite://ledger',
      dlqEntries: 0,
    };
  }
}

export const LEDGER_FLUSH_INTERVAL_MS = FLUSH_INTERVAL_MS;
