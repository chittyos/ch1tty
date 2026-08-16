// OpenAPI spec builder for the ch1tty tool registry.
// Converts tool registry entries into an OpenAPI 3.1 document so that
// openApiMcpServer can expose search + schema-validated execute over the
// full backend registry. Each tool becomes a POST operation with its
// inputSchema as the request body schema.

/** Minimal fields required from a registry entry to build the spec. */
export interface ToolSpecEntry {
  serverId: string;
  namespacedName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Build an OpenAPI 3.1 spec from the ch1tty tool registry.
 * One POST operation per tool: POST /tools/{serverId}/{toolName}.
 */
export function buildOpenApiSpec(
  tools: ToolSpecEntry[],
  version = '1.0.0',
): Record<string, unknown> {
  const paths: Record<string, unknown> = {};
  const seenOperationIds = new Set<string>();

  for (const tool of tools) {
    // URL-safe path: namespacedName is already "serverId/toolName"
    const pathKey = `/tools/${tool.namespacedName}`;
    const baseOperationId = tool.namespacedName.replace(/[^a-zA-Z0-9_]/g, '_');
    let operationId = baseOperationId;
    for (let n = 2; seenOperationIds.has(operationId); n++) operationId = `${baseOperationId}_${n}`;
    seenOperationIds.add(operationId);

    const properties = (tool.inputSchema.properties as Record<string, unknown> | undefined) ?? {};
    const required = (tool.inputSchema.required as string[] | undefined) ?? [];

    paths[pathKey] = {
      post: {
        operationId,
        summary: tool.description || tool.namespacedName,
        tags: [tool.serverId],
        // Use the full inputSchema to preserve $defs, allOf, oneOf, additionalProperties, etc.
        requestBody: Object.keys(properties).length > 0
          ? {
              required: required.length > 0,
              content: {
                'application/json': {
                  schema: tool.inputSchema,
                },
              },
            }
          : undefined,
        responses: {
          '200': {
            description: 'Tool result',
            content: {
              // Tools may return strings, arrays, or objects; use an open schema.
              'application/json': { schema: {} },
            },
          },
          '400': { description: 'Tool returned an error' },
        },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'ch1tty Tool Registry API',
      description:
        'Typed API surface over the ch1tty tool registry. ' +
        'Use the search tool to find operations and execute to run them with schema-validated arguments.',
      version,
    },
    paths,
  };
}

/**
 * Parse a /tools/{serverId}/{toolName} path into the namespaced tool name.
 * Returns null when the path does not match the expected pattern.
 */
export function parseToolPath(path: string): string | null {
  // Path pattern: /tools/<serverId>/<toolName>
  // namespacedName = "<serverId>/<toolName>"
  const m = /^\/tools\/([^/]+\/[^/]+)$/.exec(path);
  return m ? (m[1] ?? null) : null;
}
