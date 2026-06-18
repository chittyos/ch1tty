// VENDORED from chittyschema@feat/tool-schema-canon — replace with published @chittyos/schema-client when available
//
// Trimmed to the surface ch1tty actually consumes: the canonical tool-schema
// normalizer + clients and the entity-type ontology client. The upstream
// package also exports attach()/types (drift-sync helpers) which ch1tty does
// not use and which depend on Node timer types unavailable under Workers — they
// are intentionally not vendored.

// Canonical tool-schema normalizer (de-nester).
export {
  normalizeToolSchema,
  normalizeSchema,
  envelopeDepth,
  ENVELOPE_KEYS,
} from './normalize.js';
export type { JsonSchema } from './normalize.js';

// Canonical tool-schema client.
export { ToolsClient } from './tools-client.js';
export type {
  CanonicalTool,
  ResolvedToolSchema,
  ToolSchemaSource,
  ToolsClientOptions,
} from './tools-client.js';

// Canonical entity-type ontology client (P/L/T/E/A) — canon/ontology path.
export { OntologyClient } from './ontology-client.js';
export type {
  Ontology,
  OntologyType,
  OntologySource,
  OntologyClientOptions,
  CoreTypeCode,
} from './ontology-client.js';
