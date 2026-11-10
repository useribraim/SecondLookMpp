// Combine stated facts, classifier output and valuation into ranked lists.
// The score answers "is this car worth calling about?", not "how far below market is the price?":
// the biggest discounts are mostly cars that are cheap for a reason.
import { estimate, discount, plausibleMileage } from './valuation.mjs';
import { decodeIrishPlate } from './plates.mjs';
import { countyFromListing } from './criteria.mjs';

export const SEVERE_FLAGS = new Set([
  'engine_fault', 'gearbox_fault', 'not_running', 'spares_or_repair', 'write_off', 'parts_only',
  'wanted_ad_not_for_sale', 'scam_signals',
]);
// Cars with these flags go to the "cheap for a reason" list, not the main lists.
export const PROJECT_FLAGS = new Set(['accident_damage', 'no_nct', 'nct_failed']);
const MINOR_PENALTY = { needs_minor_work: 0.06, import: 0.03, high_mileage: 0.05 };
const CONFIDENT_THRESHOLD = 0.75;
const MAX_OVERPRICE = 0.05; // allow a small margin above the observed asking-price range
const DISCOUNT_CAP = 0.35; // a bigger gap usually means a hidden reason, so it earns no extra points
const SUSPICIOUS_DISCOUNT = 0.55;
const MAINTENANCE = /service (history|record|book)|serviced|receipts|invoices|timing belt|cambelt|water pump|new clutch|new tyres|full history/i;
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// NCT expiry as written by DoneDeal ("Oct 2027"), as MM/YYYY, or as an ISO date. Returns months left
// (negative when expired) or undefined when it cannot be read.
export function nctMonthsLeft(text, now = new Date()) {
  if (!text) return undefined;
  const value = String(text).trim();
  let year; let month;
  let m = value.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{4})$/);
  if (m && MONTHS[m[1].toLowerCase()] !== undefined) { month = MONTHS[m[1].toLowerCase()]; year = Number(m[2]); }
  m = m ? null : value.match(/^(\d{1,2})[/-](\d{4})$/);
  if (m) { month = Number(m[1]) - 1; year = Number(m[2]); }
  m = (year !== undefined) ? null : value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    year = Number(m[1]);
    month = Number(m[2]) - 1;
    if (month === now.getUTCMonth() && year === now.getUTCFullYear() && Number(m[3]) < now.getUTCDate()) return -1;
  }
  if (year === undefined || month < 0 || month > 11) return undefined;
  return (year - now.getUTCFullYear()) * 12 + (month - now.getUTCMonth());
}

// Used only when no classifier is configured: obvious fault words in the title or description.
const KEYWORD_FLAGS = [
  [/spares?\s*(or|&|\/)\s*repairs?|for parts|breaking for parts/i, 'spares_or_repair'],
  [/engine (issue|problem|fault|light)|head gasket|knocking|using coolant|blown/i, 'engine_fault'],
  [/gearbox (issue|problem|fault)|clutch (gone|slipping)/i, 'gearbox_fault'],
  [/non[-\s]?runner|not running|needs? (a )?tow/i, 'not_running'],
  [/no nct|nct expired|out of nct/i, 'no_nct'],
  [/\bfailed nct\b|nct fail/i, 'nct_failed'],
];
const WANTED_TITLE = /^\s*(wanted|looking for)\b/i;

export function keywordClassification(listing) {
  const text = `${listing.title} ${listing.description ?? ''}`;
  const flags = KEYWORD_FLAGS.filter(([pattern]) => pattern.test(text)).map(([, flag]) => flag);
  if (WANTED_TITLE.test(listing.title)) flags.push('wanted_ad_not_for_sale');
  if (listing.section === 'damagedcars' && !flags.length) flags.push('accident_damage');
  return {
    is_whole_car_for_sale: !flags.includes('wanted_ad_not_for_sale'),
    make: listing.make ?? null, model: listing.model ?? null,
    year_min: listing.year ?? null, year_max: listing.year ?? null,
    year_evidence: listing.year ? 'stated field' : 'unknown',
    mileage_km: listing.mileageKm ?? null,
    mileage_evidence: listing.mileageKm ? 'stated field' : 'not stated',
    fuel: listing.fuel ?? null, transmission: listing.transmission ?? null,
    condition_flags: flags,
    condition_summary: flags.length ? `Keyword check found: ${flags.join(', ')}.` : 'No fault keywords found. Photos not inspected.',
    matches_criteria: listing.make && listing.year ? 'yes' : 'unclear',
    confidence: listing.make && listing.model && listing.year ? 0.8 : 0.3,
    uncertainty_reason: '',
    keyword_only: true,
    registration_plate: null,
  };
}

