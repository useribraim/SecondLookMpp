import { plausibleMileage } from './valuation.mjs';
import { KM_PER_MILE, listing, parsePriceEur } from './listing.mjs';

// DoneDeal collector. Uses the same public JSON search endpoint as the DoneDeal web page.
// No account and no browser. Requests are sequential and rate limited.

const ENDPOINT = 'https://www.donedeal.ie/ddapi/v1/search';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const PAGE_SIZE = 40; // The endpoint returns at most 40 ads for one page.
const REQUEST_INTERVAL_MS = 600;
// Sections outside "cars" where a usable car can appear under a different label.
export const ADJACENT_SECTIONS = ['damagedcars', 'vintagecars', 'commercials'];

const DETAIL_INTERVAL_MS = 1_200;
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000];
const CACHE_TTL_MS = 30 * 60_000;
const searchCache = new Map();

let lastRequestAt = 0;
let cooldownUntil = 0; // after a 429, every DoneDeal request waits until this time
const counters = { requests: 0, rateLimited: 0 };
const detailCache = new Map(); // ad URL -> { at, value }

export function doneDealStats() {
  return { ...counters };
}

// Adaptive spacing: each 429 doubles the spacing (up to 3 s); it halves again after a quiet minute.
let slowdown = 1;
let lastRateLimitAt = 0;
function spacing(interval) {
  if (slowdown > 1 && Date.now() - lastRateLimitAt > 60_000) {
    slowdown = Math.max(1, slowdown / 2);
    lastRateLimitAt = Date.now();
  }
  return Math.min(interval * slowdown, 3_000);
}

async function pause(interval = REQUEST_INTERVAL_MS) {
  for (;;) {
    const wait = Math.max(lastRequestAt + spacing(interval), cooldownUntil) - Date.now();
    if (wait <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  lastRequestAt = Date.now();
}

// Sequential request with spacing, and backoff when DoneDeal answers 429 or 5xx.
async function politeFetch(url, init, { fetchImpl = fetch, interval } = {}) {
  for (let attempt = 0; ; attempt++) {
    await pause(interval);
    counters.requests += 1;
    const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(20_000) });
    const retryable = response.status === 429 || response.status >= 500;
    if (response.status === 429) {
      counters.rateLimited += 1;
      slowdown = Math.min(slowdown * 2, 8);
      lastRateLimitAt = Date.now();
    }
    if (!retryable || attempt >= RETRY_DELAYS_MS.length) return response;
    const retryAfter = Number(response.headers.get('retry-after')) * 1000;
    const delay = retryAfter > 0 && retryAfter <= 60_000 ? retryAfter : RETRY_DELAYS_MS[attempt];
    // A rate limit applies to all our requests, so all of them wait, not only this one.
    if (response.status === 429) cooldownUntil = Math.max(cooldownUntil, Date.now() + delay);
    else await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

export async function searchPage(body, { fetchImpl } = {}) {
  const key = JSON.stringify(body);
  const cached = searchCache.get(key);
  if (cached && cached.at > Date.now() - CACHE_TTL_MS) return cached.value;
  const response = await politeFetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': USER_AGENT },
    body: key,
  }, { fetchImpl });
  if (!response.ok) throw new Error(`DoneDeal search returned HTTP ${response.status}`);
  const data = await response.json();
  const ads = data?.ads ?? [];
  const paging = data?.paging;
  const total = paging?.totalResults;
  const from = body.paging?.from ?? 0;
  // DoneDeal omits ads on a genuine zero-result page, but still declares a total.
  if (!Number.isInteger(total) || total < 0 || !Array.isArray(ads) ||
      (ads.length === 0 && total > from) || (ads.length > 0 && total === 0)) {
    throw new Error('DoneDeal did not return a complete search response');
  }
  const value = { ads, paging };
  searchCache.set(key, { at: Date.now(), value });
  return value;
}

export async function searchAll(body, { limit = 400, fetchImpl } = {}) {
  const ads = [];
  let from = 0;
  let total = 0;
  while (ads.length < limit) {
    const page = await searchPage({ ...body, paging: { pageSize: PAGE_SIZE, from } }, { fetchImpl });
    total = page.paging.totalResults ?? total;
    ads.push(...page.ads);
    if (!page.paging.nextFrom || page.ads.length === 0) break;
    if (!Number.isInteger(page.paging.nextFrom) || page.paging.nextFrom <= from) {
      throw new Error('DoneDeal search returned invalid pagination');
    }
    from = page.paging.nextFrom;
  }
  return { ads: ads.slice(0, limit), total };
}

