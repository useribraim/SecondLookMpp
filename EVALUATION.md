# Shortlist comparison

10 November 2026, Dublin time. This round measured the public listing baseline and checked the price comparator against real ads. The full five-brief comparison still needs fresh reports from the service and blind review.

Each brief asks for a passenger car to use now. A candidate for the top three must meet the buyer's budget, model, location, year, fuel and mileage constraints on available evidence, and have no disclosed reason to rule out a normal viewing. Missing material facts stay unresolved. Count the same car once even when it appears on more than one site.

| Brief | Year | Budget | Mileage ceiling | Fuel | Standard DoneDeal ads | Extra DoneDeal ads | Motorly index count |
| --- | --- | --- | --- | --- | ---: | ---: | ---: |
| Fiesta, Dublin | 2012–2017 | €7,000 | 160,000 km | Petrol | 37 | 12 | 45 |
| Yaris, Cork | 2012–2017 | €8,000 | 160,000 km | Petrol | 3 | 2 | 5 |
| Octavia, Galway | 2015–2020 | €10,500 | 200,000 km | Diesel | 4 | 4 | 2 |
| Corolla, Limerick | 2017–2022 | €15,000 | 145,000 km | Petrol or petrol hybrid | 1 | 7 | 1 before fuel review |
| Leaf, Kildare | 2018–2022 | €13,500 | 130,000 km | Electric | 3 | 0 | 3 |

**Observed through live public sources.** The DoneDeal pass ran from 01:51 to 01:52 through the service's regular public search collector. The standard query applied model, county, price, year and mileage. Fuel was checked separately. The extra count is the number of distinct ad IDs from the damaged, vintage and commercial sections that did not appear in the standard response. Counts are collection results. They do not measure how many ads would make a buyer's shortlist. [Captured DoneDeal results](results/shortlist-baseline-2026-11-10.json)

The 25 additional ads included 17 in the damaged section, four commercial listings and four vintage cars. The commercial results were diesel Fiestas outside the buyer's fuel requirement. The vintage results were Corollas outside the requested years. One damaged Corolla exceeded the mileage ceiling in its structured fields. The other 16 damaged-section pages were read. None established an extra candidate ready for a normal viewing. One Fiesta still had ambiguous mileage and year after the description was read. Other examples included a Fiesta with a broken timing belt and an Octavia described as a repairable that needed body and restraint-system work. [Fiesta ad](https://www.donedeal.ie/damagedcars-for-sale/2013-ford-fiesta-1-0-petrol/43311623) · [Octavia ad](https://www.donedeal.ie/damagedcars-for-sale/2018-skoda-octavia-1-6tdi-drive-home/40892220)

Motorly's counts came from its public results UI. The Limerick Corolla result was diesel and failed the brief. The other searches used the listed fuel filter. The index can include duplicates and old or incorrect listings. For example, two Cork Yaris cards showed the same dealer, price, year and mileage across CarsIreland and DoneDeal. The source ads have to be checked before scoring. [Motorly public search](https://motorly.ie/cars)