function inCriteria(facts, criteria) {
  const reasons = [];
  const modelKey = (name) => name.toLowerCase().replace(/[-\s]+/g, ' ');
  const vehicleOk = criteria.vehicles.some((vehicle) =>
    facts.make && facts.make.toLowerCase() === vehicle.make.toLowerCase()
    && (!vehicle.model || (facts.model && modelKey(facts.model).includes(modelKey(vehicle.model)))));
  if (facts.make && !vehicleOk) reasons.push(`${facts.make} ${facts.model ?? ''} is not a requested model`.trim());
  if (facts.yearMax && facts.yearMax < criteria.yearFrom) reasons.push(`year ${facts.yearMax} is before ${criteria.yearFrom}`);
  if (facts.yearMin && facts.yearMin > criteria.yearTo) reasons.push(`year ${facts.yearMin} is after ${criteria.yearTo}`);
  if (criteria.mileageMaxKm && facts.mileageKm && facts.mileageKm > criteria.mileageMaxKm) reasons.push(`mileage ${facts.mileageKm} km is above the limit`);
  if (criteria.seatsMin && facts.seats && facts.seats < criteria.seatsMin) reasons.push(`listing states only ${facts.seats} seats`);
  if (criteria.engineLitres && facts.engineL && Math.abs(facts.engineL - criteria.engineLitres) > 0.06) reasons.push(`engine is ${facts.engineL} L, not the requested ${criteria.engineLitres} L`);
  if (criteria.county && facts.county && facts.county !== criteria.county) reasons.push(`listing is in ${facts.county}, outside ${criteria.county}`);
  if (criteria.fuelTypes && facts.fuel && !criteria.fuelTypes.some((fuel) => fuel.toLowerCase() === facts.fuel.toLowerCase())) reasons.push(`fuel ${facts.fuel} is not requested`);
  if (facts.priceEur && facts.priceEur > criteria.priceMaxEur) reasons.push('price is above the limit');
  if (facts.priceEur && facts.priceEur < criteria.priceMinEur) reasons.push('price is below the requested minimum');
  return reasons;
}

