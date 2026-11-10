// Car listing search service. One MPP charge buys one search job; status and report are free to poll.
// Testnet only: Tempo Moderato (chain 42431), test pathUSD.
import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { Mppx, Request as ServerRequest, stripe, tempo } from 'mppx/server';
import { privateKeyToAccount } from 'viem/accounts';
import { validateCriteria, CriteriaError } from './criteria.mjs';
import { openDatabase, replayStore, jobStore } from './job_store.mjs';
import { runSearch, classifierAvailable } from './search_job.mjs';
import { facebookCollectorFromEnv } from './facebook.mjs';
import { confirmRefund, prepareRefund, publicRefund, receiptMethod, receiptReference, refundCardPayment } from './refund.mjs';
import { EXAMPLE, landingPage, agentInstructions, reportPage, reportAccessPage } from './pages.mjs';
import { describe, openapi, resolveRoute } from './discovery.mjs';
import { CHAIN_ID, CURRENCY } from './payment_config.mjs';
import { liveCaptureAvailable, startLiveCapture } from './live.mjs';

const MAX_QUEUE = Number(process.env.MAX_QUEUE ?? 15);
const FACEBOOK_PER_HOUR = Number(process.env.FACEBOOK_SEARCHES_PER_HOUR ?? 12);
// With BEST_EFFORT_SOURCES=1 a search continues with the sources that work and reports the rest as a warning.
const BEST_EFFORT_SOURCES = process.env.BEST_EFFORT_SOURCES === '1';

export { CHAIN_ID, CURRENCY } from './payment_config.mjs';
const ACCESS_TOKEN_TTL_MS = 24 * 60 * 60_000;
const FAVICON = readFileSync(new URL('./assets/favicon.svg', import.meta.url));
const SHARE_IMAGE = readFileSync(new URL('./assets/share.png', import.meta.url));

