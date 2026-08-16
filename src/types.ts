export * from '../src-stdio/types.js';

/**
 * Worker environment for the ch1tty gateway. Binding types (AI, VECTORIZE,
 * LOADER, ASSETS, CH1TTY, MCP_OBJECT) mirror wrangler.jsonc / the generated
 * worker-configuration.d.ts. The index signature covers dynamic secret lookups
 * (CHITTY_MCP_TOKEN_<KEY>, envHeaders vars) resolved by WorkerTokenSource and
 * RemoteProxy.
 */
export interface Env extends Cloudflare.Env {
  /** Inbound bearer for /mcp and /mcp2 (secret). Absent → open, warned at deploy. */
  CH1TTY_MCP_TOKEN?: string;
  CH1TTY_LOG_LEVEL?: string;
  /** ChittyConnect credential broker base URL (default https://connect.chitty.cc). */
  CHITTYCONNECT_URL?: string;
  /** Service token for authenticating to the ChittyConnect broker (secret). */
  CHITTYCONNECT_SERVICE_TOKEN?: string;
  /** KV namespace for OAuth 2.1 token storage (workers-oauth-provider). Bound as OAUTH_KV. */
  OAUTH_KV?: KVNamespace;
  [key: string]: unknown;
}
