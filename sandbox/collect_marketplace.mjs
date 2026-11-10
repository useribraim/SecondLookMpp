// Runs inside the boat sandbox. Drives Chrome on the signed-in Facebook profile and prints JSON to stdout.
// Usage: node collect_marketplace.mjs '<criteria JSON>'
// Read-only: it opens search and item pages and never clicks, messages or posts.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

// A profile owned by the desktop user on display :0. (boat's browser-only view runs as a separate
// "browser" user on display :10, so its profile cannot be driven from here.)
const PROFILE = process.env.FACEBOOK_PROFILE_DIR ?? '/home/user/chrome-facebook';
const PORT = 9222;
const SCROLLS = Number(process.env.SCROLLS ?? 6);
const MAX_DETAILS = Number(process.env.MAX_DETAILS ?? 30);
const TABS = Math.max(1, Math.min(4, Math.trunc(Number(process.env.TABS)) || 3));
const criteria = JSON.parse(process.argv[2]);
const log = (text) => process.stderr.write(`[collector] ${text}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function debuggerReady() {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

// Start Chrome on the Facebook profile with a local debugging port, on the sandbox display.
async function ensureChrome() {
  if (await debuggerReady()) return;
  // A Chrome that already holds the profile (for example the browser view) must close first.
  spawn('pkill', ['-f', `user-data-dir=${PROFILE}`]).on('error', () => {});
  await sleep(1500);
  const chrome = spawn('google-chrome-stable', [
    `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`, '--remote-debugging-address=127.0.0.1',
    '--no-first-run', '--no-default-browser-check', '--window-size=1600,1000',
    // Background tabs must render and load images at full speed for parallel reading and screenshots.
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    // No "Restore pages?" notice after an unclean stop: it would show in the live view.
    '--hide-crash-restore-bubble',
    'about:blank',
  ], { env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ':0' }, detached: true, stdio: 'ignore' });
  chrome.unref();
  for (let i = 0; i < 30; i++) {
    if (await debuggerReady()) return;
    await sleep(500);
  }
  throw new Error('Chrome did not open its debugging port');
}

function locationSlug() {
  return (criteria.county ?? 'dublin').toLowerCase().replace(/[^a-z]/g, '');
}

function searchUrls() {
  const base = `https://www.facebook.com/marketplace/${locationSlug()}`;
  const price = `minPrice=${criteria.priceMinEur}&maxPrice=${criteria.priceMaxEur}`;
  const urls = [];
  for (const vehicle of criteria.vehicles) {
    // Query that the site itself answers for this model: these results are the "site filter" set.
    urls.push({ origin: 'exact', url: `${base}/search?query=${encodeURIComponent([vehicle.make, vehicle.model].filter(Boolean).join(' '))}&${price}` });
    // Model name alone catches ads without the make.
    if (vehicle.model) urls.push({ origin: 'adjacent', url: `${base}/search?query=${encodeURIComponent(vehicle.model)}&${price}` });
  }
  // Newest vehicles in the price range, with no make or model: the sweep for vague and mislabelled ads.
  urls.push({ origin: 'adjacent', url: `${base}/vehicles?${price}&minYear=${criteria.yearFrom}&maxYear=${criteria.yearTo}&sortBy=creation_time_descend` });
  urls.push({ origin: 'adjacent', url: `${base}/search?query=car&${price}&sortBy=creation_time_descend` });
  return urls;
}

async function readCards(page) {
  return page.evaluate(() => {
    const cards = new Map();
    for (const anchor of document.querySelectorAll('a[href*="/marketplace/item/"]')) {
      const match = anchor.getAttribute('href').match(/\/marketplace\/item\/(\d+)/);
      if (!match || cards.has(match[1])) continue;
      const lines = anchor.innerText.split('\n').map((line) => line.trim()).filter(Boolean);
      const image = anchor.querySelector('img');
      cards.set(match[1], { itemId: match[1], lines, photo: image?.src });
    }
    return [...cards.values()];
  });
}

async function collectSearch(page, { url, origin }) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  if (!response?.ok()) throw new Error(`Marketplace search returned HTTP ${response?.status() ?? 'unknown'}`);
  // Wait for the first result links instead of a fixed pause; a short pause lets images start.
  await page.waitForSelector('a[href*="/marketplace/item/"]', { timeout: 8000 }).catch(() => {});
  await sleep(700);
  if (/\/login|checkpoint/.test(page.url())) throw new Error('facebook_not_signed_in');
  for (let i = 0; i < SCROLLS; i++) {
    await page.mouse.wheel(0, 2500);
    await sleep(800 + Math.random() * 500);
  }
  const cards = await readCards(page);
  if (!cards.length) {
    const empty = await page.getByText(/^(no results found|no listings found|no results for .+)$/i).first().isVisible();
    if (!empty) throw new Error('Marketplace returned neither listings nor a recognised empty search');
  }
  log(`${cards.length} cards from ${origin} ${url}`);
  return cards.map((card) => ({ ...card, origin }));
}

