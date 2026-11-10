// One search job: collect (DoneDeal and Facebook at the same time), value, inspect, rank.
import { collectExact, collectAdjacent, collectComparables, fetchDetail, doneDealStats } from './donedeal.mjs';
import { buildMarket, estimate, discount } from './valuation.mjs';
import { classifyMany, classifierProvider, CLASSIFIER_MODEL } from './classifier.mjs';
import { keywordClassification, assess, rankAssessments, nctMonthsLeft, applyOfficialRecord, buyerAction } from './rank.mjs';
import { lookupVehicle, compareRecord } from './vehicle_record.mjs';

const OFFICIAL_LOOKUPS = Number(process.env.OFFICIAL_LOOKUPS ?? 8);

// Ads inspected per source. Small values make a search faster; larger values find more.
const DONEDEAL_CANDIDATES = Number(process.env.DONEDEAL_CANDIDATES ?? 15);
const FACEBOOK_CANDIDATES = Number(process.env.FACEBOOK_MAX_DETAILS ?? 10);

export function classifierAvailable(env = process.env) {
  return Boolean(classifierProvider(env)) && env.CLASSIFIER_DISABLED !== '1';
}

function dedupe(listings) {
  const seen = new Map();
  for (const listing of listings) if (!seen.has(listing.id)) seen.set(listing.id, listing);
  return [...seen.values()];
}

// Which DoneDeal ads to read and inspect. Search results already carry the NCT expiry and mileage, so
// ready-to-use cars (NCT valid, mileage stated) come first, ranked by a capped discount; a few
// cheap-for-a-reason cars and a share of ads from outside the site filter are added.
function selectDoneDeal(exact, adjacent, market, criteria) {
  const inPrice = (listing) => listing.priceEur && listing.priceEur >= criteria.priceMinEur && listing.priceEur <= criteria.priceMaxEur;
  const exactIds = new Set(exact.map((listing) => listing.id));
  const outside = dedupe(adjacent).filter((listing) => !exactIds.has(listing.id) && inPrice(listing)).slice(0, 3);
  const scored = exact.map((listing) => {
    const valuation = estimate(market, listing);
    const d = discount(listing.priceEur, valuation) ?? 0;
    const nct = nctMonthsLeft(listing.nctExpiry);
    const ready = nct !== undefined && nct >= 0 && Boolean(listing.mileageKm);
    return { listing, d, ready, overpriced: valuation?.confidence === 'confident' && listing.priceEur > valuation.rangeEur.high, score: Math.min(d, 0.35) + (nct >= 6 ? 0.1 : 0) };
  });
  const readySlots = Math.max(0, DONEDEAL_CANDIDATES - outside.length - 2);
  const ready = scored.filter((x) => x.ready && !x.overpriced).sort((a, b) => b.score - a.score).slice(0, readySlots);
  const cheap = scored.filter((x) => !x.ready).sort((a, b) => b.d - a.d).slice(0, DONEDEAL_CANDIDATES - outside.length - ready.length);
  return [...ready, ...cheap].map((x) => x.listing).concat(outside);
}

// Live events for the search page: tiles (one for each source or check) and ad cards.
export function goalText(criteria) {
  const vehicles = criteria.vehicles.map((v) => [v.make, v.model].filter(Boolean).join(' ')).join(' or ');
  const parts = [`${criteria.yearFrom ?? ''}${criteria.yearTo ? `-${criteria.yearTo}` : ''}`.replace(/^-/, ''),
    `under €${criteria.priceMaxEur.toLocaleString('en-IE')}`,
    criteria.engineLitres ? `${criteria.engineLitres.toFixed(1)} litre` : '',
    criteria.fuelTypes?.length ? criteria.fuelTypes.join(' or ').toLowerCase() : '',
    criteria.mileageMaxKm ? `up to ${criteria.mileageMaxKm.toLocaleString('en-IE')} km` : '',
    criteria.county ? `near ${criteria.county}` : ''].filter(Boolean);
  return `Looking for a ${vehicles}, ${parts.join(', ')}`;
}

function adCard(listing) {
  return {
    id: listing.id, source: listing.source, url: listing.url, title: listing.title,
    priceEur: listing.priceEur, year: listing.year, mileageKm: listing.mileageKm, county: listing.county,
    photo: typeof listing.photos?.[0] === 'string' && listing.photos[0].startsWith('http') ? listing.photos[0] : undefined,
  };
}

const VERDICT_LINE = { confident: 'worth a call', uncertain: 'uncertain', project: 'cheap for a reason', rejected: 'rejected' };

