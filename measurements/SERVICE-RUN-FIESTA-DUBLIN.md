# Service run: Ford Fiesta, Dublin, DoneDeal only

Evidence type: real behavior of the running local service at http://127.0.0.1:4320 on Tempo testnet (chain 42431), one paid search, 10 Nov 2026. This is a payment of free test tokens, not a mainnet purchase.

## Important finding about the server version

The running server process started at 00:50. The source file `src/server.mjs` changed at 02:05. The running server is older than the source.
- `POST /v1/searches/quote` returns 404 `{"error":"Unknown search"}` on the running server. The source has the route. The existing `scripts/buy_search.mjs` throws on this 404, so it does not work against this server.
- Finds have no next-step label or checks field. No find has an `official` record. `timings.officialRecordsChecked` is 0.
- Restart is needed to test these features. This run did not restart the server (as instructed).

I wrote a new script, `scripts/measure_service_run.mjs`, that tolerates the missing quote route.

## Run 1 (the only run; it succeeded)

Criteria: Ford Fiesta, Petrol, 2012-2017, priceMaxEur 7000, mileageMaxKm 160000, county Dublin, sources ["donedeal"]. The service added priceMinEur 300.

| Item | Value |
|---|---|
| Wall-clock, first request to done report | 29.1 s (24.3 s in the service, `elapsedMs` 24319) |
| Service requests by the buyer | 4 before the report (openapi, quote, unpaid POST, paid POST) plus 10 status polls (3 s interval) = 14 |
| Chain RPC requests by the buyer | 2 (the 12 non-service requests counted by the script include the 10 polls, which went to the public statusUrl) |
| Quote | 404, no quote endpoint on the running server |
| Paid | 0.05 test pathUSD |
| Receipt reference | 0xe61bd9a7a08bde3f02170a9396a3568d5d93596d4a3814581053f2e451dbdd09 (status success) |
| Search id | GdwB2FYWAla2i1jy8trYFQ |
| Final state | done |
| Refund | none (no refund field) |
| Report page | https://car-deal-finder.tail088e75.ts.net/searches/GdwB2FYWAla2i1jy8trYFQ |

The status URL and report page use the public Tailscale hostname, not 127.0.0.1.

## Report numbers

- Ads inspected: 15 (classifier calls 15, failures 0).
- DoneDeal: 36 in the site filter, 36 collected exact, 12 collected outside the filter.
- Confident: 10. Uncertain: 1. Cheap for a reason: 0. Rejected: 3 (diesel, spares or repair, year 2019).
- Finds with a price range (valuation): 10 of 11 (91%). Confident: 10 of 10. The one uncertain find has none.
- Finds with an official record attached: 0 of 11.
- Warnings: none.
- Timings (ms): donedealSearch 1890, comparables 6129, donedealAdPages 8886, inspection 7391, officialRecord 0. DoneDeal requests 29, rate limited 0.
- Classifier: claude-haiku-5-5 (opencode-go). 30762 input tokens, 4195 output tokens, list cost 0.0052 USD.
- Valuation method: log-linear regression on year and mileage over comparables, median of same year when data is thin.

## Confident finds (in report order)

| # | Link | Price | Year | Mileage | NCT (months left) | Valuation | Disc. | Score | Cautions |
|---|---|---|---|---|---|---|---|---|---|
| 1 | https://www.donedeal.ie/cars-for-sale/ford-fesita-141/43214431 | 4600 | 2014 | 108299 | Jun 2027 (7) | 7118, regression, 424 comp. | 35% | 0.49 | none |
| 2 | https://www.donedeal.ie/cars-for-sale/ford-fiesta-titanium-full-history-nct-10-2027/43243564 | 5950 | 2016 | 148600 | Oct 2027 (11) | 7922, regression, 424 | 25% | 0.45 | none |
| 3 | https://www.donedeal.ie/cars-for-sale/ford-fiesta-st-line/42802991 | 6900 | 2017 | 133575 | Apr 2028 (17) | 9241, regression, 424 | 25% | 0.45 | none |
| 4 | https://www.donedeal.ie/cars-for-sale/ford-fiesta-1-0-nct-1-27-low-mileage/43126765 | 4950 | 2015 | 158000 | Jan 2027 (2) | 6901, regression, 424 | 28% | 0.43 | none |
| 5 | https://www.donedeal.ie/cars-for-sale/ford-fiesta-for-sale-petrol/43204925 | 5500 | 2015 | 148552 | Jan 2028 (14) | 7090, regression, 424 | 22% | 0.42 | none |
| 6 | https://www.donedeal.ie/cars-for-sale/2016-ford-fiesta/43054090 | 6500 | 2016 | 117500 | Mar 2027 (4) | 8659, regression, 424 | 25% | 0.40 | none |
| 7 | https://www.donedeal.ie/cars-for-sale/ford-fiesta-sline/43251805 | 2750 | 2014 | not stated | Sep 2027 (10) | 7395, median-of-year, 221 | 63% | 0.40 | mileage not stated; price 63% below similar listings |
| 8 | https://www.donedeal.ie/cars-for-sale/ford-fiesta-2016-1-0-petrol/42700785 | 5500 | 2016 | 132000 | Nov 2026 (0) | 8307, regression, 424 | 34% | 0.38 | NCT expires soon (Nov 2026) |
| 9 | https://www.donedeal.ie/cars-for-sale/ford-fiesta-2015-zetec-s/42630383 | 6250 | 2015 | 115000 | May 2027 (6) | 7804, regression, 424 | 20% | 0.35 | none |
| 10 | https://www.donedeal.ie/cars-for-sale/2014-ford-fiesta/42555257 | 5450 | 2014 | 122000 | Nov 2027 (12) | 6845, regression, 424 | 20% | 0.35 | none |

