import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('blind comparison counts a new top-three car only when the baseline never found it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'car-shortlist-'));
  const script = fileURLToPath(new URL('../scripts/compare_shortlists.mjs', import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  const capture = join(dir, 'capture.json');
  const window = { startedAt: '2026-11-10T10:00:00Z', finishedAt: '2026-11-10T10:05:00Z' };
  const briefs = Array.from({ length: 5 }, (_, index) => ({
    id: `brief-${index}`,
    criteria: { county: 'Dublin', sources: ['donedeal', 'facebook'] },
    candidates: ['a', 'b', 'c'].map((id, i) => ({
      id, ads: [{ url: `https://www.donedeal.ie/cars-for-sale/example/${i + 1}`, priceEur: (i + 1) * 1000 }],
    })),
    arms: {
      baseline: { ...window, completedSources: ['donedeal', 'facebook', 'motorly'],
        spendTestPathUsd: 0, discovered: ['a', 'b'], shortlist: ['a'] },
      service: { ...window, completedSources: ['donedeal', 'facebook'],
        spendTestPathUsd: 0.05, paymentReference: '0x' + '1'.repeat(64),
        discovered: ['b', 'c'], shortlist: [index < 3 ? 'c' : 'b'] },
    },
  }));
  try {
    writeFileSync(capture, JSON.stringify({ briefs }));
    const prepared = run('prepare', capture, dir);
    assert.equal(prepared.status, 0, prepared.stderr);
    const reviewPath = join(dir, 'review.json');
    const keyPath = join(dir, 'private-key.json');
    const review = JSON.parse(readFileSync(reviewPath));
    assert.equal(review.ready, true);
    assert.ok(review.briefs.every((brief) => !brief.criteria.sources && !brief.arms
      && brief.candidates.every((candidate) => candidate.ads.every((ad) => !ad.url))));
    for (const brief of review.briefs) {
      brief.topThree = brief.candidates.map((candidate) => candidate.id);
      brief.verdicts = Object.fromEntries(brief.topThree.map((id) => [id, 'worth_call']));
    }
    writeFileSync(reviewPath, JSON.stringify(review));
    const result = run('score', keyPath, reviewPath);
    assert.equal(result.status, 0, result.stderr);
    const scored = JSON.parse(result.stdout);
    assert.equal(scored.status, 'pass');
    assert.equal(scored.improvedBriefs, 3);
    assert.deepEqual(scored.results[4].additions, []);

    briefs[0].arms.baseline.completedSources.pop();
    writeFileSync(capture, JSON.stringify({ briefs }));
    const incompleteDir = join(dir, 'incomplete');
    assert.equal(run('prepare', capture, incompleteDir).status, 0);
    const incomplete = run('score', join(incompleteDir, 'private-key.json'), join(incompleteDir, 'review.json'));
    assert.equal(incomplete.status, 2);
    assert.match(incomplete.stdout, /no completed motorly capture/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
