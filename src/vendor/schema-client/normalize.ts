/**
 * @chittyos/schema-client — JSON Schema normalizer (de-nester).
 * @canon chittycanon://core/services/chittyschema#tool-schema-normalizer
 *
 * Claude-generated MCP tool schemas drift toward "Russian doll" over-nesting:
 * a wrapper object whose single property is an envelope name (`input`, `params`,
 * `arguments`, `payload`, `body`, `data`, `request`, …) whose value is itself an
 * object schema. Each aggregation layer (chittyagent-* -> chittymcp -> ch1tty)
 * can re-wrap, compounding the depth. This module collapses those redundant
 * envelope wrappers down to the real payload while preserving every meaningful
 * field (types, `required`, `enum`, `format`, `description`, etc.).
 *
 * Design contract:
 *  - PURE. No Workers globals, no fetch, no I/O. Safe to import in a Worker
 *    bundle, in Node, and in the browser. This is the single source of truth
 *    for normalization shared by the ChittySchema worker route and ch1tty's
 *    local fallback — there must never be a second, divergent implementation.
 *  - IDEMPOTENT. normalize(normalize(x)) deep-equals normalize(x).
 *  - NON-DESTRUCTIVE of semantics. A wrapper is only collapsed when it is a
 *    single-property object whose key is a known envelope name AND whose value
 *    is itself a *structured* object schema (has its own `properties`). An
 *    opaque `{ payload: { type: "object" } }` with no inner properties is left
 *    alone — collapsing it would erase the only named handle the caller has.
 */

/**
 * Canonical envelope key set. Union of the names the operator's first pass used
 * (`parameters`, `args`) and the names called out in the canon spec
 * (`input`, `params`, `arguments`, `payload`, `body`, `data`, `request`).
 * A single-property object keyed by one of these is a candidate wrapper.
 */
export const ENVELOPE_KEYS: ReadonlySet<string> = new Set([
  'input',
  'inputs',
  'params',
  'parameters',
  'arg',
  'args',
  'argument',
  'arguments',
  'payload',
  'body',
  'data',
  'request',
  'req',
]);

/** A JSON Schema fragment. Intentionally permissive — schemas are arbitrary. */
export type JsonSchema = Record<string, unknown>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

/**
 * Is `schema` an object schema that actually carries named properties?
 * Used both to detect collapsible wrappers and to know when an inner value is
 * "structured enough" to be hoisted in place of its wrapper.
 */
function isStructuredObjectSchema(schema: unknown): schema is JsonSchema {
  if (!isPlainObject(schema)) return false;
  const declaredObject = schema.type === 'object' || schema.type === undefined;
  return (
    declaredObject &&
    isPlainObject(schema.properties) &&
    Object.keys(schema.properties as Record<string, unknown>).length > 0
  );
}

/**
 * If `schema` is a single-property object wrapper whose lone key is an envelope
 * name and whose value is a structured object schema, return that inner schema;
 * otherwise return null. This is the one-level unwrap primitive — the public
 * `normalizeToolSchema` applies it recursively until it reaches a fixed point.
 */
function unwrapOnce(schema: JsonSchema): JsonSchema | null {
  if (!isStructuredObjectSchema(schema)) return null;
  const properties = schema.properties as Record<string, unknown>;
  const keys = Object.keys(properties);
  if (keys.length !== 1) return null;

  const onlyKey = keys[0]!;
  if (!ENVELOPE_KEYS.has(onlyKey)) return null;

  const inner = properties[onlyKey];
  // Only collapse when the inner value is itself a structured object schema.
  // An opaque `{ payload: { type: "object" } }` (no inner properties) is NOT
  // collapsed — doing so would discard the caller's only named handle and is
  // exactly the lossy bug we must avoid.
  if (!isStructuredObjectSchema(inner)) return null;

  return inner as JsonSchema;
}

/**
 * Recursively normalize a JSON Schema node:
 *  1. Collapse chained envelope wrappers at this node down to a fixed point.
 *  2. Recurse into `properties`, `items`, and the combinator keywords
 *     (`allOf`/`anyOf`/`oneOf`) so nested sub-schemas are de-nested too.
 *
 * Everything not explicitly recursed into (`required`, `enum`, `format`,
 * `description`, `type`, `default`, `examples`, custom `x-*` keys, …) is copied
 * through verbatim, so field preservation is structural, not enumerated.
 */
export function normalizeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map((item) => normalizeSchema(item));
  }
  if (!isPlainObject(schema)) {
    return schema;
  }

  // 1. Collapse envelope wrappers at this level until stable.
  let current: JsonSchema = schema as JsonSchema;
  let unwrapped = unwrapOnce(current);
  while (unwrapped) {
    current = unwrapped;
    unwrapped = unwrapOnce(current);
  }

  // 2. Recurse into structural children, preserving all sibling keywords.
  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(current)) {
    if (key === 'properties' && isPlainObject(value)) {
      const props: Record<string, unknown> = {};
      for (const [propName, propSchema] of Object.entries(value)) {
        props[propName] = normalizeSchema(propSchema);
      }
      out.properties = props;
    } else if (key === 'items') {
      // `items` may be a schema or an array of schemas (tuple validation).
      out.items = normalizeSchema(value);
    } else if (
      (key === 'allOf' || key === 'anyOf' || key === 'oneOf') &&
      Array.isArray(value)
    ) {
      out[key] = value.map((sub) => normalizeSchema(sub));
    } else if (key === 'additionalProperties' && isPlainObject(value)) {
      out.additionalProperties = normalizeSchema(value);
    } else {
      out[key] = value;
    }
  }

  return out;
}

/**
 * Normalize an MCP tool input schema. Thin, intention-revealing wrapper over
 * `normalizeSchema` that guarantees an object return for the common case where
 * a tool's `inputSchema` is an object. Falsy/undefined input is returned as-is
 * so callers can pass through tools that declare no schema.
 */
export function normalizeToolSchema(
  inputSchema: JsonSchema | undefined | null,
): JsonSchema | undefined | null {
  if (inputSchema === undefined || inputSchema === null) return inputSchema;
  return normalizeSchema(inputSchema) as JsonSchema;
}

/**
 * Measure the maximum depth of *envelope-wrapper* nesting in a schema — i.e.
 * how many consecutive collapsible single-envelope wrappers sit at the root.
 * Used by the survey tooling to rank "how jacked" a tool is. A flat schema, or
 * one whose nesting is legitimate domain structure (sibling props, opaque
 * payloads), reports 0.
 */
export function envelopeDepth(schema: unknown): number {
  let depth = 0;
  let current = schema;
  while (isPlainObject(current)) {
    const inner = unwrapOnce(current as JsonSchema);
    if (!inner) break;
    depth += 1;
    current = inner;
  }
  return depth;
}
