// Keep the discovery method out of the review packet, then apply the five-brief decision gate.
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sources = { baseline: ['donedeal', 'facebook', 'motorly'], service: ['donedeal', 'facebook'] };
const briefFields = ['vehicles', 'yearFrom', 'yearTo', 'priceMinEur', 'priceMaxEur', 'mileageMaxKm', 'fuelTypes', 'county', 'seatsMin'];
const evidenceFields = ['make', 'model', 'year', 'mileageKm', 'priceEur', 'fuel', 'county', 'seats',
  'nctExpiry', 'conditionClaims', 'checkedNctExpiry', 'checkedTaxExpiry'];
const ratings = new Set(['worth_call', 'unsuitable', 'unverified']);
const sameWindowMs = 30 * 60_000;

function requireEvidence(condition, message) {
  if (!condition) throw new Error(message);
}

function unique(values, label) {
  const set = new Set(values);
  requireEvidence(set.size === values.length, `Duplicate ${label}`);
  return set;
}

function pick(object, fields) {
  return Object.fromEntries(fields.filter((field) => object[field] !== undefined).map((field) => [field, object[field]]));
}

function evidenceHash(brief) {
  return createHash('sha256').update(JSON.stringify(pick(brief, ['id', 'criteria', 'candidates']))).digest('hex');
}

function adKey(value) {
  const url = new URL(value);
  requireEvidence(url.protocol === 'https:' && !url.username && !url.password, 'Ad links must be public HTTPS URLs');
  const host = url.hostname.replace(/^www\./, '');
  const path = url.pathname.replace(/\/$/, '');
  const id = path.match(/\/(\d+)$/)?.[1];
  if (id && host === 'donedeal.ie') return `donedeal:${id}`;
  if (id && host === 'facebook.com' && path.startsWith('/marketplace/item/')) return `facebook:${id}`;
  return host + path;
}

function shuffled(items) {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function prepare({ briefs }) {
  requireEvidence(briefs.length === 5, 'Supply the five declared buyer briefs');
  unique(briefs.map((brief) => brief.id), 'brief IDs');
  const packetId = randomBytes(16).toString('hex');
  const review = { packetId, briefs: [] };
  const key = { packetId, briefs: [] };

  for (const { id, criteria, candidates, arms } of briefs) {
    const ids = unique(candidates.map((candidate) => candidate.id), `vehicle IDs in ${id}`);
    const ads = new Set();
    const order = shuffled(candidates);
    const aliases = new Map(order.map((candidate, index) => [candidate.id, `C${index + 1}`]));
    const anonymized = order.map((candidate) => {
      requireEvidence(candidate.ads.length, `Vehicle has no ad evidence in ${id}`);
      const observations = candidate.ads.map((ad) => {
        const identity = adKey(ad.url);
        requireEvidence(!ads.has(identity), `An ad appears more than once in ${id}: ${identity}`);
        ads.add(identity);
        return pick(ad, evidenceFields);
      });
      return { id: aliases.get(candidate.id), ads: observations };
    });
    const reviewerBrief = { id, criteria: pick(criteria, briefFields), candidates: anonymized, verdicts: {}, topThree: [] };
    review.briefs.push(reviewerBrief);

    const missing = [];
    const memberships = {};
    const timestamps = [];
    const discoveredInEitherArm = new Set();
    for (const [name, required] of Object.entries(sources)) {
      const arm = arms?.[name] ?? {};
      for (const source of required) {
        if (!arm.completedSources?.includes(source)) missing.push(`${name} has no completed ${source} capture`);
      }
      const discovered = arm.discovered ?? [];
      const shortlist = arm.shortlist ?? [];
      const members = unique(discovered, `${name} discoveries in ${id}`);
      unique(shortlist, `${name} shortlist entries in ${id}`);
      requireEvidence(discovered.every((candidate) => ids.has(candidate)), `Unknown ${name} discovery in ${id}`);
      requireEvidence(shortlist.length <= 3 && shortlist.every((candidate) => members.has(candidate)),
        `Invalid ${name} shortlist in ${id}`);
      discovered.forEach((candidate) => discoveredInEitherArm.add(candidate));
      const started = Date.parse(arm.startedAt);
      const finished = Date.parse(arm.finishedAt);
      if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) missing.push(`${name} has no valid capture times`);
      else timestamps.push(started, finished);
      if (!Array.isArray(arm.shortlist)) missing.push(`${name} has no submitted shortlist`);
      if (!Number.isFinite(arm.spendTestPathUsd) || arm.spendTestPathUsd < 0) missing.push(`${name} has no recorded spend`);
      if (name === 'service' && (!(arm.spendTestPathUsd > 0) || !/^0x[0-9a-f]{64}$/i.test(arm.paymentReference ?? ''))) {
        missing.push('service has no testnet payment reference and amount');
      }
      memberships[name] = {
        discovered: discovered.map((candidate) => aliases.get(candidate)),
        shortlist: shortlist.map((candidate) => aliases.get(candidate)),
        elapsedMs: finished - started,
        spendTestPathUsd: arm.spendTestPathUsd,
        paymentReference: arm.paymentReference,
      };
    }
    if (timestamps.length === 4 && Math.max(...timestamps) - Math.min(...timestamps) > sameWindowMs) {
      missing.push('the captures span more than 30 minutes');
    }
    requireEvidence(discoveredInEitherArm.size === candidates.length, `A candidate belongs to neither arm in ${id}`);
    const links = Object.fromEntries(order.map((candidate) => [aliases.get(candidate.id), candidate.ads.map((ad) => ad.url)]));
    key.briefs.push({ id, evidenceHash: evidenceHash(reviewerBrief), candidates: anonymized.map((candidate) => candidate.id), missing, memberships, links });
  }
  review.ready = key.briefs.every((brief) => !brief.missing.length);
  return { review, key };
}

