// Ambient stubs for workspace packages resolved at build time via package.json
// "file:..." references. TypeScript sees the stub; wrangler resolves the real impl.

declare module '@chittyos/schema-client' {
  export class OntologyClient {
    isValidType(typeCode: string): Promise<boolean>;
  }
}
