# Cost per run

10 November 2026. Source: the service database (`.private/service.sqlite`, `method.classifierUsage` in each report), `boat usage`, `boat billing`, and the Claude model price list.

## Measured model use (real runs, Haiku 5.5 through OpenCode Go)

| Run (UTC) | Sources | Ads read | Input tokens | Output tokens | List cost | Time |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 00:36 | DoneDeal + Facebook | 25 | 76,023 | 11,975 | $0.0136 | 113 s |
| 00:33 | DoneDeal + Facebook | 25 | 74,735 | 12,783 | $0.0139 | 66 s |
| 00:15 | DoneDeal + Facebook | 20 | 66,786 | 8,637 | $0.0110 | 57 s |
| 00:13 | DoneDeal + Facebook | 20 | 48,639 | 9,593 | $0.0097 | 68 s |
| 00:05 | DoneDeal + Facebook | 20 | 46,362 | 9,718 | $0.0095 | 81 s |
| 00:02 | DoneDeal + Facebook | 20 | 46,787 | 8,189 | $0.0088 | 51 s |
| 10:57 | DoneDeal only | 15 | 30,762 | 4,195 | $0.0052 | 24 s |
| 11:02 | DoneDeal only | 15 | 31,766 | 5,203 | $0.0058 | 24 s |

The input tokens include the Facebook screenshots and photos. The list cost matches the Haiku 5.5 price of $0.10 input and $0.50 output per million tokens. Full runs average 60k input, 10k output and **$0.011**.

The same average run on other models (calculated, not run):

- Sonnet 5.5 ($2 / $10): about $0.22.
- Opus 5.5 ($4 / $20): about $0.44.

## Other costs per run

| Item | Money | Note |
| --- | --- | --- |
| gov.ie Check My Vehicle | $0 | Up to 8 plates, 1.5 s apart, cached 24 h. Adds up to 12 s. |
| DoneDeal | $0 | Public search, about 30–60 requests. |
| Tempo testnet | $0 | Test pathUSD only. Mainnet fees not measured. |
| Mac and Tailscale Funnel | $0 extra | Runs on the laptop. |

## Sandbox (boat.dev)

- Price: $0.036 for each VM hour. The $20 plan includes 555.56 hours each month.
- Measured: 62,870 s since 9 November 17:37 UTC, which is $0.63.
- The sandbox runs all day now, because it keeps the Facebook login. That is $0.86 a day, or about $26 a month.

## Cost for 5 and 10 runs a day

| Runs a day | Model | Sandbox, always on | Total a day | Income at $0.05 |
| ---: | ---: | ---: | ---: | ---: |
| 5 | $0.06 | $0.86 | $0.92 | $0.25 |
| 10 | $0.11 | $0.86 | $0.97 | $0.50 |
| 22 | $0.24 | $0.86 | $1.10 | $1.10 (break-even) |

The model cost is small. The always-on sandbox is most of the cost.

## Not measured

- A sandbox that starts only for a run. Start time and whether the Facebook login survives a stop are not tested here. At about 3 VM minutes for each run, the sandbox cost would be about $0.002 a run.
- A repeat run that reads only new ads. The service reads all candidate ads again on each run today.
- The OpenCode Go plan fee, and charges if Extra Usage is on.
