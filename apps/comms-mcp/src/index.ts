import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpClientDispatch } from './dispatch.js';
import { createCommsMcpServer } from './server.js';
import type { OwnerIdentity } from './types.js';

function ownerIdentity(): OwnerIdentity {
  const raw = process.env['COMMS_MCP_OWNER_IDENTIFIERS'] ?? '';
  return {
    identifiers: raw.split(',').map((s) => s.trim()).filter(Boolean),
    displayName: process.env['COMMS_MCP_OWNER_DISPLAY_NAME'] ?? null,
    chittyId: process.env['COMMS_MCP_OWNER_CHITTYID'] ?? null,
  };
}

const dispatch = new McpClientDispatch();
const server = createCommsMcpServer(dispatch, ownerIdentity());

const transport = new StdioServerTransport();
await server.connect(transport);
