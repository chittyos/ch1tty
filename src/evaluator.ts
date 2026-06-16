// Evaluator — per-call route telemetry. New in the DO port (the stdio gateway
// had no equivalent; route metadata only landed in cast_route ledger entries).
// Records {ts, route, latency_ms, ok, server, capability} to DO SQLite per call;
// alarm() flushes the batch to the chittytrack tail consumer (Alchemist path),
// the same sink the ledger uses.
export interface EvalRecord {
  ts: number;
  route: string;       // e.g. "search" | "execute" | "cast" | "code" | "provision"
  latency_ms: number;
  ok: boolean;
  server?: string;     // upstream serverId, when the call targeted one
  capability?: string; // tool/method name
}

const BATCH_SIZE = 200;

export class Evaluator {
  private sql: SqlStorage;
  private totalFlushed = 0;

  constructor(sql: SqlStorage) {
    this.sql = sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS evaluator (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        route TEXT NOT NULL,
        latency_ms INTEGER NOT NULL,
        ok INTEGER NOT NULL,
        server TEXT,
        capability TEXT,
        flushed INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  record(r: EvalRecord): void {
    this.sql.exec(
      `INSERT INTO evaluator (ts, route, latency_ms, ok, server, capability, flushed) VALUES (?, ?, ?, ?, ?, ?, 0)`,
      r.ts,
      r.route,
      Math.round(r.latency_ms),
      r.ok ? 1 : 0,
      r.server ?? null,
      r.capability ?? null,
    );
  }

  /** Helper: time an async call and record the eval. Returns the call's result. */
  async measure<T>(route: string, fn: () => Promise<T>, meta?: { server?: string; capability?: string }, isOk?: (v: T) => boolean): Promise<T> {
    const started = Date.now();
    let ok = false;
    try {
      const v = await fn();
      ok = isOk ? isOk(v) : true;
      return v;
    } finally {
      this.record({ ts: started, route, latency_ms: Date.now() - started, ok, server: meta?.server, capability: meta?.capability });
    }
  }

  /** Flush eval rows to the chittytrack tail consumer. Returns flushed count. */
  async flush(): Promise<number> {
    const rows = this.sql
      .exec<{ id: number; ts: number; route: string; latency_ms: number; ok: number; server: string | null; capability: string | null }>(
        `SELECT id, ts, route, latency_ms, ok, server, capability FROM evaluator WHERE flushed = 0 ORDER BY id ASC LIMIT ?`,
        BATCH_SIZE,
      )
      .toArray();
    if (rows.length === 0) return 0;

    for (const row of rows) {
      console.log(JSON.stringify({
        ch1tty_eval: true,
        ts: row.ts,
        route: row.route,
        latency_ms: row.latency_ms,
        ok: row.ok === 1,
        server: row.server ?? undefined,
        capability: row.capability ?? undefined,
      }));
    }
    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(',');
    this.sql.exec(`UPDATE evaluator SET flushed = 1 WHERE id IN (${placeholders})`, ...ids);
    this.sql.exec(`DELETE FROM evaluator WHERE flushed = 1 AND id NOT IN (SELECT id FROM evaluator WHERE flushed = 1 ORDER BY id DESC LIMIT 500)`);
    this.totalFlushed += rows.length;
    return rows.length;
  }

  getStats(): { buffered: number; flushed: number } {
    const buffered = this.sql.exec<{ c: number }>(`SELECT COUNT(*) AS c FROM evaluator WHERE flushed = 0`).toArray()[0]?.c ?? 0;
    return { buffered, flushed: this.totalFlushed };
  }
}
