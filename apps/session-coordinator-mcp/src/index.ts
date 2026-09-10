import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SessionClient } from './session-client.js';
import { createSessionCoordinatorServer } from './server.js';

const client = new SessionClient();
const server = createSessionCoordinatorServer(client);
const transport = new StdioServerTransport();
await server.connect(transport);
