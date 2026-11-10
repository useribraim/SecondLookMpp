# Agent-alone baseline: used Ford Fiesta, Dublin

## Timing
- Start: 1794308213 (Tue 10 Nov 2026, 10:56:53 GMT).
- End: 1794308278 (taken just before the file write).
- Elapsed: 65 seconds.

## Requests
- Total: 8 (1 web search, 2 DoneDeal search-result pages by curl, 5 DoneDeal ad pages by curl).
- Blocked: 0.
- Useless: 1. The web search returned stale snippets whose prices and mileages did not match the live pages. I did not use them.
- I waited one second between requests to the same site.

## Sites
- DoneDeal.ie, search pages (curl, HTTP 200): worked. The page embeds JSON (`__NEXT_DATA__`). It listed 34 results for my filters (petrol, 2012-2017, up to 7,000 euro, up to 160,000 km, Dublin).
- DoneDeal.ie, ad pages (curl, HTTP 200): worked. They gave description, NCT expiry, owner count, seller type and a median-mileage indicator.
- Web search tool: worked, low value.
- Not tried: Adverts.ie, CarsIreland, Facebook Marketplace, gov.ie / motor tax / NCT lookup, any vehicle history check. Reason: the rules said use only general tools, and no ad showed a registration number.

## The three ads
Price judgement for all three rests on the same 34-ad DoneDeal set (32 usable; two ads showed 1 km and 218 km, which are plainly wrong). The list is a snapshot, not sold prices.

### 1. 2015 Fiesta Zetec S 1.0 petrol, Dublin 1 - 6,250 euro
- Link: https://www.donedeal.ie/cars-for-sale/ford-fiesta-2015-zetec-s/42630383
- Price: 6,250 euro (private seller). Year: 2015. Mileage: 115,000 km.
- NCT: valid until May 2027 (seller's word). Tax until Feb 2027.
- Price: normal to slightly high. Median of 12 comparable 2014-15 1.0 petrol ads is 5,975 euro. The Zetec S is a sportier trim, and the mileage is 32,000 km below DoneDeal's median for 2015 Fiestas (146,962 km). That supports the premium.
- Worries: the description says "140 BHP" but DoneDeal data says 65 hp, so check the engine. It has 2 owners and a previous registration in Northern Ireland or the UK. The ad says "upgraded alloy wheel" and gives no service history. It has 156 views and was listed 7 days ago.
- Ask: Is there a service history and when was the last service? Is the timing belt or chain done? Which owner are you? Why was the UK registration changed to Irish? Can I see the NCT cert? Can I get an independent inspection? Is the 6,250 euro firm?

### 2. 2016 Fiesta Titanium 1.0 petrol, North Dublin city - 5,950 euro
- Link: https://www.donedeal.ie/cars-for-sale/ford-fiesta-titanium-full-history-nct-10-2027/43243564
- Price: 5,950 euro (private seller). Year: 2016. Mileage: 148,600 km (inside the limit, but near it).
- NCT: Oct 2027 (seller says it just passed). Tax 06/2027.
- Price: looks low to normal. The 4 comparable 2016-17 ads range 5,500 to 6,900 euro (median 6,225). It has the most recent year and an NCT of about 11 months. The mileage is 22,700 km above the DoneDeal median for 2016, which explains part of the lower price.
- Worries: high mileage for the year. Previous registration in Northern Ireland. The ad claims "full service history" and "clutch 100%" without proof. The ad is 16 hours old with 69 views, so it may go fast.
- Ask: May I see the stamped service book and invoices? Which owner are you (ad says 1 owner)? Is the mileage backed by NCT records? When was the clutch and cambelt or chain last checked? Any accident or repair history? Can I take it to a mechanic?

### 3. 2012 Fiesta Titanium 1.2 petrol 5-door, Dublin 16 - 4,950 euro
- Link: https://www.donedeal.ie/cars-for-sale/2012-ford-fiesta-1-2-petrol-titanium-nct-05-27/43137375
- Price: 4,950 euro (private seller). Year: 2012. Mileage: 106,000 km.
- NCT: new, May 2027 (seller's word). Tax 06/2027.
- Price: normal. Four 2012 1.2 petrol ads cost 3,500 to 5,999 euro (median 4,700). Nine 2012-13 ads have a median of 5,500 euro. Mileage is 74,000 km below DoneDeal's median for 2012 (180,000 km). That is a very low figure, so the price could be seen as fair to good only if the mileage is true.
- Worries: very low mileage for a 2012 car. UK import (previous registration UK). It is the oldest of the three. The ad is 20 hours old with only 22 views.
- Ask: Can I see the service book stamps and the mileage in them? Can I see the UK and Irish import papers? Can I see the NCT cert with its odometer reading? When were the tyres, battery and brakes done? Is the price negotiable?

## Counts
- Ads read in full: 5 (the three above plus 43054090 and 43126765, which I rejected).
- Ads seen only as search-result rows: 34, including the 5 above.
- Comparable ads behind the price judgement: 32 usable ads in total. The narrower groups are 12 (2014-15, 1.0), 6 (2014-15, 1.2), 4 (2016-17) and 4 (2012, 1.2).
- Rejected on reading: 43126765 (5 owners; the text shows 5,750 euro while the headline shows 4,950 euro, so the price is unclear). 43054090 (3 owners, 6,500 euro, no location).

## What I could not do or verify
- Official Irish record check: I could not do it. No ad shows a registration number, and I did not ask for one. Without the plate, I cannot use the NCT, motor tax or vehicle history lookups. Every NCT date above is the seller's claim or DoneDeal's field and is not verified.
- Mileage check: I could not check it against NCT history or a history report.
- Other marketplaces: I did not search Adverts.ie, CarsIreland or Facebook Marketplace. The three ads come from one site only.
- Page 2 of the first search: I fetched it, but only used it for the price set.
- Live availability: I did not call anyone, and I did not confirm that any ad is still live.
- Photos: I did not look at them, so I cannot judge condition or find a plate in them.
- Price validity: asking prices only. I have no sold prices, and I did not use a valuation guide.
- Seller type and "trader" flags come from DoneDeal data. I did not check them.

## Confidence
- High that the three ads exist and match the details above on the day (read directly from DoneDeal on 10 Nov 2026).
- Medium that the price comments are fair. The set is small, one site, mixed trims and mileages.
- Low on car condition and honesty of mileage. The choice rests on listing text and DoneDeal's own mileage indicator, not on inspection or an official record.
- The ranking is a judgement. I weighed NCT validity, owner count, mileage against the median, and a low price. A fast check of the registration number on gov.ie would raise or lower my ranking.
