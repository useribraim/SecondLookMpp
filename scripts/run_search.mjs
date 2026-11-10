// Run one search job locally, without payment. Prints a short summary and writes the full report.
import { mkdirSync, writeFileSync } from 'node:fs';
import { validateCriteria } from '../src/criteria.mjs';
import { runSearch } from '../src/search_job.mjs';
import { facebookCollectorFromEnv } from '../src/facebook.mjs';

const criteria = validateCriteria(JSON.parse(process.argv[2] ?? JSON.stringify({
  vehicles: [{ make: 'Volkswagen', model: 'Passat' }, { make: 'Skoda', model: 'Octavia' }],
  yearFrom: 2007, yearTo: 2015, priceMaxEur: 6000,
})));

const report = await runSearch(criteria, {
  progress: (step) => console.error(`[${new Date().toISOString().slice(11, 19)}] ${step}`),
  facebookCollector: facebookCollectorFromEnv(),
});

mkdirSync('results', { recursive: true });
const file = `results/search-${report.generatedAt.replace(/[:.]/g, '-')}.json`;
writeFileSync(file, JSON.stringify(report, null, 2));

const line = (a) => `${a.valuation ? `${Math.round(a.valuation.discount * 100)}% below €${a.valuation.expectedEur}` : 'no valuation'} | €${a.priceEur} | ${a.facts.yearMin ?? '?'} ${a.facts.make ?? '?'} ${a.facts.model ?? '?'} ${a.facts.mileageKm ?? '?'} km | ${a.county ?? ''}${a.foundOutsideSiteFilter ? ' | OUTSIDE FILTER' : ''}\n    ${a.url}\n    ${a.condition.summary}${a.verdict === 'uncertain' ? `\n    uncertain: ${a.reasons.join('; ')}` : ''}`;
console.log(`sources ${JSON.stringify(report.sources)}`);
console.log(`inspected ${report.inspected}, rejected ${report.rejectedCount}, ${report.elapsedMs} ms, classifier ${report.method.classifier} ${JSON.stringify(report.method.classifierUsage)}`);
for (const warning of report.warnings) console.log(`warning: ${warning}`);
console.log('\nCONFIDENT');
report.confident.forEach((a, i) => console.log(`${i + 1}. ${line(a)}`));
console.log('\nUNCERTAIN');
report.uncertain.forEach((a, i) => console.log(`${i + 1}. ${line(a)}`));
console.log('\nREJECTED SAMPLE');
report.rejectedSample.forEach((a) => console.log(`- €${a.priceEur} ${a.title}: ${a.reasons.join('; ')}`));
console.log(`\nreport: ${file}`);
