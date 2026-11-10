import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCriteria, CriteriaError } from '../src/criteria.mjs';
import { buildMarket, estimate, discount, plausibleMileage } from '../src/valuation.mjs';
import { assess, buyerAction, keywordClassification, rankAssessments } from '../src/rank.mjs';
import { collectComparables, collectExact, normalizeAd, redactContacts, searchAll } from '../src/donedeal.mjs';
import { classifyListing } from '../src/classifier.mjs';

const criteria = validateCriteria({ vehicles: [{ make: 'volkswagen', model: 'passat' }], yearFrom: 2007, yearTo: 2015, priceMaxEur: 6000 });

function listing(overrides = {}) {
  return { source: 'donedeal', origin: 'exact', id: 'donedeal:1', url: 'https://www.donedeal.ie/x/1', title: '2012 Volkswagen Passat',
    priceEur: 3000, make: 'Volkswagen', model: 'Passat', year: 2012, mileageKm: 180_000, photos: [], ...overrides };
}

// Synthetic market with several ads close in year and mileage.
function syntheticMarket() {
  const rows = [];
  for (let year = 2006; year <= 2016; year++) {
    for (const km of [120_000, 150_000, 180_000, 210_000, 240_000]) {
      rows.push(listing({ id: `c${year}${km}`, year, mileageKm: km, priceEur: Math.round(20_000 * Math.exp(0.18 * (year - 2016)) * Math.exp(-0.025 * km / 10_000)) }));
    }
  }
  return buildMarket(rows);
}

test('criteria: normalizes names and rejects bad input before payment', () => {
  assert.deepEqual(criteria.vehicles, [{ make: 'Volkswagen', model: 'Passat' }]);
  assert.equal(criteria.priceMinEur, 300);
  assert.deepEqual(criteria.sources, ['donedeal', 'facebook']);
  assert.throws(() => validateCriteria({ vehicles: [], priceMaxEur: 5000 }), CriteriaError);
  assert.throws(() => validateCriteria({ vehicles: [{ make: 'VW' }] }), /priceMaxEur/);
  assert.throws(() => validateCriteria({ vehicles: [{ make: 'VW' }], priceMaxEur: 5000, yearFrom: 2015, yearTo: 2010 }), /yearFrom/);
  assert.throws(() => validateCriteria({ vehicles: [{ make: '<script>' }], priceMaxEur: 5000 }), CriteriaError);
  assert.throws(() => validateCriteria({ vehicles: [{ make: 'VW' }], priceMaxEur: 5000, extra: 1 }), /Unknown field/);
  assert.equal(validateCriteria({ vehicles: [{ make: 'VW' }], priceMaxEur: 5000, county: 'co. dublin' }).county, 'Dublin');
  assert.equal(validateCriteria({ vehicles: [{ make: 'VW' }], priceMaxEur: 5000, county: 'Cork' }).county, 'Cork');
});

test('valuation: matched asking-price range uses the nearby mileage and year sample', () => {
  const market = syntheticMarket();
  const value = estimate(market, { make: 'Volkswagen', model: 'Passat', year: 2012, mileageKm: 180_000 });
  const truth = 20_000 * Math.exp(0.18 * -4) * Math.exp(-0.025 * 18);
  assert.equal(value.method, 'matched-median');
  assert.equal(value.comparables, 9);
  assert.ok(value.rangeEur.low < value.expectedEur && value.rangeEur.high > value.expectedEur);
  assert.ok(Math.abs(value.expectedEur - truth) / truth < 0.01, `${value.expectedEur} vs ${truth}`);
  assert.equal(discount(value.expectedEur / 2, value), 0.5);
  assert.equal(estimate(market, { make: 'Skoda', model: 'Octavia', year: 2012, mileageKm: 1 }), undefined);
});

