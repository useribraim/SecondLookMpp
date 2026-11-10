import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../src/server.mjs';
import { goalText } from '../src/search_job.mjs';

test('goal text names the car and the main limits', () => {
  assert.equal(goalText({ vehicles: [{ make: 'BMW', model: '5-Series' }], yearFrom: 2010, yearTo: 2015, priceMaxEur: 10000, fuelTypes: ['Diesel'], county: 'Dublin' }),
    'Looking for a BMW 5-Series, 2010-2015, under €10,000, diesel, near Dublin');
});

test('the events endpoint returns live events after a sequence number', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const runner = async (criteria, progress, { emit }) => {
    emit({ type: 'goal', text: 'Looking for a Skoda' });
    emit({ type: 'tile', id: 'donedeal', kind: 'donedeal', op: 'add', text: 'searching DoneDeal' });
    emit({ type: 'ad', op: 'add', id: 'donedeal:1', title: 'Skoda Octavia', priceEur: 4000 });
    await gate;
    return { criteria, confident: [], uncertain: [], cheapForAReason: [], rejectedCount: 0, warnings: [] };
  };
  const dataDir = mkdtempSync(join(tmpdir(), 'events-'));
  const service = await startService({ secretKey: 'f'.repeat(64), recipient: `0x${'5'.repeat(40)}`, port: 0, dataDir, runner });
  try {
    const id = 'E'.repeat(22);
    const token = 'c'.repeat(43);
    const auth = { headers: { authorization: `Bearer ${token}` } };
    service.jobs.create(id, { vehicles: [{ make: 'Skoda' }], priceMaxEur: 5000 }, null,
      { hash: createHash('sha256').update(token).digest('hex'), expiresAt: Date.now() + 60_000 });
    service.enqueue(id);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const all = await (await fetch(`${service.url}/v1/searches/${id}/events`, auth)).json();
    assert.equal(all.state, 'running');
    assert.deepEqual(all.events.map((e) => e.seq), [1, 2, 3]);
    const later = await (await fetch(`${service.url}/v1/searches/${id}/events?after=2`, auth)).json();
    assert.deepEqual(later.events.map((e) => e.type), ['ad']);
    const page = await (await fetch(`${service.url}/searches/${id}`, auth)).text();
    assert.match(page, /id="tiles"/);
    release();
    assert.equal((await fetch(`${service.url}/v1/searches/${'Z'.repeat(22)}/events`)).status, 404);
  } finally {
    release();
    await service.close?.();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
