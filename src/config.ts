import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerAccess, ServerCategory, ServerConfig, ServersConfig } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const VALID_ACCESS: Set<string> = new Set(['read', 'write', 'readwrite']);
const VALID_CATEGORIES: Set<string> = new Set([
  'ecosystem', 'code', 'search', 'reasoning', 'desktop', 'documents', 'communication',
]);

const SERVER_KEYS = new Set([
  'id',
  'name',
  'type',
  'access',
  'category',
  'command',
  'args',
  'endpoint',
  'authTokenKey',
  'headers',
  'envHeaders',
  'lazy',
  'enabled',
  'env',
]);

/**
 * Expand ~ to home directory and ${VAR} / $VAR to environment variable values.
 */
export function interpolatePath(input: string): string {
  let result = input;

  // Expand leading ~/ or standalone ~
  if (result.startsWith('~/') || result === '~') {
    result = homedir() + result.slice(1);
  }

  // Expand ${VAR} and $VAR patterns
  result = result.replace(/\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, braced, bare) => {
    const varName = braced || bare;
    return process.env[varName] ?? '';
  });

  return result;
}

function interpolateConfig(config: ServerConfig): ServerConfig {
  if (config.type === 'local') {
    return {
      ...config,
      command: interpolatePath(config.command),
      args: config.args?.map(interpolatePath),
    };
  }
  return {
    ...config,
    endpoint: interpolatePath(config.endpoint),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertString(value: unknown, fieldPath: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fieldPath} must be a non-empty string`);
  }
  return value;
}

function assertOptionalString(value: unknown, fieldPath: string): string | undefined {
  if (value === undefined) return undefined;
  return assertString(value, fieldPath);
}

function assertOptionalStringArray(value: unknown, fieldPath: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${fieldPath} must be an array of strings`);
  }
  return value;
}

function assertOptionalBoolean(value: unknown, fieldPath: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new Error(`${fieldPath} must be a boolean`);
  }
  return value;
}

function assertOptionalEnv(value: unknown, fieldPath: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error(`${fieldPath} must be an object of string values`);
  }

  const output: Record<string, string> = {};
  for (const [key, envValue] of Object.entries(value)) {
    if (typeof envValue !== 'string') {
      throw new Error(`${fieldPath}.${key} must be a string`);
    }
    output[key] = envValue;
  }
  return output;
}

function validateServerConfig(raw: unknown, index: number): ServerConfig {
  const prefix = `servers[${index}]`;
  if (!isRecord(raw)) {
    throw new Error(`${prefix} must be an object`);
  }

  for (const key of Object.keys(raw)) {
    if (!SERVER_KEYS.has(key)) {
      throw new Error(`${prefix}.${key} is not a recognized field`);
    }
  }

  const id = assertString(raw.id, `${prefix}.id`);
  const name = assertString(raw.name, `${prefix}.name`);
  const type = assertString(raw.type, `${prefix}.type`);
  if (type !== 'local' && type !== 'remote') {
    throw new Error(`${prefix}.type must be either "local" or "remote"`);
  }

  const access = assertString(raw.access, `${prefix}.access`);
  if (!VALID_ACCESS.has(access)) {
    throw new Error(`${prefix}.access must be one of: ${[...VALID_ACCESS].join(', ')}`);
  }

  const category = assertString(raw.category, `${prefix}.category`);
  if (!VALID_CATEGORIES.has(category)) {
    throw new Error(`${prefix}.category must be one of: ${[...VALID_CATEGORIES].join(', ')}`);
  }

  const command = assertOptionalString(raw.command, `${prefix}.command`);
  const args = assertOptionalStringArray(raw.args, `${prefix}.args`);
  const endpoint = assertOptionalString(raw.endpoint, `${prefix}.endpoint`);
  const authTokenKey = assertOptionalString(raw.authTokenKey, `${prefix}.authTokenKey`);
  const headers = assertOptionalEnv(raw.headers, `${prefix}.headers`);
  const envHeaders = assertOptionalEnv(raw.envHeaders, `${prefix}.envHeaders`);
  const lazy = assertOptionalBoolean(raw.lazy, `${prefix}.lazy`);
  const enabled = assertOptionalBoolean(raw.enabled, `${prefix}.enabled`);
  const env = assertOptionalEnv(raw.env, `${prefix}.env`);

  if (type === 'local') {
    if (!command) {
      throw new Error(`${prefix}.command is required for local servers`);
    }
    return {
      id,
      name,
      type,
      access: access as ServerAccess,
      category: category as ServerCategory,
      command,
      args,
      lazy,
      enabled,
      env,
    };
  }

  // type === 'remote'
  if (!endpoint) {
    throw new Error(`${prefix}.endpoint is required for remote servers`);
  }
  return {
    id,
    name,
    type,
    access: access as ServerAccess,
    category: category as ServerCategory,
    endpoint,
    authTokenKey,
    headers,
    envHeaders,
    lazy,
    enabled,
  };
}

export function validateServersConfig(raw: unknown): ServersConfig {
  if (!isRecord(raw)) {
    throw new Error('Config root must be an object');
  }

  const { servers } = raw;
  if (!Array.isArray(servers)) {
    throw new Error('Config root must include a "servers" array');
  }

  // Filter out comment-only entries (objects with just _comment), preserving original indexes
  const indexed: Array<{ entry: unknown; originalIndex: number }> = [];
  for (let i = 0; i < servers.length; i++) {
    const s = servers[i];
    if (isRecord(s) && '_comment' in s && Object.keys(s).length === 1) continue;
    indexed.push({ entry: s, originalIndex: i });
  }
  const validated = indexed.map(({ entry, originalIndex }) => interpolateConfig(validateServerConfig(entry, originalIndex)));
  const seen = new Set<string>();
  for (const server of validated) {
    if (seen.has(server.id)) {
      throw new Error(`Duplicate server id "${server.id}" found in config`);
    }
    seen.add(server.id);
  }

  return { servers: validated };
}

export function resolveConfigPath(): string {
  return process.env.CH1TTY_CONFIG || resolve(__dirname, '..', 'servers.json');
}

export function loadConfigFromPath(path: string): ServersConfig {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err) {
    throw new Error(`Unable to read config at ${path}: ${String(err)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (err) {
    throw new Error(`Invalid JSON in config at ${path}: ${String(err)}`);
  }

  try {
    return validateServersConfig(parsed);
  } catch (err) {
    throw new Error(`Invalid config at ${path}: ${String(err)}`);
  }
}