test('valuation excludes self and duplicate ads, and links nearby examples', () => {
  const target = listing({ priceEur: 950, fuel: 'Diesel', transmission: 'Manual', seats: 5, sellerType: 'private' });
  const matches = [3000, 3500, 4000, 4500].map((priceEur, index) =>
    listing({ ...target, id: `donedeal:${index + 2}`, url: `https://www.donedeal.ie/cars-for-sale/passat/${index + 2}`, priceEur }));
  const rows = [...matches, matches[0], target,
    listing({ ...target, id: 'donedeal:8', fuel: 'Petrol', priceEur: 1900 }),
    listing({ ...target, id: 'donedeal:9', transmission: 'Automatic', priceEur: 9500 }),
    listing({ ...target, id: 'donedeal:10', sellerType: 'dealer', priceEur: 9500 }),
    listing({ ...target, id: 'donedeal:11', seats: 2, priceEur: 950 })];
  const value = estimate(buildMarket(rows), target);
  assert.equal(value.comparables, 8);
  assert.deepEqual(value.rangeEur, { low: 2725, high: 5750 });
  assert.equal(value.expectedEur, 3750);
  assert.deepEqual(value.examples.map((ad) => ad.url), matches.slice(0, 3).map((ad) => ad.url));
  assert.equal(estimate(buildMarket(rows.slice(1)), target)?.comparables, 8);
  assert.equal(estimate(buildMarket(matches.slice(1)), target).confidence, 'uncertain');
  assert.equal(estimate(buildMarket(rows), { ...target, mileageKm: undefined }), undefined);
});

test('valuation: implausible mileage is treated as unknown', () => {
  const now = new Date('2026-11-09');
  assert.equal(plausibleMileage(0, 2012, now), undefined);
  assert.equal(plausibleMileage(482, 2012, now), undefined);
  assert.equal(plausibleMileage(3_000, 2025, now), 3_000);
  assert.equal(plausibleMileage(150_000, 2012, now), 150_000);
});

test('rank: a sound underpriced car is confident; a faulty one is rejected', () => {
  const market = syntheticMarket();
  const cheap = listing({ priceEur: 2000, description: 'Full service history, NCT 2027.' });
  const good = assess(cheap, keywordClassification(cheap), market, criteria);
  assert.equal(good.verdict, 'uncertain'); // keyword mode always carries its own uncertainty
  const modelSays = { ...keywordClassification(cheap), keyword_only: false, confidence: 0.95, uncertainty_reason: 'No photos to verify.' };
  assert.equal(assess(cheap, modelSays, market, criteria).verdict, 'confident');

  const faulty = listing({ priceEur: 900, title: '2010 VOLKSWAGEN PASSAT *READ AD*', description: 'HAS AN ENGINE ISSUE, USING COOLANT, NEED TOW TRUCK' });
  const rejected = assess(faulty, keywordClassification(faulty), market, criteria);
  assert.equal(rejected.verdict, 'rejected');
  assert.ok(rejected.reasons.some((reason) => reason.includes('engine_fault')));
});

test('rank: a mislabelled ad found outside the filter keeps that mark, and wrong models are rejected', () => {
  const market = syntheticMarket();
  const hidden = listing({ origin: 'adjacent', make: undefined, model: undefined, year: undefined, mileageKm: undefined, title: 'car for sale', priceEur: 1500 });
  const classification = { ...keywordClassification(hidden), make: 'Volkswagen', model: 'Passat', year_min: 2008, year_max: 2009,
    year_evidence: '08-D plate in photo 2', matches_criteria: 'yes', confidence: 0.85, uncertainty_reason: '' };
  const result = assess(hidden, classification, market, criteria);
  assert.equal(result.foundOutsideSiteFilter, true);
  assert.equal(result.verdict, 'uncertain');
  assert.ok(result.reasons.includes('mileage not stated'));

  const wrong = assess(listing({ make: 'Ford', model: 'Focus' }), keywordClassification(listing({ make: 'Ford', model: 'Focus' })), market, criteria);
  assert.equal(wrong.verdict, 'rejected');
  const lists = rankAssessments([result, wrong]);
  assert.equal(lists.uncertain.length, 1);
  assert.equal(lists.rejected.length, 1);
});

test('donedeal: normalizes an ad and removes contact data from text', () => {
  const ad = { id: 7, header: 'Vw Passat', price: '1,750', priceEuro: 1750, county: 'Co. Louth', friendlyUrl: 'https://www.donedeal.ie/cars-for-sale/vw-passat/7',
    section: { name: 'cars' }, mileageInKm: 0, photos: [{ medium: 'https://media.donedeal.ie/a.jpg' }],
    displayAttributes: [{ name: 'make', value: 'Volkswagen' }, { name: 'model', value: 'Passat' }, { name: 'year', value: '2008' }] };
  const normalized = normalizeAd(ad, 'exact');
  assert.equal(normalized.mileageKm, null);
  assert.equal(normalized.county, 'Louth');
  assert.equal(normalized.year, 2008);
  assert.equal(redactContacts('Call 087 123 4567 or a@b.ie'), 'Call [phone removed] or [email removed]');
});

