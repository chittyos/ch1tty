import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Returns true if the request carries a valid Bearer token matching `expectedToken`.
 * Scheme matching is case-insensitive ("Bearer", "bearer", "BEARER" all accepted).
 * Comparison is timing-safe (CWE-208).
 */
export function checkBearerToken(req: IncomingMessage, expectedToken: string): boolean {
  const auth = req.headers.authorization;
  if (!auth) return false;
  const match = /^Bearer +(\S+)$/i.exec(auth);
  if (!match) return false;
  const provided = match[1];
  if (provided.length !== expectedToken.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expectedToken));
}

/** Write a 401 Unauthorized JSON response. */
export function writeUnauthorized(res: ServerResponse): void {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('WWW-Authenticate', 'Bearer');
  res.writeHead(401);
  res.end(JSON.stringify({ error: 'unauthorized' }));
}
