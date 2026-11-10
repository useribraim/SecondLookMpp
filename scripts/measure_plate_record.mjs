// Measure how often plate reading plus the official vehicle record gives a real disagreement with an ad.
// Usage: node --env-file=.env scripts/measure_plate_record.mjs [<ad URL> ...]
// With no URL, the script runs a few small DoneDeal searches and takes up to 12 ads.
// Two readings per ad: "text" (what the service does for DoneDeal today: ad text only, no photos)
// and "photo" (the same classifier with the first three ad photos attached).
// Output: JSON on stdout. Plates are masked: the last three characters are replaced by ***.
import { validateCriteria } from '../src/criteria.mjs';
import { searchPage, fetchAdPage, normalizeAd, redactContacts } from '../src/donedeal.mjs';
import { classifyListing, classifierProvider, CLASSIFIER_MODEL } from '../src/classifier.mjs';
import { decodeIrishPlate } from '../src/plates.mjs';
import { lookupVehicle, compareRecord } from '../src/vehicle_record.mjs';

const MAX_ADS = 12;
const BROWSER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const MAKES = ['Toyota', 'Ford', 'Volkswagen', 'Nissan', 'Hyundai', 'Audi'];

const mask = (plate) => (plate ? `${plate.slice(0, -3)}***` : null);
const today = new Date().toISOString().slice(0, 10);
const criteria = validateCriteria({ vehicles: [{ make: 'Toyota', model: 'Corolla' }], yearFrom: 2008, yearTo: 2019, priceMaxEur: 30000 });

let blocked = 0;
function noteBlock(error) {
  if (/HTTP (403|429)/.test(String(error?.message))) blocked += 1;
  if (blocked >= 2) throw new Error('Stopped: DoneDeal answered 403 or 429 repeatedly');
}

async function chooseAds() {
  const picked = [];
  for (const make of MAKES) {
    try {
      const page = await searchPage({ sections: ['cars'], makeModelFilters: [{ make }], ranges: [{ name: 'year', from: '2008', to: '2019' }], paging: { pageSize: 40, from: 0 } });
      const ads = page.ads.filter((ad) => Number(ad.mediaCount ?? 0) >= 3 && ad.friendlyUrl);
      const dealer = ads.filter((ad) => ad.dealerId);
      const priv = ads.filter((ad) => !ad.dealerId);
      for (const ad of [priv[3], dealer[3], priv[7], dealer[7]].filter(Boolean).slice(0, 2)) picked.push(ad.friendlyUrl);
    } catch (error) { noteBlock(error); console.error(`search ${make} failed: ${error.message}`); }
  }
  return picked.slice(0, MAX_ADS);
}

function textPlate(text) {
  const candidates = text.match(/\b\d{2,3}\s?-?\s?[A-Z]{1,2}\s?-?\s?\d{1,6}\b/gi) ?? [];
  for (const candidate of candidates) { const decoded = decodeIrishPlate(candidate); if (decoded) return decoded.plate; }
  return undefined;
}

async function photoFetch(url, init) {
  return fetch(url, { ...init, headers: { 'user-agent': BROWSER_AGENT, referer: 'https://www.donedeal.ie/' } });
}

const urls = process.argv.length > 2 ? process.argv.slice(2, 2 + MAX_ADS) : await chooseAds();
console.error(`provider ${classifierProvider()}, model ${CLASSIFIER_MODEL}, ads ${urls.length}`);
const rows = [];
let lookups = 0;