An unsigned Dublin Marketplace search displayed Ford Fiesta cards. Opening the €6,900 low-mileage candidate returned a sign-in page, so its year, mileage and condition were not verified. The signed-in Marketplace baseline, the service arm and the blind shortlist review remain open. [Marketplace candidate](https://www.facebook.com/marketplace/item/2152407958694000/)

Marketplace's location filter was Dublin within 65 km, and its search returned an ad in Dunleer. The service now checks the ad's stated county separately from the search radius. A known county mismatch fails the brief, and a town without a clear county requires confirmation. This is a code change checked with local fixtures. The saved confident Facebook ads with a stated county in the previous Dublin reports all named County Dublin.

**Price probe on real listings.** With up to 120 nationwide comparison ads per model, the initial matched estimator produced ranges for seven of 39 standard DoneDeal listings that matched the checked fuel and mileage constraints. One range was misleading. The €11,950 two-seat commercial Leaf appeared in Cars and was matched to 17 ads when seat count was ignored. It appeared below a €14,995–€17,500 asking range. With seat count included, a fresh read returned two seats for the candidate, one two-seat ad in the comparison input, and no usable range once the candidate itself was excluded. A minimum of four seats would also exclude it from the buyer shortlist. [Commercial Leaf ad](https://www.donedeal.ie/cars-for-sale/nissan-leaf-2022-commercial-2-seater/42545498)

**Decision gate.** For each brief, gather the normal DoneDeal results, normal Marketplace searches with sensible model variants, and Motorly in the same time window as a fresh service run. Pool and deduplicate the candidates and hide which arm found them during review. Record the top three worthy of a call, unsuitable recommendations, sources completed, elapsed time and testnet spend for each arm. The service passes this initial gate if it adds a top-three-worthy car on at least three briefs without adding unsuitable recommendations. The DoneDeal sweep alone showed no established lift on these briefs. The combined service result is unresolved.

**Payment and refund check.** At 02:06 Dublin time, a local service accepted a 0.05 test pathUSD charge from a fresh faucet-funded wallet on Tempo Moderato. A simulated failure of the required Marketplace source produced a failed job. The test stopped the service after it saved the signed refund and before broadcast. After restart it broadcast that refund once. A separate chain receipt read confirmed the exact 0.05 test pathUSD transfer back to the payer in block 43427653. A further restart kept the confirmed state and made no second broadcast in the test. In a separate check, the refund worker found the already-mined receipt and confirmed it without submitting another transaction. The charge and refund were real testnet transactions. Source failure was simulated, and this run did not measure listing coverage. [Transaction evidence](results/refund-restart-V_Us4X_XdJyBCGnR1zmYEA.json)

**Completed search with zero results.** At 02:21 Dublin time, a fresh faucet-funded wallet paid 0.05 test pathUSD on Tempo Moderato for a local service to search live DoneDeal for a 2022 Nissan Leaf in Leitrim at €499–€500 and at most 1,000 km. The standard and adjacent queries returned zero ads. The service produced a completed empty shortlist in 1.9 seconds. No classifier call was needed. The collector now checks the declared result count and rejects malformed responses that could otherwise look empty. This was a real one-source testnet purchase and live public search. [Transaction and report evidence](results/empty-purchase-pEOo9A7Mxqfwsec9Z1moMA.json)

## Blind review

Record both arms' discoveries and shortlists before sending anything for review. Use a common 30-minute capture window for each brief. In the capture JSON, each of the five `briefs` has an `id`, the buyer's `criteria`, a `candidates` pool and two `arms` named `baseline` and `service`.

- Give each distinct vehicle one candidate `id` and an `ads` array of original ad URLs and comparable factual fields. Merge cross-posts when the evidence establishes they are the same car. A shared make, year and price alone are insufficient.
- For each arm, record `completedSources`, `startedAt`, `finishedAt`, `discovered` candidate IDs, `shortlist` candidate IDs in the arm's proposed order, and `spendTestPathUsd`. For the service include the verified purchase transaction hash as `paymentReference`.
- Include ad claims as `conditionClaims` and use `checkedNctExpiry` or `checkedTaxExpiry` only when backed by a check. Keep source references in the private capture so they can be checked after the review is recorded.

```sh
node scripts/compare_shortlists.mjs prepare results/paired-capture.json results/blind-review
node scripts/compare_shortlists.mjs score results/blind-review/private-key.json results/blind-review/review.json
```

Give the reviewer only `review.json`. It hides URLs, discovery memberships, tool ranks and payment data. The reviewer supplies `verdicts` by candidate ID using `worth_call`, `unsuitable` or `unverified`, plus the ordered `topThree` from among worthy cars. After the review is recorded, scoring unblinds both shortlists and links to the original ads. An addition must appear in both the service shortlist and the reviewer's top three, and be absent from the baseline's full discovery pool. The gate also checks aggregate unsuitable recommendations and requires zero unverified service recommendations. The scorer refuses incomplete captures.

The preview contains the 73 ads observed in the DoneDeal component. Its readiness flag is false. It lacks paired service reports and review verdicts. Motorly's earlier counts describe its index and do not complete the baseline candidate pool. [Review preview](results/shortlist-review-preview-2026-11-10/review.json)

**Access check.** Meta requires its permission for automated collection. The Centre d’accès sécurisé aux données describes Marketplace data in Meta Content Library as part of an access process for public-interest research. The plugin search surfaced marketing integrations and no connector for Marketplace vehicle listings. No permitted access route for this benchmark has been verified. The existing OpenCode configuration can incur credit charges if Extra Usage is enabled and included usage runs out. The paired runs need permitted listing access and a supplier spend limit before they can proceed. [Meta collection policy](https://about.fb.com/news/2021/04/how-we-combat-scraping/) · [CASD research access](https://www.casd.eu/en/nouveau-projet-avec-meta/) · [OpenCode Go billing](https://opencode.ai/v2/docs/console/go/)