export function assess(listing, classification, market, criteria) {
  const c = classification;
  // On a year conflict the model's reading (title, text, plate) is used for the facts and the valuation.
  const yearConflict = Boolean(listing.year && c.year_min && c.year_max && (listing.year < c.year_min || listing.year > c.year_max));
  const statedYear = yearConflict ? undefined : listing.year;
  // An Irish plate gives the year (of first Irish registration) when the ad states none.
  const plate = decodeIrishPlate(c.registration_plate ?? undefined);
  const facts = {
    make: listing.make ?? c.make ?? undefined,
    model: listing.model ?? c.model ?? undefined,
    yearMin: statedYear ?? c.year_min ?? plate?.year ?? undefined,
    yearMax: statedYear ?? c.year_max ?? plate?.year ?? undefined,
    // DoneDeal mileage is a site field; on Facebook the model's reading of the ad comes first and the
    // text parser is the backup (the parser cannot tell an odometer from a service record).
    mileageKm: listing.source === 'facebook'
      ? plausibleMileage(c.mileage_km ?? undefined, listing.year ?? c.year_max ?? undefined) ?? listing.mileageKm
      : listing.mileageKm ?? plausibleMileage(c.mileage_km ?? undefined, listing.year ?? c.year_max ?? undefined),
    fuel: listing.fuel ?? c.fuel ?? undefined,
    seats: listing.seats,
    // An engine size written in the title (for example "2.0 diesel") counts when the engine field is empty.
    engineL: listing.engineL ?? (Number(/(?:^|\s)([1-6][.,]\d)(?=\s|l\b|$)/i.exec(listing.title ?? '')?.[1]?.replace(',', '.')) || undefined),
    county: countyFromListing(listing.county),
    priceEur: listing.priceEur,
  };
  const year = facts.yearMin === facts.yearMax ? facts.yearMin : undefined;
  const valuation = estimate(market, {
    ...listing, make: facts.make, model: facts.model, year, mileageKm: facts.mileageKm,
  }, { inferredIdentity: !listing.make || !listing.model });
  const priceDiscount = discount(listing.priceEur, valuation);
  const severe = c.condition_flags.filter((flag) => SEVERE_FLAGS.has(flag));
  const project = c.condition_flags.filter((flag) => PROJECT_FLAGS.has(flag));
  const penalty = c.condition_flags.reduce((sum, flag) => sum + (MINOR_PENALTY[flag] ?? 0), 0);
  const outOfCriteria = inCriteria(facts, criteria);
  const nctLeft = nctMonthsLeft(listing.nctExpiry);
  if (nctLeft !== undefined && nctLeft < 0 && !project.includes('no_nct')) project.push('no_nct');

  const uncertainties = [];
  if (c.confidence < CONFIDENT_THRESHOLD) uncertainties.push(`identification confidence ${c.confidence}`);
  if (!facts.yearMin) uncertainties.push('year not known');
  else if (facts.yearMax - facts.yearMin > 1) uncertainties.push(`year only known as ${facts.yearMin}-${facts.yearMax}`);
  const cautions = [];
  if (!facts.mileageKm) uncertainties.push(criteria.mileageMaxKm ? 'mileage limit cannot be checked' : 'mileage not stated');
  if (criteria.seatsMin && !facts.seats) uncertainties.push('seat requirement cannot be checked');
  if (criteria.engineLitres && !facts.engineL) uncertainties.push('engine size not stated');
  if (criteria.county && !facts.county) uncertainties.push('listing county is unclear');
  if (!facts.priceEur) uncertainties.push('asking price not stated');
  if (criteria.fuelTypes && !facts.fuel) uncertainties.push('required fuel type not stated');
  if (facts.yearMin && facts.yearMax && (facts.yearMin < criteria.yearFrom || facts.yearMax > criteria.yearTo)) {
    uncertainties.push('year range overlaps the requested limit');
  }
  if (c.matches_criteria === 'unclear') uncertainties.push('criteria match unclear');
  if (!listing.description) uncertainties.push('ad text could not be read; faults may be missed');
  if (c.keyword_only) uncertainties.push('not inspected by the model (keyword check only)');
  // A mileage suspicion is a question for the seller, not a reason to drop the car: the model also
  // raises it for harmless cases such as service records written in miles on a UK import.
  if (c.condition_flags.includes('clocked_mileage_suspected')) uncertainties.push('mileage may be inconsistent: check the NCT history');
  // A stated year outside the year range the model reads from the title, text or plate is a conflict.
  if (yearConflict) {
    uncertainties.push(`year conflict: stated ${listing.year}, ad text or photo suggests ${c.year_min === c.year_max ? c.year_min : `${c.year_min}-${c.year_max}`}`);
  }
  if (nctLeft === undefined && !project.length) cautions.push('NCT date not stated: ask the seller');
  if (nctLeft !== undefined && nctLeft >= 0 && nctLeft <= 1) cautions.push(`NCT expires soon (${listing.nctExpiry})`);
  if (priceDiscount !== undefined && priceDiscount >= SUSPICIOUS_DISCOUNT && !project.length) cautions.push(`price is ${Math.round(priceDiscount * 100)}% below similar listings: ask why`);
  // The model's free-text note is shown on the find but does not decide the list on its own.

  const overpriced = valuation?.confidence === 'confident' && listing.priceEur > valuation.rangeEur.high * (1 + MAX_OVERPRICE);
  let verdict;
  if (!c.is_whole_car_for_sale || severe.length || outOfCriteria.length || c.matches_criteria === 'no' || overpriced) verdict = 'rejected';
  else if (project.length) verdict = 'project';
  else if (uncertainties.length === 0) verdict = 'confident';
  else verdict = 'uncertain';

  // "Worth calling about": a capped discount plus evidence that the car is ready to use.
  const maintained = MAINTENANCE.test(listing.description ?? '');
  const priceSignal = valuation && (listing.priceEur < valuation.rangeEur.low || listing.priceEur > valuation.rangeEur.high)
    ? priceDiscount : 0;
  const score = Math.min(priceSignal ?? 0, DISCOUNT_CAP)
    + nctBonus(nctLeft)
    + (facts.mileageKm ? 0.05 : 0)
    + (maintained ? 0.05 : 0)
    // A price far below similar cars with no stated reason is a risk (hidden fault or scam), not a bonus.
    - (priceDiscount >= SUSPICIOUS_DISCOUNT && !project.length ? 0.1 : 0)
    - penalty;
  return {
    id: listing.id, source: listing.source, url: listing.url, title: listing.title, section: listing.section,
    priceEur: listing.priceEur, county: listing.county, photo: listing.photos?.[0],
    foundOutsideSiteFilter: listing.origin !== 'exact',
    facts: { ...facts, yearEvidence: c.year_evidence || (plate ? 'number plate' : undefined), mileageEvidence: c.mileage_evidence,
      plate: plate ? { year: plate.year, half: plate.half, county: plate.county } : undefined,
      nctExpiry: listing.nctExpiry, nctMonthsLeft: nctLeft, maintenanceMentioned: maintained },
    // Kept only for the official lookup; removed before the report is stored.
    privatePlate: plate?.plate,
    valuation: valuation ? { ...valuation, discount: priceDiscount } : undefined,
    valuationNote: valuation ? undefined : 'No asking-price comparison. Too few closely matched ads or insufficient vehicle details.',
    condition: { flags: c.condition_flags, summary: c.condition_summary },
    notes: c.uncertainty_reason || undefined,
    cautions: cautions.length ? cautions : undefined,
    confidence: c.confidence,
    verdict,
    score: Math.round(score * 100) / 100,
    reasons: verdict === 'rejected'
      ? [...(c.is_whole_car_for_sale ? [] : ['not a whole car for sale']), ...severe.map((flag) => `flag: ${flag}`), ...outOfCriteria,
        ...(overpriced ? ['asking price is above the comparable range'] : [])]
      : verdict === 'project' ? project.map((flag) => ({ accident_damage: 'damage stated', no_nct: 'no valid NCT', nct_failed: 'failed NCT' })[flag])
        : uncertainties,
  };
}

