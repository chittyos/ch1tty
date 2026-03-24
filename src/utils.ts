import type { ToolCallResult } from './types.js';

export const VERSION = '2.0.0';

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

export function normalizeToolResult(result: Record<string, unknown>): ToolCallResult {
  if ('content' in result) {
    return {
      content: (result.content as Array<{ type: string; text: string }>),
      isError: (result.isError as boolean | undefined) ?? false,
    };
  }

  // Legacy toolResult format
  return {
    content: [{ type: 'text', text: JSON.stringify((result as { toolResult: unknown }).toolResult) }],
    isError: false,
  };
}
