// Pure utility functions extracted from Ch1ttyCore — no Cloudflare runtime deps,
// safe to import in Node.js test environments.

/**
 * True when the URL's host is chitty.cc or a *.chitty.cc subdomain (https only).
 * Used to allowlist dynamically-ingested upstream endpoints before sending them
 * inherited credentials. Rejects look-alikes like chitty.cc.evil.com.
 */
export function isChittyHost(url: string): boolean {
  let host: string;
  let protocol: string;
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    protocol = u.protocol;
  } catch {
    return false;
  }
  if (protocol !== 'https:') return false;
  return host === 'chitty.cc' || host.endsWith('.chitty.cc');
}

/**
 * Extract the canonical entity-type code (T position) from a ChittyID of the
 * form VV-G-LLL-SSSS-T-YM-C-X. Returns the single-letter uppercase code (e.g.
 * 'P') when the id matches that shape, else null (callers skip type validation
 * rather than guess). @canon chittycanon://gov/governance#core-types
 */
export function extractEntityTypeCode(entityId: string): string | null {
  const parts = entityId.split('-');
  // VV-G-LLL-SSSS-T-YM-C-X => exactly 8 segments, type code is index 4.
  if (parts.length === 8 && /^[A-Z]$/.test(parts[4]!)) return parts[4]!;
  return null;
}
