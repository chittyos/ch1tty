/**
 * embedding-brain.ts:376 — candidateText() false branch: c.category absent → cat = ''
 *
 * All prior EmbeddingBrain tests use candidates with a category set. This test
 * calls route() with a no-category candidate, exercising the false branch of
 * `const cat = c.category ? \` [${c.category}]\` : ''` in describeForEmbed/candidateText.
 *
 * We verify by inspecting the body that the embedding server received: it must
 * contain the tool name + description but NOT a "[category]" bracket.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { EmbeddingBrain } from '../src/embedding-brain.js';

async function startEmbedFake(
  handler: (body: string) => Promise<{ status: number; body: string }>,
): Promise<{ url: string; requests: string[]; stop: () => Promise<void> }> {
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8'); });
    req.on('end', () => {
      requests.push(raw);
      handler(raw).then((result) => {
        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        res.end(result.body);
      }).catch((err) => { res.writeHead(500); res.end(String(err)); });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    stop: () => new Promise<void>((resolve, reject) => {
      server.closeAllConnections?.();
      server.close((err) => (err ? reject(err) : resolve()));
    }),
  };
}

test('candidateText: no-category candidate omits [category] bracket in embed input', async () => {
  const fake = await startEmbedFake(async (raw) => {
    const { input } = JSON.parse(raw) as { input: string[] };
    // Return one zero-dimension-safe embedding per input
    const embeddings = input.map(() => [0.1, 0.2, 0.3]);
    return { status: 200, body: JSON.stringify({ embeddings }) };
  });

  try {
    const brain = new EmbeddingBrain({
      url: fake.url,
      enabled: true,
      timeoutMs: 3000,
      minSimilarity: 0.0,
    });

    // Candidate with no category — exercises the false branch at embedding-brain.ts:376
    const result = await brain.route('find a tool', [
      { namespacedName: 'myserver/my_tool', description: 'does something useful' },
    ]);

    // The fake returns a low-similarity vector so result may be null or have one entry;
    // either way the embed was called and candidateText exercised the false branch.
    assert.equal(fake.requests.length, 2, 'two embed calls (query + candidate batch)');

    // Find the request that contains the candidate description (order not guaranteed with Promise.all)
    const allInputs = fake.requests.flatMap((raw) => {
      const parsed = JSON.parse(raw) as { input?: string[] };
      return parsed.input ?? [];
    });
    const candidateInput = allInputs.find((t) => t.includes('myserver/my_tool'));

    assert.ok(candidateInput !== undefined, 'embed received candidate text');
    assert.ok(candidateInput.includes('does something useful'), 'description present');
    assert.ok(!candidateInput.includes('['), 'no [category] bracket when category absent (line 376 false branch)');

    void result; // result is not the point of this test
  } finally {
    await fake.stop();
  }
});