function wanted(card) {
  const text = card.lines.join(' ').toLowerCase();
  const names = criteria.vehicles.flatMap((v) => [v.make, v.model].filter(Boolean).map((s) => s.toLowerCase()));
  const vague = !/(toyota|ford|bmw|audi|mercedes|nissan|honda|hyundai|kia|opel|vauxhall|peugeot|renault|citroen|mazda|volvo|seat|fiat|dacia|mini|lexus|land rover|jaguar|suzuki|mitsubishi|tesla)/.test(text);
  return names.some((name) => text.includes(name)) || vague;
}

async function readItem(page, card) {
  const response = await page.goto(`https://www.facebook.com/marketplace/item/${card.itemId}/`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  if (!response?.ok() || /\/login|checkpoint/.test(page.url())) throw new Error('Marketplace item could not be opened');
  // Wait for the item heading and price block, then a short pause for the main photo.
  await page.waitForFunction(() => (document.querySelector('[role="main"]')?.innerText ?? '').includes('€'), null, { timeout: 8000 });
  await sleep(1000 + Math.random() * 500);
  // One screenshot of the top of the item page: main photo, title, price and key details.
  const screenshot = (await page.screenshot({ type: 'jpeg', quality: 60 })).toString('base64'); // the visible window area
  const fields = await page.evaluate(() => {
    const main = document.querySelector('[role="main"]') ?? document.body;
    // The item text runs: title, price, "Listed ... ago", vehicle details, seller's description,
    // then "Seller information". Stop there so seller names and unrelated listings are not kept.
    const text = main.innerText.split(/\nSeller information\n/)[0].slice(0, 4000);
    const photos = [...main.querySelectorAll('img')].map((img) => img.src).filter((src) => /scontent|fbcdn/.test(src)).slice(0, 4);
    return { photos, pageText: text };
  });
  return { ...fields, screenshot };
}

await ensureChrome();
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const context = browser.contexts()[0] ?? await browser.newContext();
// Each worker gets its own window, tiled side by side on the 1920x1080 sandbox screen,
// so a live view of the screen shows all workers at once.
const SCREEN = { width: 1920, height: 1080, top: 32 };
async function openTiledWindow(index) {
  const cdp = await browser.newBrowserCDPSession();
  const opened = context.waitForEvent('page');
  await cdp.send('Target.createTarget', { url: 'about:blank', newWindow: true });
  const page = await opened;
  const width = Math.floor(SCREEN.width / TABS);
  try {
    const session = await context.newCDPSession(page);
    const { windowId } = await session.send('Browser.getWindowForTarget');
    await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    await session.send('Browser.setWindowBounds', { windowId, bounds: { left: index * width, top: SCREEN.top, width, height: SCREEN.height - SCREEN.top - 70 } });
  } catch {
    // Tiling is only for the live view; collection works without it.
  }
  return page;
}
const pages = [];
for (let i = 0; i < TABS; i++) pages.push(await openTiledWindow(i));
const started = Date.now();

// Run tasks on a fixed set of tabs: each tab takes the next task when it is free.
async function onTabs(items, task) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(pages.map(async (tab) => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(tab, items[index]);
    }
  }));
  return results;
}

try {
  const byId = new Map();
  let siteFilterCount = 0;
  const searches = searchUrls();
  const found = await onTabs(searches, (tab, search) => collectSearch(tab, search));
  found.forEach((cards, index) => {
    if (searches[index].origin === 'exact') siteFilterCount += cards.length;
    for (const card of cards) {
      const known = byId.get(card.itemId);
      if (!known || (known.origin === 'adjacent' && card.origin === 'exact')) byId.set(card.itemId, card);
    }
  });
  const cards = [...byId.values()];
  // Read half from the site's own search and half from the sweeps, where mislabelled ads hide.
  const exact = cards.filter((card) => card.origin === 'exact' && wanted(card));
  const sweep = cards.filter((card) => card.origin === 'adjacent' && wanted(card));
  const half = Math.ceil(MAX_DETAILS / 2);
  const fromSweep = sweep.slice(0, Math.max(half, MAX_DETAILS - exact.length));
  const selected = [...exact.slice(0, MAX_DETAILS - fromSweep.length), ...fromSweep];
  await onTabs(selected, async (tab, card) => {
    try {
      card.detail = await readItem(tab, card);
    } catch (error) {
      card.detailError = error.message;
    }
  });
  process.stdout.write(JSON.stringify({ ok: true, cards, detailsRead: selected.length, siteFilterCount, tabs: TABS, elapsedMs: Date.now() - started }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
} finally {
  await Promise.all(pages.map((tab) => tab.close().catch(() => {})));
  await browser.close().catch(() => {}); // Disconnects only; Chrome keeps running for the next job.
}
