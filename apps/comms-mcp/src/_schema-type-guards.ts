/**
 * Compile-time assertions that the TypeScript mirror types in types.ts
 * stay in sync with the JSON Schema enums in schemas/*.json.
 *
 * This file has no runtime output. If any of these assertions fails tsc
 * will report a type error on the offending line, catching drift between
 * types.ts and the canonical schemas before it reaches production.
 *
 * Placed in src/ (not test/) so it is included in the project's tsc
 * compilation — apps/comms-mcp/tsconfig.json excludes test/.
 */

import type { UnifiedCommsEntry, CommParty } from './types.ts';

type Expect<T extends true> = T;
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;

// unified-comms-entry.schema.json §channel enum
type _ChannelEnum = Expect<Equal<
  UnifiedCommsEntry['channel'],
  'quo' | 'imessage' | 'email' | 'twilio' | 'voice'
>>;

// unified-comms-entry.schema.json §direction enum
type _DirectionEnum = Expect<Equal<
  UnifiedCommsEntry['direction'],
  'inbound' | 'outbound'
>>;

// unified-comms-entry.schema.json §CommParty.role enum
type _RoleEnum = Expect<Equal<
  CommParty['role'],
  'sender' | 'recipient' | 'cc' | 'bcc'
>>;

// unified-comms-entry.schema.json §CommParty.identifierKind enum (optional field)
type _IdentifierKindEnum = Expect<Equal<
  NonNullable<CommParty['identifierKind']>,
  'phone' | 'email' | 'handle'
>>;