function score(key, review) {
  requireEvidence(key.packetId === review.packetId, 'Review packet and arm membership do not match');
  const missing = key.briefs.flatMap((brief) => brief.missing.map((reason) => `${brief.id}: ${reason}`));
  if (missing.length) return { status: 'incomplete', missing };
  requireEvidence(review.briefs.length === key.briefs.length, 'Review must cover all five briefs');
  const results = key.briefs.map(({ id, evidenceHash: expected, candidates, memberships, links }) => {
    const record = review.briefs.find((brief) => brief.id === id);
    requireEvidence(record && evidenceHash(record) === expected, `Review evidence changed in ${id}`);
    requireEvidence(record && Object.keys(record.verdicts).length === candidates.length
      && candidates.every((candidate) => ratings.has(record.verdicts[candidate])), `Rate every candidate in ${id}`);
    const worthy = candidates.filter((candidate) => record.verdicts[candidate] === 'worth_call');
    unique(record.topThree, `reviewed top-three entries in ${id}`);
    requireEvidence(record.topThree.length === Math.min(3, worthy.length)
      && record.topThree.every((candidate) => worthy.includes(candidate)), `Invalid reviewed top three in ${id}`);
    const { baseline, service } = memberships;
    const additions = service.shortlist.filter((candidate) => record.topThree.includes(candidate) && !baseline.discovered.includes(candidate));
    const outcome = (arm) => ({
      shortlist: arm.shortlist, elapsedMs: arm.elapsedMs, spendTestPathUsd: arm.spendTestPathUsd,
      paymentReference: arm.paymentReference,
      unsuitable: arm.shortlist.filter((candidate) => record.verdicts[candidate] === 'unsuitable').length,
      unverified: arm.shortlist.filter((candidate) => record.verdicts[candidate] === 'unverified').length,
    });
    const mentioned = new Set([...record.topThree, ...baseline.shortlist, ...service.shortlist]);
    return { id, reviewedTopThree: record.topThree, additions, baseline: outcome(baseline), service: outcome(service),
      links: Object.fromEntries([...mentioned].map((candidate) => [candidate, links[candidate]])) };
  });
  const improvedBriefs = results.filter((brief) => brief.additions.length).length;
  const total = (arm, field) => results.reduce((sum, brief) => sum + brief[arm][field], 0);
  const pass = improvedBriefs >= 3 && total('service', 'unsuitable') <= total('baseline', 'unsuitable')
    && total('service', 'unverified') === 0;
  return { status: pass ? 'pass' : 'below_gate', improvedBriefs, results };
}

const [mode, input, output] = process.argv.slice(2);
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
if (mode === 'prepare' && input && output) {
  const { review, key } = prepare(read(input));
  mkdirSync(output, { recursive: true, mode: 0o700 });
  writeFileSync(join(output, 'review.json'), JSON.stringify(review, null, 2) + '\n', { flag: 'wx' });
  writeFileSync(join(output, 'private-key.json'), JSON.stringify(key, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(review.ready ? 'Review packet ready.' : 'Preview only. The comparison inputs are incomplete.');
} else if (mode === 'score' && input && output) {
  const result = score(read(input), read(output));
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'incomplete') process.exitCode = 2;
} else {
  console.error('Usage: compare_shortlists.mjs prepare <capture.json> <output-dir> | score <private-key.json> <review.json>');
  process.exitCode = 1;
}
