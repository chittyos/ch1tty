import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Returns true if the request carries a valid Bearer token matching `expectedToken`.
 * Scheme matching is case-insensitive ("Bearer", "bearer", "BEARER" all accepted).
 */
export function checkBearerToken(req: IncomingMessage, expectedToken: string): boolean {
  const auth = req.headers.authorization;
  if (!auth) return false;
  const [scheme, token] = auth.split(' ', 2);
  return scheme?.toLowerCase() === 'bearer' && token === expectedToken;
}

/** Write a 401 Unauthorized JSON response. */
export function writeUnauthorized(res: ServerResponse): void {
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(401);
  res.end(JSON.stringify({ error: 'unauthorized' }));
}
