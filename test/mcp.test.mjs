import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { privateKeyToAccount } from 'viem/accounts';
import { createCarSearchServer } from '../src/mcp.ts';
import { CURRENCY, startService } from '../src/server.mjs';
import { mockTempoRpc } from './fixtures/tempo-rpc.mjs';

test('MCP tools handle 402, payment, 202, protected progress and both ranked lists against a local API', async (t) => {
  const transfers = mockTempoRpc(t);
  const dataDir = mkdtempSync(join(tmpdir(), 'car-search-mcp-'));
  const sellerKey = `0x${'1'.repeat(64)}`;
  const recipient = privateKeyToAccount(sellerKey).address;
  const account = privateKeyToAccount(`0x${'2'.repeat(64)}`);
  let finish;
  const gate = new Promise((resolve) => { finish = resolve; });
  const report = { confident: [{ id: 'confident-ad' }], uncertain: [{ id: 'uncertain-ad' }] };
  const service = await startService({ secretKey: 'm'.repeat(64), recipient, sellerKey, port: 0, dataDir,
    runner: async (_criteria, progress) => {
      progress('checking listings');
      await gate;
      return report;
    },
  });
  const server = createCarSearchServer({ origin: service.url, recipient, account });
  const client = new Client({ name: 'car-search-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(({ name }) => name), ['create_car_search', 'get_car_search']);
    const bought = await client.callTool({ name: 'create_car_search', arguments: {
      criteria: { vehicles: [{ make: 'Skoda', model: 'Octavia' }], priceMaxEur: 5000, sources: ['donedeal'] },
    } });
    assert.equal(bought.isError, undefined, JSON.stringify(bought.content));
    const access = bought.structuredContent;
    assert.deepEqual(Object.keys(access).sort(), ['accessToken', 'message', 'progressPage', 'searchId']);
    assert.ok(access.progressPage.endsWith(`/searches/${access.searchId}#access=${access.accessToken}`));
    assert.deepEqual(transfers, [{ from: account.address.toLowerCase(), to: recipient.toLowerCase(), amount: 50_000n, currency: CURRENCY }]);

    const read = (credentials) => client.callTool({ name: 'get_car_search', arguments: credentials });
    const progress = await read(access);
    assert.equal(progress.structuredContent.state, 'running');
    assert.equal(progress.structuredContent.progress, 'checking listings');
    const wrong = await read({ ...access, accessToken: 'X'.repeat(43) });
    assert.equal(wrong.isError, true);
    assert.match(wrong.content[0].text, /404/);

    finish();
    const completed = await read(access);
    assert.equal(completed.structuredContent.state, 'done');
    assert.deepEqual(completed.structuredContent.report, report);
  } finally {
    finish();
    await client.close();
    await server.close();
    await service.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
