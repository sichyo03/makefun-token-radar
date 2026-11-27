# Token Radar — every value term fitted and kept only if it survives held-out tests: conformal ranges, launch odds from the peers' record, farm plans costed per chain in $/hour at minimum viable capital

[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/sichyo03/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/sichyo03/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

198 pre-token protocols ranked by fitted launch value, each with a conformal range, 12-month launch odds from the peers' record, a launch clock, and a farm verdict in $/hour **net of per-chain gas** at a stated minimum viable capital — computed from the sealed snapshot (DefiLlama protocol index, 2026-11-14, 758 protocols).

## The numbers that earn the ranking

| Test | Fitted log-log curve | Flat multiple | Category medians |
|---|---|---|---|
| Split-half held-out median APE | **0.852** | 0.936 | 0.954 |
| Walk-forward (older → newer) | — | **0.882** | 0.989 |
| Leave-one-out (categories n≥8) | — | **0.856** | 0.885 |

- Implied value = `exp(6.964567) × TVL^0.5223 × growth × window`, fitted by OLS on the 128 live protocols in the snapshot. Category multiples and chain breadth were tested held-out and dropped; the growth and window terms earned their place.
- Conformal bands from split-half residuals of the shipped formula: middle half ×[0.324, 4.685], 10–90% ×[0.048, 8.946].
- Forward check on fresh data 13 days after the snapshot (validation only): 7-day growth predicted the next move (Spearman **+0.353**, n=294); 2 of 294 launched (doppler-finance, infinifi).
- All 758 protocols accounted exactly once: 198 board + 402 live + 144 excluded + 14 CEX.

## New in radar-4: costed per chain, sized to the smallest deposit that pays

- **Per-chain gas.** Each plan farms on the cheapest chain the protocol supports, at a stated $/transaction (Ethereum $6.00, Bitcoin $2.00, Tron $0.50, Arbitrum $0.25, Base $0.12, Solana $0.01, unlisted chains $0.50; full table in `lib/model.ts` and the dashboard). The gas bill — 3 setup transactions plus one a week over the plan's horizon — comes off the expected value before the $/hour verdict.
- **Minimum viable capital.** Per row, the smallest deposit (on a $10 grid) whose expected reward still covers the gas bill plus 5% a year on the capital, assuming the reward share scales with the deposit from a stated 0.01% capture at a TVL-tiered reference deposit. FARM requires ≥ $50/hour net **and** a minimum capital ≤ $1,000.
- Effect: the FARM set is unchanged (18), but 16 marginal WATCH rows — mostly Ethereum-only, where a ~$330 gas bill wipes out thin expected value — drop to SKIP once gas is charged. Verdicts: **18 FARM / 90 WATCH / 90 SKIP**.

## Top of the board

| Rank | Protocol | TVL | Implied value | Odds 12m | Clock | Farm chain | Min capital | Verdict (net) |
|---|---|---|---|---|---|---|---|---|
| 1 | Sentora Curator | $2.76B | $91.3M | 23% | 52 mo | Solana | $10 | FARM $152/h |
| 2 | Steakhouse Financial | $2.75B | $89.2M | 34% | 35 mo | Solana | $10 | FARM $218/h |
| 3 | Gauntlet | $1.58B | $69.3M | 34% | 35 mo | Solana | $10 | FARM $170/h |
| 4 | Veda | $1.56B | $64.3M | 44% | 27 mo | Hyperliquid L1 | $10 | FARM $200/h |
| 5 | USDD | $1.06B | $53.9M | 39% | 30 mo | Binance | $10 | FARM $151/h |
| 6 | Upshift | $0.50B | $38.5M | 47% | 25 mo | Solana | $10 | FARM $130/h |
| 7 | Nonce Capital | $0.51B | $30.3M | 8% | 60 mo | Optimism | $10 | WATCH $16/h |
| 8 | OnRe | $0.31B | $28.8M | 18% | 60 mo | Solana | $10 | WATCH $36/h |
| 9 | CIAN Yield Layer | $0.28B | $28.0M | 48% | 25 mo | Mantle | $10 | FARM $96/h |
| 10 | RockawayX | $0.29B | $27.6M | 7% | 60 mo | Solana | $10 | WATCH $14/h |

Implied value is what a launch could be worth at snapshot conditions, not a promise — and "no token on record" is not proof a protocol has none.

## Reproduce

```
node main.ts --input <snapshot.json>   # writes board.json, data.js, dashboard/, screenshots/, dossier.json
python3 tools/analyze.py <snapshot.json> [fresh_protocols.json]   # re-derives every fitted constant
```

Full methodology, assumptions and limitations: [METHODS.md](METHODS.md).

Built for the make.fun Token Radar bounty by @sichyo03. Try make.fun: https://make.fun/r/p3gwn12d
