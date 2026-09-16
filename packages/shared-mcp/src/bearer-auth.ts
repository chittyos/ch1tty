import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Returns true if the request carries a valid Bearer token matching `expectedToken`.
 * Scheme matching is case-insensitive ("Bearer", "bearer", "BEARER" all accepted).
 */
export function checkBearerToken(req: IncomingMessage, expectedToken: string): boolean {
  const auth = req.headers.authorization;
  if (!auth) return false;
  const match = /^Bearer +(\S+)$/i.exec(auth);
  return match?.[1] === expectedToken;
}

/** Write a 401 Unauthorized JSON response. */
export function writeUnauthorized(res: ServerResponse): void {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('WWW-Authenticate', 'Bearer');
  res.writeHead(401);
  res.end(JSON.stringify({ error: 'unauthorized' }));
}
