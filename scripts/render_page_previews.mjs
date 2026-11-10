// Write static HTML previews of the landing page and the report page states to .private/previews/.
// Usage: node scripts/render_page_previews.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { landingPage, reportPage, EXAMPLE } from '../src/pages.mjs';

const directory = fileURLToPath(new URL('../.private/previews/', import.meta.url));
const origin = 'https://cars.example.test';

const photo = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="264" height="198"><rect width="264" height="198" fill="#3a4a5a"/><circle cx="132" cy="99" r="40" fill="#8aa"/></svg>')}`;
const comparable = (n) => ({ url: `https://www.donedeal.ie/cars-for-sale/example/${n}`, year: 2010 + (n % 3), mileageKm: 140000 + n * 7000, priceEur: 3100 + n * 150 });
const valuation = (price, expected) => ({
  method: 'regression', comparables: 24, expectedEur: expected, discount: 1 - price / expected,
  rangeEur: { low: Math.round(expected * 0.85), high: Math.round(expected * 1.12) }, examples: [1, 2, 3].map(comparable),
});
const find = (overrides) => ({
  id: 'x', source: 'donedeal', url: 'https://www.donedeal.ie/cars-for-sale/example/1', title: 'Example',
  priceEur: 3500, county: 'Dublin', photo,
  facts: { make: 'Volkswagen', model: 'Passat', yearMin: 2011, yearMax: 2011, mileageKm: 168000, seats: 5, nctExpiry: 'Jul 2027' },
  valuation: valuation(3500, 3939), condition: { flags: [], summary: 'No faults mentioned in the text; photos show a clean interior.' },
  verdict: 'confident', reasons: [], score: 0.4, ...overrides,
});
const done = {
  id: 'preview-done', state: 'done', report: {
    criteria: { ...EXAMPLE, mileageMaxKm: 200000, seatsMin: 5 }, generatedAt: '2026-11-10T09:30:00Z', elapsedMs: 94000, inspected: 63, rejectedCount: 41,
    cachedFrom: new Date(Date.now() - 4 * 60000).toISOString(), sharedWithIdenticalSearch: true,
    warnings: ['3 DoneDeal ad pages could not be read; those finds are marked uncertain.', 'Used a keyword check without photo inspection.'],
    shortlist: ['a', 'b', 'c'],
    confident: [
      find({ id: 'a', condition: { flags: ['needs_minor_work', 'import'], summary: 'Ad mentions a small dent and UK import.' }, official: { make: 'VOLKSWAGEN', model: 'PASSAT', colour: 'SILVER', nctExpiry: '2027-07-14', taxExpiry: '2026-12-31' }, facts: { make: 'Volkswagen', model: 'Passat', yearMin: 2011, yearMax: 2011, mileageKm: 168000, seats: 5, nctExpiry: 'Jul 2027', plate: { year: 2011, half: 2, county: 'Dublin' } }, nextStep: { label: 'Worth a call', checks: ['Confirm it is still available and ask for service records before arranging a viewing.'] } }),
      find({ id: 'b', url: 'https://www.facebook.com/marketplace/item/1', source: 'facebook', title: 'A very long title that does not break anywhere ' + 'Superlongunbrokenwordwithoutanyspaces'.repeat(4), facts: { make: 'Skoda', model: 'Octavia Combi Elegance 2.0 TDI CR 140 bhp DSG Estate Executive Pack Sat Nav', yearMin: 2012, yearMax: 2013, mileageKm: 1234567, seats: 5 }, county: 'Dún Laoghaire-Rathdown', priceEur: 5995, foundOutsideSiteFilter: true, cautions: ['NCT date not stated: ask the seller', 'price is 58% below similar listings: ask why'], valuation: valuation(5995, 5800) }),
      find({ id: 'c', photo: undefined, valuation: undefined, valuationNote: 'No asking-price comparison. Too few closely matched ads or insufficient vehicle details.', priceEur: undefined, facts: { make: 'Skoda', model: 'Octavia', mileageKm: undefined }, notes: 'Mileage reading is unclear in the photo.' }),
      find({ id: 'd', facts: { make: 'Volkswagen', model: 'Passat', yearMin: 2010, yearMax: 2010, mileageKm: 150000 }, valuation: { method: 'median-of-year', comparables: 5, expectedEur: 3600, discount: 0.03 } }),
    ],
    uncertain: [find({ id: 'e', verdict: 'uncertain', reasons: ['mileage not stated', 'year only known as 2010-2012', 'ad text could not be read; faults may be missed'], condition: { flags: ['clocked_mileage_suspected', 'high_mileage'], summary: 'Mileage may be inconsistent.' } }), find({ id: 'f', verdict: 'uncertain', photo: undefined, reasons: ['asking price not stated'], priceEur: undefined, valuation: undefined })],
    cheapForAReason: [find({ id: 'g', verdict: 'project', reasons: ['damage stated', 'NCT expired on 2026-02-01 (official record)'], condition: { flags: ['accident_damage', 'no_nct'], summary: 'Front-end damage stated.' }, priceEur: 900, valuation: valuation(900, 3939) })],
  },
};
const failed = {
  id: 'preview-failed', state: 'failed', progress: 'Facebook Marketplace collection failed', criteria: done.report.criteria,
  error: 'no source returned listings (Facebook Marketplace collection failed: browser session expired; sign in again.)',
  refund: { state: 'sent', hash: '0x' + 'ab12'.repeat(16) },
};
const running = {
  id: 'preview-running', state: 'running', progress: 'reading Facebook Marketplace ads (12 of 30)', queuePosition: 0, liveView: true,
  criteria: { ...EXAMPLE, vehicles: [{ make: 'Volkswagen', model: 'Passat' }, { make: 'Skoda', model: 'Octavia' }, { make: 'Toyota', model: 'Corolla Verso' }] },
};
const pages = {
  'landing.html': landingPage({ origin, price: '0.05', queueLength: 2, completed: 118, refunded: 3, facebookEnabled: true, classifierEnabled: false }),
  'report-running.html': reportPage(running),
  'report-failed.html': reportPage(failed),
  'report-done.html': reportPage(done),
};
await mkdir(directory, { recursive: true });
for (const [name, html] of Object.entries(pages)) await writeFile(directory + name, html);
console.log(`wrote ${Object.keys(pages).length} files to ${directory}`);