function atomic(amount) {
  const [whole, fraction = ''] = amount.split('.');
  return (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0').slice(0, 6))).toString();
}


export async function startService({ secretKey, recipient, sellerKey, price = '0.05', card, port = 4320, host = '127.0.0.1', dataDir = '.private', realm, runner,
  createPreview = !runner && liveCaptureAvailable() ? startLiveCapture : undefined } = {}) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = openDatabase(`${dataDir}/service.sqlite`);
  const jobs = jobStore(db);
  function canReadSearch(request, id) {
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(request.headers.get('authorization') ?? '')?.[1];
    if (!token) return false;
    const access = jobs.access(id);
    if (!access?.hash || !(access.expiresAt > Date.now())) return false;
    const expected = Buffer.from(access.hash, 'hex');
    const actual = createHash('sha256').update(token).digest();
    return expected.length === actual.length && timingSafeEqual(actual, expected);
  }
  // Facebook searches use the operator's own account and have an hourly cap.
  const facebookRuns = [];
  const collector = facebookCollectorFromEnv();
  const refundAvailable = /^0x[0-9a-f]{64}$/i.test(sellerKey ?? '') &&
    privateKeyToAccount(sellerKey).address.toLowerCase() === recipient.toLowerCase();
  const sourceStatus = () => {
    const hourAgo = Date.now() - 3_600_000;
    while (facebookRuns.length && facebookRuns[0] < hourAgo) facebookRuns.shift();
    return {
      donedeal: 'available',
      facebook: !(collector || runner) ? 'not_configured' : facebookRuns.length >= FACEBOOK_PER_HOUR ? 'rate_limited' : 'available',
    };
  };
  function searchOffer(criteria) {
    const sources = sourceStatus();
    const unavailable = criteria.sources.filter((source) => sources[source] !== 'available');
    const blocked = BEST_EFFORT_SOURCES ? unavailable.length === criteria.sources.length : unavailable.length > 0;
    const reason = blocked ? `Required sources unavailable: ${unavailable.join(', ')}`
      : !refundAvailable && !card ? 'Refunds are unavailable'
      : queue.length >= MAX_QUEUE ? 'Search queue is full' : undefined;
    return { price, currency: CURRENCY, chainId: CHAIN_ID, testnet: true, sources,
      requiredSources: criteria.sources, availableSources: criteria.sources.filter((source) => !unavailable.includes(source)),
      canPay: !reason, reason };
  }
  const defaultRunner = async (criteria, progress, hooks = {}) => {
    let skipped;
    if (criteria.sources.includes('facebook')) {
      if (sourceStatus().facebook === 'available') facebookRuns.push(Date.now());
      else if (BEST_EFFORT_SOURCES && criteria.sources.length > 1) skipped = `Facebook Marketplace was not searched (${sourceStatus().facebook.replace('_', ' ')}).`;
      else throw new Error('Required source unavailable: facebook');
    }
    const report = await runSearch(skipped ? { ...criteria, sources: criteria.sources.filter((source) => source !== 'facebook') } : criteria, {
      progress, requireAllSources: !BEST_EFFORT_SOURCES, emit: hooks.emit,
      facebookCollector: collector, wrapFacebook: hooks.wrapFacebook,
    });
    if (skipped) { report.criteria = criteria; report.warnings = [...(report.warnings ?? []), skipped]; }
    return report;
  };
  const run = runner ?? defaultRunner;

  const mppx = Mppx.create({
    secretKey,
    realm: realm ?? process.env.MPP_REALM ?? host,
    methods: [tempo.charge({ recipient, currencies: [CURRENCY], testnet: true, chainId: CHAIN_ID,
      supportedModes: ['pull'], store: replayStore(db), waitForConfirmation: true }),
      // Card payments through a Stripe Shared Payment Token. Stripe's minimum card charge is 0.50.
      ...(card ? [stripe.charge({ secretKey: card.secretKey, networkId: card.networkId, paymentMethodTypes: ['card'],
        currency: card.currency, decimals: 2 })] : [])],
  });
  // Each method has its own price: test pathUSD on Tempo, and euros on a card.
  // A method is offered only when its refund path works. Without a card, Tempo stays for discovery.
  const charge = (options) => {
    const entries = [];
    if (refundAvailable || !card) entries.push(['tempo/charge', { amount: price, ...options }]);
    if (card) entries.push(['stripe/charge', { amount: card.price, ...options }]);
    return entries.length === 1 && entries[0][0] === 'tempo/charge' ? mppx.charge(entries[0][1]) : mppx.compose(...entries);
  };

  // One job at a time: the sources are rate limited and the browser sandbox has one screen.
  // Up to SEARCH_WORKERS searches run at the same time. The Facebook step uses the one browser screen
  // in the sandbox, so it takes a lock: other searches do their DoneDeal work meanwhile.
  const WORKERS = Math.max(1, Number(process.env.SEARCH_WORKERS ?? 3));
  const REPORT_CACHE_MS = Number(process.env.REPORT_CACHE_MINUTES ?? 15) * 60_000;
  const queue = [];
  const active = new Set();
  const liveByJob = new Map(); // jobId -> live capture, kept until the job ends
  const eventsByJob = new Map(); // jobId -> { events: [], at } for the live search page, kept 30 min
  const EVENTS_KEEP_MS = 30 * 60_000;
  const MAX_EVENTS = 2_000;
  function emitFor(id) {
    const entry = { events: [], at: Date.now() };
    eventsByJob.set(id, entry);
    for (const [other, value] of eventsByJob) if (Date.now() - value.at > EVENTS_KEEP_MS) eventsByJob.delete(other);
    return (event) => {
      if (entry.events.length >= MAX_EVENTS) return;
      entry.events.push({ seq: entry.events.length + 1, at: Date.now(), ...event });
      entry.at = Date.now();
    };
  }
  const reportCache = new Map(); // criteria key -> { report, at }
  const inflight = new Map(); // criteria key -> promise of a report
  const refundsInProgress = new Set();
  let closing = false;
  let facebookLock = Promise.resolve();

  function withFacebookLock(work) {
    const result = facebookLock.then(work, work);
    facebookLock = result.catch(() => {});
    return result;
  }

  const criteriaKey = (criteria) => JSON.stringify(criteria);

  async function runJob(id) {
    const job = jobs.get(id);
    if (!job || job.state === 'done' || job.state === 'failed') return;
    const key = criteriaKey(job.criteria);
    try {
      jobs.progress(id, 'running', 'starting');
      const cached = reportCache.get(key);
      if (cached && Date.now() - cached.at < REPORT_CACHE_MS) {
        jobs.complete(id, { ...cached.report, cachedFrom: cached.report.generatedAt });
        return;
      }
      if (inflight.has(key)) {
        jobs.progress(id, 'running', 'an identical search is running; sharing its result');
        jobs.complete(id, { ...(await inflight.get(key)), sharedWithIdenticalSearch: true });
        return;
      }
      const hooks = {
        jobId: id,
        emit: emitFor(id),
        // Wrap the Facebook collector: wait for the browser, show the live view while it works.
        wrapFacebook: (collect) => async (criteria) => {
          jobs.progress(id, 'running', 'waiting for the browser (another search is using it)');
          return withFacebookLock(async () => {
            jobs.progress(id, 'running', 'collecting DoneDeal and Facebook Marketplace listings');
            const capture = createPreview?.();
            if (capture) liveByJob.set(id, capture);
            try {
              return await collect(criteria);
            } finally {
              capture?.finish();
            }
          });
        },
      };
      const work = run(job.criteria, (text) => jobs.progress(id, 'running', text), hooks);
      inflight.set(key, work);
      let report;
      try {
        report = await work;
      } finally {
        inflight.delete(key);
      }
      reportCache.set(key, { report, at: Date.now() });
      jobs.complete(id, report);
    } catch (error) {
      jobs.fail(id, `Search failed: ${error.message}`);
      void refundFailedJob(id);
    } finally {
      liveByJob.get(id)?.finish();
      liveByJob.delete(id);
    }
  }

  function drain() {
    while (active.size < WORKERS && queue.length) {
      const id = queue.shift();
      active.add(id);
      runJob(id).finally(() => {
        active.delete(id);
        drain();
      });
    }
  }

  // A job that failed completely delivered nothing, so its payment goes back to the payer.
  async function refundFailedJob(id) {
    if (closing || refundsInProgress.has(id)) return;
    const job = jobs.get(id);
    if (!job?.receipt || !['pending', 'prepared'].includes(job.refund?.state)) return;
    const byCard = receiptMethod(job.receipt) === 'stripe';
    if (byCard ? !card : !refundAvailable) return;
    refundsInProgress.add(id);
    try {
      if (byCard) {
        // Stripe refunds are idempotent per search, so a retry after a restart cannot refund twice.
        const refunded = await refundCardPayment({ reference: receiptReference(job.receipt, 'stripe'), secretKey: card.secretKey, idempotencyKey: `car-search-refund-${id}` });
        if (!closing) jobs.setRefund(id, refunded, 'pending');
        return;
      }
      let refund = job.refund;
      if (refund.state === 'pending') {
        const reference = receiptReference(job.receipt);
        const prepared = reference
          ? await prepareRefund({ reference, sellerKey, recipient, currency: CURRENCY })
          : { state: 'failed', error: 'Payment receipt does not contain a transaction reference.' };
        if (closing) return;
        jobs.setRefund(id, prepared, 'pending');
        refund = jobs.get(id).refund;
      }
      if (refund.state !== 'prepared') return;
      const confirmed = await confirmRefund(refund, { recipient, currency: CURRENCY });
      if (!closing) jobs.setRefund(id, confirmed, 'prepared');
    } catch {
      // A transient RPC error leaves the durable intent available for retry.
    } finally {
      refundsInProgress.delete(id);
    }
  }
  function queuePosition(id) {
    const index = queue.indexOf(id);
    return index < 0 ? undefined : index + 1;
  }

  // Paid jobs interrupted by a restart run again.
  for (const id of jobs.unfinished()) queue.push(id);
  drain();
  const resumeRefunds = () => {
    for (const id of jobs.pendingRefunds()) void refundFailedJob(id);
  };
  if (refundAvailable || card) resumeRefunds();
  const refundTimer = refundAvailable || card ? setInterval(resumeRefunds, 20_000).unref() : undefined;

  const handler = async (request) => {
    const url = new URL(request.url);
    const origin = process.env.PUBLIC_ORIGIN ?? url.origin;
    const route = resolveRoute(url.pathname);
    const id = route?.id;
    let response;
    if (route && request.method !== route.method) {
      response = Response.json({ error: `Use ${route.method}` }, { status: 405, headers: { allow: route.method } });
    } else if (route?.name === 'health') {
      response = Response.json({ ok: true, testnet: true, chainId: CHAIN_ID, price, classifier: classifierAvailable(), facebook: Boolean(process.env.BOAT_SANDBOX_ID || process.env.FACEBOOK_COLLECTOR_DIR) });
    } else if (route?.name === 'landing') {
      response = new Response(landingPage({
        origin, price, card: card && { price: card.price, currency: card.currency, test: card.secretKey.includes('_test_') }, queueLength: queue.length, ...jobs.counts(),
        facebookEnabled: Boolean(process.env.BOAT_SANDBOX_ID || process.env.FACEBOOK_COLLECTOR_DIR),
        classifierEnabled: classifierAvailable(),
      }), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    } else if (route?.name === 'favicon') {
      response = new Response(FAVICON, { headers: { 'content-type': 'image/svg+xml' } });
    } else if (route?.name === 'share') {
      response = new Response(SHARE_IMAGE, { headers: { 'content-type': 'image/png' } });
    } else if (route?.name === 'agents') {
      response = new Response(agentInstructions({ origin, price, card: card && { price: card.price, currency: card.currency, test: card.secretKey.includes('_test_') } }), { headers: { 'content-type': 'text/markdown; charset=utf-8' } });
    } else if (route?.name === 'llms') {
      response = new Response(describe(origin, price, CHAIN_ID, card), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    } else if (route?.name === 'openapi') {
      response = Response.json(openapi(origin, { price, amount: atomic(price), recipient, currency: CURRENCY, chainId: CHAIN_ID, card: card && { price: card.price, currency: card.currency, networkId: card.networkId } }));
    } else if (route?.name === 'create' && !request.headers.get('authorization') && !(await request.clone().text()).trim()) {
      // Discovery: an unpaid call with no body gets the 402 challenge, so scanners and agents can read
      // the price. The challenge scope matches no criteria, so it cannot pay for a search, and a paid
      // retry with no body still gets 400 below before the credential is verified.
      const payment = await charge({ description: 'One car listing search', scope: '/v1/searches:discovery' })(request);
      response = payment.status === 402 ? payment.challenge : Response.json({ error: 'Body must be JSON criteria', example: EXAMPLE }, { status: 400 });
    } else if (route?.name === 'create' || route?.name === 'quote') {
      let criteria;
      try {
        criteria = validateCriteria(await request.clone().json());
      } catch (error) {
        const message = error instanceof CriteriaError ? error.message : 'Body must be JSON criteria';
        response = Response.json({ error: message, example: EXAMPLE }, { status: 400 });
      }
      if (criteria) {
        const offer = searchOffer(criteria);
        if (route.name === 'quote') response = Response.json(offer);
        else if (!offer.canPay) {
          response = Response.json({ error: offer.reason, offer }, { status: 503, headers: { 'retry-after': '120' } });
        } else {
          const scope = '/v1/searches:' + createHash('sha256').update(criteriaKey(criteria)).digest('hex');
          const payment = await charge({ description: 'One car listing search', scope })(request);
          if (payment.status === 402) response = payment.challenge;
          else {
            const id = randomBytes(16).toString('base64url');
            const accessToken = randomBytes(32).toString('base64url');
            // The link carries the token in the fragment. A browser does not send a fragment to any server,
            // so the token stays out of request logs. Any person with the full link can open the search.
            const progressPage = `${origin}/searches/${id}#access=${accessToken}`;
            const accepted = payment.withReceipt(Response.json({
              searchId: id, accessToken, progressPage,
              message: `To track the progress of this search, open ${progressPage} in a browser. Keep the link private: it opens the search without a prompt.`,
            }, { status: 202 }));
            jobs.create(id, criteria, accepted.headers.get('payment-receipt'), {
              hash: createHash('sha256').update(accessToken).digest('hex'), expiresAt: Date.now() + ACCESS_TOKEN_TTL_MS,
            });
            queue.push(id);
            drain();
            response = accepted;
          }
        }
      }
    } else if (route?.name === 'events') {
      const job = canReadSearch(request, id) ? jobs.get(id) : undefined;
      const after = Number(url.searchParams.get('after') ?? 0) || 0;
      const entry = eventsByJob.get(id);
      if (!job) response = Response.json({ error: 'Unknown search' }, { status: 404 });
      else response = Response.json({ state: job.state, progress: job.progress, queuePosition: queuePosition(id), live: liveByJob.has(id) ? { finished: liveByJob.get(id).finished() } : undefined, events: (entry?.events ?? []).filter((event) => event.seq > after) });
    } else if (route?.name === 'status') {
      const job = canReadSearch(request, id) ? jobs.get(id) : undefined;
      if (!job) response = Response.json({ error: 'Unknown search' }, { status: 404 });
      else response = Response.json({ searchId: job.id, state: job.state, queuePosition: queuePosition(job.id), progress: job.progress, live: liveByJob.has(job.id) ? { finished: liveByJob.get(job.id).finished() } : undefined, reportPage: `${origin}/searches/${job.id}`, createdAt: job.createdAt, updatedAt: job.updatedAt, error: job.error, refund: publicRefund(job.refund), report: job.report });
    } else if (route?.name === 'liveFrames') {
      const capture = canReadSearch(request, id) ? liveByJob.get(id) : undefined;
      response = capture && !capture.finished()
        ? new Response(capture.stream(), { headers: { 'content-type': 'application/octet-stream', 'x-accel-buffering': 'no' } })
        : new Response('No live preview', { status: 404 });
    } else if (route?.name === 'live') {
      const frame = canReadSearch(request, id) ? liveByJob.get(id)?.latest() : undefined;
      response = frame ? new Response(frame.jpeg, { headers: { 'content-type': 'image/jpeg', 'x-frame-age-ms': String(Date.now() - frame.at) } }) : new Response('No live picture', { status: 404 });
    } else if (route?.name === 'report') {
      const job = canReadSearch(request, id) ? jobs.get(id) : undefined;
      if (!job) response = new Response(reportAccessPage(), { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
      else response = new Response(reportPage({ ...job, refund: publicRefund(job.refund), queuePosition: queuePosition(job.id), liveView: job.state !== 'done' && job.state !== 'failed' && liveCaptureAvailable() && job.criteria.sources.includes('facebook') }), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    } else {
      response = Response.json({ error: 'Not found' }, { status: 404 });
    }
    response.headers.set('cache-control', 'no-store');
    // Log the route template, never the caller's URL, headers or body.
    appendFileSync(`${dataDir}/requests.jsonl`, JSON.stringify({ at: new Date().toISOString(), method: request.method, path: route?.path ?? '<unmatched>', status: response.status, receipt: Boolean(response.headers.get('payment-receipt')) }) + '\n', { mode: 0o600 });
    return response;
  };

  const server = createServer(ServerRequest.toNodeListener(handler, { maxBodySize: 8_000, onError: () => Response.json({ error: 'Request failed' }, { status: 500 }) }));
  server.listen(port, host);
  await once(server, 'listening');
  return {
    url: `http://${host}:${server.address().port}`,
    jobs,
    enqueue(id) { queue.push(id); drain(); }, // for tests and operator tools
    async close() {
      closing = true;
      clearInterval(refundTimer);
      for (const capture of liveByJob.values()) capture.finish();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      db.close();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { MPP_SECRET_KEY: secretKey, TEMPO_RECIPIENT: recipient } = process.env;
  if (!/^[0-9a-f]{64}$/i.test(secretKey ?? '') || !/^0x[0-9a-f]{40}$/i.test(recipient ?? '')) {
    console.error('Run node scripts/setup.mjs first: MPP_SECRET_KEY or TEMPO_RECIPIENT missing.');
    process.exit(1);
  }
  const card = process.env.STRIPE_SECRET_KEY && process.env.STRIPE_NETWORK_ID
    ? { secretKey: process.env.STRIPE_SECRET_KEY, networkId: process.env.STRIPE_NETWORK_ID, price: process.env.CARD_PRICE ?? '0.50', currency: (process.env.CARD_CURRENCY ?? 'eur').toLowerCase() }
    : undefined;
  const service = await startService({ secretKey, recipient, sellerKey: process.env.TEMPO_SELLER_KEY, price: process.env.SEARCH_PRICE ?? '0.05', card, port: Number(process.env.PORT ?? 4320), host: process.env.HOST ?? '127.0.0.1' });
  console.log(`Car listing search (testnet MPP): ${service.url}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await service.close(); process.exit(0); });
}
