// Measures one paid search: wall-clock time, request counts, payment, and the raw report.
// Usage: node --env-file=.env scripts/measure_service_run.mjs <serviceUrl> '<criteria json>' <output json path>
import { writeFileSync } from 'node:fs';
import { Mppx, tempo } from 'mppx/client';
import { Receipt } from 'mppx';
import { createPublicClient, http } from 'viem';
import { tempoModerato } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const CHAIN_ID = 42431;
const CURRENCY = '0x20c0000000000000000000000000000000000000';
const serviceUrl = process.argv[2].replace(/\/$/, '');
const criteria = JSON.parse(process.argv[3]);
const outputPath = process.argv[4];
const budget = '0.10';
const counts = { service: 0, rpc: 0 };
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url ?? String(input);
  counts[url.startsWith(serviceUrl) ? 'service' : 'rpc'] += 1;
  return nativeFetch(input, init);
};
const chain = createPublicClient({ chain: tempoModerato, transport: http('https://rpc.moderato.tempo.xyz', { timeout: 15_000 }) });
if (await chain.getChainId() !== CHAIN_ID) throw new Error('Refusing: not Tempo Moderato testnet');
const account = privateKeyToAccount(process.env.BUYER_PRIVATE_KEY);
counts.rpc = 0; counts.service = 0;

const start = Date.now();
const doc = await (await fetch(`${serviceUrl}/openapi.json`)).json();
const offer = doc.paths['/v1/searches'].post['x-payment-info'].offers[0];
const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(criteria) };
const quoteResponse = await fetch(`${serviceUrl}/v1/searches/quote`, init);
const quote = await quoteResponse.json();
console.log('QUOTE', quoteResponse.status, JSON.stringify(quote));
if (quoteResponse.ok && (!quote.canPay || quote.chainId !== CHAIN_ID)) throw new Error('Quote refused');
const unpaid = await fetch(`${serviceUrl}/v1/searches`, init);
if (unpaid.status !== 402) throw new Error(`Expected 402, got ${unpaid.status}`);
const client = Mppx.create({
  polyfill: false, maxPaymentRetries: 1,
  methods: [tempo.charge({ account, getClient: () => chain, expectedChainId: CHAIN_ID, allowedChainIds: [CHAIN_ID],
    expectedRecipients: [offer.recipient], currencies: [CURRENCY], decimals: 6, maxAmount: budget, autoSwap: false, mode: 'pull' })],
});
const prepared = await client.preparePayment(unpaid);
const request = prepared.challenge.request;
if (request.amount !== offer.amount || request.currency.toLowerCase() !== CURRENCY) throw new Error('Challenge mismatch');
const credential = await prepared.createCredential();
const paid = await fetch(`${serviceUrl}/v1/searches`, prepared.setCredential(init, credential));
const paidAt = Date.now();
if (paid.status !== 202) throw new Error(`Paid request returned ${paid.status}: ${await paid.text()}`);
const receipt = Receipt.fromResponse(paid);
const accepted = await paid.json();
const { searchId, accessToken } = accepted;
console.log('PAID', JSON.stringify({ amount: Number(request.amount) / 1e6, receipt, searchId }));
let status; let polls = 0; let refundDeadline;
for (;;) {
  const response = await fetch(`${serviceUrl}/v1/searches/${searchId}`, { headers: { authorization: `Bearer ${accessToken}` }, redirect: 'error' });
  if (!response.ok) throw new Error(`Search status returned HTTP ${response.status}`);
  status = await response.json(); polls += 1;
  if (status.state === 'done') break;
  if (status.state === 'failed') {
    refundDeadline ??= Date.now() + 90_000;
    if (!['pending', 'sending'].includes(status.refund?.state) || Date.now() >= refundDeadline) break;
  }
  await new Promise((r) => setTimeout(r, 3000));
}
const end = Date.now();
const result = { elapsedSeconds: (end - start) / 1000, secondsAfterPayment: (end - paidAt) / 1000, httpRequests: { service: counts.service, polls, chainRpc: counts.rpc },
  paidAmountPathUsd: Number(request.amount) / 1e6, receipt, accepted: { searchId }, quote, status };
writeFileSync(outputPath, JSON.stringify(result, null, 2));
console.log('DONE', JSON.stringify({ elapsedSeconds: result.elapsedSeconds, httpRequests: result.httpRequests, state: status.state, refund: status.refund }));
