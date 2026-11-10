import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Receipt } from 'mppx';
import { Mppx, tempo } from 'mppx/client';
import { isAddress, type Address } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { z } from 'zod';
import { CHAIN_ID, CURRENCY } from './payment_config.mjs';

const searchId = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
const accessToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const acceptedSearch = z.object({ searchId, accessToken });
const optionalInt = z.number().int().nullish();
const criteria = z.strictObject({
  vehicles: z.array(z.object({ make: z.string(), model: z.string().optional() })).min(1).max(4),
  priceMaxEur: z.number().int().min(500).max(200_000),
  priceMinEur: optionalInt, yearFrom: optionalInt, yearTo: optionalInt, mileageMaxKm: optionalInt, seatsMin: optionalInt,
  county: z.string().optional(), fuelTypes: z.array(z.string()).min(1).optional(),
  sources: z.array(z.enum(['donedeal', 'facebook'])).min(1).nullish(),
});

type Config = { origin: string; recipient: Address; account: PrivateKeyAccount; maxPrice?: string };

function toolResult(value: Record<string, unknown>) {
  return { structuredContent: value, content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

function toolError(text: string) {
  return { isError: true, content: [{ type: 'text' as const, text }] };
}

export function createCarSearchServer({ origin, recipient, account, maxPrice = '0.05' }: Config) {
  const url = new URL(origin);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) {
    throw new Error('CAR_SEARCH_URL must be HTTPS or loopback HTTP.');
  }
  const searches = new URL('/v1/searches', url);
  const payments = Mppx.create({
    polyfill: false,
    methods: [tempo.charge({
      account, expectedChainId: CHAIN_ID, allowedChainIds: [CHAIN_ID],
      expectedRecipients: [recipient], currencies: [CURRENCY], decimals: 6, maxAmount: maxPrice,
      autoSwap: false, mode: 'pull',
    })],
  });
  const server = new McpServer({ name: 'car-listing-search', version: '0.2.0' });

  server.registerTool('create_car_search', {
    description: `Buy one used-car search with a Tempo testnet payment of up to ${maxPrice} test pathUSD. Returns a search ID and a private 24-hour access token.`,
    inputSchema: { criteria },
  }, async ({ criteria }) => {
    const request: RequestInit = {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(criteria), redirect: 'error', signal: AbortSignal.timeout(60_000),
    };
    let submitted = false;
    try {
      const unpaid = await fetch(searches, request);
      if (unpaid.status !== 402) return toolError(`Expected a payment challenge. The API returned HTTP ${unpaid.status}.`);
      const payment = await payments.preparePayment(unpaid, { request });
      const credential = await payment.createCredential();
      submitted = true;
      const paid = await fetch(searches, payment.setCredential(request, credential));
      if (paid.status !== 202) return toolError(`Payment request returned HTTP ${paid.status}. Check the payment before trying again.`);
      if (Receipt.fromResponse(paid).status !== 'success') throw new Error('Missing successful receipt');
      return toolResult(acceptedSearch.parse(await paid.json()));
    } catch {
      return toolError(submitted
        ? 'The payment was submitted, but the API did not return a usable receipt and search. Check the payment before trying again.'
        : 'Could not prepare the testnet payment. Check the service URL, wallet and payment policy.');
    }
  });

  server.registerTool('get_car_search', {
    description: 'Read search progress or the final ranked lists using the private access token. Polling is free.',
    inputSchema: { searchId, accessToken },
  }, async ({ searchId, accessToken }) => {
    try {
      const response = await fetch(new URL(`${searches.pathname}/${searchId}`, searches), {
        headers: { authorization: `Bearer ${accessToken}` }, redirect: 'error', signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return toolError(`Search unavailable (HTTP ${response.status}).`);
      return toolResult(await response.json());
    } catch {
      return toolError('Could not read the search from the API.');
    }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const key = process.env.BUYER_PRIVATE_KEY;
    const recipient = process.env.CAR_SEARCH_RECIPIENT;
    if (!key || !/^0x[0-9a-f]{64}$/i.test(key) || !recipient || !isAddress(recipient)) throw new Error('Missing wallet configuration');
    const server = createCarSearchServer({
      origin: process.env.CAR_SEARCH_URL ?? 'http://127.0.0.1:4320',
      account: privateKeyToAccount(key as `0x${string}`), recipient,
      maxPrice: process.env.CAR_SEARCH_MAX_PRICE,
    });
    await server.connect(new StdioServerTransport());
  } catch {
    console.error('Could not start car search MCP. Check BUYER_PRIVATE_KEY, CAR_SEARCH_RECIPIENT, CAR_SEARCH_URL and CAR_SEARCH_MAX_PRICE.');
    process.exitCode = 1;
  }
}
