// Irish number plates: format, year and county, decoded locally (no lookup).
// 1987-2012: YY-CC-N (08-D-12345). Since 2013: YYH-CC-N, H = half-year (131 = Jan-Jun 2013).

const COUNTIES = {
  C: 'Cork', CE: 'Clare', CN: 'Cavan', CW: 'Carlow', D: 'Dublin', DL: 'Donegal', G: 'Galway',
  KE: 'Kildare', KK: 'Kilkenny', KY: 'Kerry', L: 'Limerick', LD: 'Longford', LH: 'Louth',
  LK: 'Limerick', LM: 'Leitrim', LS: 'Laois', MH: 'Meath', MN: 'Monaghan', MO: 'Mayo', OY: 'Offaly',
  RN: 'Roscommon', SO: 'Sligo', T: 'Tipperary', TN: 'Tipperary', TS: 'Tipperary', W: 'Waterford',
  WD: 'Waterford', WH: 'Westmeath', WX: 'Wexford', WW: 'Wicklow',
};

export function normalizePlate(text) {
  if (typeof text !== 'string') return undefined;
  const compact = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return compact.length >= 4 && compact.length <= 10 ? compact : undefined;
}

// Returns { plate, year, half, county } for a valid Irish plate, otherwise undefined.
export function decodeIrishPlate(text, now = new Date()) {
  const plate = normalizePlate(text);
  if (!plate) return undefined;
  const match = plate.match(/^(\d{2,3})([A-Z]{1,2})(\d{1,6})$/);
  if (!match) return undefined;
  const [, digits, code] = match;
  const county = COUNTIES[code];
  if (!county) return undefined;
  let year;
  let half;
  if (digits.length === 3) {
    year = 2000 + Number(digits.slice(0, 2));
    half = Number(digits[2]);
    if (year < 2013 || (half !== 1 && half !== 2)) return undefined;
  } else {
    const yy = Number(digits);
    year = yy >= 87 ? 1900 + yy : 2000 + yy;
    if (year > 2012) return undefined;
  }
  if (year > now.getUTCFullYear()) return undefined;
  return { plate, year, half, county };
}
