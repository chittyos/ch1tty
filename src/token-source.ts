// Worker-side TokenSource for RemoteProxy upstream auth. Replaces the stdio
// gateway's execFile('chitty-mcp-token', [key]) — a Worker cannot spawn
// processes. Resolution order, all real paths (no placeholders):
//
//   1. env.CHITTY_MCP_TOKEN_<KEY>  — Cloudflare secret binding (zero latency)
//   2. DO SQLite cache             — previously brokered token within TTL
//   3. ChittyConnect broker        — GET {CHITTYCONNECT_URL}/v1/credentials/
//                                    services/<key>/service_token, mirroring
//                                    chittyconnect/src/lib/credential-helper.js
//                                    (getServiceToken → broker.get path shape)
//
// Per the sensitive-intent contract, if neither a bound secret nor the broker
// can produce a token we FAIL CLOSED with POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE
// rather than silently connecting unauthenticated.
import type { TokenSource } from './remote-proxy.js';
import type { Env } from './types.js';
import { log } from './logger.js';

/** Brokered tokens are cached in DO SQLite for 30 minutes (matches the
 * ChittyServ broker's `services/*` cache TTL of 1800s). */
const BROKER_CACHE_TTL_MS = 30 * 60 * 1000;

const DEFAULT_BROKER_URL = 'https://connect.chitty.cc';

function envVarNameFor(key: string): string {
  return `CHITTY_MCP_TOKEN_${key.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

export class WorkerTokenSource implements TokenSource {
  constructor(private env: Env, private sql: SqlStorage) {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS token_cache (
        key TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
  }

  async getToken(key: string): Promise<string> {
    // 1. Bound secret: env.CHITTY_MCP_TOKEN_<KEY>.
    const bound = this.env[envVarNameFor(key)];
    if (typeof bound === 'string' && bound.length > 0) return bound;

    // 2. SQLite cache (brokered tokens only — bound secrets are never cached).
    const now = Date.now();
    const row = this.sql
      .exec<{ token: string }>(`SELECT token FROM token_cache WHERE key = ? AND expires_at > ?`, key, now)
      .toArray()[0];
    if (row?.token) return row.token;

    // 3. ChittyConnect broker (fail closed on any failure).
    const token = await this.fetchFromBroker(key);
    this.sql.exec(
      `INSERT INTO token_cache (key, token, expires_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at`,
      key, token, now + BROKER_CACHE_TTL_MS,
    );
    return token;
  }

  private async fetchFromBroker(key: string): Promise<string> {
    const base = typeof this.env.CHITTYCONNECT_URL === 'string' && this.env.CHITTYCONNECT_URL
      ? this.env.CHITTYCONNECT_URL.replace(/\/$/, '')
      : DEFAULT_BROKER_URL;
    const url = `${base}/v1/credentials/services/${encodeURIComponent(key)}/service_token`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Request-ID': crypto.randomUUID(),
      'X-Source-Service': 'ch1tty',
      'X-Canonical-URI': 'chittycanon://core/services/ch1tty',
    };
    const serviceToken = this.env.CHITTYCONNECT_SERVICE_TOKEN;
    if (typeof serviceToken === 'string' && serviceToken) {
      headers['Authorization'] = `Bearer ${serviceToken}`;
    }

    let res: Response;
    try {
      res = await fetch(url, { method: 'GET', headers });
    } catch (err) {
      log.error(`ChittyConnect broker unreachable for key '${key}': ${String(err)}`);
      throw new Error(`POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE: broker fetch failed for '${key}'`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      log.error(`ChittyConnect broker HTTP ${res.status} for key '${key}'${body ? `: ${body.slice(0, 200)}` : ''}`);
      throw new Error(`POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE: broker returned ${res.status} for '${key}'`);
    }

    // Broker returns { success: true, value: "..." } or { value: "..." } —
    // same contract the ChittyServ client in chittyconnect parses ({ credential }
    // as legacy alias).
    let data: { value?: unknown; credential?: unknown };
    try {
      data = await res.json() as { value?: unknown; credential?: unknown };
    } catch {
      throw new Error(`POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE: broker returned non-JSON body for '${key}'`);
    }
    const value = data.value ?? data.credential;
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE: broker returned no value for '${key}'`);
    }
    return value;
  }
}
