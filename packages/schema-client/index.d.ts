/**
 * Stub for @chittyos/schema-client.
 * Real implementation lives in CHITTYFOUNDATION/chittyschema/clients/schema-client.
 * This stub provides safe no-op defaults so the Worker build succeeds in environments
 * where the monorepo sibling is not present.
 */

export interface CanonicalToolEntry {
  canonicalSchema?: Record<string, unknown>;
}

/**
 * Fetches canonical tool schemas from ChittySchema. Falls back to empty Map
 * (no canonical overrides) when the service is unreachable.
 */
export declare class ToolsClient {
  fetchCanonicalTools(serverId: string): Promise<Map<string, CanonicalToolEntry>>;
}

/**
 * Validates canonical entity-type codes (P/L/T/E/A) against the ChittyOS ontology.
 * Falls back to accepting all codes when the canon service is unreachable.
 */
export declare class OntologyClient {
  isValidType(typeCode: string): Promise<boolean>;
}

/**
 * Normalizes a tool inputSchema by flattening unnecessary nesting.
 * Returns null if no normalization is needed.
 */
export declare function normalizeToolSchema(
  inputSchema: Record<string, unknown>
): Record<string, unknown> | null;
