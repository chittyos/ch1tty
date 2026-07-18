/**
 * Ledger client — buffered, batched writes to ChittyLedger.
 *
 * Replaces the coordinator's fire-and-forget callEcosystem('chitty_ledger_record')
 * with a resilient write-ahead buffer that:
 *  - Queues entries when the ecosystem backend is unavailable
 *  - Batches rapid events (tool_call) into coalesced writes
 *  - Flushes the buffer on a timer and on session end
 *  - Drops oldest entries when the buffer is full (bounded memory)
 *
 * @canon chittycanon://gov/governance#ledger-is-append-only
 */

import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { log } from './logger.js';
import type { Backend, ToolCallResult } from './types.js';

const DEAD_LETTER_PATH = process.env.CH1TTY_LEDGER_DLQ ?? join(homedir(), '.ch1tty', 'ledger.dlq.jsonl');

/**
 * Pluggable dead-letter store (mirrors the RemoteProxy TokenSource pattern).
 * The stdio gateway uses FileDlqStore (node:fs); the Worker/DO runtime injects
 * a DO-SQLite-backed store — a Worker has no persistent filesystem, so the
 * node:fs DLQ silently throws or lands on ephemeral storage while getStats()
 * reports the entries as durably saved. append/rewrite MUST persist durably;
 * count() must reflect only what is actually recoverable.
 */
export interface DlqStore {
  /** Append entries to the DLQ (stamps droppedAt). Best-effort, must not throw. */
  append(entries: LedgerEntry[]): void;
  /** Read up to `limit` most-recent entries (chronological). */
  readEntries(limit: number): object[];
  /** Replace the DLQ contents with the given entries (empty => clear). */
  rewrite(entries: object[]): void;
  /** Count of durably-stored DLQ entries. */
  count(): number;
  /** Human-readable location, surfaced in getStats().dlqPath. */
  describe(): string;
}

/** Default stdio store: a JSONL WAL under ~/.ch1tty (or $CH1TTY_LEDGER_DLQ). */
export class FileDlqStore implements DlqStore {
  constructor(private readonly dlqPath: string) {}

  describe(): string { return this.dlqPath; }

  append(entries: LedgerEntry[]): void {
    /* c8 ignore next -- all callers guard with length > 0; defensive only */
    if (entries.length === 0) return;
    try {
      mkdirSync(dirname(this.dlqPath), { recursive: true });
      const lines = entries.map((e) => JSON.stringify({ ...e, droppedAt: new Date().toISOString() })).join('\n') + '\n';
      appendFileSync(this.dlqPath, lines, 'utf8');
    } catch (err) {
      log.error(`Ledger DLQ write failed (${this.dlqPath}): ${err}`);
    }
  }

  readEntries(limit = 50): object[] {
    try {
      const text = readFileSync(this.dlqPath, 'utf8');
      const lines = text.split('\n').filter((l) => l.trim().length > 0);
      const parsed: object[] = [];
      for (const l of lines) {
        try {
          const v = JSON.parse(l) as unknown;
          if (v !== null && typeof v === 'object' && !Array.isArray(v)) parsed.push(v as object);
        } catch { /* skip malformed */ }
      }
      return parsed.slice(-limit);
    } catch {
      return [];
    }
  }

  rewrite(entries: object[]): void {
    try {
      if (entries.length === 0) {
        try { unlinkSync(this.dlqPath); } catch { /* file may not exist or already gone */ }
        return;
      }
      const targetDir = dirname(this.dlqPath);
      mkdirSync(targetDir, { recursive: true });
      const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
      // Stage in a unique temp dir on the same filesystem, then atomic rename.
      const tmpDir = mkdtempSync(join(targetDir, '.dlq-tmp-'));
      const tmpPath = join(tmpDir, 'dlq.jsonl');
      try {
        writeFileSync(tmpPath, lines, { encoding: 'utf8', mode: 0o600 });
        renameSync(tmpPath, this.dlqPath);
      } finally {
        try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* cleanup best-effort */ }
      }
    } catch (err) { /* c8 ignore next 2 -- requires OS-level fault (ENOSPC/EROFS), untestable in sandbox */
      log.error(`Ledger DLQ rewrite failed (${this.dlqPath}): ${err}`);
    }
  }

  count(): number {
    try {
      const text = readFileSync(this.dlqPath, 'utf8');
      return text.split('\n').filter((l) => l.trim().length > 0).length;
    } catch {
      return 0;
    }
  }
}

// ── Types ─────────────────────────────────────────────────────

export interface LedgerEntry {
  event_type: string;
  entity_id?: string;
  session_id: string;
  metadata: Record<string, unknown>;
  timestamp: string;
  retries: number;
}

export interface LedgerStats {
  buffered: number;
  flushed: number;
  dropped: number;
  flushErrors: number;
  lastFlushAt: string | null;
  flushIntervalMs: number;
  dlqPath: string;
  dlqEntries: number;
}

// ── Config ────────────────────────────────────────────────────

