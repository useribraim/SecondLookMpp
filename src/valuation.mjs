// Asking-price evidence from comparable DoneDeal ads.
const MIN_COMPARABLES = 5;
const KM_WINDOW = 30_000;
const euro = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2, minimumFractionDigits: 0 });

// Mileage below 5,000 km on a car older than three years is almost always a typing error
// (for example 482 for 482,000). Treat it as unknown.
export function plausibleMileage(km, year, now = new Date()) {
  if (!km || km < 100) return undefined;
  if (year && year < now.getUTCFullYear() - 3 && km < 5_000) return undefined;
  return km;
}

export function vehicleKey(make, model) {
  return `${String(make ?? '').trim().toLowerCase()}|${String(model ?? '').trim().toLowerCase()}`;
}

function quantile(sorted, fraction) {
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  return roundToCents(sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower));
}

function roundToCents(value) {
  return Math.round(value * 100) / 100;
}

const positive = (value) => Number.isFinite(value) && value > 0;

export function buildMarket(comparables) {
  const market = new Map();
  const seen = new Set();
  for (const listing of comparables) {
    if (!listing.id || seen.has(listing.id) || !listing.make || !listing.model ||
        !positive(listing.priceEur) || !positive(listing.year) || !positive(listing.mileageKm)) continue;
    seen.add(listing.id);
    const key = vehicleKey(listing.make, listing.model);
    if (!market.has(key)) market.set(key, { listings: [] });
    market.get(key).listings.push(listing);
  }
  return market;
}

// First use ±1 year and ±30,000 km. If fewer than five ads match, widen both windows once.
export function valueListing(market, car, { inferredIdentity = false } = {}) {
  const { id, make, model, year, mileageKm, priceEur } = car;
  const entry = market.get(vehicleKey(make, model));
  let matches = [];
  if (entry && positive(year) && positive(mileageKm)) {
    const candidates = entry.listings.filter((listing) => listing.id !== id);
    const within = (years, km) => candidates.filter((listing) =>
      Math.abs(listing.year - year) <= years && Math.abs(listing.mileageKm - mileageKm) <= km);
    matches = within(1, KM_WINDOW);
    if (matches.length < MIN_COMPARABLES) matches = within(2, 2 * KM_WINDOW);
  }
  const compCount = matches.length;
  const confidence = compCount < MIN_COMPARABLES || inferredIdentity ? 'uncertain' : 'confident';
  if (!compCount) return {
    fairPrice: null, deltaEur: null, deltaPct: null, compCount, confidence, rangeEur: null,
    examples: [], reason: 'No comparable asking prices.',
  };

  const prices = matches.map((listing) => listing.priceEur).sort((a, b) => a - b);
  const fairPrice = quantile(prices, 0.5);
  const deltaEur = positive(priceEur) ? roundToCents(fairPrice - priceEur) : null;
  const deltaPct = deltaEur === null ? null : roundToCents(deltaEur / fairPrice * 100);
  const sample = `${compCount} similar ${make} ${model} ${compCount === 1 ? 'ad' : 'ads'}`;
  let reason = `Median of ${sample}`;
  if (deltaEur) reason = `${euro.format(Math.abs(deltaEur))} ${deltaEur > 0 ? 'under' : 'over'} the median of ${sample}`;
  else if (deltaEur === 0) reason = `At the median of ${sample}`;
  if (confidence === 'uncertain') reason += inferredIdentity ? ' (make or model inferred)' : ' (small sample)';

  const examples = matches.filter((listing) => /^https:\/\/www\.donedeal\.ie\/.+\/\d+\/?$/.test(listing.url))
    .sort((a, b) => Math.abs(a.year - year) - Math.abs(b.year - year) ||
      Math.abs(a.mileageKm - mileageKm) - Math.abs(b.mileageKm - mileageKm))
    .slice(0, 3)
    .map(({ url, year, mileageKm, priceEur }) => ({ url, year, mileageKm, priceEur }));
  return { fairPrice, deltaEur, deltaPct, compCount, confidence, reason,
    rangeEur: { low: quantile(prices, 0.25), high: quantile(prices, 0.75) }, examples };
}

// Keep the report fields consumed by the HTML page and existing buyers.
export function estimate(market, car, options) {
  const value = valueListing(market, car, options);
  if (value.fairPrice === null) return undefined;
  return { ...value, expectedEur: value.fairPrice, comparables: value.compCount, method: 'matched-median' };
}

export function discount(priceEur, valuation) {
  if (!valuation || !priceEur || valuation.confidence === 'uncertain') return undefined;
  return Math.round(((valuation.expectedEur - priceEur) / valuation.expectedEur) * 100) / 100;
}
