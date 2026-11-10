import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDoneDealAd } from '../src/donedeal.mjs';
import { listing } from '../src/listing.mjs';
import { buildMarket, valueListing } from '../src/valuation.mjs';

// Synthetic saved fixtures in the collector's observed input shape.
const rawAds = JSON.parse(readFileSync(new URL('./fixtures/donedeal-ads.json', import.meta.url)));
test('DoneDeal parser normalises prices, miles and missing values, and retains the category', () => {
  const [first, imported, commercial, sparse, noPrice, damaged] = rawAds.map(parseDoneDealAd);
  assert.deepEqual(first, {
    source: 'donedeal', id: 'donedeal:101', url: 'https://www.donedeal.ie/cars-for-sale/passat/101', title: 'Volkswagen Passat',
    make: 'Volkswagen', model: 'Passat', year: 2012, mileageKm: 180000, fuel: 'Diesel', transmission: 'Manual',
    engineL: 2, owners: 2, nctExpiry: 'Oct 2027', county: 'Dublin', priceEur: 8500,
    photos: ['https://example.test/passat.jpg'], description: null, section: 'cars', rawCategory: { name: 'cars' },
  });
  assert.equal(imported.priceEur, 8500);
  assert.equal(imported.mileageKm, 160934);
  assert.equal(imported.engineL, 1.598);
  assert.equal(imported.url, 'https://www.donedeal.ie/cars-for-sale/octavia/102');
  assert.equal(commercial.section, 'commercials');
  assert.deepEqual(commercial.rawCategory, { name: 'Commercial Vehicles' });
  assert.equal(commercial.priceEur, 2000);
  assert.equal(commercial.mileageKm, 110200);
  assert.deepEqual(sparse, listing({ source: 'donedeal', id: 'donedeal:104' }));
  assert.equal(noPrice.priceEur, null);
  assert.equal(noPrice.photos, null);
  assert.equal(noPrice.mileageKm, null);
  assert.equal(damaged.rawCategory, 'damagedcars');
  assert.equal(damaged.priceEur, 950.5);
  assert.equal(damaged.description, 'Email [email removed] for details');
});

const car = (id, make, model, year, mileageKm, priceEur) =>
  listing({ source: 'donedeal', id, make, model, year, mileageKm, priceEur });
const passat = car('passat', 'Volkswagen', 'Passat', 2012, 180000, 4100);
const octavia = car('octavia', 'Skoda', 'Octavia', 2014, 150000, 6000);
const fiesta = car('fiesta', 'Ford', 'Fiesta', 2018, 90000, 5500);
const market = buildMarket([
  passat, octavia, fiesta,
  ...[
    [2011, 150000, 4500], [2013, 210000, 5000], [2012, 180000, 6000], [2012, 181000, 6500], [2012, 185000, 7500],
    [2010, 180000, 1000], [2012, 210001, 15000], [2014, 180000, 20000],
    [2015, 180000, 100], [2012, 240001, 100],
  ].map(([year, km, price], i) => car(`p${i}`, 'Volkswagen', 'Passat', year, km, price)),
  ...[
    [2013, 120000, 4100], [2014, 140000, 5100], [2015, 150000, 6100], [2014, 180000, 7100],
    [2012, 90000, 8100], [2016, 210000, 9100], [2017, 150000, 100], [2014, 210001, 100],
  ].map(([year, km, price], i) => car(`o${i}`, 'Skoda', 'Octavia', year, km, price)),
  ...[
    [2017, 85000, 4000], [2018, 90000, 5000], [2020, 150000, 6000], [2021, 90000, 100],
  ].map(([year, km, price], i) => car(`f${i}`, 'Ford', 'Fiesta', year, km, price)),
  ...['Golf', 'Polo', 'Touran', 'Jetta', 'Arteon', 'Tiguan', 'Up'].map((model, i) =>
    car(`d${i}`, 'Volkswagen', model, 2012, 180000, 99)),
  car('p0', 'Volkswagen', 'Passat', 2011, 150000, 1), // repeated ad ID
]);

test('valuation scores against a fixed 32-listing market, excludes self and widens once', () => {
  assert.deepEqual(valueListing(market, passat), {
    fairPrice: 6000, deltaEur: 1900, deltaPct: 31.67, compCount: 5, confidence: 'confident',
    rangeEur: { low: 5000, high: 6500 }, examples: [], reason: '€1,900 under the median of 5 similar Volkswagen Passat ads',
  });
  assert.deepEqual(valueListing(market, octavia), {
    fairPrice: 6600, deltaEur: 600, deltaPct: 9.09, compCount: 6, confidence: 'confident',
    rangeEur: { low: 5350, high: 7850 }, examples: [], reason: '€600 under the median of 6 similar Skoda Octavia ads',
  });
  const thin = valueListing(market, fiesta);
  assert.equal(thin.compCount, 3);
  assert.equal(thin.fairPrice, 5000);
  assert.equal(thin.deltaEur, -500);
  assert.equal(thin.deltaPct, -10);
  assert.equal(thin.confidence, 'uncertain');
  assert.match(thin.reason, /€500 over.*small sample/);
  const inferred = valueListing(market, passat, { inferredIdentity: true });
  assert.equal(inferred.confidence, 'uncertain');
  assert.equal(inferred.compCount, 5);
  assert.match(inferred.reason, /inferred/);
  const unknown = valueListing(market, { ...passat, mileageKm: null });
  assert.equal(unknown.fairPrice, null);
  assert.equal(unknown.compCount, 0);
  assert.equal(unknown.confidence, 'uncertain');
});
