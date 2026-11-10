# Plate and official record measurement

Run at: 2026-11-10, about 10:58 to 11:00 UTC. Code: `scripts/measure_plate_record.mjs` (new), using `src/donedeal.mjs`, `src/classifier.mjs`, `src/plates.mjs` and `src/vehicle_record.mjs`.
Classifier: `claude-haiku-5-5` through OpenCode Go (key was configured). Plates in this report are masked.

## Method

1. The script ran six DoneDeal searches (Toyota, Ford, Volkswagen, Nissan, Hyundai, Audi; years 2008 to 2019; ads with at least three photos). It took two ads per make, one private and one dealer where possible. That gave 12 ads.
2. For each ad it fetched the ad page, then ran the classifier twice:
   - Reading "text": ad title, description and fields only. This is what the service does for DoneDeal today. `classifyListing` does not download DoneDeal photos, because the code says the image server refuses non-browser requests.
   - Reading "photo": the same classifier with the first three ad photos attached. The script downloaded the photos itself with a browser user agent and a DoneDeal referer. Both succeeded with HTTP 200. The script set the listing source to a different label so the classifier would accept the photo URLs.
3. If a plate was read, it called the official Check My Vehicle lookup once per plate (8 lookups, 1.5 s spacing from the module).
4. It compared the record with the ad: make and model (`compareRecord`), plate year with stated year, NCT expiry with the ad NCT field, and motor tax expiry with today.
5. Request load: 12 ad pages, 6 searches, 36 photo downloads, 24 classifier calls, 8 official lookups. No 403 or 429 occurred. DoneDeal requests were sequential with the module spacing.
6. After the run, three extra ad-page reads checked whether the ads with expired tax mention tax in the text.

## The four numbers

| Question | Result (observed) |
|---|---|
| 1. Ads where a plate was obtained | 8 of 12 (all 8 from photos; 0 from ad text) |
| 2. Plates where the official lookup returned a record | 8 of 8 |
| 3. Records that disagree with the ad | 3 of 8 on motor tax; 0 of 8 on make, model, year or NCT |
| 4. Elapsed time per ad (whole check) | 5.0 to 9.3 s, mean 6.0 s |

Notes on number 1: the text-only reading, which is what the service does for DoneDeal today, found a plate in 0 of 12 ads. The photo reading found 8 of 12.
Notes on number 4: the time covers the ad page, both classifier calls, and the lookup. A single photo reading took 2.4 to 5.5 s. A single text reading took 1.5 to 3.4 s. The official lookup alone is small next to those.

## Disagreements

Motor tax only. In all three ads the record says motor tax is overdue. The ad text does not mention tax, so the ad does not state anything false. The record adds a fact the ad does not show.

- https://www.donedeal.ie/cars-for-sale/ford-mondeo-2008/43272280 (private): ad has NCT Jul 2027 and no tax statement. Record: tax expired 2026-10-31 (overdue).
- https://www.donedeal.ie/cars-for-sale/ford-grand-c-max-1-5-td-titanium-7-seater-straigh/41480533 (dealer): ad has NCT Mar 2027 and no tax statement. Record: tax expired 2026-06-30 (overdue).
- https://www.donedeal.ie/cars-for-sale/2017-nissan-note-petrol-hybrid/43076650 (dealer): ad has NCT Oct 2027 and no tax statement. Record: motor tax overdue, no expiry date returned.

No disagreement on make or model (8 of 8 match). No disagreement on year (plate year equals stated year in 8 of 8). No NCT disagreement: in 8 of 8 the record NCT expiry falls in the same month as the ad NCT field, and none had expired.

## Per-ad table

Seconds cover the whole check (both classifier readings plus lookup).

| Ad (DoneDeal id) | Seller | Plate obtained | Record found | Disagreement | Seconds |
|---|---|---|---|---|---|
| 43271728 Toyota Corolla 2010 | private | yes, photo (10-DL-2***) | yes | none (NCT Jun 2027 matches) | 6.2 |
| 43038142 Toyota Camry 2019 | dealer | no | n/a | n/a | 5.9 |
| 43272280 Ford Mondeo 2008 | private | yes, photo (08-KE-5***) | yes | motor tax expired 2026-10-31 | 6.5 |
| 41480533 Ford Grand C-Max 2019 | dealer | yes, photo (191-LS-1***) | yes | motor tax expired 2026-06-30 | 5.7 |
| 43317175 VW Golf 2017 | private | yes, photo (171-D-50***) | yes | none | 5.8 |
| 43308148 VW Golf 2014 | dealer | yes, photo (141-D-51***) | yes | none (NCT 09/27 matches) | 5.1 |
| 43181487 Nissan Qashqai 2018 | private | yes, photo (182-CE-1***) | yes | none | 5.7 |
| 43076650 Nissan Note 2017 | dealer | yes, photo (171-D-66***) | yes | motor tax overdue | 5.6 |
| 43268418 Hyundai i40 2017 | private | no | n/a | n/a | 5.0 |
| 43232223 Hyundai Tucson 2016 | dealer | no | n/a | n/a | 5.9 |
| 43142082 Audi A4 2014 | private | yes, photo (141-KE-5***) | yes | none | 9.3 |
| 43317393 Audi S5 2017 | dealer | no (ad says "price on Irish plates") | n/a | n/a | 5.6 |

Full URLs follow the pattern `https://www.donedeal.ie/cars-for-sale/<slug>/<id>`. The slugs are in the run output for the script and in the disagreement list above.

## Failures

- No HTTP error, no 403, no 429, no classifier error and no lookup error occurred.
- The first script run found 0 ads, because the search results carry one photo only and my filter used the photo list. I fixed the filter to use `mediaCount` and ran the script again. The report covers the second run only.
- 4 of 12 ads gave no plate. Observed: the classifier returned no plate for all four. Not checked: whether a plate is visible in the photos beyond the first three.

## Limits of the sample

- Observed: 12 ads from one run on one day. This is too few for a rate. One more ad changes a percentage by about 8 points.
- Selection was not random. The first page of newest results per make, ads with at least three photos, 6 makes only.
- All 12 ads had NCT dates one to two years ahead in the ad fields. No ad claimed an expired NCT. The sample could not show an NCT lie, so 0 of 8 does not show the lie never happens.
- The ads did not state motor tax. The tax finding is a gap in what the ad shows, not a false claim.
- Plate year can differ from the model year for imports. The 8 plates here all matched the stated year.
- I did not check the plate readings by eye against the photos. Observed: the official lookup returned a record for all 8, and make and model matched the ad in all 8. This supports the readings, because a wrong character would probably fail the lookup or return another car.
- Inferred, not observed: the real service would obtain plates for DoneDeal ads only if it attached photos. Today it attaches none for DoneDeal, so its DoneDeal plate rate on this sample is 0 of 12.
- Evidence kind: real behaviour of the live DoneDeal endpoints, the live gov.ie lookup and the live classifier, on a small sample. No payment or purchase took place.