Next-step label and checks: not present in this server version.

## Uncertain find

https://www.donedeal.ie/damagedcars-for-sale/ford-fiesta/43226638: price 600, year unknown, mileage 190 km, no NCT date, no valuation, outside the site filter, score 0.05. Reasons: "identification confidence 0.6", "year not known", "too few comparable listings to value it", "criteria match unclear". Caution: "NCT date not stated: ask the seller".

## Papercuts (exact values)

1. Quote route is missing on the running server (404 "Unknown search"), while `src/server.mjs` and `scripts/buy_search.mjs` expect it. The reference buyer fails against this server.
2. Photo contradiction. All 11 finds have a `photo` URL, but 10 `condition.summary` texts and many `yearEvidence` texts say "no photos" (for example find 1: "Five previous owners, no photos provided"; `yearEvidence` "...no photos"). Either the photo exists and the classifier did not see it, or the text is wrong. Buyers will doubt the report.
3. Find 4 contradicts itself: title "LOW MILEAGE" but mileageKm 158000, which is 2000 km under the 160000 cap. Find 4 has NCT "Jan 2027" with 2 months left and no caution. Find 8 (0 months left) does get a caution.
4. Find 7 sits in `confident` at rank 7 with a 63% discount, no mileage, and `valuation.method` "median-of-year" with no `spread`. The 63% discount is a probable error or scam signal. The report lists it as "worth calling about" next to a caution to "ask why".
5. Find 8: `nctMonthsLeft` 0 and nctExpiry "Nov 2026". Today is 10 Nov 2026. The text says "which is after today so it is not expired", which is unclear about the days left. It shows "0 months".
6. Ranking: find 7 (score 0.40, 63% discount) ranks equal to find 6 (score 0.40, 25% discount). The capped discount treats them the same. The ranking reason is not visible to a buyer. Field `reasons` is an empty array for all confident finds.
7. `valuation.comparables` is 424 for 9 finds and the same `spread` 0.21 for all regression finds. This means one pooled model for all years. The number looks like a per-car sample but is not.
8. The `notes` field contains classifier chatter, such as "the title typo 'fesita' is a spelling error" and "NCT expiry Jun 2027 is after today so no_nct is not flagged". It is present on 4 finds and absent on 6 (inconsistent).
9. Find 1 ranks first with `condition.flags` ["needs_minor_work"], 5 previous owners, and a misspelled title. Its facts have `yearEvidence` text of 200+ characters. The `plate` fact is absent even though the title has "141".
10. `facts.yearMin` and `facts.yearMax` are always equal (2014/2014). Two fields for one value is confusing.
11. Uncertain find: mileage 190 km, price 600, and "year not known" appear in a search with yearFrom 2012. It is in `damagedcars-for-sale`. It has `foundOutsideSiteFilter` true, and a buyer could think the service found a bargain. The only reason lines are classifier-internal ("identification confidence 0.6").
12. No official record and no next-step label in any find, and `cheapForAReason` is empty. This is the old server version, not a product failure. Re-run after a restart to measure them.
13. Accepted response `criteria` shows `priceMinEur: 300`, which the buyer did not send. The default is not documented in the criteria list of SKILL.md.

Raw report and status: `measurements/service-run-fiesta-dublin.json` (also contains elapsed time, request counts, receipt and the quote answer).
