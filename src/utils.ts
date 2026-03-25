import type { ContentItem, ToolCallResult } from './types.js';

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
  if ('content' in result && Array.isArray(result.content)) {
    return {
      content: (result.content as Array<Record<string, unknown>>).map(normalizeContentItem),
      isError: (result.isError as boolean | undefined) ?? false,
    };
  }

  // Legacy toolResult format
  return {
    content: [{ type: 'text', text: JSON.stringify((result as { toolResult: unknown }).toolResult) }],
    isError: false,
  };
}

function normalizeContentItem(item: Record<string, unknown>): ContentItem {
  switch (item.type) {
    case 'image':
      return { type: 'image', data: item.data as string, mimeType: item.mimeType as string };
    case 'resource':
      return {
        type: 'resource',
        resource: item.resource as { uri: string; mimeType?: string; text?: string; blob?: string },
      };
    default:
      return { type: 'text', text: (item.text as string) ?? '' };
  }
}