function inspectionLine(find) {
  const facts = [find.facts.yearMin && (find.facts.yearMin === find.facts.yearMax ? find.facts.yearMin : `${find.facts.yearMin}-${find.facts.yearMax}`),
    find.facts.mileageKm && `${find.facts.mileageKm.toLocaleString('en-IE')} km`,
    find.facts.plate && `plate ${find.facts.plate.year} ${find.facts.plate.county}`].filter(Boolean).join(' · ');
  const why = find.reasons?.[0] ?? find.cautions?.[0];
  return `Claude read the ad${facts ? `: ${facts}` : ''} → ${VERDICT_LINE[find.verdict]}${why ? ` (${why})` : ''}`;
}

async function timed(timings, name, work) {
  const started = Date.now();
  try {
    return await work();
  } finally {
    timings[name] = Date.now() - started;
  }
}

export async function runSearch(criteria, { progress = () => {}, facebookCollector, wrapFacebook = (collect) => collect,
  onFacebookDone = () => {}, useClassifier = classifierAvailable(), requireAllSources = false, emit = () => {} } = {}) {
  const started = Date.now();
  const tile = (id, kind, op, text, extra = {}) => emit({ type: 'tile', id, kind, op, text, ...extra });
  emit({ type: 'goal', text: goalText(criteria) });
  const doneDealBefore = doneDealStats();
  const sources = {};
  const warnings = [];
  const timings = {};

  // DoneDeal: search, comparables for valuation, then the candidates' ad pages.
  const doneDealWork = async () => {
    if (!criteria.sources.includes('donedeal')) return { candidates: [], comparables: [], exact: [] };
    tile('donedeal', 'donedeal', 'add', 'searching DoneDeal');
    const exactResult = await timed(timings, 'donedealSearchMs', async () => {
      const exact = await collectExact(criteria);
      tile('donedeal', 'donedeal', 'update', `${exact.listings.length} ads match the filter` + (process.env.DONEDEAL_ADJACENT === '0' ? '' : '; checking damaged and other sections'));
      // DONEDEAL_ADJACENT=0 reads only the site's own search results (no damaged, vintage or commercial sections).
      const adjacent = process.env.DONEDEAL_ADJACENT === '0' ? { listings: [] } : await collectAdjacent(criteria);
      return { exact, adjacent };
    });
    sources.donedeal = { status: 'ok', siteFilterTotal: exactResult.exact.siteFilterTotal, collectedExact: exactResult.exact.listings.length, collectedOutsideFilter: exactResult.adjacent.listings.length };
    const needsComparables = exactResult.exact.listings.length || exactResult.adjacent.listings.length || criteria.sources.includes('facebook');
    const comparables = needsComparables
      ? await timed(timings, 'comparablesMs', () => collectComparables(criteria))
      : { listings: [] };
    const market = buildMarket([...comparables.listings, ...exactResult.exact.listings]);
    const engineOk = (listing) => !criteria.engineLitres || !listing.engineL || Math.abs(listing.engineL - criteria.engineLitres) <= 0.06;
    const candidates = selectDoneDeal(dedupe(exactResult.exact.listings).filter(engineOk), exactResult.adjacent.listings.filter(engineOk), market, criteria);
    tile('donedeal', 'donedeal', 'update', `${comparables.listings.length} price comparisons · ${candidates.length} ads picked to read`);
    for (const listing of candidates) emit({ type: 'ad', op: 'add', ...adCard(listing), line: 'found on DoneDeal' });
    let unread = 0;
    await timed(timings, 'donedealAdPagesMs', async () => {
      for (const [index, listing] of candidates.entries()) {
        tile('donedeal', 'donedeal', 'update', `reading ad ${index + 1} of ${candidates.length}`, { detail: listing.title });
        try {
          Object.assign(listing, await fetchDetail(listing.url));
        } catch {
          listing.description = null;
          unread += 1;
        }
      }
    });
    tile('donedeal', 'donedeal', 'end', `${candidates.length} ads read`);
    if (unread && unread === candidates.length) throw new Error('No candidate ad pages could be read');
    if (unread) warnings.push(`${unread} DoneDeal ad pages could not be read; those finds are marked uncertain.`);
    return { candidates, comparables: comparables.listings, exact: exactResult.exact.listings };
  };

  const facebookWork = async () => {
    if (!criteria.sources.includes('facebook')) return [];
    if (!facebookCollector) {
      warnings.push('Facebook Marketplace collector is not configured; Facebook was not searched.');
      sources.facebook = { status: 'not_configured' };
      return [];
    }
    const windows = Math.max(1, Math.min(4, Math.trunc(Number(process.env.FACEBOOK_TABS)) || 3));
    const updateWindows = (op, text, state) => {
      for (let index = 0; index < windows; index += 1) tile(`facebook-${index + 1}`, 'facebook', op, text, { index, windows, state });
    };
    updateWindows('add', 'opening Marketplace');
    try {
      const collect = wrapFacebook(async (searchCriteria) => {
        updateWindows('update', 'searching Marketplace');
        // Marketplace has no engine field. With an engine size and no model, the size and fuel become the search words.
        const engineWords = searchCriteria.engineLitres ? [searchCriteria.engineLitres.toFixed(1), ...(searchCriteria.fuelTypes?.length === 1 ? [searchCriteria.fuelTypes[0].toLowerCase()] : [])].join(' ') : undefined;
        return facebookCollector(engineWords
          ? { ...searchCriteria, vehicles: searchCriteria.vehicles.map((vehicle) => (vehicle.model ? vehicle : { ...vehicle, model: engineWords })) }
          : searchCriteria);
      });
      const result = await timed(timings, 'facebookMs', () => collect(criteria).finally(() => onFacebookDone()));
      sources.facebook = { status: 'ok', inspected: result.listings.length, ...result.stats };
      const kept = result.listings.slice(0, FACEBOOK_CANDIDATES);
      updateWindows('end', `${kept.length} ads read across Marketplace`);
      for (const listing of kept) emit({ type: 'ad', op: 'add', ...adCard(listing), line: 'found on Facebook Marketplace' });
      return kept;
    } catch (error) {
      updateWindows('end', 'Marketplace search failed', 'bad');
      warnings.push(`Facebook Marketplace collection failed: ${error.message}`);
      sources.facebook = { status: 'failed' };
      return [];
    }
  };

  const safeDoneDeal = async () => {
    try {
      return await doneDealWork();
    } catch (error) {
      warnings.push(`DoneDeal collection failed: ${error.message}. Finds have no market valuation.`);
      sources.donedeal = { status: 'failed' };
      return { candidates: [], comparables: [], exact: [] };
    }
  };

  const collecting = `collecting ${criteria.sources.map((source) => (source === 'facebook' ? 'Facebook Marketplace' : 'DoneDeal')).join(' and ')} listings`;
  progress(collecting);
  emit({ type: 'ads', op: 'collecting', text: `Searching ${criteria.sources.map((source) => (source === 'facebook' ? 'Facebook Marketplace' : 'DoneDeal')).join(' and ')}` });
  const [doneDeal, facebook] = await Promise.all([safeDoneDeal(), facebookWork()]);
  const missingSources = criteria.sources.filter((source) => sources[source]?.status !== 'ok');
  if (requireAllSources && missingSources.length) {
    throw new Error(`Required sources could not be searched: ${missingSources.join(', ')}`);
  }
  const market = buildMarket([...doneDeal.comparables, ...doneDeal.exact]);
  const candidates = dedupe([...doneDeal.candidates, ...facebook]);
  if (!candidates.length && warnings.some((warning) => /failed|not configured/.test(warning))) {
    throw new Error(`no source returned listings (${warnings.join(' ')})`);
  }

  let classifications;
  const usage = { calls: 0, inputTokens: 0, outputTokens: 0, failures: 0, listCostUsd: 0 };
  if (useClassifier) {
    progress(`inspecting ${candidates.length} ads with ${CLASSIFIER_MODEL}`);
    emit({ type: 'ads', op: 'inspecting', text: `Claude is reading ${candidates.length} ads${facebook.length ? ', with Marketplace photos where available' : ''}` });
    const onResult = (index, outcome) => {
      try {
        const find = assess(candidates[index], outcome.result ?? keywordClassification(candidates[index]), market, criteria);
        emit({ type: 'ad', op: find.verdict === 'rejected' ? 'reject' : 'update', id: find.id, verdict: find.verdict, score: find.score, line: inspectionLine(find) });
      } catch {
        // The live card is only a view; the report below is the result.
      }
    };
    const results = await timed(timings, 'inspectionMs', () => classifyMany(candidates, criteria, { concurrency: Number(process.env.CLASSIFIER_CONCURRENCY ?? 6), onResult }));
    classifications = results.map((outcome, index) => {
      usage.calls += 1;
      usage.inputTokens += outcome.usage?.input_tokens ?? 0;
      usage.outputTokens += outcome.usage?.output_tokens ?? 0;
      usage.listCostUsd += outcome.usage?.opencode?.list_cost ?? 0;
      if (outcome.result) return outcome.result;
      usage.failures += 1;
      return keywordClassification(candidates[index]);
    });
    usage.listCostUsd = Math.round(usage.listCostUsd * 10000) / 10000;
  } else {
    if (candidates.length) warnings.push('Used a keyword check without photo inspection.');
    classifications = candidates.map(keywordClassification);
  }

  const assessments = candidates.map((listing, index) => assess(listing, classifications[index], market, criteria));

  // Official record (gov.ie Check My Vehicle) for the best finds with a readable Irish plate.
  let officialChecked = 0;
  if (OFFICIAL_LOOKUPS > 0) {
    const order = (x) => (x.verdict === 'confident' ? 0 : x.verdict === 'uncertain' ? 1 : 2);
    const worth = assessments.filter((x) => x.privatePlate && x.verdict !== 'rejected')
      .sort((x, y) => order(x) - order(y) || y.score - x.score).slice(0, OFFICIAL_LOOKUPS);
    if (worth.length) {
      tile('plate', 'plate', 'add', `${worth.length} plates read from ad photos`);
      tile('nct', 'nct', 'add', 'waiting for a plate');
    }
    await timed(timings, 'officialRecordMs', async () => {
      for (const [index, find] of worth.entries()) {
        tile('plate', 'plate', 'update', `plate ${index + 1} of ${worth.length}`, { detail: find.privatePlate, title: find.title });
        tile('nct', 'nct', 'update', 'asking gov.ie Check My Vehicle', { detail: find.privatePlate });
        try {
          const record = await lookupVehicle(find.privatePlate);
          officialChecked += 1;
          if (!record) {
            tile('nct', 'nct', 'update', 'no official record for this plate', { detail: find.privatePlate });
            continue;
          }
          const check = compareRecord(record, find.facts);
          if (check.mismatch) {
            find.reasons.push(check.mismatch);
            if (find.verdict === 'confident') find.verdict = 'uncertain';
            tile('nct', 'nct', 'update', check.mismatch, { detail: find.privatePlate, state: 'bad' });
            emit({ type: 'ad', op: 'update', id: find.id, verdict: find.verdict, score: find.score, line: `gov.ie: ${check.mismatch}` });
            continue;
          }
          applyOfficialRecord(find, record);
          const taxCautions = check.cautions.filter((caution) => caution.startsWith('motor tax'));
          if (taxCautions.length) find.cautions = [...(find.cautions ?? []), ...taxCautions];
          const nctLine = record.nctExpiry ? `NCT ${record.nctExpiry < new Date().toISOString().slice(0, 10) ? 'expired' : 'valid to'} ${record.nctExpiry}` : 'NCT date not on record';
          const taxLine = record.taxExpiry ? `tax to ${record.taxExpiry}` : '';
          tile('nct', 'nct', 'update', [record.make, record.model].filter(Boolean).join(' '), { detail: find.privatePlate, lines: [nctLine, taxLine].filter(Boolean), state: /expired/.test(nctLine) || taxCautions.length ? 'bad' : 'good' });
          emit({ type: 'ad', op: 'update', id: find.id, verdict: find.verdict, score: find.score, line: `gov.ie: ${[nctLine, taxLine].filter(Boolean).join(', ')}` });
        } catch {
          // The official check is extra evidence; a failed lookup leaves the find as it was.
        }
      }
    });
    if (worth.length) {
      tile('plate', 'plate', 'end', `${worth.length} plates read`);
      tile('nct', 'nct', 'end', `${officialChecked} official records checked`);
    }
  }
  for (const find of assessments) {
    delete find.privatePlate;
    find.nextStep = buyerAction(find);
  }
  // Screenshots are large; the report keeps only the facts derived from them.
  for (const listing of candidates) delete listing.images;
  const ranked = rankAssessments(assessments);
  emit({ type: 'ranked', confident: ranked.confident.map((x) => x.id), uncertain: ranked.uncertain.map((x) => x.id), cheapForAReason: ranked.cheapForAReason.map((x) => x.id) });
  return {
    criteria,
    generatedAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    timings: { ...timings, officialRecordsChecked: officialChecked, donedealRequests: doneDealStats().requests - doneDealBefore.requests, donedealRateLimited: doneDealStats().rateLimited - doneDealBefore.rateLimited },
    sources,
    inspected: candidates.length,
    method: {
      classifier: useClassifier ? `${CLASSIFIER_MODEL} (${classifierProvider()})` : 'keyword check',
      valuation: 'median and middle half of unique DoneDeal asking prices for the same make and model within one year and 30,000 km; widen once to two years and 60,000 km when fewer than five ads match',
      classifierUsage: usage,
    },
    shortlist: ranked.confident.slice(0, 3).map((find) => find.id),
    confident: ranked.confident,
    uncertain: ranked.uncertain,
    cheapForAReason: ranked.cheapForAReason,
    rejectedCount: ranked.rejected.length,
    rejectedSample: ranked.rejected.slice(0, 5).map(({ title, url, reasons, priceEur }) => ({ title, url, priceEur, reasons })),
    warnings,
  };
}
