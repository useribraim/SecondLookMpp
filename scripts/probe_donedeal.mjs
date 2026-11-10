// Run the DoneDeal collector and valuation for one sample search, without payment or classification.
import { validateCriteria } from '../src/criteria.mjs';
import { collectExact, collectAdjacent, collectComparables } from '../src/donedeal.mjs';
import { buildMarket, estimate, discount } from '../src/valuation.mjs';

const criteria = validateCriteria(JSON.parse(process.argv[2] ?? JSON.stringify({
  vehicles: [{ make: 'Volkswagen', model: 'Passat' }, { make: 'Skoda', model: 'Octavia' }],
  yearFrom: 2007, yearTo: 2015, priceMaxEur: 6000, sources: ['donedeal'],
})));

const started = Date.now();
const exact = await collectExact(criteria);
const adjacent = await collectAdjacent(criteria);
const comparables = await collectComparables(criteria);
const market = buildMarket(comparables.listings);

for (const [key, entry] of market) {
  console.log(key, 'unique ads with mileage', entry.listings.length);
}

const scored = exact.listings.map((listing) => {
  const valuation = estimate(market, listing);
  return { ...listing, valuation, discount: discount(listing.priceEur, valuation) };
}).filter((listing) => listing.discount !== undefined).sort((a, b) => b.discount - a.discount);

console.log(`\nsite filter total ${exact.siteFilterTotal}, collected ${exact.listings.length}, adjacent ${adjacent.listings.length}, valued ${scored.length}, ${Date.now() - started} ms`);
for (const l of scored.slice(0, 10)) {
  console.log(`${Math.round(l.discount * 100)}%  €${l.priceEur} vs €${l.valuation.expectedEur} (${l.valuation.method}, n=${l.valuation.comparables})  ${l.year} ${l.make} ${l.model} ${l.mileageKm ?? '?'} km  ${l.county}  ${l.url}`);
}
console.log('\nadjacent sample:');
for (const l of adjacent.listings.slice(0, 10)) console.log(`${l.section}  €${l.priceEur}  ${l.year ?? '?'} ${l.make ?? '?'} ${l.model ?? '?'}  ${l.title}  ${l.url}`);
