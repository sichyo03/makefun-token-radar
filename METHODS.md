# Token Radar radar-4 — methods

How the board is computed, what was tested, what survived, and what the
farm plans assume about cost. Every number below is recomputed from the
sealed snapshot by `tools/analyze.py`; the board itself is computed by
`lib/model.ts` from the same snapshot plus the assumptions stated here.
Fresh external data is used only for the out-of-sample check in §6 — never
for board rows.

## 1. Data

The input is the sealed snapshot: the DefiLlama protocol index as of
**2026-11-14**, 758 protocols with TVL ≥ $5M, 40 of them on the
competition watchlist. A protocol counts as **pre-token** when the
snapshot records no market cap, no CoinGecko id and no symbol for it —
"no token on record", which is not proof it has none. 128 protocols are
**live** (a market cap and positive TVL) and form the fitting sample.

Every protocol is accounted exactly once: **198** rankable pre-token rows
on the board, **402** live, **144** excluded (wrapped products, tokenized
funds and similar non-farmable entries), **14** centralized exchanges.
The global median market-cap/TVL multiple among live protocols is
**0.2138** (interquartile range 0.0477–1.0566).

## 2. The fitted value model

Implied launch value is a fitted curve, not a round-number multiple:

```
implied = round( exp(6.964567) × TVL^0.5223 × growth(change_7d) × window(age) )
```

- The curve is ordinary least squares of log(market cap) on log(TVL)
  over the 128 live protocols. The sub-linear exponent (0.5223) is the
  single most important correction over a flat multiple: big protocols
  trade at lower multiples, and the fit knows it.
- `growth` scales with 7-day TVL change, clamped to [−50%, +150%] and
  halved: `1 + clamp(change_7d, −50, 150) / 100 × 0.5`.
- `window` discounts the very young (ramping 0.7 → 1.0 over the first
  90 days) and the long-unlaunched (decaying after 3 years toward a 0.6
  floor); a missing listing date scores 0.85.

Every term had to earn its place in held-out tests — median absolute
percentage error (APE) against live market caps, three ways:

| Test | Fitted log-log | Flat global multiple | Category medians |
|---|---|---|---|
| Split-half (md5 slug split, both ways) | **0.852** | 0.936 | 0.954 |
| Walk-forward (older half fits, newer predicted) | — | **0.882** | 0.989 |
| Leave-one-out (categories with n ≥ 8) | — | **0.856** | 0.885 |

Category multiples lost every test and were dropped. Chain breadth
(+2% per extra chain) also lost (0.972 vs 0.936) and was dropped. The
growth and window terms each improved the split-half score on the
global base (0.929 and 0.925 vs 0.936) and stayed. An 85% median error
is large in absolute terms — token valuations are noisy — but it is
measured, and it beats every simpler alternative we tried.

## 3. Conformal ranges

Each row carries a range, not just a point. The bands are empirical
quantiles of the split-half residuals of the shipped formula itself
(actual ÷ predicted, with the curve refit on each half): the middle
half of held-out actuals fell within **×[0.324, 4.685]** of the
prediction, and the 10–90% band is **×[0.048, 8.946]**. The dashboard
draws the middle-half band under every value.

## 4. Launch odds and the launch clock

Odds come from the peers' record. Among non-CEX protocols, the share
that has a token rises with age — roughly 27% under six months, ~85%
at 3–5 years. From that share curve we derive a 12-month launch hazard
(the chance a still-pre-token protocol of a given age launches within a
year), smoothed over an age grid and capped to [0.02, 0.60]:

| Age (days) | 90 | 180 | 270 | 365 | 545 | 730 | 910 | 1095 | 1460 | 1825 |
|---|---|---|---|---|---|---|---|---|---|---|
| Odds (12m) | 12.6% | 11.3% | 13.1% | 19.9% | 34.4% | 48.3% | 50.7% | 36.1% | 22.9% | 8.3% |

The hazard peaks near 2–2.5 years (~50%) and falls to ~8% past five
years: a protocol that has gone five years without a token usually
never launches one. Where a category has at least 15 protocols, its
own hazard is blended with the global curve by pool size
(weight n/(n+40)); nine categories qualify. The **launch clock** is
`12 / odds` months, capped at 60 — the expected wait if the hazard
stays constant.

## 5. Costed verdicts: per-chain gas and minimum viable capital

radar-3 priced a farm plan's time but not its transactions. radar-4
charges both.

**Per-chain gas.** Each plan farms on the cheapest chain the protocol
supports, at a stated typical cost per transaction:

