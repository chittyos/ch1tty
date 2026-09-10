// Pure fn-table builder and result marshaler for the codemode bridge.
// No @cloudflare/codemode import — safe to load in Node.js test environments.
import type { CodemodeHost, CodemodeResult } from './codemode-bridge.js';

/** Flat function table passed to the Worker sandbox executor. */
export type FnTable = Record<string, (...args: unknown[]) => Promise<unknown>>;

/**
 * Build the namespace fn-table from a CodemodeHost.
 * For each remoteServerId, registers `<id>.execute` and `<id>.search`.
 * Always adds `ch1tty.search` and `ch1tty.execute` (cross-server).
 */
export function buildFnTable(host: CodemodeHost, sessionId?: string): FnTable {
  const fns: FnTable = {};

  for (const serverId of host.remoteServerIds()) {
    fns[`${serverId}.execute`] = async (tool: unknown, args: unknown) => {
      const toolName = String(tool);
      const a = (args && typeof args === 'object' && !Array.isArray(args)) ? (args as Record<string, unknown>) : {};
      return host.runTool(`${serverId}/${toolName}`, a, sessionId);
    };
    fns[`${serverId}.search`] = async (query: unknown) => {
      return host.searchTools(String(query ?? ''), serverId);
    };
  }

  fns['ch1tty.search'] = async (query: unknown) => host.searchTools(String(query ?? ''));
  fns['ch1tty.execute'] = async (tool: unknown, args: unknown) => {
    const a = (args && typeof args === 'object' && !Array.isArray(args)) ? (args as Record<string, unknown>) : {};
    return host.runTool(String(tool), a, sessionId);
  };

  return fns;
}

/** Marshal raw executor output into a CodemodeResult. */
export function marshalResult(out: { result: unknown; error?: string; logs?: string[] }): CodemodeResult {
  return { result: out.result, error: out.error, logs: out.logs };
}