test('BMW series searches use the DoneDeal catalog name and accept it in ranking', async () => {
  const bmw = validateCriteria({ vehicles: [{ make: 'BMW', model: '5 series' }], priceMaxEur: 35000 });
  const fetchImpl = async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body).makeModelFilters, [{ make: 'BMW', model: '5-Series' }]);
    return Response.json({ paging: { totalResults: 0, nextFrom: 0 } });
  };
  await collectExact(bmw, { fetchImpl });
  await collectComparables(bmw, { fetchImpl });
  const car = listing({ make: 'BMW', model: '5-Series', description: 'Service history available.' });
  const classified = { ...keywordClassification(car), keyword_only: false };
  assert.equal(assess(car, classified, new Map(), bmw).verdict, 'confident');
});

test('donedeal: a malformed response cannot fulfil a search as zero matches', async () => {
  const fetchImpl = async (_url, options) => {
    const { terms } = JSON.parse(options.body);
    return Response.json(terms === 'confirmed-empty' ? { paging: { totalResults: 0, nextFrom: 0 } } : {});
  };
  assert.deepEqual(await searchAll({ terms: 'confirmed-empty' }, { fetchImpl }), { ads: [], total: 0 });
  await assert.rejects(searchAll({ terms: 'missing-result' }, { fetchImpl }), /did not return a complete search response/);
});

test('classifier: sends the schema request and handles refusal', async () => {
  let request;
  const fakeClient = (stopReason, text) => ({ beta: { messages: { create: async (body) => { request = body; return { stop_reason: stopReason, content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 5 } }; } } } });
  const payload = { ...keywordClassification(listing()), confidence: 0.9 };
  const ok = await classifyListing(listing(), criteria, { client: fakeClient('end_turn', JSON.stringify(payload)) });
  assert.equal(ok.result.confidence, 0.9);
  assert.equal(request.output_config.format.type, 'json_schema');
  assert.equal(request.fallbacks, undefined); // no provider configured in tests: no Anthropic-only extras
  const refused = await classifyListing(listing(), criteria, { client: fakeClient('refusal', '') });
  assert.equal(refused.error, 'refusal');
});

test('facebook: card text becomes a listing; vague titles keep unknown make', async () => {
  const { normalizeCard } = await import('../src/facebook.mjs');
  const listing = normalizeCard({ itemId: '123', origin: 'adjacent', lines: ['€2,300', 'Car for sale 2009', 'Dublin, Ireland', '210K km'],
    photo: 'https://scontent.example/a.jpg', detail: { photos: ['https://scontent.example/b.jpg'],
      pageText: 'Car for sale 2009\n€2,300\nListed 2 days ago in Lucan, County Dublin\nMessage\nDriven 210,000 km\nSeller\'s description\nRuns well. Call 087 765 4321\nSeller information\nJane Seller\nJoined Facebook in 2012' } });
  assert.equal(listing.title, 'Car for sale 2009');
  assert.equal(listing.priceEur, 2300);
  assert.equal(listing.year, 2009);
  assert.equal(listing.mileageKm, 210_000);
  assert.equal(listing.make, null);
  assert.equal(listing.county, 'Lucan, County Dublin');
  assert.match(listing.description, /Runs well\. Call \[phone removed\]$/);
  assert.doesNotMatch(listing.description, /Jane Seller|Joined Facebook|^Message$/m);
  assert.deepEqual(listing.photos, ['https://scontent.example/b.jpg', 'https://scontent.example/a.jpg']);
  assert.equal(normalizeCard({ itemId: '9', lines: ['€1.500', 'Passat', '95,000 miles'] }).mileageKm, 152_888);
});