| Chain | $/tx | Chain | $/tx | Chain | $/tx |
|---|---|---|---|---|---|
| Ethereum | 6.00 | Linea | 0.15 | Polygon | 0.03 |
| Bitcoin | 2.00 | Scroll | 0.15 | Fantom | 0.02 |
| Tron | 0.50 | Base | 0.12 | Sei | 0.02 |
| Avalanche | 0.35 | Binance | 0.12 | Solana | 0.01 |
| Arbitrum | 0.25 | Blast | 0.10 | Sui | 0.01 |
| Optimism | 0.20 | Mantle | 0.05 | Aptos | 0.01 |
| zkSync Era | 0.20 | Sonic | 0.05 | Near | 0.01 |
| *(unlisted chains)* | *0.50* | Berachain | 0.05 | xDai | 0.01 |
| | | Hyperliquid L1 | 0.05 | Celo | 0.01 |
| | | TON | 0.05 | | |

These are stated assumptions, not live quotes — one place to change
them (`GAS_USD_PER_TX` in `lib/model.ts`). A plan spends 3 setup
transactions (fund, approve, first deposit) plus one a week over its
horizon (the launch clock, capped at 52 weeks). The gas bill comes off
the expected value before the $/hour figure:

```
EV/h net = (implied × odds × 0.01% capture − gas bill) / (1 + 0.25 × weeks)
```

**Minimum viable capital.** A plan can be positive in expectation yet
pointless at the deposit size a reader would actually use. For each
row we find the smallest deposit — on a $10 grid, from $10 up — whose
expected reward still covers the gas bill plus 5% a year on the
capital, assuming the reward share scales linearly with the deposit
from the stated 0.01% capture at a TVL-tiered reference deposit
($250 for TVL ≥ $5B, $150 ≥ $1B, $100 ≥ $100M, else $50). Rows where
no deposit size clears the bar show "never pays".

**Verdicts.** FARM: net EV/hour ≥ $50 **and** minimum capital ≤ $1,000.
WATCH: net EV/hour ≥ $10. SKIP: the rest.

**Effect of the costing.** The statistical core is unchanged — same
implied values, same ranks, same odds. The FARM set is identical (18).
What changes is the margin: **16 rows drop from WATCH to SKIP** once
gas is charged — mostly Ethereum-only protocols where a ~$330 gas bill
(55 transactions × $6) erases a thin expected value: Tori Finance,
Axis, Circle Gateway, Arcus Perps, AZverse Perps, Plasma One, Fira,
Avant avETH, 3Jane Lending, Katana Pre-Launch, Hakutora, UltraYield
Vaults, RockSolid Network, Strata Markets, CommunityV3 and MEV
Capital. Verdicts: **18 FARM / 90 WATCH / 90 SKIP** (radar-3:
18 / 106 / 74).

## 6. Out-of-sample check (fresh data, validation only)

Thirteen days after the snapshot we pulled fresh DefiLlama data and
asked how the snapshot's pre-token protocols had fared. Of 294 matched
pre-token protocols, **2 had launched** (doppler-finance, infinifi).
Seven-day growth in the snapshot predicted the forward 13-day TVL move
(Spearman **+0.353**, n=294), while age predicted it negatively
(−0.193) — consistent with the growth term earning its place and the
window discount on the long-unlaunched. The median protocol lost 8.3%
of TVL over the window; the old board's top 20 lost 10.4% against
8.2% for the rest, a reminder that the top of the board is where the
money already is, not where it is going.

## 7. Limitations

- The model prices a launch at snapshot conditions. A points program,
  a token announcement or a sharp TVL move after 2026-11-14 moves a
  row more than any factor here. Re-run on a fresh snapshot to refresh.
- An 85% median held-out error means the point values are order-of-
  magnitude guides; the conformal bands are the honest uncertainty.
- Gas figures are stated typical costs, not quotes; a congested
  Ethereum week can triple the $6 assumption, which would demote more
  Ethereum-only rows, never promote them.
- Minimum capital assumes the reward share scales with deposit size.
  Real airdrops often cap or flatten per-wallet rewards, which would
  raise the true minimum for the largest rows.
- "Pre-token" is what the snapshot records. A protocol with an
  unlisted or points-only token can appear here; the farm plan's first
  step is always to verify on the protocol's own channels.

## 8. Top of the board

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

## 9. Reproduce

```
node main.ts --input <snapshot.json>
python3 tools/analyze.py <snapshot.json> [fresh_protocols.json]
```

`main.ts` writes `board.json`, `data.js`, `dashboard/`, `screenshots/`
and `dossier.json` to the output directory; two runs on the same
snapshot produce byte-identical output. `tools/analyze.py` re-derives
every fitted constant and prints it beside the value `lib/model.ts`
ships, flagging any mismatch.