const MAX_BUFFER_SIZE = 500;
const FLUSH_INTERVAL_MS = 10_000; // 10 seconds
/** Exported for the DO alarm scheduler (Worker runtime has no setInterval-driven flush). */
export const LEDGER_FLUSH_INTERVAL_MS = FLUSH_INTERVAL_MS;
const BATCH_SIZE = 25; // entries per flush batch
const MAX_RETRIES = 3;

// ── Client ────────────────────────────────────────────────────

export class LedgerClient {
  private buffer: LedgerEntry[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;
  private backend?: Backend;
  private serverId?: string;
  private readonly dlq: DlqStore;
  readonly dlqPath: string;

  // Stats
  private totalFlushed = 0;
  private totalDropped = 0;
  private flushErrors = 0;
  private lastFlushAt: Date | null = null;
  private replaying = false;

  /**
   * @param dlqPathOrStore  A filesystem path (stdio default → FileDlqStore) or
   *   an explicit DlqStore (Worker/DO passes a SQLite-backed store). Undefined
   *   uses the default ~/.ch1tty WAL path.
   */
  constructor(dlqPathOrStore?: string | DlqStore) {
    if (dlqPathOrStore && typeof dlqPathOrStore !== 'string') {
      this.dlq = dlqPathOrStore;
    } else {
      this.dlq = new FileDlqStore(dlqPathOrStore ?? DEAD_LETTER_PATH);
    }
    this.dlqPath = this.dlq.describe();
  }

  /** Bind to the ecosystem backend for ledger writes. */
  bind(backend: Backend, serverId: string): void {
    this.backend = backend;
    this.serverId = serverId;
    log.info(`Ledger client bound to backend: ${serverId}`);

    // Start periodic flush
    if (!this.flushTimer) {
      this.flushTimer = setInterval(() => {
        this.flush()
          .then(async () => {
            // After each flush, replay any DLQ entries if the backend is now reachable.
            if (this.backend && this.serverId && this.dlqEntries() > 0) {
              await this.replayDlq();
            }
          })
          .catch((err) => {
            log.warn(`Periodic flush error: ${err}`);
          });
      }, FLUSH_INTERVAL_MS);
      // Don't keep the process alive just for background flushes (important for tests/CLI one-shots).
      // workerd timers return numbers (no unref); guard for Worker/DO runtime.
      this.flushTimer.unref?.();
    }
  }

  /** Unbind — stops the flush timer. Buffer is preserved for rebind. */
  unbind(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.backend = undefined;
    this.serverId = undefined;
  }

  /** Append an entry to the write-ahead buffer. */
  record(
    sessionId: string,
    eventType: string,
    metadata: Record<string, unknown>,
    entityId?: string,
  ): void {
    // Coalesce rapid tool_call events for the same session
    if (eventType === 'tool_call' && this.buffer.length > 0) {
      const last = this.buffer[this.buffer.length - 1];
      if (
        last.event_type === 'tool_call_batch' &&
        last.session_id === sessionId &&
        Date.now() - new Date(last.timestamp).getTime() < 2000
      ) {
        // Append to existing batch
        const tools = last.metadata.tools as string[];
        const tool = metadata.tool as string;
        if (tool && !tools.includes(tool)) {
          tools.push(tool);
          last.metadata.count = tools.length;
          last.timestamp = new Date().toISOString();
        }
        return;
      }

      // Start a new batch if the previous entry was also a tool_call for same session
      if (
        last.event_type === 'tool_call' &&
        last.session_id === sessionId &&
        Date.now() - new Date(last.timestamp).getTime() < 2000
      ) {
        // Upgrade previous entry to a batch
        last.event_type = 'tool_call_batch';
        const prevTool = last.metadata.tool as string;
        const newTool = metadata.tool as string;
        last.metadata = {
          tools: [prevTool, newTool].filter(Boolean),
          count: 2,
          session_id: sessionId,
          entity_id: entityId,
        };
        last.timestamp = new Date().toISOString();
        return;
      }
    }

    // Enforce buffer limit — drop oldest
    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      const dropped = this.buffer.splice(0, Math.floor(MAX_BUFFER_SIZE * 0.1));
      this.totalDropped += dropped.length;
      log.warn(`Ledger buffer full — dropped ${dropped.length} oldest entries`);
    }

    this.buffer.push({
      event_type: eventType,
      entity_id: entityId,
      session_id: sessionId,
      metadata,
      timestamp: new Date().toISOString(),
      retries: 0,
    });
  }

