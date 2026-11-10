# Car listing search (testnet MPP)

An agent checks price and source availability for free, then pays one testnet MPP charge for a car search.
The service searches the requested sources, compares asking prices when enough similar ads are available,
and gives the buyer up to three cars to call about with the checks to make before a viewing.

Plan and reasoning: [research/CAR-LISTING-SEARCH-PLAN.md](../../research/CAR-LISTING-SEARCH-PLAN.md).
The [evaluation](EVALUATION.md) records the five buyer briefs, observed public baselines, and remaining comparison.

## Run

Node 26. Testnet only (Tempo Moderato, chain 42431, free faucet tokens).

```bash
npm ci --ignore-scripts
node scripts/setup.mjs          # creates .env (0600): service keys and a demo buyer wallet
npm test
npm start                       # http://127.0.0.1:4320
node --env-file=.env scripts/buy_search.mjs http://127.0.0.1:4320
```

Optional parts, each switched on by a line in `.env`:

- `ANTHROPIC_API_KEY=...` turns on text and photo inspection (`claude-opus-5-5`, low effort; override with `CLASSIFIER_MODEL`).
- `OPENCODE_API_KEY=...` is the alternative: an OpenCode Go key, used for `claude-haiku-5-5` through `https://opencode.ai/inference/go/anthropic`. OpenCode Go is designed for coding-agent traffic and monitors for abuse; keep volume low.
- With neither key, a keyword check runs and every find is marked uncertain.
- `node scripts/probe_classifier.mjs <DoneDeal ad URL> ...` classifies single ads to check the setup.
- `BOAT_SANDBOX_ID=...` turns on Facebook Marketplace. Run `boat login`, then `scripts/prepare_facebook_sandbox.sh`, and sign in to Facebook yourself in the printed browser link.
- The Marketplace preview shares one JPEG feed across worker tiles and sends one frame each second. An oversized frame is reduced in quality, then in size, until it fits. It needs FFmpeg in Boat, with ImageMagick `convert` for oversized frames. Each delivered JPEG is at most 25,000 bytes. Set `LIVE_VIEW=0` to disable the preview.

To try the preview locally with FFmpeg, invented listings, and a moving test pattern:

```sh
export CAR_SEARCH_DEMO_TOKEN="$(node -p "require('node:crypto').randomBytes(32).toString('base64url')")"
echo "$CAR_SEARCH_DEMO_TOKEN"
node scripts/demonstrate_live_page.mjs --preview
```

Open the printed local URL and enter the demo token. The feed plays during the simulated Marketplace step.

## Card payments (Stripe Shared Payment Token)

The paid route also accepts a card when these values are in `.env`:

