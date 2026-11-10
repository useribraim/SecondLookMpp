// The common fields use null when the source supplies no usable value.
// Collectors may attach their own evidence (for example a Marketplace screenshot).
/**
 * @typedef {object} Listing
 * @property {'donedeal' | 'facebook'} source
 * @property {string | null} id
 * @property {string | null} url
 * @property {string | null} title
 * @property {string | null} make
 * @property {string | null} model
 * @property {number | null} year
 * @property {number | null} mileageKm
 * @property {string | null} fuel
 * @property {string | null} transmission
 * @property {number | null} engineL
 * @property {number | null} owners
 * @property {string | null} nctExpiry
 * @property {string | null} county
 * @property {number | null} priceEur
 * @property {string[] | null} photos
 * @property {string | null} description
 * @property {string | null} section
 * @property {string | object | null} rawCategory
 */

const optionalFields = {
  id: null, url: null, title: null, make: null, model: null, year: null, mileageKm: null,
  fuel: null, transmission: null, engineL: null, owners: null, nctExpiry: null, county: null,
  priceEur: null, photos: null, description: null, section: null, rawCategory: null,
};

/**
 * @template {Pick<Listing, 'source'> & Partial<Listing>} T
 * @param {T} fields
 * @returns {Listing & T}
 */
export function listing(fields) {
  const known = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
  return { ...optionalFields, ...known };
}

export function parsePriceEur(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  const text = String(value ?? '').trim().replace(/^€\s*/, '').replace(/\s*(?:EUR|€)$/i, '').trim().replace(/\.(?=\d{3}(?:\.|$))/g, ',');
  const match = /^(\d{1,3}(?:[, \u00a0]\d{3})+|\d+)(?:\.(\d{1,2}))?\s*(k)?$/i.exec(text);
  if (!match) return null;
  const number = Number(match[1].replace(/[,\s]/g, '') + (match[2] ? '.' + match[2] : ''));
  const price = number * (match[3] ? 1_000 : 1);
  return Number.isFinite(price) && price > 0 ? Math.round(price * 100) / 100 : null;
}

export const KM_PER_MILE = 1.609344;