  /** Flush buffered entries to the ledger backend. */
  async flush(): Promise<number> {
    if (this.flushing || this.buffer.length === 0 || !this.backend || !this.serverId) {
      return 0;
    }

    this.flushing = true;
    let flushedCount = 0;

    try {
      // Take a batch from the front of the buffer
      const batch = this.buffer.splice(0, BATCH_SIZE);
      const failed: LedgerEntry[] = [];

      for (const entry of batch) {
        try {
          const result = await this.backend!.callTool(this.serverId!, 'chitty_ledger_record', {
            event_type: entry.event_type,
            entity_id: entry.entity_id,
            session_id: entry.session_id,
            metadata: entry.metadata,
            timestamp: entry.timestamp,
          });
          // RemoteProxy returns isError:true without throwing for circuit-open / unknown server.
          if (result.isError) throw new Error(`ledger write rejected: ${JSON.stringify(result.content)}`);
          flushedCount++;
        } catch (err) {
          entry.retries++;
          if (entry.retries < MAX_RETRIES) {
            failed.push(entry);
          } else {
            this.totalDropped++;
            // Canon: chittycanon://gov/governance#ledger-is-append-only — elevate to error + WAL.
            log.error(`Ledger entry dropped after ${MAX_RETRIES} retries: ${entry.event_type} (session ${entry.session_id}) — written to DLQ`);
            this.dlq.append([entry]);
          }
        }
      }

      // Put failed entries back at the front
      if (failed.length > 0) {
        this.buffer.unshift(...failed);
        this.flushErrors++;
      }

      this.totalFlushed += flushedCount;
      if (flushedCount > 0) {
        this.lastFlushAt = new Date();
        log.debug(`Ledger flushed ${flushedCount} entries (${this.buffer.length} remaining)`);
      }
    } finally {
      this.flushing = false;
    }

    return flushedCount;
  }

  /** Force-flush all entries (used on session end / shutdown). */
  async flushAll(): Promise<number> {
    let total = 0;
    while (this.buffer.length > 0 && this.backend) {
      const count = await this.flush();
      if (count === 0) break; // avoid infinite loop if backend is down
      total += count;
    }
    return total;
  }

  /**
   * Attempt to replay entries from the dead-letter WAL against the bound backend.
   * Entries that succeed are removed from the DLQ file; entries that fail remain.
   * Returns the number of entries successfully replayed.
   * No-op when no backend is bound or the DLQ is empty.
   */
  async replayDlq(): Promise<number> {
    if (this.replaying || !this.backend || !this.serverId) return 0;

    type DlqEntry = LedgerEntry & { droppedAt?: string };
    const entries = this.dlqReadEntries(1000) as DlqEntry[];
    if (entries.length === 0) return 0;

    this.replaying = true;
    const failed: DlqEntry[] = [];
    let replayed = 0;

    try {
      for (const entry of entries) {
        try {
          const result = await this.backend.callTool(this.serverId, 'chitty_ledger_record', {
            event_type: entry.event_type,
            entity_id: entry.entity_id,
            session_id: entry.session_id,
            metadata: entry.metadata,
            timestamp: entry.timestamp,
          });
          if (result.isError) throw new Error(`ledger replay rejected: ${JSON.stringify(result.content)}`);
          replayed++;
        } catch {
          failed.push(entry);
        }
      }

      this.rewriteDlq(failed);

      if (replayed > 0) {
        log.info(`Ledger DLQ replay: ${replayed} entries replayed (${failed.length} remaining in DLQ)`);
      }
    } finally {
      this.replaying = false;
    }

    return replayed;
  }

  /** Rewrite the DLQ with the given entries (delegates to the store). */
  private rewriteDlq(entries: object[]): void {
    this.dlq.rewrite(entries);
  }

  /** Read up to `limit` most-recent DLQ entries (delegates to the store). */
  dlqReadEntries(limit = 50): object[] {
    return this.dlq.readEntries(limit);
  }

  /** Count of durably-stored DLQ entries (delegates to the store). */
  dlqEntries(): number {
    return this.dlq.count();
  }

  getStats(): LedgerStats {
    return {
      buffered: this.buffer.length,
      flushed: this.totalFlushed,
      dropped: this.totalDropped,
      flushErrors: this.flushErrors,
      lastFlushAt: this.lastFlushAt?.toISOString() ?? null,
      flushIntervalMs: FLUSH_INTERVAL_MS,
      dlqPath: this.dlqPath,
      dlqEntries: this.dlqEntries(),
    };
  }

  /** Shutdown — flush what we can, then stop. */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.backend) {
      const flushed = await this.flushAll();
      if (flushed > 0) {
        log.info(`Ledger shutdown: flushed ${flushed} entries`);
      }
      if (this.buffer.length > 0) {
        // Append-only integrity — write remaining entries to DLQ instead of losing them.
        const lost = this.buffer.length;
        this.dlq.append(this.buffer);
        this.totalDropped += lost;
        this.buffer = [];
        log.error(`Ledger shutdown: ${lost} unflushed entries written to DLQ (${this.dlqPath})`);
      }
    } else if (this.buffer.length > 0) {
      // Never bound — still flush to DLQ so entries aren't lost on shutdown.
      const lost = this.buffer.length;
      this.dlq.append(this.buffer);
      this.totalDropped += lost;
      this.buffer = [];
      log.error(`Ledger shutdown: ${lost} entries never flushed (no backend bound) — written to DLQ`);
    }
  }
}
