import assert from 'node:assert/strict';
import test from 'node:test';
import { RemoteProxy } from '../src/remote-proxy.js';

function registerDefaultServer(proxy: RemoteProxy): void {
  proxy.registerServer({
    id: 'remote',
    name: 'Remote',
    type: 'remote',
    endpoint: 'https://example.com/mcp',
  });
}

test('callTool returns structured error for non-200 HTTP responses', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 502, statusText: 'Bad Gateway' });

  try {
    const proxy = new RemoteProxy();
    registerDefaultServer(proxy);

    const result = await proxy.callTool('remote', 'do_work', { foo: 'bar' });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Remote call failed: 502 Bad Gateway/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('callTool normalizes JSON parse failures into structured MCP errors', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('not-json', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  try {
    const proxy = new RemoteProxy();
    registerDefaultServer(proxy);

    const result = await proxy.callTool('remote', 'do_work', {});
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Remote call error:/);
    assert.match(result.content[0].text, /Invalid JSON response/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('callTool enforces CH1TTY_HTTP_TIMEOUT_MS via abort timeout', async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = process.env.CH1TTY_HTTP_TIMEOUT_MS;
  process.env.CH1TTY_HTTP_TIMEOUT_MS = '5';

  globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
  };

  try {
    const proxy = new RemoteProxy();
    registerDefaultServer(proxy);

    const result = await proxy.callTool('remote', 'do_work', {});
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /timed out after 5ms/);
  } finally {
    if (originalTimeout === undefined) {
      delete process.env.CH1TTY_HTTP_TIMEOUT_MS;
    } else {
      process.env.CH1TTY_HTTP_TIMEOUT_MS = originalTimeout;
    }
    globalThis.fetch = originalFetch;
  }
});

test('callTool normalizes malformed SSE responses into structured errors', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('event: message\ndata: not-json\n\n', {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });

  try {
    const proxy = new RemoteProxy();
    registerDefaultServer(proxy);

    const result = await proxy.callTool('remote', 'do_work', {});
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Remote call error:/);
    assert.match(result.content[0].text, /Unable to parse SSE JSON payload/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
