/**
 * Timing-safe bearer token check for the Worker endpoints.
 * Extracted from index.ts so it can be unit-tested without pulling in
 * Cloudflare runtime dependencies (McpAgent, OAuthProvider, Ch1ttyDO, etc.).
 */

/**
 * Returns true when the request carries a valid bearer token matching
 * `expectedToken`. If `expectedToken` is absent or empty, every request is
 * allowed (open endpoint; the caller is responsible for warning on startup).
 *
 * Uses a constant-time comparison loop to prevent timing-based secret
 * extraction: the loop always iterates `max(actual.length, expected.length)`
 * times regardless of where values first differ.
 */
export function checkBearerAuth(req: Request, expectedToken?: string): boolean {
  if (!expectedToken) return true;
  const auth = req.headers.get('authorization');
  if (!auth) return false;
  const [scheme, value] = auth.split(' ', 2);
  const enc = new TextEncoder();
  const ab = enc.encode(value ?? '');
  const bb = enc.encode(expectedToken);
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return scheme?.toLowerCase() === 'bearer' && diff === 0;
}
