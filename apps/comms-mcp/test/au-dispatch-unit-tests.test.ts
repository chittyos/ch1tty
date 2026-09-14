/**
 * AU — McpClientDispatch unit tests (dispatch.ts)
 *
 * McpClientDispatch is the real CommsDispatch implementation that routes calls
 * to backend MCP servers over Streamable HTTP. It was previously exercised only
 * through mock-dispatch tests (mcp-tool-layer, recent-log, reshape); this file
 * covers the implementation branches directly, without a real backend.
 *
 * 4 tests, no network required for 3 of them; the 4th uses a deliberate
 * missing-endpoint path to verify cleanup behavior.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { McpClientDispatch } from '../src/dispatch.ts';

// ── helpers ───────────────────────────────────────────────────────────────────

/** Delete one env var, return a cleanup callback. */
function withoutEnv(key: string): () => void {
  const prev = process.env[key];
  delete process.env[key];
  return () => {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('McpClientDispatch', () => {
  it('call(): missing endpoint env var → rejects with descriptive error', async () => {
    const restore = withoutEnv('COMMS_MCP_NOENDPOINT_ENDPOINT');
    try {
      const d = new McpClientDispatch();
      await assert.rejects(
        () => d.call('noendpoint', 'sometool', {}),
        (err: Error) => {
          assert.ok(
            err.message.includes("no endpoint for backend 'noendpoint'"),
            `expected no-endpoint message, got: ${err.message}`,
          );
          return true;
        },
      );
    } finally {
      restore();
    }
  });

  it('call(): error message includes the ${P}_ENDPOINT env var name (envPrefix coverage)', async () => {
    // chittyagent-quo → COMMS_MCP_CHITTYAGENT_QUO → env var COMMS_MCP_CHITTYAGENT_QUO_ENDPOINT
    const restore = withoutEnv('COMMS_MCP_CHITTYAGENT_QUO_ENDPOINT');
    try {
      const d = new McpClientDispatch();
      await assert.rejects(
        () => d.call('chittyagent-quo', 'sometool', {}),
        /COMMS_MCP_CHITTYAGENT_QUO_ENDPOINT/,
      );
    } finally {
      restore();
    }
  });

  it('close(): no open connections → resolves without error', async () => {
    const d = new McpClientDispatch();
    await d.close();
  });

  it('close(): can be called multiple times without error', async () => {
    const d = new McpClientDispatch();
    await d.close();
    await d.close();
  });
});
