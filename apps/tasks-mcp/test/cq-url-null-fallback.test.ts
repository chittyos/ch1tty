/**
 * CQ: tasks-mcp HTTP server req.url null-coalescing fallback coverage
 *
 * Covers the `const url = req.url ?? '';` branch in
 * apps/tasks-mcp/src/http-server.ts line 38: the right-hand side
 * (empty-string fallback) fires when IncomingMessage.url is undefined. In
 * that state no route matches and the handler falls through to the 404 path.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createTasksHttpApp } from '../src/http-server.ts';

test('tasks-mcp: req.url undefined → empty-string fallback → 404', async () => {
  const app = createTasksHttpApp();
  let capturedStatus = 0;
  let ended = false;

  const req = { url: undefined, method: 'GET', headers: {} } as unknown as IncomingMessage;
  const res = {
    writeHead: (code: number) => { capturedStatus = code; },
    end: () => { ended = true; },
    setHeader: () => {},
  } as unknown as ServerResponse;

  await app.handleRequest(req, res);

  assert.equal(capturedStatus, 404);
  assert.ok(ended, 'res.end() must be called');
});