function nctBonus(months) {
  return months >= 6 ? 0.1 : months >= 0 ? 0.05 : 0;
}

// The official record can confirm or contradict the ad after the assessment.
export function applyOfficialRecord(find, record, today = new Date()) {
  if (!record) return;
  find.official = record;
  const left = nctMonthsLeft(record.nctExpiry, today);
  if (left === undefined) return;
  find.cautions = (find.cautions ?? []).filter((caution) => !/^NCT (date not stated|expires soon)/.test(caution));
  const previousBonus = nctBonus(find.facts.nctMonthsLeft);
  find.facts.nctMonthsLeft = left;
  find.score = Math.round((find.score - previousBonus + nctBonus(left)) * 100) / 100;
  if (left < 0 && find.verdict !== 'rejected') {
    const earlier = find.verdict === 'project' ? find.reasons ?? [] : [];
    find.reasons = [...earlier.filter((reason) => reason !== 'no valid NCT'), `NCT expired on ${record.nctExpiry} (official record)`];
    find.verdict = 'project';
  } else if (left >= 0 && left <= 1) {
    find.cautions.push(`NCT expires soon (${record.nctExpiry}, official record)`);
  }
  if (!find.cautions.length) delete find.cautions;
}

export function buyerAction(find) {
  const { facts, official, verdict } = find;
  const reasons = find.reasons ?? [];
  const checks = [];
  if (reasons.some((reason) => reason.startsWith('official record says'))) {
    checks.push('Confirm the registration and vehicle details with the seller.');
  }
  if (!find.priceEur && reasons.includes('asking price not stated')) checks.push('Confirm the total asking price.');
  if (reasons.includes('required fuel type not stated')) checks.push('Confirm the fuel type.');
  if (reasons.includes('seat requirement cannot be checked')) checks.push('Confirm how many seats the car has.');
  if (reasons.includes('engine size not stated')) checks.push('Confirm the engine size.');
  if (reasons.includes('listing county is unclear')) checks.push('Confirm where the car can be viewed.');
  if (!facts.mileageKm || reasons.some((reason) => reason.startsWith('mileage may be inconsistent'))) {
    checks.push('Ask for the current odometer reading and recent NCT mileage records.');
  }
  if (find.condition?.flags?.includes('accident_damage')) checks.push('Ask for details of the damage and any repairs.');
  if (facts.nctMonthsLeft === undefined || facts.nctMonthsLeft <= 1) {
    checks.push('Ask for the latest NCT certificate and expiry date.');
  }
  if (official?.taxExpiry && find.cautions?.some((caution) => caution.startsWith('motor tax expired'))) {
    checks.push('Confirm whether the motor tax has been renewed.');
  }
  if (find.cautions?.some((caution) => caution.endsWith('ask why'))) checks.push('Ask why the price is well below similar ads.');
  const label = verdict === 'project' ? 'Project car' : verdict === 'uncertain' || checks.length ? 'Call first' : 'Worth a call';
  if (!checks.length) checks.push('Confirm it is still available and ask for service records before arranging a viewing.');
  return { label, checks: checks.slice(0, 2) };
}

export function rankAssessments(assessments, size = 10) {
  const byScore = (a, b) => b.score - a.score;
  const byDiscount = (a, b) => (b.valuation?.discount ?? 0) - (a.valuation?.discount ?? 0);
  return {
    confident: assessments.filter((a) => a.verdict === 'confident').sort(byScore).slice(0, size),
    uncertain: assessments.filter((a) => a.verdict === 'uncertain').sort(byScore).slice(0, size),
    cheapForAReason: assessments.filter((a) => a.verdict === 'project').sort(byDiscount).slice(0, 5),
    rejected: assessments.filter((a) => a.verdict === 'rejected').sort(byScore),
  };
}
