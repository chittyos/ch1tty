// Real ajv (draft 2020-12) validation harness. Loads the canonical schema JSON
// from ../schemas and validates by absolute $ref so the Output's
// entries.items.$ref (the external unified URI) resolves.

import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { ValidateFunction } from 'ajv';

function loadSchema(name: string): Record<string, unknown> {
  const url = new URL(`../schemas/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>;
}

const unifiedSchema = loadSchema('unified-comms-entry.schema.json');
const recentLogSchema = loadSchema('comms.recentLog.schema.json');

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(unifiedSchema); // self-registers under its $id
ajv.addSchema(recentLogSchema);

export const validateUnifiedEntry: ValidateFunction = ajv.getSchema(
  'https://schema.chitty.cc/comms/v1/unified-comms-entry.schema.json',
)!;

export const validateRecentLogOutput: ValidateFunction = ajv.getSchema(
  'https://schema.chitty.cc/comms/v1/comms.recentLog.schema.json#/$defs/Output',
)!;

export function assertValid(validate: ValidateFunction, data: unknown, label: string): void {
  const ok = validate(data);
  if (!ok) {
    throw new Error(`${label} failed schema validation: ${JSON.stringify(validate.errors, null, 2)}`);
  }
}
