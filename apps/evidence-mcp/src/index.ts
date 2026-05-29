import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { EvidenceClient, type IngestDocumentInput, type ListDocumentsFilter } from './evidence-client.js';

const client = new EvidenceClient();

const server = new Server(
  { name: 'evidence-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'ingest_document',
      description: 'Submit a document for indexing in ChittyEvidence. Returns the document record with its assigned canonical URI.',
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Document text content to ingest (required)' },
          kind: { type: 'string', description: 'Document kind/type (e.g. "note", "report", "transcript", "spec")' },
          title: { type: 'string', description: 'Optional human-readable title' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of tags for filtering and discovery',
          },
          metadata: {
            type: 'object',
            description: 'Optional arbitrary key-value metadata (source, author, correlation_id, etc.)',
            additionalProperties: true,
          },
        },
        required: ['content', 'kind'],
      },
    },
    {
      name: 'list_documents',
      description: 'List ingested documents with optional filtering by kind, tag, or creation time.',
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', description: 'Filter by document kind (e.g. "note", "report")' },
          tag: { type: 'string', description: 'Filter to documents that include this tag' },
          since: { type: 'string', description: 'ISO 8601 timestamp — return only documents created after this time' },
          cursor: { type: 'string', description: 'Pagination cursor from a previous list_documents response' },
          limit: { type: 'number', description: 'Maximum number of results (default: 50)' },
        },
      },
    },
    {
      name: 'get_document',
      description: 'Get a single document by its ID, including content, canonical URI, and metadata.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Document ID (required)' },
        },
        required: ['id'],
      },
    },
    {
      name: 'search_documents',
      description: 'Search the evidence corpus by keyword or phrase. Returns ranked matches.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query — keywords or phrase (required)' },
          kind: { type: 'string', description: 'Restrict search to this document kind' },
          limit: { type: 'number', description: 'Maximum number of results (default: 20)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_canonical_uri',
      description: 'Resolve a document ID to its canonical URI (chittycanon:// scheme). Use when you have an ID but need the stable canonical reference.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Document ID to resolve (required)' },
        },
        required: ['id'],
      },
    },
  ],
}));

function missingArg(tool: string, field: string) {
  return {
    content: [{ type: 'text' as const, text: `${tool}: required argument "${field}" is missing or not a string` }],
    isError: true,
  };
}

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  const a = args as Record<string, unknown>;

  try {
    let result: unknown;

    switch (name) {
      case 'ingest_document':
        if (typeof a['content'] !== 'string' || !a['content']) return missingArg('ingest_document', 'content');
        if (typeof a['kind'] !== 'string' || !a['kind']) return missingArg('ingest_document', 'kind');
        result = await client.ingestDocument({
          content: a['content'],
          kind: a['kind'],
          title: a['title'] as string | undefined,
          tags: a['tags'] as string[] | undefined,
          metadata: a['metadata'] as IngestDocumentInput['metadata'],
        });
        break;

      case 'list_documents':
        result = await client.listDocuments({
          kind: a['kind'] as string | undefined,
          tag: a['tag'] as string | undefined,
          since: a['since'] as string | undefined,
          cursor: a['cursor'] as string | undefined,
          limit: a['limit'] as number | undefined,
        } satisfies ListDocumentsFilter);
        break;

      case 'get_document':
        if (typeof a['id'] !== 'string' || !a['id']) return missingArg('get_document', 'id');
        result = await client.getDocument(a['id']);
        break;

      case 'search_documents':
        if (typeof a['query'] !== 'string' || !a['query']) return missingArg('search_documents', 'query');
        result = await client.searchDocuments(
          a['query'],
          a['kind'] as string | undefined,
          a['limit'] as number | undefined,
        );
        break;

      case 'get_canonical_uri':
        if (typeof a['id'] !== 'string' || !a['id']) return missingArg('get_canonical_uri', 'id');
        result = await client.getCanonicalUri(a['id']);
        break;

      default:
        return {
          content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text' as const, text: `Error: ${msg}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
