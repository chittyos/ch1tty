/**
 * Pure helper — no external runtime deps.
 * Builds the namespace type-hint string injected into the `code` tool description
 * so the model knows which sandbox namespaces exist.
 * Extracted here so it can be tested in Node without the Cloudflare Worker runtime.
 */
export function describeNamespaces(serverIds: string[]): string {
  const lines = serverIds.map(
    (id) =>
      `  ${id}.execute(toolName: string, args?: object): Promise<unknown>; ${id}.search(query: string): Promise<ToolDescriptor[]>;`,
  );
  return [
    'Available namespaces inside the code sandbox (call via Workers RPC):',
    '  ch1tty.search(query: string): Promise<ToolDescriptor[]>;',
    '  ch1tty.execute(namespacedTool: string, args?: object): Promise<unknown>;',
    ...lines,
    'Write an async function body that returns the final value. No internet fetch — only these namespaces.',
  ].join('\n');
}