test('refund: reads the transaction reference from a payment receipt header', async () => {
  const { receiptReference } = await import('../src/refund.mjs');
  const hash = `0x${'ab'.repeat(32)}`;
  const header = Buffer.from(JSON.stringify({ method: 'tempo', reference: hash, status: 'success' })).toString('base64url');
  assert.equal(receiptReference(header), hash);
  assert.equal(receiptReference('not-base64-json'), undefined);
  assert.equal(receiptReference(undefined), undefined);
});

test('search job: a failed source is a warning; no listings at all fails the job', async () => {
  const { runSearch } = await import('../src/search_job.mjs');
  const fbOnly = validateCriteria({ vehicles: [{ make: 'VW', model: 'Passat' }], priceMaxEur: 6000, sources: ['facebook'] });
  await assert.rejects(runSearch(fbOnly, { useClassifier: false, facebookCollector: async () => { throw new Error('blocked'); } }), /no source returned listings/);
  const report = await runSearch(fbOnly, { useClassifier: false, facebookCollector: async () => ({ listings: [listing({ source: 'facebook', id: 'facebook:1', description: 'ok' })], stats: {} }) });
  assert.equal(report.inspected, 1);
  const empty = await runSearch(fbOnly, { requireAllSources: true, useClassifier: false, facebookCollector: async () => ({ listings: [], stats: {} }) });
  assert.equal(empty.sources.facebook.status, 'ok');
  assert.deepEqual(empty.shortlist, []);
  const workerEvents = [];
  await assert.rejects(runSearch(fbOnly, {
    requireAllSources: true,
    useClassifier: false,
    emit: (event) => { if (event.kind === 'facebook' && event.index === 0) workerEvents.push(event); },
    wrapFacebook: (collect) => (criteria) => {
      assert.deepEqual(workerEvents.map((event) => event.op), ['add']);
      return collect(criteria);
    },
    facebookCollector: async () => {
      assert.deepEqual(workerEvents.map((event) => event.op), ['add', 'update']);
      throw new Error('blocked');
    },
  }), /Required sources could not be searched: facebook/);
  assert.deepEqual(workerEvents.map((event) => event.op), ['add', 'update', 'end']);
  assert.equal(workerEvents.at(-1).state, 'bad');
});

test('rank: a model note is shown but does not make a sound find uncertain', () => {
  const market = syntheticMarket();
  const ad = listing({ priceEur: 2000, description: 'Full service history.' });
  const result = assess(ad, { ...keywordClassification(ad), keyword_only: false, confidence: 0.9, uncertainty_reason: 'No photos to verify.' }, market, criteria);
  assert.equal(result.verdict, 'confident');
  assert.equal(result.notes, 'No photos to verify.');
});

test('rank: a stated year that the model contradicts makes the find uncertain', () => {
  const market = syntheticMarket();
  const ad = listing({ priceEur: 2000, year: 2014, description: 'Passat 2012 for sale.' });
  const result = assess(ad, { ...keywordClassification(ad), keyword_only: false, confidence: 0.9, year_min: 2012, year_max: 2012 }, market, criteria);
  assert.equal(result.verdict, 'uncertain');
  assert.ok(result.reasons.some((reason) => reason.startsWith('year conflict: stated 2014')));
});

test('rank: on a year conflict the valuation uses the year the model trusts', () => {
  const market = syntheticMarket();
  const ad = listing({ priceEur: 2000, year: 2014, description: 'Passat 2012.' });
  const result = assess(ad, { ...keywordClassification(ad), keyword_only: false, confidence: 0.9, year_min: 2012, year_max: 2012 }, market, criteria);
  assert.equal(result.facts.yearMin, 2012);
  assert.equal(result.valuation.expectedEur, estimate(market, { make: 'Volkswagen', model: 'Passat', year: 2012, mileageKm: 180_000 }).expectedEur);
});

test('facebook: mileage from the seller text, ignoring fuel figures and distances', async () => {
  const { mileageFromText } = await import('../src/facebook.mjs');
  assert.equal(mileageFromText('2014 1.6 TDI with **283,300 km**.'), 283300);
  assert.equal(mileageFromText('pasat b6 237700km'), 237700);
  assert.equal(mileageFromText('279k kms'), 279000);
  assert.equal(mileageFromText('159,692 miles.'), 256999);
  assert.equal(mileageFromText('4.5 litres per 100km'), undefined);
  assert.equal(mileageFromText('Celbridge · 20 km'), undefined);
});

