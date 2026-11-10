import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Challenge, Credential } from 'mppx';
import { Mppx, tempo } from 'mppx/client';
import { DatabaseSync } from 'node:sqlite';
import { privateKeyToAccount } from 'viem/accounts';
import { jobStore, openDatabase } from '../src/job_store.mjs';
import { publicRefund } from '../src/refund.mjs';
import { CHAIN_ID, CURRENCY, startService } from '../src/server.mjs';
import { mockTempoRpc } from './fixtures/tempo-rpc.mjs';

const hash = (token) => createHash('sha256').update(token).digest('hex');

test('a paid failure persists one refund intent across a database reopen', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'car-search-refund-test-'));
  const path = join(dataDir, 'test.sqlite');
  const id = 'A'.repeat(22);
  const prepared = { state: 'prepared', hash: 'refund-hash', transaction: 'signed bytes' };
  let db = openDatabase(path);
  try {
    let jobs = jobStore(db);
    jobs.create(id, {}, 'payment-receipt');
    jobs.fail(id, 'required source failed');
    assert.equal(jobs.get(id).state, 'failed');
    assert.deepEqual(jobs.get(id).refund, { state: 'pending' });
    jobs.setRefund(id, prepared, 'pending');
    jobs.setRefund(id, { ...prepared, transaction: 'replacement bytes' }, 'pending');
    db.close();
    db = openDatabase(path);
    jobs = jobStore(db);
    assert.deepEqual(jobs.pendingRefunds(), [id]);
    assert.deepEqual(jobs.get(id).refund, prepared);
    assert.deepEqual(publicRefund(jobs.get(id).refund), { state: 'sending', hash: prepared.hash });
    jobs.setRefund(id, { state: 'sent', hash: prepared.hash }, 'prepared');
    assert.deepEqual(jobs.pendingRefunds(), []);
  } finally {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('server: pages, validation before payment, 402 challenge, report page', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'car-search-test-'));
  const sellerKey = `0x${'1'.repeat(64)}`;
  const recipient = privateKeyToAccount(sellerKey).address;
  const service = await startService({ secretKey: 'a'.repeat(64), recipient, sellerKey, port: 0, dataDir, runner: async () => ({}) });
  try {
    const landing = await fetch(`${service.url}/`);
    assert.match(landing.headers.get('content-type'), /text\/html/);
    const html = await landing.text();
    assert.match(html, /Second Look/);
    assert.ok(html.indexOf('class="wordmark"') < html.indexOf('class="code prompt"'));
    assert.ok(html.indexOf('class="code prompt"') < html.indexOf('class="diagram"'));
    assert.ok(html.includes(`Read ${service.url}/SKILL.md`));
    assert.ok(html.includes(`content="${service.url}/share.png"`));
    assert.match(html, /Volkswagen Pass<mark>s<\/mark>t B8 2015/);
    assert.match(html, /searches completed <b>0<\/b>/);
    assert.equal((await fetch(`${service.url}/favicon.svg`)).headers.get('content-type'), 'image/svg+xml');
    assert.equal((await fetch(`${service.url}/share.png`)).headers.get('content-type'), 'image/png');
    const agents = await (await fetch(`${service.url}/agents.md`)).text();
    assert.match(agents, /--network testnet/);
    assert.match(agents, /Never repeat a payment/);
    assert.match(await (await fetch(`${service.url}/llms.txt`)).text(), /agents\.md/);
    const spec = await (await fetch(`${service.url}/openapi.json`)).json();
    assert.equal(spec.openapi, '3.1.0');
    assert.ok(spec.paths['/v1/searches'].post.responses[402].headers['WWW-Authenticate']);
    assert.deepEqual(spec.paths['/v1/searches/{searchId}'].get.security, [{ searchAccess: [] }]);
    assert.equal(spec.components.securitySchemes.searchAccess.scheme, 'bearer');
    assert.deepEqual(Object.keys(spec.paths).sort(), [
      '/', '/health', '/favicon.svg', '/share.png', '/SKILL.md', '/skill.md', '/agents.md', '/AGENTS.md',
      '/llms.txt', '/openapi.json', '/v1/searches/quote', '/v1/searches', '/v1/searches/{searchId}',
      '/v1/searches/{searchId}/events', '/searches/{searchId}', '/searches/{searchId}/live.frames', '/searches/{searchId}/live.jpg',
    ].sort());

    const bad = await fetch(`${service.url}/v1/searches`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"vehicles":[]}' });
    assert.equal(bad.status, 400);
    // The hackathon scanner calls the paid route with no body and no payment: it must get the challenge.
    const discovery = await fetch(`${service.url}/v1/searches`, { method: 'POST' });
    assert.equal(discovery.status, 402);
    assert.match(discovery.headers.get('www-authenticate'), /^Payment /);
    const paidEmpty = await fetch(`${service.url}/v1/searches`, { method: 'POST', headers: { authorization: 'Payment invalid' } });
    assert.equal(paidEmpty.status, 400);
    assert.equal(paidEmpty.headers.get('www-authenticate'), null);
    const request = { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"vehicles":[{"make":"Skoda"}],"priceMaxEur":5000}' };
    const quote = await fetch(`${service.url}/v1/searches/quote`, request);
    assert.equal(quote.status, 200);
    assert.equal(quote.headers.get('www-authenticate'), null);
    const offer = await quote.json();
    assert.equal(offer.price, '0.05');
    assert.equal(offer.canPay, true);
    assert.deepEqual(offer.requiredSources, ['donedeal', 'facebook']);
    const unpaid = await fetch(`${service.url}/v1/searches`, request);
    assert.equal(unpaid.status, 402);
    assert.match(unpaid.headers.get('www-authenticate'), /^Payment /);
    const narrowerRequest = {
      ...request, body: '{"vehicles":[{"make":"Skoda"}],"priceMaxEur":5000,"sources":["donedeal"]}',
    };
    const reduced = await fetch(`${service.url}/v1/searches`, narrowerRequest);
    assert.equal(reduced.status, 402);
    const original = Challenge.fromResponse(unpaid);
    assert.ok(original.opaque);
    assert.deepEqual(original.request.methodDetails.supportedModes, ['pull']);
    assert.notEqual(original.opaque, Challenge.fromResponse(reduced).opaque);
    const swapped = await fetch(`${service.url}/v1/searches`, {
      ...narrowerRequest, headers: { ...narrowerRequest.headers, authorization: Credential.serialize({
        challenge: original, payload: { type: 'hash', hash: `0x${'0'.repeat(64)}` },
      }) },
    });
    assert.equal(swapped.status, 402);
    assert.match(await swapped.text(), /credential opaque does not match/);

    assert.equal((await fetch(`${service.url}/searches/${'x'.repeat(22)}`)).status, 404);
    const token = 'B'.repeat(43);
    const authorization = { headers: { authorization: `Bearer ${token}` } };
    service.jobs.create('A'.repeat(22), { vehicles: [{ make: 'Skoda' }], priceMaxEur: 5000 }, null,
      { hash: hash(token), expiresAt: Date.now() + 60_000 });
    service.jobs.complete('A'.repeat(22), { criteria: { vehicles: [{ make: 'Skoda', model: 'Octavia' }], yearFrom: 2007, yearTo: 2015, priceMaxEur: 5000 },
      inspected: 1, elapsedMs: 1000, warnings: [], rejectedCount: 0, generatedAt: '2026-11-09T00:00:00Z', uncertain: [],
      confident: [{ source: 'donedeal', url: 'https://www.donedeal.ie/x/1', title: 'Octavia', priceEur: 2000, county: 'Dublin', verdict: 'confident', reasons: [],
        facts: { make: 'Skoda', model: 'Octavia', yearMin: 2012, yearMax: 2012, mileageKm: 180000 }, valuation: { expectedEur: 4000, discount: 0.5, method: 'regression', comparables: 300 },
        condition: { flags: [], summary: 'No faults <script>' } }] });
    const report = await (await fetch(`${service.url}/searches/${'A'.repeat(22)}`, authorization)).text();
    assert.match(report, /50% below estimated €4,000/);
    assert.match(report, /No faults &lt;script&gt;/);
    assert.match(report, /href="#calls"/);

    const saved = service.jobs.get('A'.repeat(22)).report;
    const comparable = { url: 'https://www.donedeal.ie/cars-for-sale/octavia/24', year: 2012, mileageKm: 170_000, priceEur: 3800 };
    const finds = [1, 2, 3, 4].map((id) => ({
      ...saved.confident[0], id: `donedeal:${id}`,
      valuation: { expectedEur: 4000, comparables: 6, rangeEur: { low: 3800, high: 4200 }, examples: [comparable] },
    }));
    service.jobs.complete('A'.repeat(22), { ...saved, confident: finds, shortlist: finds.slice(0, 3).map((find) => find.id) });
    const updatedReport = await (await fetch(`${service.url}/searches/${'A'.repeat(22)}`, authorization)).text();
    assert.match(updatedReport, /Who to call first \(3\)/);
    assert.match(updatedReport, /More cars worth a call \(1\)/);
    assert.match(updatedReport, /Middle half of 6 comparable asks: €3,800–€4,200/);
    assert.ok(updatedReport.includes(comparable.url));

    for (const state of ['sending', 'failed', 'sent']) {
      const id = state.padEnd(22, 'x');
      service.jobs.create(id, { vehicles: [{ make: 'Skoda' }], priceMaxEur: 5000 }, null);
      service.jobs.fail(id, 'test failure');
      service.jobs.setRefund(id, { state });
    }
    const updated = await (await fetch(`${service.url}/`)).text();
    assert.match(updated, /searches completed <b>1<\/b>/);
    // The landing page no longer shows refunds; the store still counts only sent refunds.
    assert.equal(service.jobs.counts().refunded, 1);
  } finally {
    await service.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('verified payments issue independent tokens and every search read requires one', async (t) => {
  const transfers = mockTempoRpc(t);
  const dataDir = mkdtempSync(join(tmpdir(), 'car-search-access-'));
  const sellerKey = `0x${'1'.repeat(64)}`;
  const recipient = privateKeyToAccount(sellerKey).address;
  const service = await startService({ secretKey: 'a'.repeat(64), recipient, sellerKey, port: 0, dataDir,
    runner: async () => ({ confident: [], uncertain: [] }) });
  const auth = (token) => ({ headers: token ? { authorization: `Bearer ${token}` } : {} });
  const buy = async (make) => {
    const path = `${service.url}/v1/searches`;
    const request = {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vehicles: [{ make }], priceMaxEur: 5000, sources: ['donedeal'] }),
    };
    const unpaid = await fetch(path, request);
    assert.equal(unpaid.status, 402);
    const client = Mppx.create({ polyfill: false, methods: [tempo.charge({
      account: privateKeyToAccount(`0x${'2'.repeat(64)}`), expectedChainId: CHAIN_ID, currencies: [CURRENCY], autoSwap: false, mode: 'pull',
    })] });
    const payment = await client.preparePayment(unpaid, { request });
    const response = await fetch(path, payment.setCredential(request, await payment.createCredential()));
    assert.equal(response.status, 202);
    assert.ok(response.headers.get('payment-receipt'));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return response.json();
  };
  try {
    const started = Date.now();
    const [first, second] = await Promise.all([buy('Skoda'), buy('Volkswagen')]);
    assert.equal(transfers.length, 2);
    assert.deepEqual(Object.keys(first).sort(), ['accessToken', 'searchId']);
    assert.match(first.searchId, /^[A-Za-z0-9_-]{22}$/);
    assert.match(first.accessToken, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(first.accessToken, 'base64url').length, 32);
    assert.notEqual(first.searchId, second.searchId);
    assert.notEqual(first.accessToken, second.accessToken);
    const access = service.jobs.access(first.searchId);
    assert.equal(access.hash, hash(first.accessToken));
    assert.ok(access.expiresAt >= started + 86_400_000 && access.expiresAt <= Date.now() + 86_400_000);
    const status = `${service.url}/v1/searches/${first.searchId}`;
    const authorized = await fetch(status, auth(first.accessToken));
    assert.equal(authorized.status, 200);
    assert.equal((await authorized.json()).searchId, first.searchId);
    for (const token of [undefined, 'x'.repeat(43), second.accessToken]) {
      const report = `${service.url}/searches/${first.searchId}`;
      for (const path of [status, `${status}/events`, report, `${report}/live.jpg`, `${report}/live.frames`]) {
        assert.equal((await fetch(path, auth(token))).status, 404);
      }
    }
    const legacy = 'L'.repeat(22);
    service.jobs.create(legacy, {}, null);
    assert.equal((await fetch(`${service.url}/v1/searches/${legacy}`, auth(first.accessToken))).status, 404);
    const db = new DatabaseSync(join(dataDir, 'service.sqlite'));
    try {
      db.prepare('UPDATE jobs SET access_token_expires_at = ? WHERE id = ?').run(Date.now() - 1, first.searchId);
    } finally { db.close(); }
    assert.equal((await fetch(status, auth(first.accessToken))).status, 404);
    for (const file of readdirSync(dataDir)) {
      const bytes = readFileSync(join(dataDir, file));
      assert.ok(!bytes.includes(first.accessToken) && !bytes.includes(second.accessToken), file);
    }
  } finally {
    await service.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('server refuses payment for unavailable sources and allows the buyer to choose a narrower quote', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'car-search-test-'));
  const sellerKey = `0x${'2'.repeat(64)}`;
  const recipient = privateKeyToAccount(sellerKey).address;
  const service = await startService({ secretKey: 'b'.repeat(64), recipient, sellerKey, port: 0, dataDir });
  try {
    const criteria = { vehicles: [{ make: 'Skoda' }], priceMaxEur: 5000 };
    const post = (path, body) => fetch(`${service.url}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const refused = await post('/v1/searches', criteria);
    assert.equal(refused.status, 503);
    assert.equal(refused.headers.get('www-authenticate'), null);
    assert.deepEqual((await refused.json()).offer.availableSources, ['donedeal']);
    const narrower = await post('/v1/searches/quote', { ...criteria, sources: ['donedeal'] });
    assert.equal((await narrower.json()).canPay, true);
  } finally {
    await service.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('server: searches run in parallel, the Facebook step never overlaps, identical searches use the cache', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'car-search-test-'));
  let running = 0, maxRunning = 0, inFacebook = 0, maxFacebook = 0, runs = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const runner = async (criteria, progress, hooks) => {
    runs += 1; running += 1; maxRunning = Math.max(maxRunning, running);
    const collect = hooks.wrapFacebook(async () => { inFacebook += 1; maxFacebook = Math.max(maxFacebook, inFacebook); await sleep(60); inFacebook -= 1; return { listings: [] }; });
    await collect(criteria);
    await sleep(40);
    running -= 1;
    return { criteria, generatedAt: new Date().toISOString(), confident: [], uncertain: [], warnings: [] };
  };
  const service = await startService({ secretKey: 'b'.repeat(64), recipient: `0x${'2'.repeat(40)}`, port: 0, dataDir, runner });
  try {
    const ids = ['A', 'B', 'C'].map((c) => c.repeat(22));
    ids.forEach((id, i) => { service.jobs.create(id, { vehicles: [{ make: `Make${i}` }], priceMaxEur: 5000 }, null); service.enqueue(id); });
    const waitDone = async (id) => { for (;;) { const job = service.jobs.get(id); if (job.state === 'done' || job.state === 'failed') return job; await sleep(20); } };
    await Promise.all(ids.map(waitDone));
    assert.equal(maxRunning, 3);
    assert.equal(maxFacebook, 1);
    service.jobs.create('D'.repeat(22), { vehicles: [{ make: 'Make0' }], priceMaxEur: 5000 }, null);
    service.enqueue('D'.repeat(22));
    const cached = await waitDone('D'.repeat(22));
    assert.ok(cached.report.cachedFrom);
    assert.equal(runs, 3);
  } finally {
    await service.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
