// SqliteDlqStore — DO-SQLite-backed dead-letter store for LedgerClient in the
// Worker/DO runtime. The stdio FileDlqStore writes a JSONL WAL under ~/.ch1tty
// via node:fs; inside a Worker that path either throws or lands on ephemeral
// storage, so failed ledger entries would be silently lost while getStats()
// reported them durably saved. This store persists them in the DO's SQLite
// (durable, per-session) so count() never lies.
import type { DlqStore, LedgerEntry } from './ledger.js';
import { log } from './logger.js';

export class SqliteDlqStore implements DlqStore {
  constructor(private sql: SqlStorage) {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS ledger_dlq (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dropped_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
    `);
  }

  describe(): string {
    return 'do-sqlite:ledger_dlq';
  }

  append(entries: LedgerEntry[]): void {
    if (entries.length === 0) return;
    const droppedAt = new Date().toISOString();
    try {
      for (const e of entries) {
        this.sql.exec(
          `INSERT INTO ledger_dlq (dropped_at, payload) VALUES (?, ?)`,
          droppedAt,
          JSON.stringify({ ...e, droppedAt }),
        );
      }
    } catch (err) {
      // Best-effort, contract says must not throw — but a SQLite failure here is
      // real data loss, so surface it loudly.
      log.error(`Ledger DLQ (sqlite) append failed: ${String(err)}`);
    }
  }

  readEntries(limit = 50): object[] {
    try {
      const rows = this.sql
        .exec<{ payload: string }>(`SELECT payload FROM ledger_dlq ORDER BY id ASC LIMIT ?`, limit)
        .toArray();
      const out: object[] = [];
      for (const r of rows) {
        try {
          const v = JSON.parse(r.payload) as unknown;
          if (v !== null && typeof v === 'object' && !Array.isArray(v)) out.push(v as object);
        } catch { /* skip malformed */ }
      }
      return out;
    } catch (err) {
      log.error(`Ledger DLQ (sqlite) read failed: ${String(err)}`);
      return [];
    }
  }

  rewrite(entries: object[]): void {
    // Replay path hands back the entries that still failed; replace the table
    // contents with exactly those (empty => clear). Runs in an implicit DO
    // transaction (single-threaded storage), so no partial state is observable.
    try {
      this.sql.exec(`DELETE FROM ledger_dlq`);
      const droppedAt = new Date().toISOString();
      for (const e of entries) {
        const payload = JSON.stringify(e);
        this.sql.exec(`INSERT INTO ledger_dlq (dropped_at, payload) VALUES (?, ?)`, droppedAt, payload);
      }
    } catch (err) {
      log.error(`Ledger DLQ (sqlite) rewrite failed: ${String(err)}`);
    }
  }

  count(): number {
    try {
      return this.sql.exec<{ c: number }>(`SELECT COUNT(*) AS c FROM ledger_dlq`).toArray()[0]?.c ?? 0;
    } catch {
      return 0;
    }
  }
}
