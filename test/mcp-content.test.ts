import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toMcpResult } from '../src/mcp-content.js';

// toMcpResult() normalises the gateway's ToolCallResult (where resource.text
// and resource.blob are both optional) to the MCP SDK's stricter CallToolResult
// (resource must carry text XOR blob, both as required fields in their union).

describe('toMcpResult — text content', () => {
  it('passes through a single text item unchanged', () => {
    const r = toMcpResult({ content: [{ type: 'text', text: 'hello' }] });
    assert.deepEqual(r.content, [{ type: 'text', text: 'hello' }]);
  });

  it('passes through multiple text items', () => {
    const r = toMcpResult({
      content: [
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ],
    });
    assert.equal(r.content.length, 2);
    assert.equal((r.content[0] as { type: 'text'; text: string }).text, 'a');
    assert.equal((r.content[1] as { type: 'text'; text: string }).text, 'b');
  });

  it('preserves isError: true', () => {
    const r = toMcpResult({ content: [{ type: 'text', text: 'err' }], isError: true });
    assert.equal(r.isError, true);
  });

  it('preserves isError: false', () => {
    const r = toMcpResult({ content: [{ type: 'text', text: 'ok' }], isError: false });
    assert.equal(r.isError, false);
  });

  it('isError is undefined when absent', () => {
    const r = toMcpResult({ content: [] });
    assert.equal(r.isError, undefined);
  });

  it('preserves extra top-level fields via spread', () => {
    const r = toMcpResult({ content: [], _meta: { tag: 'test' } } as Record<string, unknown> & { content: [] });
    assert.deepEqual((r as Record<string, unknown>)['_meta'], { tag: 'test' });
  });
});

describe('toMcpResult — image content', () => {
  it('passes through an image item unchanged', () => {
    const r = toMcpResult({ content: [{ type: 'image', data: 'base64data', mimeType: 'image/png' }] });
    assert.deepEqual(r.content, [{ type: 'image', data: 'base64data', mimeType: 'image/png' }]);
  });
});

describe('toMcpResult — resource with text', () => {
  it('normalises resource with text to text variant', () => {
    const r = toMcpResult({
      content: [{
        type: 'resource',
        resource: { uri: 'file:///readme.md', mimeType: 'text/markdown', text: '# Hello' },
      }],
    });
    const item = r.content[0] as { type: 'resource'; resource: { uri: string; mimeType?: string; text: string } };
    assert.equal(item.type, 'resource');
    assert.equal(item.resource.uri, 'file:///readme.md');
    assert.equal(item.resource.text, '# Hello');
    assert.equal((item.resource as Record<string, unknown>)['blob'], undefined);
  });

  it('preserves mimeType on text variant', () => {
    const r = toMcpResult({
      content: [{
        type: 'resource',
        resource: { uri: 'x://y', mimeType: 'text/plain', text: 'content' },
      }],
    });
    const item = r.content[0] as { type: 'resource'; resource: { uri: string; mimeType?: string; text: string } };
    assert.equal(item.resource.mimeType, 'text/plain');
  });

  it('coerces resource with no text and no blob to text: ""', () => {
    const r = toMcpResult({
      content: [{
        type: 'resource',
        resource: { uri: 'x://empty' },
      }],
    });
    const item = r.content[0] as { type: 'resource'; resource: { uri: string; text: string } };
    assert.equal(item.resource.text, '');
    assert.equal((item.resource as Record<string, unknown>)['blob'], undefined);
  });
});

describe('toMcpResult — resource with blob', () => {
  it('normalises resource with blob to blob variant', () => {
    const r = toMcpResult({
      content: [{
        type: 'resource',
        resource: { uri: 'file:///img.png', mimeType: 'image/png', blob: 'binarydata==' },
      }],
    });
    const item = r.content[0] as { type: 'resource'; resource: { uri: string; mimeType?: string; blob: string } };
    assert.equal(item.type, 'resource');
    assert.equal(item.resource.blob, 'binarydata==');
    assert.equal((item.resource as Record<string, unknown>)['text'], undefined);
  });

  it('prefers blob when both text and blob are present', () => {
    const r = toMcpResult({
      content: [{
        type: 'resource',
        resource: { uri: 'x://both', text: 'ignored', blob: 'chosen==' },
      }],
    });
    const item = r.content[0] as { type: 'resource'; resource: Record<string, unknown> };
    assert.equal(item.resource['blob'], 'chosen==');
    assert.equal(item.resource['text'], undefined);
  });
});

describe('toMcpResult — mixed content', () => {
  it('handles a mix of text + resource in one result', () => {
    const r = toMcpResult({
      content: [
        { type: 'text', text: 'summary' },
        { type: 'resource', resource: { uri: 'x://doc', text: 'body' } },
      ],
    });
    assert.equal(r.content.length, 2);
    assert.equal((r.content[0] as { type: 'text'; text: string }).text, 'summary');
    const res = r.content[1] as { type: 'resource'; resource: { text: string } };
    assert.equal(res.resource.text, 'body');
  });

  it('returns empty content array unchanged', () => {
    const r = toMcpResult({ content: [] });
    assert.deepEqual(r.content, []);
  });
});
