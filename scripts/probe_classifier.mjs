// Classify a few real DoneDeal ads and print the result, to check the classifier end to end.
// Usage: node scripts/probe_classifier.mjs <ad URL> [<ad URL> ...]
import { validateCriteria } from '../src/criteria.mjs';
import { fetchAdPage, normalizeAd, redactContacts } from '../src/donedeal.mjs';
import { classifyListing, classifierProvider, CLASSIFIER_MODEL } from '../src/classifier.mjs';

const criteria = validateCriteria({ vehicles: [{ make: 'Volkswagen', model: 'Passat' }, { make: 'Skoda', model: 'Octavia' }], yearFrom: 2007, yearTo: 2015, priceMaxEur: 6000 });
console.log(`provider ${classifierProvider()}, model ${CLASSIFIER_MODEL}`);

for (const url of process.argv.slice(2)) {
  const page = await fetchAdPage(url);
  const listing = normalizeAd({ ...page, friendlyUrl: url }, 'exact');
  listing.description = page.description ? redactContacts(page.description).slice(0, 4000) : undefined;
  const started = Date.now();
  const outcome = await classifyListing(listing, criteria);
  console.log(`\n${url}\n  ${Date.now() - started} ms, photos read ${outcome.photosRead ?? 0}, usage ${JSON.stringify(outcome.usage ?? {})}`);
  console.log(outcome.error ? `  ERROR ${outcome.error}` : JSON.stringify(outcome.result, null, 2).replace(/^/gm, '  '));
}
