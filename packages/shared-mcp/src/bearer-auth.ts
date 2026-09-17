import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

function hashToken(s: string): Buffer {
  return createHash('sha256').update(s, 'utf8').digest();
}

/**
 * Returns true if the request carries a valid Bearer token matching `expectedToken`.
 * Scheme matching is case-insensitive ("Bearer", "bearer", "BEARER" all accepted).
 * Uses constant-time digest comparison to prevent timing side channels (CWE-208).
 */
export function checkBearerToken(req: IncomingMessage, expectedToken: string): boolean {
  const auth = req.headers.authorization;
  if (!auth) return false;
  const match = /^Bearer +(\S+)$/i.exec(auth);
  if (!match) return false;
  return timingSafeEqual(hashToken(match[1]), hashToken(expectedToken));
}

/** Write a 401 Unauthorized JSON response. */
export function writeUnauthorized(res: ServerResponse): void {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('WWW-Authenticate', 'Bearer');
  res.writeHead(401);
  res.end(JSON.stringify({ error: 'unauthorized' }));
}