test('rank: missing mileage cannot establish the buyer limit or support a price comparison', () => {
  const market = syntheticMarket();
  const ad = listing({ priceEur: 2000, mileageKm: undefined, description: 'Runs well.' });
  const result = assess(ad, { ...keywordClassification(ad), keyword_only: false, confidence: 0.9, mileage_km: null }, market, criteria);
  assert.equal(result.verdict, 'uncertain');
  assert.equal(result.valuation, undefined);
  const limited = assess(ad, { ...keywordClassification(ad), keyword_only: false, confidence: 0.9, mileage_km: null }, market, { ...criteria, mileageMaxKm: 200_000 });
  assert.equal(limited.verdict, 'uncertain');
  assert.ok(limited.reasons.includes('mileage limit cannot be checked'));
});

test('rank: required seats block a match, but thin price evidence does not', () => {
  const market = buildMarket([]);
  const requirements = { ...criteria, seatsMin: 4 };
  const review = (seats) => {
    const ad = listing({ description: 'Runs well.', seats });
    return assess(ad, { ...keywordClassification(ad), keyword_only: false, confidence: 0.9 }, market, requirements);
  };
  assert.equal(review(2).verdict, 'rejected');
  const unknown = review(undefined);
  assert.equal(unknown.verdict, 'uncertain');
  assert.ok(buyerAction(unknown).checks.includes('Confirm how many seats the car has.'));
  const fit = review(5);
  assert.equal(fit.verdict, 'confident');
  assert.equal(fit.valuation, undefined);
});

test('rank: county filter checks the stated location of a Marketplace ad', () => {
  const market = buildMarket([]);
  const requirements = { ...criteria, county: 'Dublin' };
  const review = (county) => {
    const ad = listing({ source: 'facebook', description: 'Runs well.', county });
    const classifier = { ...keywordClassification(ad), keyword_only: false, confidence: 0.9 };
    return assess(ad, classifier, market, requirements);
  };
  assert.equal(review('Lucan, County Dublin').verdict, 'confident');
  const outside = review('Naas, Co. Kildare');
  assert.equal(outside.verdict, 'rejected');
  assert.ok(outside.reasons.includes('listing is in Kildare, outside Dublin'));
  const unclear = review('Dunleer, Ireland');
  assert.equal(unclear.verdict, 'uncertain');
  assert.ok(buyerAction(unclear).checks.includes('Confirm where the car can be viewed.'));
});

test('plates: Irish plates decode to year, half-year and county; others are refused', async () => {
  const { decodeIrishPlate } = await import('../src/plates.mjs');
  assert.deepEqual(decodeIrishPlate('141-KE-4220'), { plate: '141KE4220', year: 2014, half: 1, county: 'Kildare' });
  assert.deepEqual(decodeIrishPlate('08 D 12345'), { plate: '08D12345', year: 2008, half: undefined, county: 'Dublin' });
  assert.equal(decodeIrishPlate('07-KE-9228').year, 2007);
  assert.equal(decodeIrishPlate('99-D-1').year, 1999);
  assert.equal(decodeIrishPlate('133-D-1'), undefined); // half-year must be 1 or 2
  assert.equal(decodeIrishPlate('13-D-1'), undefined); // two-digit years end in 2012
  assert.equal(decodeIrishPlate('AB12 CDE'), undefined); // UK format
  assert.equal(decodeIrishPlate('141-ZZ-1'), undefined); // unknown county
});

test('vehicle record: a different make is a mismatch; expired NCT is a caution', async () => {
  const { compareRecord } = await import('../src/vehicle_record.mjs');
  const record = { make: 'NISSAN', model: 'QASHQAI', nctExpiry: '2026-05-01', taxExpiry: '2026-12-31' };
  const check = compareRecord(record, { make: 'Volkswagen', model: 'Passat' }, '2026-11-10');
  assert.match(check.mismatch, /NISSAN QASHQAI/);
  assert.deepEqual(check.cautions, ['NCT expired on 2026-05-01 (official record)']);
  assert.equal(compareRecord({ make: 'VOLKSWAGEN', model: 'PASSAT CC' }, { make: 'Volkswagen', model: 'Passat' }).mismatch, undefined);
});

