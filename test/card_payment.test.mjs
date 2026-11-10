// Card payments through a Stripe Shared Payment Token, with the Stripe API simulated.
// No request reaches Stripe: fetch calls to api.stripe.com get fixed answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Mppx, stripe } from 'mppx/client';
import { privateKeyToAccount } from 'viem/accounts';
import { startService } from '../src/server.mjs';

const card = { secretKey: 'sk_test_simulated', networkId: 'profile_test_simulated', price: '0.50', currency: 'eur' };
const sellerKey = `0x${'1'.repeat(64)}`;
const recipient = privateKeyToAccount(sellerKey).address;
const criteria = { vehicles: [{ make: 'Skoda', model: 'Octavia' }], priceMaxEur: 5000, sources: ['donedeal'] };

function simulateStripe() {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('https://api.stripe.com/')) return realFetch(input, init);
    const body = Object.fromEntries(new URLSearchParams(String(init.body ?? '')));
    const headers = new Headers(init.headers);
    calls.push({ url, body, idempotencyKey: headers.get('idempotency-key') });
    if (url.endsWith('/v1/payment_intents')) {
      return Response.json({ id: 'pi_simulated1', status: 'succeeded', amount: Number(body.amount), currency: body.currency });
    }
    if (url.endsWith('/v1/refunds')) {
      return Response.json({ id: 're_simulated1', status: 'succeeded', amount: 50, currency: 'eur', payment_intent: body.payment_intent });
    }
    return Response.json({ error: { message: 'unexpected Stripe call' } }, { status: 400 });
  };
  return { calls, restore: () => { globalThis.fetch = realFetch; } };
}

const waitFor = async (check) => {
  for (let i = 0; i < 100; i += 1) { const value = check(); if (value) return value; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error('timed out');
};

test('card: the 402 offers Tempo and a 0.50 EUR card, and a failed search refunds the card', async () => {
  const stripeApi = simulateStripe();
  const dataDir = mkdtempSync(join(tmpdir(), 'car-search-card-test-'));
  const service = await startService({ secretKey: 'c'.repeat(64), recipient, sellerKey,
    card, port: 0, dataDir, runner: async () => { throw new Error('simulated source failure'); } });
  try {
    // Discovery: both methods, each at its own price.
    const unpaid = await fetch(`${service.url}/v1/searches`, { method: 'POST' });
    assert.equal(unpaid.status, 402);
    const challenges = unpaid.headers.get('www-authenticate');
    assert.match(challenges, /method="tempo"/);
    assert.match(challenges, /method="stripe"/);
    const spec = await (await fetch(`${service.url}/openapi.json`)).json();
    const offers = spec.paths['/v1/searches'].post['x-payment-info'].offers;
    assert.deepEqual(offers.map((o) => o.method), ['tempo', 'stripe']);
    assert.deepEqual({ amount: offers[1].amount, currency: offers[1].currency }, { amount: '50', currency: 'eur' });
    assert.match(await (await fetch(`${service.url}/llms.txt`)).text(), /0\.50 EUR by card/);

    // Pay by card. The client hands over a Shared Payment Token; the server creates the PaymentIntent.
    const tokenRequests = [];
    const client = Mppx.create({ polyfill: false, methods: [stripe.charge({
      paymentMethod: 'pm_card_visa',
      createToken: async (parameters) => { tokenRequests.push(parameters); return 'spt_simulated'; },
    })] });
    const paid = await client.fetch(`${service.url}/v1/searches`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(criteria) });
    assert.equal(paid.status, 202);
    assert.ok(paid.headers.get('payment-receipt'));
    assert.equal(tokenRequests[0].amount, '50');
    assert.equal(tokenRequests[0].currency, 'eur');
    const intent = stripeApi.calls.find((c) => c.url.endsWith('/v1/payment_intents'));
    assert.equal(intent.body.amount, '50');
    assert.equal(intent.body.shared_payment_granted_token, 'spt_simulated');

    // The runner fails, so the card payment goes back through the Stripe Refunds API, once.
    const { searchId } = await paid.json();
    const job = await waitFor(() => { const j = service.jobs.get(searchId); return j?.refund?.state === 'sent' && j; });
    assert.equal(job.refund.paymentIntent, 'pi_simulated1');
    const refunds = stripeApi.calls.filter((c) => c.url.endsWith('/v1/refunds'));
    assert.equal(refunds.length, 1);
    assert.equal(refunds[0].body.payment_intent, 'pi_simulated1');
    assert.equal(refunds[0].idempotencyKey, `car-search-refund-${searchId}`);
  } finally {
    await service.close();
    stripeApi.restore();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('card: without Stripe configuration the offers stay Tempo only', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'car-search-card-test-'));
  const service = await startService({ secretKey: 'd'.repeat(64), recipient: `0x${'4'.repeat(40)}`, port: 0, dataDir, runner: async () => ({}) });
  try {
    const unpaid = await fetch(`${service.url}/v1/searches`, { method: 'POST' });
    assert.doesNotMatch(unpaid.headers.get('www-authenticate'), /method="stripe"/);
  } finally {
    await service.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('card: without a Tempo refund key, only the card is offered', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'car-search-card-test-'));
  const service = await startService({ secretKey: 'e'.repeat(64), recipient: `0x${'4'.repeat(40)}`, card, port: 0, dataDir, runner: async () => ({}) });
  try {
    const unpaid = await fetch(`${service.url}/v1/searches`, { method: 'POST' });
    assert.equal(unpaid.status, 402);
    assert.match(unpaid.headers.get('www-authenticate'), /method="stripe"/);
    assert.doesNotMatch(unpaid.headers.get('www-authenticate'), /method="tempo"/);
  } finally {
    await service.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
