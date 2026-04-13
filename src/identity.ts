/**
 * Ch1tty Identity — Person (P), Synthetic.
 *
 * Ch1tty has agency: it routes, arbitrates, stages memory, runs the
 * coordinator. Per doctrine: "AI contexts are Person (P), Synthetic —
 * never Thing (T)."
 *
 * This module provides:
 *  - Ch1tty's own minted ChittyID
 *  - Ed25519 keypair generation and loading
 *  - Request signing for ChittyConnect authentication
 *  - `signedFetch` — drop-in fetch wrapper that presents identity
 *
 * Auth flow:
 *  1. Ch1tty presents its ChittyID + Ed25519 signature
 *  2. ChittyConnect verifies via id.chitty.cc public key lookup
 *  3. ChittyConnect provisions scoped, short-lived access based on
 *     behavioral trust (Six R's) + session Person context
 *  4. Ch1tty logs usage to ledger → feeds trust back
 *
 * @canon chittycanon://doctrine/seed — "identity lives in coordination layer"
 * @canon chittycanon://gov/governance#trust-is-behavioral
 */

import { log } from './logger.js';
import * as crypto from 'node:crypto';

// ── Ch1tty's own identity ─────────────────────────────────────

/** Minted via id.chitty.cc/api/get-chittyid?type=P&region=1&jurisdiction=USA */
export const CH1TTY_CHITTY_ID = '03-1-USA-4266-P-2604-0-02';

export const CH1TTY_IDENTITY = {
  chittyId: CH1TTY_CHITTY_ID,
  entityType: 'P' as const,
  characterization: 'Synthetic' as const,
  service: 'ch1tty',
  version: '4.1.0',
  canonicalUri: 'chittycanon://core/services/ch1tty',
} as const;

// ── Ed25519 keypair ───────────────────────────────────────────

interface KeyPair {
  publicKey: crypto.KeyObject;
  privateKey: crypto.KeyObject;
  publicKeyBase64: string;
}

let cachedKeyPair: KeyPair | null = null;

/**
 * Load or generate ch1tty's Ed25519 keypair.
 *
 * Priority:
 *  1. CH1TTY_PRIVATE_KEY env var (base64-encoded PKCS8)
 *  2. Generate ephemeral keypair (logs warning — prod should use env var)
 *
 * The public key should be registered at id.chitty.cc for verification.
 */
export function getKeyPair(): KeyPair {
  if (cachedKeyPair) return cachedKeyPair;

  const envKey = process.env.CH1TTY_PRIVATE_KEY;

  if (envKey) {
    try {
      const privateKey = crypto.createPrivateKey({
        key: Buffer.from(envKey, 'base64'),
        format: 'der',
        type: 'pkcs8',
      });
      const publicKey = crypto.createPublicKey(privateKey);
      const publicKeyBase64 = publicKey
        .export({ type: 'spki', format: 'der' })
        .toString('base64');

      cachedKeyPair = { publicKey, privateKey, publicKeyBase64 };
      log.info('Ed25519 keypair loaded from CH1TTY_PRIVATE_KEY');
      return cachedKeyPair;
    } catch (err) {
      // Key was set but malformed — throw, don't silently downgrade to ephemeral.
      throw new Error(`CH1TTY_PRIVATE_KEY is set but invalid: ${err}`);
    }
  }

  // Ephemeral fallback — functional but not verifiable by id.chitty.cc
  log.warn('Generating ephemeral Ed25519 keypair — set CH1TTY_PRIVATE_KEY for persistent identity');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyBase64 = publicKey
    .export({ type: 'spki', format: 'der' })
    .toString('base64');

  cachedKeyPair = { publicKey, privateKey, publicKeyBase64 };
  return cachedKeyPair;
}

// ── Request signing ───────────────────────────────────────────

export interface SignedHeaders {
  'X-ChittyID': string;
  'X-ChittyID-Signature': string;
  'X-ChittyID-Timestamp': string;
  'X-ChittyID-PublicKey': string;
}

/**
 * Sign a request payload with ch1tty's identity.
 *
 * Signature covers: `${method}:${url}:${timestamp}:${bodyHash}`
 * The receiving server can enforce timestamp windows (replay),
 * verify body hash (tampering), and check method+url (misrouting).
 */
export function signRequest(
  method: string,
  url: string,
  body?: string,
): SignedHeaders {
  const kp = getKeyPair();
  method = method.toUpperCase();
  const timestamp = new Date().toISOString();
  const bodyHash = body
    ? crypto.createHash('sha256').update(body).digest('hex')
    : 'empty';

  const message = `${method}:${url}:${timestamp}:${bodyHash}`;
  const signature = crypto.sign(null, Buffer.from(message), kp.privateKey);

  return {
    'X-ChittyID': CH1TTY_CHITTY_ID,
    'X-ChittyID-Signature': signature.toString('base64'),
    'X-ChittyID-Timestamp': timestamp,
    'X-ChittyID-PublicKey': kp.publicKeyBase64,
  };
}

// ── Signed fetch ──────────────────────────────────────────────

export interface SignedFetchOptions {
  method?: string;
  body?: string | Record<string, unknown>;
  headers?: Record<string, string>;
  /** The Person ChittyID this request is on behalf of (viewport carrier). */
  onBehalfOf?: string;
  timeoutMs?: number;
}

/**
 * Fetch with ch1tty's identity attached.
 *
 * Signs the request with Ed25519, attaches ChittyID headers, and
 * optionally includes the session's Person ChittyID as X-On-Behalf-Of.
 * This is how ch1tty authenticates to ChittyConnect — no bearer tokens,
 * no API keys.
 */
export async function signedFetch(
  url: string,
  options: SignedFetchOptions = {},
): Promise<Response> {
  const method = (options.method ?? 'GET').toUpperCase();
  const bodyStr = options.body
    ? typeof options.body === 'string'
      ? options.body
      : JSON.stringify(options.body)
    : undefined;

  const signed = signRequest(method, url, bodyStr);

  const headers: Record<string, string> = {
    ...options.headers,
    ...signed,
  };
  if (bodyStr) {
    headers['Content-Type'] = 'application/json';
  }

  if (options.onBehalfOf) {
    headers['X-On-Behalf-Of'] = options.onBehalfOf;
  }

  const controller = new AbortController();
  const timeout = options.timeoutMs ?? 10_000;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(url, {
      method,
      headers,
      body: bodyStr,
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`Request to ${url} timed out after ${timeout}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
