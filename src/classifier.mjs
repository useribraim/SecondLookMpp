// Listing classifier: Claude reads the ad text and up to three photos and returns structured facts.
// The model identifies the car and its condition. It does not set the price verdict:
// valuation.mjs compares the price with market data.
import Anthropic from '@anthropic-ai/sdk';

// Provider: the Anthropic API when ANTHROPIC_API_KEY is set; otherwise OpenCode Go, which serves
// Claude Haiku 5.5 through an Anthropic-compatible Messages endpoint.
const OPENCODE_GO_BASE_URL = 'https://opencode.ai/inference/go/anthropic';
export function classifierProvider(env = process.env) {
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) return 'anthropic';
  if (env.OPENCODE_API_KEY) return 'opencode-go';
  return undefined;
}
export const CLASSIFIER_MODEL = process.env.CLASSIFIER_MODEL
  ?? (classifierProvider() === 'opencode-go' ? 'claude-haiku-5-5' : 'claude-opus-5-5');
const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 4_000_000;
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export const CONDITION_FLAGS = [
  'engine_fault', 'gearbox_fault', 'accident_damage', 'spares_or_repair', 'not_running', 'no_nct',
  'nct_failed', 'import', 'high_mileage', 'write_off', 'clocked_mileage_suspected', 'scam_signals',
  'needs_minor_work', 'wanted_ad_not_for_sale', 'parts_only',
];

const nullableString = { type: ['string', 'null'] };
const nullableInteger = { type: ['integer', 'null'] };

export const CLASSIFICATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'is_whole_car_for_sale', 'make', 'model', 'year_min', 'year_max', 'year_evidence', 'mileage_km',
    'mileage_evidence', 'fuel', 'transmission', 'condition_flags', 'condition_summary',
    'matches_criteria', 'confidence', 'uncertainty_reason', 'registration_plate',
  ],
  properties: {
    is_whole_car_for_sale: { type: 'boolean', description: 'False for parts, wheels, wanted ads, services, or other items.' },
    make: nullableString,
    model: nullableString,
    year_min: nullableInteger,
    year_max: nullableInteger,
    year_evidence: { type: 'string', description: 'Where the year comes from: stated field, title, registration plate in a photo, body style generation, or unknown.' },
    mileage_km: nullableInteger,
    mileage_evidence: { type: 'string', description: 'Where the mileage comes from, including miles converted to km, or "not stated".' },
    fuel: nullableString,
    transmission: nullableString,
    condition_flags: { type: 'array', items: { type: 'string', enum: CONDITION_FLAGS } },
    condition_summary: { type: 'string', description: 'One or two plain sentences about condition, faults and history found in the text and photos.' },
    matches_criteria: { type: 'string', enum: ['yes', 'no', 'unclear'] },
    confidence: { type: 'number', description: 'Confidence from 0 to 1 that make, model and year range are correct.' },
    uncertainty_reason: { type: 'string', description: 'What is missing or contradictory. Empty string when nothing is.' },
    registration_plate: { type: ['string', 'null'], description: 'The number plate exactly as readable in a photo or the text, for example "08-D-12345" or "141-KE-4220"; null when no plate is fully readable. Never guess characters.' },
  },
};

const SYSTEM_PROMPT = `You inspect used-car classified ads in Ireland for a buyer.
Identify the car from all evidence: structured fields, title, description, and photos.
Sellers often omit or mislabel the make, model, year and mileage. Use visible evidence such as
badges, body shape, generation-specific lights and grille, and Irish registration plates
(for example "08-D-12345" means 2008, "151-D" means the first half of 2015) to fill gaps.
Say where each fact comes from. Never invent mileage: use null when no source states it.
When sources disagree on the year (for example the stated field says 2014 but the title says 2012),
set year_min and year_max to the year you trust from the title, text or plate, not to the stated field.
Irish sellers often write mileage in thousands: "241" or "241k" on a car older than five years means
241,000 km; report it in full km. This shorthand alone is not evidence of clocked mileage.
Use clocked_mileage_suspected only when sources contradict each other, for example NCT history or
two different readings in the same ad.
Flag faults and risks stated or visible in the ad. Treat phrases like "read ad", "spares or repair",
"needs tow", "no NCT", "engine light", "knocking", "smoke" as condition evidence.
Judge matches_criteria against the buyer's criteria only; ignore price, which is assessed elsewhere.`;

// A slow model call must not hold up the whole report: limit each call and retry once.
// classifyMany turns a failed call into an error result, and the search job then uses the
// keyword check for that one ad (marked uncertain).
const CALL_LIMITS = { timeout: Number(process.env.CLASSIFIER_TIMEOUT_MS ?? 25_000), maxRetries: 1 };

