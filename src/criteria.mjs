// Search criteria: validation runs before any payment is requested.

const COUNTIES = [
  'Carlow', 'Cavan', 'Clare', 'Cork', 'Donegal', 'Dublin', 'Galway', 'Kerry', 'Kildare', 'Kilkenny',
  'Laois', 'Leitrim', 'Limerick', 'Longford', 'Louth', 'Mayo', 'Meath', 'Monaghan', 'Offaly',
  'Roscommon', 'Sligo', 'Tipperary', 'Waterford', 'Westmeath', 'Wexford', 'Wicklow',
];
const FUEL_TYPES = ['Petrol', 'Diesel', 'Electric', 'Petrol Hybrid', 'Diesel Hybrid', 'Petrol Plug-in Hybrid'];
const CURRENT_YEAR = new Date().getUTCFullYear();

export class CriteriaError extends Error {}

function text(value, name, max = 40) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || !/^[\p{L}\p{N} .\-]+$/u.test(value)) {
    throw new CriteriaError(`${name} must be a short name (letters, digits, spaces, '.', '-')`);
  }
  return value.trim();
}

function integer(value, name, min, max) {
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value) || value < min || value > max) throw new CriteriaError(`${name} must be an integer from ${min} to ${max}`);
  return value;
}

function capitalize(value) {
  return value.split(' ').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function countyName(value) {
  const name = String(value).trim().toLowerCase().replace(/^(?:county\s+|co(?:\.\s*|\s+))/, '');
  return COUNTIES.find((county) => county.toLowerCase() === name);
}

// A listing can name a town and county. A town alone does not establish the county.
export function countyFromListing(location) {
  return String(location ?? '').split(',').reverse().map(countyName).find(Boolean);
}

export function validateCriteria(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CriteriaError('Send a JSON object');
  const allowed = new Set(['vehicles', 'yearFrom', 'yearTo', 'priceMinEur', 'priceMaxEur', 'mileageMaxKm', 'seatsMin', 'engineLitres', 'fuelTypes', 'county', 'sources']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new CriteriaError(`Unknown field: ${key}`);

  if (!Array.isArray(input.vehicles) || input.vehicles.length < 1 || input.vehicles.length > 4) {
    throw new CriteriaError('vehicles must list 1 to 4 {make, model?} entries');
  }
  const vehicles = input.vehicles.map((vehicle, index) => {
    if (!vehicle || typeof vehicle !== 'object') throw new CriteriaError(`vehicles[${index}] must be an object`);
    const make = capitalize(text(vehicle.make, `vehicles[${index}].make`));
    const model = vehicle.model === undefined ? undefined : capitalize(text(vehicle.model, `vehicles[${index}].model`));
    return model ? { make, model } : { make };
  });

  const yearFrom = integer(input.yearFrom, 'yearFrom', 1950, CURRENT_YEAR) ?? 1950;
  const yearTo = integer(input.yearTo, 'yearTo', 1950, CURRENT_YEAR) ?? CURRENT_YEAR;
  if (yearFrom > yearTo) throw new CriteriaError('yearFrom must not be after yearTo');

  const priceMaxEur = integer(input.priceMaxEur, 'priceMaxEur', 500, 200_000);
  if (priceMaxEur === undefined) throw new CriteriaError('priceMaxEur is required');
  const priceMinEur = integer(input.priceMinEur, 'priceMinEur', 0, priceMaxEur) ?? 300;
  const mileageMaxKm = integer(input.mileageMaxKm, 'mileageMaxKm', 1_000, 1_000_000);
  const seatsMin = integer(input.seatsMin, 'seatsMin', 1, 20);
  let engineLitres;
  if (input.engineLitres !== undefined) {
    engineLitres = Math.round(Number(input.engineLitres) * 10) / 10;
    if (!(engineLitres >= 0.6 && engineLitres <= 8)) throw new CriteriaError('engineLitres must be a number from 0.6 to 8, for example 3.0');
  }

  let fuelTypes;
  if (input.fuelTypes !== undefined) {
    if (!Array.isArray(input.fuelTypes) || !input.fuelTypes.length) throw new CriteriaError('fuelTypes must be a non-empty list');
    fuelTypes = input.fuelTypes.map((fuel) => {
      const match = FUEL_TYPES.find((known) => known.toLowerCase() === String(fuel).toLowerCase());
      if (!match) throw new CriteriaError(`fuelTypes: use ${FUEL_TYPES.join(', ')}`);
      return match;
    });
  }

  let county;
  if (input.county !== undefined) {
    county = countyName(input.county);
    if (!county) throw new CriteriaError('county must be an Irish county name, for example Dublin');
  }

  const sources = input.sources ?? ['donedeal', 'facebook'];
  if (!Array.isArray(sources) || !sources.length || sources.some((source) => !['donedeal', 'facebook'].includes(source))) {
    throw new CriteriaError('sources must contain "donedeal" and/or "facebook"');
  }

  return { vehicles, yearFrom, yearTo, priceMinEur, priceMaxEur, mileageMaxKm, seatsMin, engineLitres, fuelTypes, county, sources: [...new Set(sources)] };
}
