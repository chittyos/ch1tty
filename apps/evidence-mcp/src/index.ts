import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { EvidenceClient } from './evidence-client.js';
import { createEvidenceServer } from './server.js';

const server = createEvidenceServer(new EvidenceClient());
const transport = new StdioServerTransport();
await server.connect(transport);
