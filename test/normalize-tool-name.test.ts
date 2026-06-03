import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';

const DLQ = join(tmpdir(), `ch1tty-normalize-${process.pid}.dlq.jsonl`);
after(() => { rmSync(DLQ, { force: true }); });

function agg(): Aggregator {
  const config: ServerConfig[] = [
    { id: 'local', name: 'Local', type: 'local', access: 'readwrite', category: 'code', command: 'ch1tty-test-no-such-server' },
  ];
  return new Aggregator(config, { ledgerDlqPath: DLQ });
}

const VARIANTS = [
  'ch1tty/status',          // canonical
  'ch1tty.status',          // dot-notation from ASDK wrappers
  'ch1tty/ch1tty/status',   // doubled namespace
  'status',                 // bare verb
  'gateway_status',         // stale alias from older ASDK manifests
];

for (const name of VARIANTS) {
  test(`callTool accepts "${name}" and routes to ch1tty/status`, async () => {
    const result = await agg().callTool(name);
    assert.equal(result.isError, undefined, `expected no error for "${name}", got: ${JSON.stringify(result)}`);
    const status = JSON.parse(result.content[0].text);
    assert.ok(status.servers !== undefined || status.tools !== undefined || status.gateway !== undefined,
      `expected gateway status JSON shape for "${name}", got: ${result.content[0].text.slice(0, 200)}`);
  });
}

test('callTool still rejects unknown tools', async () => {
  const result = await agg().callTool('nonexistent_tool');
  assert.equal(result.isError, true);
});

test('callTool still rejects non-meta server prefixes', async () => {
  const result = await agg().callTool('someserver/status');
  assert.equal(result.isError, true);
});
