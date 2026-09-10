import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { LedgerClient } from './ledger-client.js';
import { createLedgerServer } from './server.js';

const server = createLedgerServer(new LedgerClient());
const transport = new StdioServerTransport();
await server.connect(transport);
