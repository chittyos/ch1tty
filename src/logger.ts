// Worker-safe logger. The stdio gateway wrote to process.stderr (kept stdout
// clean for the MCP framing); in a Worker there is no process.stderr, and
// console.* is captured by Workers observability (chittytrack tail consumer).
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export class Logger {
  private minLevel: number;

  constructor() {
    // No env at module-init in a Worker; default to info. DO can raise verbosity
    // by setting CH1TTY_LOG_LEVEL via setLevel() once env is available.
    this.minLevel = LEVEL_ORDER.info;
  }

  setLevel(level?: string): void {
    if (!level) return;
    const lvl = level.toLowerCase() as LogLevel;
    if (lvl in LEVEL_ORDER) this.minLevel = LEVEL_ORDER[lvl];
  }

  private write(level: LogLevel, msg: string, server?: string, extra?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < this.minLevel) return;
    const entry = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...(server ? { server } : {}),
      ...extra,
    };
    const line = JSON.stringify(entry);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }

  debug(msg: string, server?: string, extra?: Record<string, unknown>): void { this.write('debug', msg, server, extra); }
  info(msg: string, server?: string, extra?: Record<string, unknown>): void { this.write('info', msg, server, extra); }
  warn(msg: string, server?: string, extra?: Record<string, unknown>): void { this.write('warn', msg, server, extra); }
  error(msg: string, server?: string, extra?: Record<string, unknown>): void { this.write('error', msg, server, extra); }
}

export const log = new Logger();