test('rank: a readable plate gives the year when the ad states none, and stays private', () => {
  const market = syntheticMarket();
  const ad = listing({ year: undefined, priceEur: 2000, description: 'Runs well.' });
  const result = assess(ad, { ...keywordClassification(ad), keyword_only: false, confidence: 0.9, year_min: null, year_max: null, registration_plate: '10-D-1234' }, market, criteria);
  assert.equal(result.facts.yearMin, 2010);
  assert.deepEqual(result.facts.plate, { year: 2010, half: undefined, county: 'Dublin' });
  assert.equal(result.privatePlate, '10D1234');
});

test('rank: damaged or expired-NCT cars go to cheap-for-a-reason, not the main lists', () => {
  const market = syntheticMarket();
  const model = (ad, extra = {}) => ({ ...keywordClassification(ad), keyword_only: false, confidence: 0.9, condition_flags: [], ...extra });
  const damaged = listing({ priceEur: 900, description: 'Damaged but drives.' });
  assert.equal(assess(damaged, model(damaged, { condition_flags: ['accident_damage'] }), market, criteria).verdict, 'project');
  const expired = listing({ priceEur: 1500, description: 'Good car.', nctExpiry: 'May 2026' });
  const result = assess(expired, model(expired), market, criteria);
  assert.equal(result.verdict, 'project');
  assert.deepEqual(result.reasons, ['no valid NCT']);
});

test('rank: a ready, fairly priced car outranks a suspiciously cheap one with no NCT date', () => {
  const market = syntheticMarket();
  const model = (ad) => ({ ...keywordClassification(ad), keyword_only: false, confidence: 0.9, condition_flags: [] });
  const value = estimate(market, { make: 'Volkswagen', model: 'Passat', year: 2012, mileageKm: 180_000 }).expectedEur;
  const ready = listing({ id: 'r', priceEur: Math.round(value * 0.8), nctExpiry: 'Oct 2027', description: 'Full service history, timing belt done.' });
  const cheap = listing({ id: 'c', priceEur: Math.round(value * 0.35), description: 'Quick sale.' });
  const a = assess(ready, model(ready), market, criteria);
  const b = assess(cheap, model(cheap), market, criteria);
  assert.ok(a.score > b.score, `${a.score} vs ${b.score}`);
  assert.ok(b.cautions.some((x) => x.includes('ask why')));
  const lists = rankAssessments([b, a]);
  assert.equal(lists.confident[0].id, 'r');
});

test('rank: more than 5% above the range is rejected; an NCT expired this month moves a car to the project list', async () => {
  const { applyOfficialRecord } = await import('../src/rank.mjs');
  const market = syntheticMarket();
  const model = (ad) => ({ ...keywordClassification(ad), keyword_only: false, confidence: 0.9, condition_flags: [] });
  const value = estimate(market, { make: 'Volkswagen', model: 'Passat', year: 2012, mileageKm: 180_000 });
  const pricey = listing({ priceEur: Math.round(value.rangeEur.high * 1.06), description: 'x' });
  assert.equal(assess(pricey, model(pricey), market, criteria).verdict, 'rejected');
  const ok = listing({ priceEur: Math.round(value.expectedEur * 0.8), description: 'Runs well.' });
  const find = assess(ok, model(ok), market, criteria);
  applyOfficialRecord(find, { make: 'VOLKSWAGEN', model: 'PASSAT', nctExpiry: '2026-11-03' }, new Date('2026-11-10'));
  assert.equal(find.verdict, 'project');
  assert.deepEqual(find.reasons, ['NCT expired on 2026-11-03 (official record)']);
});

test('rank: a mileage suspicion makes a find uncertain, not rejected', () => {
  const market = syntheticMarket();
  const ad = listing({ priceEur: 2000, nctExpiry: 'Oct 2027', description: 'UK import, timing belt at 110,000 miles.' });
  const result = assess(ad, { ...keywordClassification(ad), keyword_only: false, confidence: 0.9, condition_flags: ['clocked_mileage_suspected'] }, market, criteria);
  assert.equal(result.verdict, 'uncertain');
  assert.ok(result.reasons.includes('mileage may be inconsistent: check the NCT history'));
});
