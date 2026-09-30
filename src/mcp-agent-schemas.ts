// Pure Zod schemas for Ch1ttyMcpAgent tool parameters. No Cloudflare runtime
// dependencies — extracted so tests can validate schema behaviour in Node.js.
import { z } from 'zod';

export const SearchSchema = {
  query: z.string().optional().describe('Search keywords matched against tool names and descriptions'),
  server: z.string().optional().describe('Filter by server id (e.g. "neon", "chittyos")'),
  category: z.string().optional().describe('Filter by category (ecosystem, code, search, reasoning, desktop, documents, communication)'),
  focus: z.string().optional().describe('Focus profile to bias results toward. A soft lens — out-of-focus tools still appear. Use "none" to disable.'),
  limit: z.number().optional().describe('Max results to return (default 20)'),
};

export const ExecuteSchema = {
  tool: z.string().describe('Namespaced tool name from search results (e.g. "neon/list_projects")'),
  args: z.record(z.string(), z.unknown()).optional().describe('Arguments to pass to the tool'),
};

export const CodeSchema = {
  code: z.string().describe('Async function body. Return the final value. Call upstream namespaces (e.g. await neon.execute("run_sql", {...})).'),
};

export const CastSchema = {
  intent: z.string().describe('Natural language description of what you want accomplished'),
  args: z.record(z.string(), z.unknown()).optional().describe('Arguments to pass to the resolved tool (if known)'),
  confirm: z.boolean().optional().describe('If true, return the execution plan without running it (default false)'),
  focus: z.string().optional().describe('Focus profile to bias resolution toward. Use "none" to disable.'),
};

export const ProvisionSchema = {
  intent: z.string().describe('What the provisioned agent should accomplish'),
  entityId: z.string().describe('ChittyID of the entity to attach the agent to'),
};

export const MemoryRecallSchema = {
  profile: z.string().describe('Name of the memory profile (e.g. user ID, team name, case ID).'),
  query: z.string().describe('Natural language question or search query.'),
};

export const MemoryIngestSchema = {
  profile: z.string().describe('Name of the memory profile to ingest into.'),
  sessionId: z.string().optional().describe('Optional session identifier to scope extraction.'),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']).describe('Message author role'),
    content: z.string().describe('Message text content'),
  })).describe('Conversation messages to process'),
};

export const MemorySummarySchema = {
  profile: z.string().describe('Name of the memory profile to summarize.'),
  sessionId: z.string().optional().describe('Optional session identifier to scope the summary.'),
};