function number(value) {
  if (value === undefined || value === null) return undefined;
  const digits = String(value).replace(/[^\d]/g, '');
  return digits ? Number(digits) : undefined;
}

// Read the description and dates from one ad page. The page embeds its data as JSON.
// The ad page's embedded data has the same shape as a search result, plus the description.
// One ad: the site's own JSON endpoint (about 150 KB) first; the HTML page (about 1 MB) as a fallback.
// Both return the same fields: header, description, dates, displayAttributes, photos.
export async function fetchAdPage(url, { fetchImpl = fetch } = {}) {
  if (!/^https:\/\/www\.donedeal\.ie\//.test(url)) throw new Error('Not a DoneDeal ad URL');
  const id = url.match(/\/(\d+)\/?(?:[?#].*)?$/)?.[1];
  if (id) {
    const response = await politeFetch(`https://www.donedeal.ie/ddapi/v1/listings/${id}`, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } }, { fetchImpl });
    if (response.ok) return response.json();
  }
  const response = await politeFetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html' } }, { fetchImpl, interval: DETAIL_INTERVAL_MS });
  if (!response.ok) throw new Error(`DoneDeal ad page returned HTTP ${response.status}`);
  const html = await response.text();
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('DoneDeal ad page has no embedded data');
  return JSON.parse(match[1]).props?.pageProps ?? {};
}

export async function fetchDetail(url, options = {}) {
  const cached = detailCache.get(url);
  if (cached && cached.at > Date.now() - CACHE_TTL_MS) return cached.value;
  const value = await readDetail(url, options);
  detailCache.set(url, { at: Date.now(), value });
  return value;
}

async function readDetail(url, options) {
  const page = await fetchAdPage(url, options);
  return {
    description: typeof page.description === 'string' ? redactContacts(page.description).slice(0, 4000) : null,
    firstPublishedAt: page.firstPublishDate ? new Date(page.firstPublishDate).toISOString() : undefined,
    updatedAt: page.lastUpdateDate ? new Date(page.lastUpdateDate).toISOString() : undefined,
    state: page.state,
  };
}

// Remove phone numbers and e-mail addresses: the report does not need seller contact data.
export function redactContacts(text) {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email removed]')
    .replace(/(\+?\d[\d\s-]{7,}\d)/g, '[phone removed]');
}

function adText(value) {
  return typeof value === 'string' ? value.trim() || null : null;
}

function adMileage(ad, attributes) {
  const km = number(ad.mileageInKm);
  if (km > 0) return km;
  const match = /^(\d{1,3}(?:[,.\s]\d{3})+|\d+)\s*(km|kms|kilomet(?:er|re)s?|miles?|mi)?$/i.exec(adText(attributes.mileage) ?? '');
  if (!match) return null;
  const distance = number(match[1]);
  return distance > 0 ? Math.round(distance * (/^mi/i.test(match[2] ?? '') ? KM_PER_MILE : 1)) : null;
}

function engineLitres(value) {
  const match = /^(\d+(?:[.,]\d+)?)\s*(l|litres?|cc|cm³)?$/i.exec(adText(value) ?? '');
  if (!match) return null;
  const capacity = Number(match[1].replace(',', '.'));
  return capacity > 0 ? capacity / (/^(cc|cm³)$/i.test(match[2] ?? '') ? 1_000 : 1) : null;
}

/** @returns {import('./listing.mjs').Listing} */
export function parseDoneDealAd(ad) {
  const attributes = Object.fromEntries((ad.displayAttributes ?? []).map((item) => [item.name, item.value]));
  const photos = (ad.photos ?? []).slice(0, 6)
    .map((photo) => adText(typeof photo === 'string' ? photo : photo?.medium ?? photo?.large ?? photo?.small)).filter(Boolean);
  const section = adText(ad.section?.name ?? ad.section);
  const relativeUrl = adText(ad.relativeUrl);
  return listing({
    source: 'donedeal',
    id: ad.id == null ? null : `donedeal:${ad.id}`,
    url: adText(ad.friendlyUrl) ?? (relativeUrl?.startsWith('/') ? `https://www.donedeal.ie${relativeUrl}` : null),
    title: adText(ad.header) ?? adText(ad.title),
    description: adText(ad.description) ? redactContacts(ad.description).slice(0, 4000) : null,
    section,
    rawCategory: ad.category ?? ad.section ?? null,
    priceEur: parsePriceEur(ad.priceEuro) ?? parsePriceEur(ad.price),
    county: adText(ad.county)?.replace(/^Co\.\s*/i, ''),
    make: adText(attributes.make),
    model: adText(attributes.model),
    year: number(attributes.year) || null,
    mileageKm: adMileage(ad, attributes),
    fuel: adText(attributes.fuelType),
    transmission: adText(attributes.transmission),
    engineL: engineLitres(attributes.engine),
    owners: number(attributes.owners) ?? null,
    nctExpiry: adText(attributes.NCTExpiry),
    photos: photos.length ? photos : null,
  });
}

export function normalizeAd(ad, origin) {
  const parsed = parseDoneDealAd(ad);
  const attributes = Object.fromEntries((ad.displayAttributes ?? []).map((item) => [item.name, item.value]));
  return {
    ...parsed,
    origin,
    // The collector also filters out implausibly low odometer readings.
    mileageKm: plausibleMileage(parsed.mileageKm, parsed.year) ?? null,
    engine: attributes.engine,
    bodyType: attributes.bodyType,
    trim: attributes.trim,
    seats: number(attributes.seats),
    sellerType: ad.dealerId ? 'dealer' : 'private',
    publishedAt: ad.publishDate ? new Date(ad.publishDate).toISOString() : undefined,
  };
}

function baseFilters(criteria) {
  const ranges = [{ name: 'price', from: String(criteria.priceMinEur), to: String(criteria.priceMaxEur) }];
  const filters = criteria.county ? [{ name: 'area', values: [criteria.county] }] : [];
  return { ranges, filters };
}

function doneDealVehicle(vehicle) {
  // DoneDeal's catalog uses a hyphen in BMW series names.
  const series = /^([1-8])[-\s]+series$/i.exec(vehicle.model ?? '');
  return vehicle.make.toLowerCase() === 'bmw' && series
    ? { ...vehicle, model: `${series[1]}-Series` }
    : vehicle;
}

// What the site's own filter returns for the buyer's criteria.
export async function collectExact(criteria, options = {}) {
  const results = [];
  let siteFilterTotal = 0;
  for (const vehicle of criteria.vehicles) {
    const { ranges, filters } = baseFilters(criteria);
    ranges.push({ name: 'year', from: String(criteria.yearFrom), to: String(criteria.yearTo) });
    if (criteria.mileageMaxKm) ranges.push({ name: 'mileage', from: '0', to: String(criteria.mileageMaxKm) });
    const body = { sections: ['cars'], makeModelFilters: [doneDealVehicle(vehicle)], ranges, filters };
    const { ads, total } = await searchAll(body, { limit: options.limit ?? 200, ...options });
    siteFilterTotal += total;
    results.push(...ads.map((ad) => normalizeAd(ad, 'exact')));
  }
  return { listings: results, siteFilterTotal };
}

// Keyword search in sections that the site's car filter does not cover.
export async function collectAdjacent(criteria, options = {}) {
  const results = [];
  for (const vehicle of criteria.vehicles) {
    const terms = [vehicle.make, vehicle.model].filter(Boolean).join(' ');
    for (const section of ADJACENT_SECTIONS) {
      const { ranges, filters } = baseFilters(criteria);
      const { ads } = await searchAll({ sections: [section], terms, ranges, filters }, { limit: options.limit ?? 80, ...options });
      results.push(...ads.map((ad) => normalizeAd(ad, 'adjacent')));
    }
  }
  return { listings: results };
}

// Market data for valuation: the same models over a wider year and price range, all of Ireland.
export async function collectComparables(criteria, options = {}) {
  const results = [];
  for (const vehicle of criteria.vehicles) {
    const ranges = [
      { name: 'year', from: String(criteria.yearFrom - 2), to: String(criteria.yearTo + 2) },
      { name: 'price', from: '300', to: String(Math.max(criteria.priceMaxEur * 3, 15_000)) },
    ];
    const { ads } = await searchAll({ sections: ['cars'], makeModelFilters: [doneDealVehicle(vehicle)], ranges }, { limit: options.limit ?? 400, ...options });
    results.push(...ads.map((ad) => normalizeAd(ad, 'comparable')));
  }
  return { listings: results };
}