for (const url of urls) {
  const row = { url, errors: [] };
  const started = Date.now();
  try {
    let page;
    try { page = await fetchAdPage(url); } catch (error) { noteBlock(error); throw error; }
    const listing = normalizeAd({ ...page, friendlyUrl: url }, 'exact');
    listing.description = page.description ? redactContacts(page.description).slice(0, 4000) : undefined;
    const photoUrls = (page.photos ?? []).slice(0, 3).map((p) => p.large ?? p.medium ?? p.small).filter(Boolean);
    row.seller = listing.sellerType;
    row.ad = { make: listing.make, model: listing.model, year: listing.year, nctExpiry: listing.nctExpiry ?? null, title: listing.title };
    const fullText = `${listing.title}\n${page.description ?? ''}`;
    const textRegex = textPlate(fullText);

    // Reading 1: text only (the service's DoneDeal path today).
    const t1 = Date.now();
    const textOutcome = await classifyListing(listing, criteria).catch((error) => ({ error: String(error?.message ?? error) }));
    row.textMs = Date.now() - t1;
    const textPlateRead = decodeIrishPlate(textOutcome.result?.registration_plate ?? undefined)?.plate ?? textRegex;
    if (textOutcome.error) row.errors.push(`text classify: ${textOutcome.error}`);

    // Reading 2: the first three photos attached.
    const t2 = Date.now();
    const photoListing = { ...listing, source: 'donedeal-photos', photos: photoUrls };
    const photoOutcome = await classifyListing(photoListing, criteria, { fetchImpl: photoFetch }).catch((error) => ({ error: String(error?.message ?? error) }));
    row.photoMs = Date.now() - t2;
    row.photosRead = photoOutcome.photosRead ?? 0;
    const photoPlateRead = decodeIrishPlate(photoOutcome.result?.registration_plate ?? undefined)?.plate;
    if (photoOutcome.error) row.errors.push(`photo classify: ${photoOutcome.error}`);

    const plate = textPlateRead ?? photoPlateRead;
    row.plate = mask(plate);
    row.plateFrom = textPlateRead ? (textRegex ? 'text' : 'text (classifier)') : photoPlateRead ? 'photo' : 'none';
    row.textReading = mask(textPlateRead) ?? null;
    row.photoReading = mask(photoPlateRead) ?? null;
    row.photoAgreesWithText = textPlateRead && photoPlateRead ? textPlateRead === photoPlateRead : null;

    if (plate && lookups < 12) {
      const decoded = decodeIrishPlate(plate);
      try {
        lookups += 1;
        const record = await lookupVehicle(plate);
        row.record = record ? { make: record.make, model: record.model, nctExpiry: record.nctExpiry ?? null, nctStatus: record.nctStatus ?? null, taxExpiry: record.taxExpiry ?? null, taxStatus: record.taxStatus ?? null } : null;
        row.recordFound = Boolean(record);
        if (record) {
          const disagreements = [];
          const check = compareRecord(record, { make: listing.make, model: listing.model }, today);
          if (check.mismatch) disagreements.push(`make/model: ad says ${listing.make} ${listing.model}; ${check.mismatch}`);
          if (decoded && listing.year && decoded.year !== listing.year) disagreements.push(`year: ad says ${listing.year}; plate says ${decoded.year}`);
          if (record.nctExpiry && record.nctExpiry < today) disagreements.push(`NCT expired ${record.nctExpiry} (ad NCT field: ${listing.nctExpiry ?? 'none'})`);
          else if (record.nctExpiry && listing.nctExpiry) disagreements.push(`NCT date check needed: ad ${listing.nctExpiry}, record ${record.nctExpiry}`);
          if (record.taxExpiry && record.taxExpiry < today) disagreements.push(`motor tax expired ${record.taxExpiry}`);
          row.disagreements = disagreements;
        }
      } catch (error) { row.errors.push(`lookup: ${error.message}`); }
    }
  } catch (error) {
    row.errors.push(error.message);
    if (/^Stopped/.test(error.message)) { row.seconds = Math.round((Date.now() - started) / 100) / 10; rows.push(row); break; }
  }
  row.seconds = Math.round((Date.now() - started) / 100) / 10;
  rows.push(row);
  console.error(`done ${url} ${row.seconds}s plate ${row.plate} from ${row.plateFrom}`);
}
console.log(JSON.stringify({ at: new Date().toISOString(), model: CLASSIFIER_MODEL, provider: classifierProvider(), lookups, rows }, null, 2));
