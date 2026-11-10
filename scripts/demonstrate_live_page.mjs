// Plays a simulated search on a local service so the live search page can be checked without
// payment, sources or model calls. The ads below are invented examples, not real listings.
// Usage: node scripts/demonstrate_live_page.mjs [--preview] [--windows 4] [--port 4399]
import { mkdtempSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../src/server.mjs';
import { goalText } from '../src/search_job.mjs';
import { startLiveCapture } from '../src/live.mjs';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : fallback;
};
const WINDOWS = Number(arg('windows', 3));
const PORT = Number(arg('port', 4399));
const PREVIEW = process.argv.includes('--preview');
const demoToken = process.env.CAR_SEARCH_DEMO_TOKEN;
if (!/^[A-Za-z0-9_-]{43}$/.test(demoToken ?? '')) throw new Error('Set CAR_SEARCH_DEMO_TOKEN to a 43-character base64url demo token.');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ADS = [
  { id: 'd1', source: 'donedeal', title: '2012 BMW 530d SE auto', priceEur: 8500, year: 2012, mileageKm: 212000, county: 'Dublin' },
  { id: 'd2', source: 'donedeal', title: '2011 BMW 530d M Sport', priceEur: 7950, year: 2011, mileageKm: 238000, county: 'Kildare' },
  { id: 'd3', source: 'donedeal', title: '2013 BMW 530d Luxury', priceEur: 9900, year: 2013, mileageKm: 187000, county: 'Dublin' },
  { id: 'd4', source: 'donedeal', title: '2010 BMW 530d spares or repair', priceEur: 2500, year: 2010, mileageKm: 301000, county: 'Meath' },
  { id: 'd5', source: 'donedeal', title: '2012 BMW 530d Touring', priceEur: 8250, year: 2012, county: 'Wicklow' },
  { id: 'f1', source: 'facebook', title: '2012 BMW 5 Series 3.0 diesel', priceEur: 6900, county: 'Dublin' },
  { id: 'f2', source: 'facebook', title: 'BMW 530d 2011 NCT 05/27', priceEur: 7400, county: 'Dublin' },
  { id: 'f3', source: 'facebook', title: 'BMW 530d needs gearbox', priceEur: 3000, county: 'Louth' },
];
const RESULTS = {
  d1: ['confident', 0.31, 'Claude read the ad: 2012 · 212,000 km · plate 2012 Dublin → worth a call'],
  d2: ['uncertain', 0.18, 'Claude read the ad: 2011 · 238,000 km → uncertain (service history not stated)'],
  d3: ['confident', 0.22, 'Claude read the ad: 2013 · 187,000 km → worth a call'],
  d4: ['rejected', -1, 'Claude read the ad: 2010 → rejected (spares or repair)'],
  d5: ['uncertain', 0.2, 'Claude read the ad: 2012 → uncertain (mileage not stated: ask the seller)'],
  f1: ['confident', 0.36, 'Claude read the ad: 2012 · 196,000 km · plate 2012 Dublin → worth a call'],
  f2: ['uncertain', 0.24, 'Claude read the ad: 2011 · 225,000 km → uncertain (year conflict in the ad)'],
  f3: ['rejected', -1, 'Claude read the ad: 2011 → rejected (gearbox fault)'],
};

