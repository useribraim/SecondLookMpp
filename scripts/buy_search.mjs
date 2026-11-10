// Demo buyer: discovers the service, checks the offer against its budget, pays one testnet MPP charge,
// verifies the transfer on chain, then polls for the report.
// Usage: node --env-file=.env scripts/buy_search.mjs [serviceUrl] ['{"vehicles":[...], ...}']
import { mkdirSync, writeFileSync } from 'node:fs';
import { Mppx, tempo } from 'mppx/client';
import { Receipt } from 'mppx';
import { createPublicClient, http, parseAbi, parseEventLogs, parseUnits } from 'viem';
import { tempoModerato } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const CHAIN_ID = 42431;
const CURRENCY = '0x20c0000000000000000000000000000000000000';
const tokenAbi = parseAbi(['function balanceOf(address) view returns (uint256)', 'event Transfer(address indexed from, address indexed to, uint256 value)']);
const serviceUrl = (process.argv[2] ?? 'http://127.0.0.1:4320').replace(/\/$/, '');
const criteria = JSON.parse(process.argv[3] ?? JSON.stringify({
  vehicles: [{ make: 'Volkswagen', model: 'Passat' }, { make: 'Skoda', model: 'Octavia' }],
  yearFrom: 2007, yearTo: 2015, priceMaxEur: 6000,
}));
const budget = process.env.BUYER_MAX_PRICE ?? '0.10';
const log = (text) => console.log(`[buyer ${new Date().toISOString().slice(11, 19)}] ${text}`);

const chain = createPublicClient({ chain: tempoModerato, transport: http('https://rpc.moderato.tempo.xyz', { timeout: 15_000 }) });
if (await chain.getChainId() !== CHAIN_ID) throw new Error('Refusing: not Tempo Moderato testnet');
const account = privateKeyToAccount(process.env.BUYER_PRIVATE_KEY);

// 1. Fund from the free testnet faucet when the balance is low.
let balance = await chain.readContract({ address: CURRENCY, abi: tokenAbi, functionName: 'balanceOf', args: [account.address] });
if (balance < parseUnits(budget, 6)) {
  log('testnet balance low; requesting faucet tokens');
  for (const hash of await chain.request({ method: 'tempo_fundAddress', params: [account.address] })) await chain.waitForTransactionReceipt({ hash, timeout: 60_000 });
  balance = await chain.readContract({ address: CURRENCY, abi: tokenAbi, functionName: 'balanceOf', args: [account.address] });
}
log(`wallet ${account.address}, balance ${Number(balance) / 1e6} test pathUSD, budget ${budget} per search`);

// 2. Discover the offer.
const doc = await (await fetch(`${serviceUrl}/openapi.json`)).json();
const offer = doc.paths['/v1/searches'].post['x-payment-info'].offers[0];
log(`offer: ${Number(offer.amount) / 1e6} test pathUSD to ${offer.recipient} on chain ${offer.methodDetails.chainId}`);
if (BigInt(offer.amount) > parseUnits(budget, 6)) throw new Error('Offer is above the budget; not buying');

// 3. Confirm the requested sources, then check the 402 challenge and pay.
const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(criteria) };
const quoteResponse = await fetch(`${serviceUrl}/v1/searches/quote`, init);
if (!quoteResponse.ok) throw new Error(`Quote returned ${quoteResponse.status}: ${await quoteResponse.text()}`);
const quote = await quoteResponse.json();
if (!quote.canPay) throw new Error(`Cannot buy this search: ${quote.reason}`);
if (!quote.testnet || quote.chainId !== CHAIN_ID || quote.currency !== CURRENCY || parseUnits(quote.price, 6) !== BigInt(offer.amount)) {
  throw new Error('Quote does not match the advertised testnet offer');
}
log(`required sources: ${quote.requiredSources.join(', ')}`);
const unpaid = await fetch(`${serviceUrl}/v1/searches`, init);
if (unpaid.status !== 402) throw new Error(`Expected 402, got ${unpaid.status}: ${await unpaid.text()}`);
const client = Mppx.create({
  polyfill: false,
  maxPaymentRetries: 1,
  methods: [tempo.charge({
    account, getClient: () => chain, expectedChainId: CHAIN_ID, allowedChainIds: [CHAIN_ID],
    expectedRecipients: [offer.recipient], currencies: [CURRENCY], decimals: 6, maxAmount: budget, autoSwap: false, mode: 'pull',
  })],
});
const prepared = await client.preparePayment(unpaid);
const request = prepared.challenge.request;
if (request.recipient.toLowerCase() !== offer.recipient.toLowerCase() || request.amount !== offer.amount || request.currency.toLowerCase() !== CURRENCY.toLowerCase()) {
  throw new Error('Challenge does not match the advertised offer; not paying');
}
log('402 challenge matches the offer; paying');
const credential = await prepared.createCredential();
const paid = await fetch(`${serviceUrl}/v1/searches`, prepared.setCredential(init, credential));
if (paid.status !== 202) throw new Error(`Paid request returned ${paid.status}: ${await paid.text()}`);
const receipt = Receipt.fromResponse(paid);
const accepted = await paid.json();
log(`paid; receipt ${receipt.status}, transaction ${receipt.reference}`);

