// Phase 4: legacy /mcp JSON-RPC DO decommission handler.
// The /mcp path is permanently retired in favour of /mcp2 (McpAgent, OAuth 2.1).
// Returns 410 Gone for all requests so that clients get a clear, actionable error
// instead of a silent hang or a confusing 404.
//
// Ch1ttyDO is kept exported (wrangler.jsonc CH1TTY binding retained) so that
// Cloudflare's migration chain remains intact. The DO class must stay until all
// in-flight DO instances have been drained via a subsequent wrangler migration.

const BODY = JSON.stringify({
  error: 'ENDPOINT_DECOMMISSIONED',
  message:
    'The /mcp JSON-RPC endpoint has been retired. Connect to /mcp2 (OAuth 2.1) for full MCP access, or /mcp-api for typed search+execute over the tool registry.',
  migration: {
    canonical: '/mcp2',
    alternates: ['/mcp-api'],
    docs: 'https://ch1tty.chitty.cc/docs/migration',
  },
});

/**
 * Returns a 410 Gone response for any request to the retired /mcp path.
 * Does not inspect the request — every method/path variant gets the same
 * response so clients cannot accidentally continue using a subset of the API.
 */
export function handleMcpDeprecated(_req: Request): Response {
  return new Response(BODY, {
    status: 410,
    headers: {
      'content-type': 'application/json',
      'sunset': 'Sat, 16 Aug 2026 00:00:00 GMT',
      'link': '</mcp2>; rel="successor-version"',
    },
  });
}