| Variable | Value |
| - | - |
| `STRIPE_SECRET_KEY` | A Stripe secret key. Use a `sk_test_` key until a test payment works. |
| `STRIPE_NETWORK_ID` | Your Stripe Business Network profile ID (see the [Stripe MPP guide](https://docs.stripe.com/payments/machine/mpp)). |
| `CARD_PRICE` | Optional. Default `0.50`, the Stripe minimum for a card. |
| `CARD_CURRENCY` | Optional. Default `eur`. |

To pay one search by card in a Stripe sandbox, run `node --env-file=.env scripts/buy_search_with_card.mjs`. It gets a test Shared Payment Token from Stripe's sandbox helper and pays the `stripe` offer. An outside agent gets its token from its own wallet, for example `npx @stripe/link-cli mpp pay` (see `/SKILL.md`, step 2b).

Each method has its own price: Tempo stays at `SEARCH_PRICE` test pathUSD. A method is offered only when its refund works: Tempo needs `TEMPO_SELLER_KEY`, and a card uses the Stripe Refunds API. If a required source fails after a card payment, the service refunds the PaymentIntent with an idempotency key per search. `test/card_payment.test.mjs` covers this flow against a simulated Stripe API.

## Endpoints

| Route | Price | Purpose |
| - | - | - |
| `GET /llms.txt`, `GET /openapi.json` | free | Discovery, price and example criteria |
| `POST /v1/searches/quote` | free | Checks price and source availability |
| `POST /v1/searches` | 0.05 test pathUSD by default | Validates criteria, issues an MPP challenge and returns `{searchId, accessToken}` after payment |
| `GET /v1/searches/{searchId}` | free | Progress and report, with `Authorization: Bearer <accessToken>` |

The service stores the token's SHA-256 hash and a 24-hour expiry. Missing, wrong and expired tokens return 404. Searches created before this change also return 404. To view the HTML report, open `/searches/{searchId}` and enter the token. Keep it out of URLs and logs.

One payment buys a search covering the requested sources, including an empty report when nothing matches. If a required source fails, the service attempts a testnet refund.

## Valuation

The service compares unique asking prices for the same make and model within one year and 30,000 km. With fewer than five ads it tries once more within two years and 60,000 km. The estimate includes the median, middle-half range and a reason. Positive `deltaEur` and `deltaPct` mean the ad asks less than the median. A sample below five ads or an inferred make or model makes the estimate uncertain. Uncertain estimates are shown and excluded from the price ranking.

## Claude Code MCP

Run the stdio server with Node 24 or newer. Set `CAR_SEARCH_URL` to the service URL and `CAR_SEARCH_RECIPIENT` to the seller address. The wrapper reads the buyer's wallet key from `BUYER_PRIVATE_KEY` in the environment of the Claude Code process. It caps a charge at `0.05` test pathUSD by default. Set `CAR_SEARCH_MAX_PRICE` for a different cap. Keep the wallet key out of the MCP config and prompts.

Pass a config like this to `claude --mcp-config /path/to/config.json`:

```json
{
  "mcpServers": {
    "car-search": {
      "command": "node",
      "args": ["/absolute/path/to/car-listing-search/src/mcp.ts"]
    }
  }
}
```

For a manual smoke test, open `/mcp` in Claude Code and check that `car-search` connects and lists `create_car_search` and `get_car_search`. The equivalent CLI connection check is `claude mcp list` after registering the server in a local config. The automated `test/mcp.test.mjs` signs a testnet payment through `mppx`, checks the resulting 202, and polls a local API through `running` and `done` using simulated Tempo RPC and listing data.

## Evidence so far (9 November 2026)

| Claim | Kind |
| - | - |
| DoneDeal search and ad pages are readable over plain HTTP; DoneDeal answers HTTP 429 when requests come too fast, so the collector spaces requests and backs off. | Real behavior |
| On DoneDeal, mislabelled cars are rare: the seller picks make, model and year from fields. Matches outside the car section were few (`damagedcars`, `vintagecars`, `commercials`). | Real behavior, one sample of keyword searches |
| Full paid flow: discovery, 400 on bad input, 402, offer check, payment, on-chain check (block 43368816), job, report in 30 s. | Real behavior on testnet, DoneDeal only, keyword check (no classifier key) |
| Valuation and ranking behavior, plus contact redaction. | Simulated (unit tests with synthetic data) |
| Text inspection (Claude Haiku 5.5 through OpenCode Go) flagged a stated engine fault and found a Nissan Qashqai listed in DoneDeal's Passat fields. | Real behavior, 3 ads |
| Facebook Marketplace works from the boat sandbox (Polish data-center IP) with the user's own sign-in. Screenshots let the classifier read Irish registration plates, for example a 2007 year on an ad without a year. | Real behavior, 30 ads |
| DoneDeal answers HTTP 403 to the boat sandbox, so the service runs on the Mac and reaches Facebook through `boat exec`. | Real behavior |
| Full search, 10 ads per source, sources in parallel: 113 s, Facebook 97 s of it. With 3 tabs, Facebook alone: 44 s. | Real behavior, one run each |
| `npx mppx@0.17.4 validate`: 26 of 26 checks pass, including a paid request and an on-chain transaction. (0.15.0 failed one check because of a client defect fixed in 0.17.4.) | Real behavior on testnet, local URL |
| A job that fails completely is refunded: the payer is read from the payment transaction and the amount is sent back. | Real behavior on testnet, one refund (block 43376385) |

## Public address

The service runs on the Mac (DoneDeal blocks data-center addresses). A Cloudflare Tunnel named
`car-listing-search` publishes it at https://mpp.ibraim.ie

```bash
cloudflared tunnel run --url http://127.0.0.1:4320 car-listing-search   # keep running
scripts/start_public.sh https://mpp.ibraim.ie
```

At this address the discovery documents, the free quote and the 402 challenge (realm `mpp.ibraim.ie`)
responded correctly on 10 November 2026.

At 17:44 GMT on 10 November 2026, `npx mppx@0.18.0 validate https://mpp.ibraim.ie --yes` passed 32 of 32
checks. The run paid the Tempo offer (testnet pathUSD) and the Stripe offer (sandbox key, test Shared
Payment Token). Both paid searches finished with a report. Without `MPPX_STRIPE_SECRET_KEY` and `--yes`,
the validator skips the card payment and passes 30 of 30 other checks. Real behavior on testnet and in a
Stripe sandbox; no real money moved.

The earlier Tailscale Funnel address, https://car-deal-finder.tail088e75.ts.net, still reaches the same
service. Through it, `npx mppx@0.17.4 validate` passed 26 of 26 checks, and a headless Claude Code
run with only the landing page prompt paid once and reported in 53 s (10 November 2026).
