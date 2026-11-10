// Facebook Marketplace collector, local side. Runs sandbox/collect_marketplace.mjs in the boat sandbox
// through the boat CLI and converts its cards into the common listing schema.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { redactContacts } from './donedeal.mjs';
import { KM_PER_MILE, listing, parsePriceEur } from './listing.mjs';

const run = promisify(execFile);
const COLLECTOR_DIR = '/home/user/car-listing-collector';
const TIMEOUT_SECONDS = 900;

function boatBinary(env) {
  return env.BOAT_BIN ?? `${homedir()}/.ascii/bin/boat`;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function mileage(text) {
  const match = text.match(/([\d.,]+)\s*(k)?\s*(km|miles|mi)\b/i);
  if (!match) return undefined;
  let value = Number(match[1].replace(/,/g, ''));
  if (match[2]) value *= 1000;
  if (/mi/i.test(match[3])) value *= KM_PER_MILE;
  return Math.round(value);
}

// Mileage written in the seller's free text: "283,300 km", "237700km", "279k kms", "159,692 miles".
// Fuel figures ("4.5 l/100km") and distances to places ("within 20 km") are ignored.
export function mileageFromText(text) {
  if (!text) return undefined;
  const candidates = [];
  const full = /(?<![\d/.,])(\d{1,3}(?:[,.\s]\d{3})+|\d{4,7})\s*(km|kms|kilomet(?:er|re)s?|miles|mi)\b/gi;
  for (const m of text.matchAll(full)) {
    const value = Number(m[1].replace(/[,.\s]/g, ''));
    candidates.push(/^mi/i.test(m[2]) ? value * KM_PER_MILE : value);
  }
  const short = /(?<![\d/.,])(\d{2,3})\s*k\s*(km|kms|miles|mi)?\b/gi;
  for (const m of text.matchAll(short)) {
    const value = Number(m[1]) * 1000;
    candidates.push(m[2] && /^mi/i.test(m[2]) ? value * KM_PER_MILE : value);
  }
  const plausible = candidates.filter((km) => km >= 5_000 && km <= 700_000);
  return plausible.length ? Math.round(Math.max(...plausible)) : undefined;
}

// Card text is usually: price, (old price), title, location, mileage.
export function normalizeCard(card) {
  const lines = card.lines ?? [];
  const priceLine = lines.find((line) => /€/.test(line)) ?? '';
  const mileageLine = lines.find((line) => /\b(km|miles)\b/i.test(line));
  const textLines = lines.filter((line) => line !== priceLine && line !== mileageLine && !/^€/.test(line));
  // Item page text: title on the first line, then price, listing age, details and description.
  // Everything from "Seller information" on is dropped (seller name, other listings).
  const pageText = card.detail?.pageText?.split(/\nSeller information\n/)[0];
  const pageLines = pageText ? pageText.split('\n').map((line) => line.trim()).filter(Boolean) : [];
  const title = pageLines[0] || textLines.find((line) => !/,\s*Ireland$|^Just listed$/i.test(line)) || '';
  const yearMatch = title.match(/\b(19[5-9]\d|20[0-3]\d)\b/);
  const description = pageText ? redactContacts(pageLines.filter((line) => line !== 'Message').join('\n')) : undefined;
  const detailMileage = pageLines.find((line) => /^Driven\b/i.test(line));
  const listedLine = pageLines.find((line) => /^Listed\b/i.test(line));
  const photos = [...new Set([...(card.detail?.photos ?? []), card.photo].filter(Boolean))].slice(0, 4);
  return listing({
    source: 'facebook',
    origin: card.origin,
    id: `facebook:${card.itemId}`,
    url: `https://www.facebook.com/marketplace/item/${card.itemId}/`,
    title: title || null,
    description,
    section: 'marketplace',
    priceEur: parsePriceEur(priceLine),
    county: (listedLine?.match(/\bin (.+)$/)?.[1]) ?? textLines.find((line) => /Ireland|County|Dublin/i.test(line)),
    year: yearMatch ? Number(yearMatch[1]) : undefined,
    mileageKm: mileage(detailMileage ?? mileageLine ?? '') ?? mileageFromText(description),
    listed: listedLine,
    photos: photos.length ? photos : null,
    // Screenshot taken in the signed-in browser; the classifier reads it instead of downloading photos.
    images: card.detail?.screenshot ? [{ mediaType: 'image/jpeg', data: card.detail.screenshot }] : [],
    detailRead: Boolean(card.detail),
  });
}

// `boat exec --json` returns one envelope {"stdout", "stderr", ...} for short commands, and JSON-line
// frames {"type": "stdout" | "stderr" | "exit", "data"} when the timeout is above 600 seconds.
export function parseCollectorOutput(raw) {
  let stdout = '';
  let stderr = '';
  for (const line of raw.trim().split('\n')) {
    if (!line.trim()) continue;
    const frame = JSON.parse(line);
    // boat refused the command before it ran, for example {"event": "error", "code": "machine_not_running"}.
    if (frame.event === 'error') throw Object.assign(new Error(`boat exec refused: ${frame.error ?? frame.code}`), { code: frame.code });
    if (frame.type === 'stdout') stdout += frame.data;
    else if (frame.type === 'stderr') stderr += frame.data;
    else if (typeof frame.stdout === 'string') {
      if (frame.stdoutTruncated) throw new Error('collector output was truncated by boat exec');
      stdout += frame.stdout;
      stderr += frame.stderr ?? '';
    }
  }
  const start = stdout.indexOf('{"ok"');
  if (start < 0) throw new Error(`collector printed no result: ${stderr.slice(-400)}`);
  return JSON.parse(stdout.slice(start));
}

function finish(result) {
  if (!result.ok) throw new Error(result.error);
  // Only cards with a read item page are inspected; the rest stay counted.
  const listings = result.cards.filter((card) => card.detail).map(normalizeCard);
  if (result.detailsRead > 0 && !listings.length) throw new Error('Marketplace item pages could not be read');
  return {
    listings,
    stats: { cardsSeen: result.cards.length, detailsRead: listings.length, siteSearchResults: result.siteFilterCount, elapsedMs: result.elapsedMs },
  };
}

// Two modes: inside the sandbox (FACEBOOK_COLLECTOR_DIR set) the collector runs as a child process;
// elsewhere it runs in the sandbox named by BOAT_SANDBOX_ID through `boat exec`.
export function facebookCollectorFromEnv(env = process.env) {
  const localDir = env.FACEBOOK_COLLECTOR_DIR;
  const sandboxId = env.BOAT_SANDBOX_ID;
  if (!localDir && !sandboxId) return undefined;
  const maxDetails = Number(env.FACEBOOK_MAX_DETAILS ?? 10);
  const scrolls = Number(env.FACEBOOK_SCROLLS ?? 2);
  const tabs = Number(env.FACEBOOK_TABS ?? 3);
  if (localDir) {
    return async function collectFacebookLocally(criteria) {
      let stdout;
      try {
        ({ stdout } = await run(process.execPath, ['collect_marketplace.mjs', JSON.stringify(criteria)], {
          cwd: localDir, env: { ...process.env, MAX_DETAILS: String(maxDetails), SCROLLS: String(scrolls), TABS: String(tabs) },
          maxBuffer: 64 * 1024 * 1024, timeout: TIMEOUT_SECONDS * 1000,
        }));
      } catch (error) {
        stdout = error.stdout;
        if (!stdout) throw new Error(`collector failed: ${(error.stderr || error.message).slice(-300)}`);
      }
      const start = stdout.indexOf('{"ok"');
      if (start < 0) throw new Error('collector printed no result');
      return finish(JSON.parse(stdout.slice(start)));
    };
  }
  async function execute(command) {
    let raw;
    try {
      ({ stdout: raw } = await run(boatBinary(env), ['exec', sandboxId, '--json', '--timeout', String(TIMEOUT_SECONDS), command], { maxBuffer: 64 * 1024 * 1024, timeout: (TIMEOUT_SECONDS + 60) * 1000 }));
    } catch (error) {
      raw = error.stdout;
      if (!raw) throw new Error(`boat exec failed: ${(error.stderr || error.message).slice(0, 300)}`);
    }
    return parseCollectorOutput(raw);
  }
  return async function collectFacebook(criteria) {
    const command = `cd ${COLLECTOR_DIR} && MAX_DETAILS=${maxDetails} SCROLLS=${scrolls} TABS=${tabs} node collect_marketplace.mjs ${shellQuote(JSON.stringify(criteria))}`;
    try {
      return finish(await execute(command));
    } catch (error) {
      if (error.code !== 'machine_not_running') throw error;
      // The sandbox stops when its lifetime ends. Resume it from its snapshot and run the command again.
      await run(boatBinary(env), ['resume', sandboxId, '--json'], { timeout: 180 * 1000 });
      return finish(await execute(command));
    }
  };
}
