import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TasksClient } from './tasks-client.js';
import { createTaskServer } from './server.js';

const client = new TasksClient();
const server = createTaskServer(client);

const transport = new StdioServerTransport();
await server.connect(transport);