// 4. Verify the transfer on chain, independently of the service.
const tx = await chain.waitForTransactionReceipt({ hash: receipt.reference, timeout: 60_000 });
const transfers = parseEventLogs({ abi: tokenAbi, eventName: 'Transfer', logs: tx.logs.filter((l) => l.address.toLowerCase() === CURRENCY.toLowerCase()) })
  .filter(({ args }) => args.from.toLowerCase() === account.address.toLowerCase() && args.to.toLowerCase() === offer.recipient.toLowerCase() && args.value === BigInt(offer.amount));
if (tx.status !== 'success' || transfers.length !== 1) throw new Error('On-chain transfer does not match the payment');
log(`on chain: block ${tx.blockNumber}, 1 matching transfer of ${Number(offer.amount) / 1e6} test pathUSD`);

// 5. Poll the free status URL.
const statusUrl = `${serviceUrl}/v1/searches/${accepted.searchId}`;
log(`search ${accepted.searchId} accepted; polling ${statusUrl}`);
let status;
let lastProgress;
let refundDeadline;
for (;;) {
  const response = await fetch(statusUrl, { headers: { authorization: `Bearer ${accepted.accessToken}` }, redirect: 'error' });
  if (!response.ok) throw new Error(`Search status returned HTTP ${response.status}`);
  status = await response.json();
  const progress = status.refund ? `${status.progress}, refund ${status.refund.state}` : status.progress;
  if (progress !== lastProgress) { log(`${status.state}: ${progress}`); lastProgress = progress; }
  if (status.state === 'done') break;
  if (status.state === 'failed') {
    refundDeadline ??= Date.now() + 90_000;
    if (!['pending', 'sending'].includes(status.refund?.state) || Date.now() >= refundDeadline) break;
  }
  await new Promise((resolve) => setTimeout(resolve, 3000));
}

mkdirSync('results', { recursive: true });
const file = `results/purchase-${accepted.searchId}.json`;
writeFileSync(file, JSON.stringify({ serviceUrl, buyer: account.address, offer, receipt, transaction: { hash: tx.transactionHash, block: tx.blockNumber.toString() }, status }, null, 2));
if (status.state === 'failed') { log(`failed: ${status.error}`); process.exit(1); }

const report = status.report;
const notify = report.confident.filter((find) => find.valuation?.discount >= 0.2);
log(`report: ${report.confident.length} confident, ${report.uncertain.length} uncertain, ${report.inspected} inspected, ${Math.round(report.elapsedMs / 1000)} s`);
log(`stage times: ${JSON.stringify(report.timings)}; inspection cost ${JSON.stringify(report.method.classifierUsage)}`);
for (const warning of report.warnings) log(`warning: ${warning}`);
console.log(notify.length ? `\nNOTIFY THE USER: ${notify.length} strong finds` : '\nNo find is strong enough to notify the user.');
for (const find of [...report.confident, ...report.uncertain].slice(0, 6)) {
  console.log(`- [${find.verdict}] €${find.priceEur} ${find.facts.yearMin ?? '?'} ${find.facts.make ?? '?'} ${find.facts.model ?? '?'}, ${find.valuation ? `${Math.round(find.valuation.discount * 100)}% below €${find.valuation.expectedEur}` : 'no valuation'}${find.foundOutsideSiteFilter ? ', outside site filter' : ''}\n  ${find.url}\n  ${find.condition.summary}`);
}
log(`saved ${file}`);
