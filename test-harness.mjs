import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['/Users/nb/Desktop/Projects/github.com/CHITTYOS/ch1tty/dist/index.js'],
  stderr: 'pipe',
});

const stderr = transport.stderr;
if (stderr) stderr.on('data', (c) => process.stderr.write(`[gw] ${c}`));

const client = new Client({ name: 'test-harness', version: '1.0.0' }, { capabilities: {} });

try {
  await client.connect(transport);
  console.log('Connected to ch1tty');

  const result = await client.listTools();
  console.log(`\nTools discovered: ${result.tools.length}`);

  // Group by server prefix
  const groups = {};
  for (const t of result.tools) {
    const sep = t.name.indexOf('/');
    const prefix = sep > 0 ? t.name.slice(0, sep) : '(none)';
    groups[prefix] = (groups[prefix] || 0) + 1;
  }

  console.log('\nBy server:');
  for (const [k, v] of Object.entries(groups).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v} tools`);
  }

  // Show first 5 tool names
  console.log('\nSample tools:');
  for (const t of result.tools.slice(0, 5)) {
    console.log(`  ${t.name}`);
  }
} catch (err) {
  console.error('Error:', err.message);
} finally {
  await client.close();
  process.exit(0);
}
