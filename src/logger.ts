export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
  server?: string;
  [key: string]: unknown;
}

export class Logger {
  private minLevel: number;
  private json: boolean;

  constructor() {
    const envLevel = (process.env.CH1TTY_LOG_LEVEL ?? 'info').toLowerCase() as LogLevel;
    this.minLevel = LEVEL_ORDER[envLevel] ?? LEVEL_ORDER.info;
    this.json = process.env.CH1TTY_LOG_FORMAT === 'json';
  }

  private write(level: LogLevel, msg: string, server?: string, extra?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < this.minLevel) return;

    if (this.json) {
      const entry: LogEntry = {
        ts: new Date().toISOString(),
        level,
        msg,
        ...(server ? { server } : {}),
        ...extra,
      };
      process.stderr.write(JSON.stringify(entry) + '\n');
    } else {
      const prefix = server ? `[ch1tty:${server}]` : '[ch1tty]';
      process.stderr.write(`${prefix} ${msg}\n`);
    }
  }

  debug(msg: string, server?: string, extra?: Record<string, unknown>): void {
    this.write('debug', msg, server, extra);
  }

  info(msg: string, server?: string, extra?: Record<string, unknown>): void {
    this.write('info', msg, server, extra);
  }

  warn(msg: string, server?: string, extra?: Record<string, unknown>): void {
    this.write('warn', msg, server, extra);
  }

  error(msg: string, server?: string, extra?: Record<string, unknown>): void {
    this.write('error', msg, server, extra);
  }

  /** Pipe child stderr lines with server prefix */
  childStderr(serverId: string, chunk: Buffer): void {
    if (this.json) {
      this.write('debug', chunk.toString().trimEnd(), serverId);
    } else {
      process.stderr.write(`[ch1tty:${serverId}] ${chunk.toString()}`);
    }
  }
}

export const log = new Logger();
