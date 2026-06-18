// Stub for @chittyos/schema-client.
// Safe no-op defaults: the Worker's catch blocks handle empty canonical results
// and OntologyClient failures gracefully (see ch1tty-do.ts handleProvision).

export class ToolsClient {
  async fetchCanonicalTools(_serverId) {
    return new Map();
  }
}

export class OntologyClient {
  async isValidType(_typeCode) {
    // When canon is unreachable, fall back to accepting all types.
    return true;
  }
}

export function normalizeToolSchema(_inputSchema) {
  return null;
}
