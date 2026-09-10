// Pure adapter: convert the gateway's ToolCallResult to the MCP SDK's stricter
// CallToolResult, where an embedded resource must carry text XOR blob (not both
// optional). No Cloudflare runtime dependencies — safe to import in tests.
import type { ToolCallResult } from './types.js';

/** MCP SDK CallToolResult content union (text | image | resource with text XOR blob). */
export type McpContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource'; resource: { uri: string; mimeType?: string; text: string } | { uri: string; mimeType?: string; blob: string } };

/**
 * Adapt the gateway's ToolCallResult to the MCP SDK's stricter CallToolResult.
 * The SDK requires embedded resources to carry `text` XOR `blob` (both required
 * variants), while the gateway type leaves them optional. A resource with
 * neither text nor blob is coerced to `text: ''`.
 */
export function toMcpResult(r: ToolCallResult): { [key: string]: unknown; content: McpContent[]; isError?: boolean } {
  const content: McpContent[] = r.content.map((c) => {
    if (c.type === 'resource') {
      const { uri, mimeType, text, blob } = c.resource;
      return blob !== undefined
        ? { type: 'resource' as const, resource: { uri, mimeType, blob } }
        : { type: 'resource' as const, resource: { uri, mimeType, text: text ?? '' } };
    }
    return c;
  });
  return { ...r, content };
}
