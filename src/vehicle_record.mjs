// Official vehicle record from the Government of Ireland's Check My Vehicle service
// (vehicleservices.gov.ie): make, model, colour, motor tax and NCT expiry. No owner data.
// Light use only: at most a few lookups per search, spaced out, and cached for a day.

const ENDPOINT = 'https://www.vehicleservices.gov.ie/api/v1/public-cmv/cmv/vehicles/lookup';
const SPACING_MS = 1_500;
const CACHE_MS = 24 * 3_600_000;
const cache = new Map(); // plate -> { at, value }
let lastAt = 0;

export async function lookupVehicle(plate, { fetchImpl = fetch } = {}) {
  const hit = cache.get(plate);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const wait = lastAt + SPACING_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastAt = Date.now();
  const response = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'car-listing-search/0.1' },
    body: JSON.stringify({ registrationNumber: plate }),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) {
    cache.set(plate, { at: Date.now(), value: null });
    return null;
  }
  if (!response.ok) throw new Error(`Check My Vehicle returned HTTP ${response.status}`);
  const data = await response.json();
  const value = data?.vehicleDetails ? {
    make: data.vehicleDetails.vehicleMake,
    model: data.vehicleDetails.vehicleModel,
    colour: data.vehicleDetails.vehicleColourEn,
    taxExpiry: data.motorTaxDetails?.motorTaxExpiryDate,
    taxStatus: data.motorTaxDetails?.statusEn,
    nctExpiry: data.nctInformation?.nctExpiryDate,
    nctStatus: data.nctInformation?.nctStatusEn,
  } : null;
  cache.set(plate, { at: Date.now(), value });
  return value;
}

// Compare the official record with what the ad claims. Returns { mismatch?, cautions[] }.
export function compareRecord(record, facts, today = new Date().toISOString().slice(0, 10)) {
  const result = { cautions: [] };
  if (!record) return result;
  const same = (a, b) => a && b && (a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase()));
  if (facts.make && record.make && !same(record.make, facts.make)) {
    result.mismatch = `official record says ${record.make} ${record.model ?? ''}`.trim();
  } else if (facts.model && record.model && !same(record.model, facts.model)) {
    result.mismatch = `official record says ${record.make} ${record.model}`;
  }
  if (record.nctExpiry && record.nctExpiry < today) result.cautions.push(`NCT expired on ${record.nctExpiry} (official record)`);
  if (record.taxExpiry && record.taxExpiry < today) result.cautions.push(`motor tax expired on ${record.taxExpiry} (official record)`);
  return result;
}