async function simulatedSearch(criteria, progress, { emit, wrapFacebook }) {
  const tile = (id, kind, op, text, extra = {}) => emit({ type: 'tile', id, kind, op, text, ...extra });
  emit({ type: 'goal', text: goalText(criteria) });
  progress('collecting DoneDeal and Facebook Marketplace listings');
  tile('donedeal', 'donedeal', 'add', 'searching DoneDeal');
  for (let i = 0; i < WINDOWS; i += 1) { await wait(350); tile(`facebook-${i + 1}`, 'facebook', 'add', 'opening Marketplace', { index: i, windows: WINDOWS }); }
  await wait(1200);
  tile('donedeal', 'donedeal', 'update', '37 ads match the filter; checking damaged and other sections');
  await wait(1200);
  tile('donedeal', 'donedeal', 'update', '120 price comparisons · 5 ads picked to read');
  for (const ad of ADS.filter((x) => x.source === 'donedeal')) { await wait(400); emit({ type: 'ad', op: 'add', ...ad, line: 'found on DoneDeal' }); }
  for (const [i, ad] of ADS.filter((x) => x.source === 'donedeal').entries()) {
    await wait(500);
    tile('donedeal', 'donedeal', 'update', `reading ad ${i + 1} of 5`, { detail: ad.title });
  }
  tile('donedeal', 'donedeal', 'end', '5 ads read');
  for (let i = 0; i < WINDOWS; i += 1) tile(`facebook-${i + 1}`, 'facebook', 'update', `scrolling search ${i + 1}`);
  if (PREVIEW) await wrapFacebook(() => wait(15_000))(criteria);
  else await wait(2500);
  for (let i = 0; i < WINDOWS; i += 1) tile(`facebook-${i + 1}`, 'facebook', 'end', '3 ads read');
  for (const ad of ADS.filter((x) => x.source === 'facebook')) { await wait(400); emit({ type: 'ad', op: 'add', ...ad, line: 'found on Facebook Marketplace' }); }
  progress('inspecting 8 ads');
  emit({ type: 'ads', op: 'inspecting', text: 'Claude is reading 8 ads, with photos' });
  for (const ad of ADS) {
    await wait(700);
    const [verdict, score, line] = RESULTS[ad.id];
    emit({ type: 'ad', op: verdict === 'rejected' ? 'reject' : 'update', id: ad.id, verdict, score, line });
  }
  tile('plate', 'plate', 'add', '2 plates read from ad photos');
  tile('nct', 'nct', 'add', 'waiting for a plate');
  const checks = [['f1', '12-D-00000', 'BMW 530D', 'NCT valid to 2027-05-14', 'tax to 2026-12-31', 'good'], ['d1', '12-D-11111', 'BMW 530D', 'NCT expired 2026-09-03', 'tax to 2026-08-31', 'bad']];
  for (const [i, [adId, plate, model, nct, tax, state]] of checks.entries()) {
    tile('plate', 'plate', 'update', `plate ${i + 1} of 2`, { detail: plate, title: ADS.find((x) => x.id === adId).title });
    tile('nct', 'nct', 'update', 'asking gov.ie Check My Vehicle', { detail: plate });
    await wait(1500);
    tile('nct', 'nct', 'update', model, { detail: plate, lines: [nct, tax], state });
    emit({ type: 'ad', op: 'update', id: adId, verdict: state === 'bad' ? 'project' : 'confident', score: state === 'bad' ? 0.05 : 0.4, line: `gov.ie: ${nct}, ${tax}` });
    await wait(1200);
  }
  tile('plate', 'plate', 'end', '2 plates read');
  tile('nct', 'nct', 'end', '2 official records checked');
  emit({ type: 'ranked', confident: ['f1', 'd3'], uncertain: ['f2', 'd5', 'd2'], cheapForAReason: ['d1'] });
  await wait(4000);
  return { criteria, generatedAt: new Date().toISOString(), elapsedMs: 30000, timings: {}, sources: {}, inspected: 8, method: {}, confident: [], uncertain: [], cheapForAReason: [], rejectedCount: 2, rejectedSample: [], warnings: ['Simulated search: invented example ads.'] };
}

const dataDir = mkdtempSync(join(tmpdir(), 'live-page-'));
const service = await startService({ secretKey: 'd'.repeat(64), recipient: `0x${'3'.repeat(40)}`, port: PORT, host: '127.0.0.1', dataDir, runner: simulatedSearch,
  createPreview: PREVIEW ? () => startLiveCapture({ FACEBOOK_COLLECTOR_DIR: '.' }, { testPattern: true }) : undefined });
const start = () => {
  const id = randomBytes(16).toString('base64url');
  service.jobs.create(id, { vehicles: [{ make: 'BMW', model: '5 Series' }], yearFrom: 2010, yearTo: 2014, priceMaxEur: 10000, fuelTypes: ['Diesel'], county: 'Dublin', sources: ['donedeal', 'facebook'] }, null,
    { hash: createHash('sha256').update(demoToken).digest('hex'), expiresAt: Date.now() + 24 * 60 * 60_000 });
  service.enqueue(id);
  return id;
};
const first = start();
console.log(`Simulated search page: ${service.url}/searches/${first}`);