let client;
function anthropic() {
  if (!client) {
    client = classifierProvider() === 'opencode-go'
      ? new Anthropic({
        ...CALL_LIMITS,
        apiKey: process.env.OPENCODE_API_KEY,
        baseURL: OPENCODE_GO_BASE_URL,
        // OpenCode asks clients to name themselves and send a stable session id.
        defaultHeaders: { 'user-agent': 'car-listing-search/0.1', 'x-opencode-session': `car-listing-search-${process.pid}` },
      })
      : new Anthropic(CALL_LIMITS);
  }
  return client;
}

// Server-side refusal fallbacks exist only on the Anthropic API, and not for Haiku models.
function requestExtras() {
  return classifierProvider() === 'anthropic' && !CLASSIFIER_MODEL.includes('haiku')
    ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }
    : {};
}

async function photoBlock(url, fetchImpl) {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return undefined;
    const mediaType = (response.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!PHOTO_TYPES.has(mediaType)) return undefined;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_PHOTO_BYTES) return undefined;
    return { type: 'image', source: { type: 'base64', media_type: mediaType, data: bytes.toString('base64') } };
  } catch {
    return undefined;
  }
}

function describeListing(listing) {
  const facts = {
    source: listing.source, section: listing.section, title: listing.title, priceEur: listing.priceEur,
    county: listing.county, statedMake: listing.make, statedModel: listing.model, statedYear: listing.year,
    statedMileageKm: listing.mileageKm, fuel: listing.fuel, transmission: listing.transmission,
    engine: listing.engine, owners: listing.owners, nctExpiry: listing.nctExpiry, sellerType: listing.sellerType,
  };
  return `Ad facts (JSON, stated by the seller or the site):\n${JSON.stringify(facts)}\n\nDescription:\n${listing.description ?? '(no description collected)'}`;
}

function describeCriteria(criteria) {
  return JSON.stringify({
    vehicles: criteria.vehicles, yearFrom: criteria.yearFrom, yearTo: criteria.yearTo,
    mileageMaxKm: criteria.mileageMaxKm ?? null, fuelTypes: criteria.fuelTypes ?? null,
    requiredEngineSizeInLitresExactly: criteria.engineLitres ?? null,
  });
}

export async function classifyListing(listing, criteria, { fetchImpl = fetch, client: injected } = {}) {
  // Images captured by a collector come first. Photo URLs are fetched only when the source allows it.
  const captured = (listing.images ?? []).slice(0, MAX_PHOTOS).map((image) => ({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } }));
  const downloadable = listing.source === 'donedeal' ? [] : (listing.photos ?? []); // DoneDeal's image server refuses non-browser requests.
  // Full-size ad photos make number plates readable; the screenshot adds the page context.
  const fetched = (await Promise.all(downloadable.slice(0, MAX_PHOTOS - Math.min(captured.length, 1)).map((url) => photoBlock(url, fetchImpl)))).filter(Boolean);
  const photos = [...captured.slice(0, 1), ...fetched];
  const content = [
    ...photos,
    // Today's date lets the model judge NCT and tax expiry dates; it sits in the user turn so the system prompt stays cacheable.
    { type: 'text', text: `Today is ${new Date().toISOString().slice(0, 10)}. Flag no_nct when the NCT expiry is before today.\n\nBuyer criteria: ${describeCriteria(criteria)}\n\n${describeListing(listing)}\n\nPhotos attached: ${photos.length}.` },
  ];
  const response = await (injected ?? anthropic()).beta.messages.create({
    model: CLASSIFIER_MODEL,
    max_tokens: 4000,
    ...requestExtras(),
    system: SYSTEM_PROMPT,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: CLASSIFICATION_SCHEMA } },
    messages: [{ role: 'user', content }],
  });
  if (response.stop_reason === 'refusal') {
    return { error: 'refusal', usage: response.usage };
  }
  if (response.stop_reason === 'max_tokens') {
    return { error: 'truncated', usage: response.usage };
  }
  const text = response.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
  try {
    return { result: JSON.parse(text), photosRead: photos.length, usage: response.usage };
  } catch {
    return { error: 'invalid_json', usage: response.usage };
  }
}

// Run a bounded number of classifications at the same time.
export async function classifyMany(listings, criteria, { concurrency = 4, onResult = () => {}, ...options } = {}) {
  const results = new Array(listings.length);
  let next = 0;
  async function worker() {
    while (next < listings.length) {
      const index = next++;
      try {
        results[index] = await classifyListing(listings[index], criteria, options);
      } catch (error) {
        results[index] = { error: error?.status ? `api_${error.status}` : 'request_failed' };
      }
      onResult(index, results[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, listings.length) }, worker));
  return results;
}
