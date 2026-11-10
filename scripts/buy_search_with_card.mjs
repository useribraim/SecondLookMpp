// Demo buyer for the card method: pays one search with a Stripe Shared Payment Token (SPT) in a Stripe sandbox.
// The 402 challenge offers Tempo and Stripe. This buyer has only the Stripe method, so it answers that offer.
// The SPT comes from Stripe's sandbox test helper, which grants a token on a test card to the account of the key.
// Outside a sandbox an agent gets its SPT from its own wallet (for example the Link agent wallet), not from this script.
// Usage: node --env-file=.env scripts/buy_search_with_card.mjs [serviceUrl] ['{"vehicles":[...], ...}']
import { Mppx, stripe } from 'mppx/client';
import { Receipt } from 'mppx';

const STRIPE_VERSION = '2026-09-30.preview';
const TEST_PAYMENT_METHOD = 'pm_card_visa';
const serviceUrl = (process.argv[2] ?? 'http://127.0.0.1:4320').replace(/\/$/, '');
const criteria = JSON.parse(process.argv[3] ?? JSON.stringify({
  vehicles: [{ make: 'Volkswagen', model: 'Passat' }], yearFrom: 2012, priceMaxEur: 9000, county: 'Dublin', sources: ['donedeal'],
}));
const maxMinorUnits = Math.round(Number(process.env.BUYER_MAX_CARD_PRICE ?? '0.50') * 100);
const secretKey = process.env.STRIPE_SECRET_KEY ?? '';
if (!secretKey.startsWith('sk_test_')) throw new Error('This buyer uses the sandbox test helper. Set a Stripe test key (sk_test_...).');
const log = (text) => console.log(`[card buyer ${new Date().toISOString().slice(11, 19)}] ${text}`);

// Ask Stripe for a token that one seller profile can charge once: fixed currency, maximum amount and expiry.
async function createSharedPaymentToken({ amount, currency, expiresAt, networkId, paymentMethod }) {
  if (Number(amount) > maxMinorUnits) throw new Error(`The seller asks ${amount} ${currency} minor units; the budget is ${maxMinorUnits}.`);
  const body = new URLSearchParams({
    payment_method: paymentMethod,
    'usage_limits[currency]': currency,
    'usage_limits[max_amount]': String(amount),
    'usage_limits[expires_at]': String(expiresAt ?? Math.floor(Date.now() / 1000) + 600),
  });
  const response = await fetch('https://api.stripe.com/v1/test_helpers/shared_payment/granted_tokens', {
    method: 'POST',
    headers: { authorization: `Bearer ${secretKey}`, 'stripe-version': STRIPE_VERSION, 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const token = await response.json();
  if (!response.ok) throw new Error(`Stripe refused the token request: ${token.error?.message ?? response.status}`);
  log(`token ${token.id.slice(0, 12)}... granted for seller profile ${networkId}: at most ${amount} ${currency} minor units, one use`);
  return token.id;
}

// 1. Discovery: read the card offer and check it against the budget.
const document = await (await fetch(`${serviceUrl}/openapi.json`)).json();
const offer = document.paths['/v1/searches'].post['x-payment-info'].offers.find((entry) => entry.method === 'stripe');
if (!offer) throw new Error('The service does not offer card payment.');
log(`offer: ${(Number(offer.amount) / 100).toFixed(2)} ${offer.currency.toUpperCase()} by card to profile ${offer.methodDetails.networkId}`);

// 2. Pay: the client answers the Stripe challenge with a new token; the seller creates the PaymentIntent.
const client = Mppx.create({ polyfill: false, methods: [stripe.charge({ paymentMethod: TEST_PAYMENT_METHOD, createToken: createSharedPaymentToken })] });
const paid = await client.fetch(`${serviceUrl}/v1/searches`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(criteria),
});
if (paid.status !== 202) throw new Error(`Payment was not accepted: HTTP ${paid.status} ${(await paid.text()).slice(0, 300)}`);
const receipt = Receipt.deserialize(paid.headers.get('payment-receipt'));
const accepted = await paid.json();
log(`paid; receipt ${receipt.status}, method ${receipt.method}, Stripe reference ${receipt.reference}`);

// 3. Poll the free status URL.
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
if (status.state === 'done') {
  const report = status.report;
  log(`report: ${report.confident.length} to call first, ${report.uncertain.length} uncertain, ${report.inspected} ads inspected`);
  log(`open ${serviceUrl}/searches/${accepted.searchId} with the access token from the paid response`);
} else {
  log(`search failed: ${status.error ?? 'no reason given'}; refund ${status.refund?.state ?? 'not started'}`);
  process.exitCode = 1;
}
