# Token Radar (radar-3) — Methods

This document describes how the radar's numbers are produced, how each model term
was tested before it shipped, and where the method is weak. Every figure below
comes from the sealed snapshot, from `tools/analyze.py` (the build-time fitting
and validation script), or from `tools/fitted.json` (the constants the model
ships). Nothing here is hand-tuned after the fact: if a term failed its held-out
tests, it was dropped, and the failures are reported alongside the successes.

## 1. Data

The input is a sealed DefiLlama snapshot (`https://api.llama.fi/protocols`,
fetched 2026-11-14T01:18:33Z, `as_of` 2026-11-14) holding 758 protocols, each
with ten fields: slug, name, category, chains, TVL in USD, 7-day TVL change,
market cap, listing date, CoinGecko id, and token symbol. The snapshot also
carries a 40-protocol watchlist that the board must cover in full.

A protocol counts as **pre-token** when it records no token at all:
`mcap_usd`, `gecko_id`, and `symbol` are all null. "No token on record" is a
statement about the snapshot, not proof that no token exists anywhere; see the
limitations in section 7.

Not every pre-token protocol is rankable. Following the house's own
wrapped-product rule, the board sets aside anything that is a wrapped, staked,
or bridged product of a token that already trades: the categories Bridge,
Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC, and CEX;
names carrying `wrapped`, `staked`, or `staking`; and names beginning with an
exchange's name (Binance, Coinbase, Bybit, Kraken, Bitget, OKX, Bitfinex,
Gemini). Versioned pool names (ending in `V2`, `v1.5`, `2.0`, and similar) are
also set aside, since a versioned pool is a pool of another protocol, not a
launch still to come.

Every one of the 758 snapshot protocols is accounted for exactly once:

| Bucket | Count |
| --- | --- |
| On the board (ranked pre-token) | 198 |
| Live-token (already trades, shown at market value) | 402 |
| Excluded pre-token (wrapped / bridged / versioned / CEX rules) | 144 |
| Tokened CEX | 14 |
| **Total** | **758** |

The 198 board rows are the whole 40-protocol watchlist plus every other
rankable pre-token protocol at any TVL. The snapshot's $50M floor describes how
the snapshot was cut; it is not a ranking cutoff. The previous radar (radar-2)
both dropped eligible protocols above its floor and ranked below-floor bridges
and wrapped products; radar-3 fixes both errors.

## 2. The fitted value model

### 2.1 Form and fit

Implied launch value is a log-log fit of market cap on TVL, estimated on the
snapshot's **128 live-token protocols** (those with both a positive market cap
and positive TVL):

```
base value = exp(6.964567) × TVL^0.5223
implied    = base × growth multiplier × window multiplier
```

The exponent 0.5223 says market cap grows sub-linearly in TVL: a protocol with
100× the TVL of another is worth roughly 11× as much, not 100×. For reference,
the global median market-cap/TVL ratio across the 128 live protocols is 0.2138,
and the ratio's interquartile range is wide (25th percentile 0.0477, 75th
percentile 1.0566; 10th–90th percentile 0.0134–2.9747), which is exactly why a
flat multiple predicts poorly and why every board row carries a range.

Two multipliers adjust the base:

- **Growth** (half-weighted 7-day TVL change): `1 + (g/100) × 0.5`, with `g`
  clamped to [−50, +150]. Missing growth counts as 0.
- **Launch window** (age): ramps from 0.7 at listing to 1.0 at 90 days, stays
  at 1.0 through 1,095 days (3 years), then decays toward a floor of 0.6 over
  3,650 days. Protocols with no listing date score 0.85.

All fitting is done at build time by `tools/analyze.py`, which writes
`tools/fitted.json`; `lib/model.ts` ships those constants and recomputes every
row from the snapshot, so the arithmetic stays checkable in the page.

### 2.2 Held-out tests, and what they killed

Every candidate term was tested held-out three ways, predicting the live
protocols' actual market caps, scored by median absolute percentage error
(median APE):

1. **Split-half** — protocols split deterministically by slug hash; fit on one
   half, predict the other, both directions.
2. **Walk-forward** — fit on the older half by listing date, predict the newer
   half (older → newer).
3. **Leave-one-out** — within each category with at least 8 live protocols,
   predict each member from the rest of its category.

Results (median APE; lower is better):

| Model / term | Split-half | Walk-forward | Leave-one-out | Verdict |
| --- | --- | --- | --- | --- |
| Log-log fit `exp(a)·TVL^b` | **0.852** | — | — | kept |
| Flat global-median multiple (0.2138) | 0.936 | 0.882 | 0.856 | baseline |
| Category multiples (shrunk medians, k=5) | 0.954 | 0.989 | 0.885 | **dropped** — lost all three |
| + 7-day growth (half-weighted) | 0.929 vs 0.936 base | — | — | kept |
| + launch window (age) | 0.925 vs 0.936 base | — | — | kept |
| + chain breadth (+2% per extra chain, max 5) | 0.972 vs 0.936 base | — | — | **dropped** — made predictions worse |

Category multiples are the instructive failure: per-category medians (shrunk
toward the global median with 5 pseudo-counts) look sensible and are what a
hand-built radar would reach for, but they lost to the flat global median on
all three held-out tests. The log-log curve beat the flat multiple on the
split-half test (0.852 vs 0.936) and is the shipped base. Growth and the age
window each improved the global base slightly and were kept; chain breadth
hurt and was dropped.

The growth term also passed a genuine forward test (section 6): 7-day growth
at the snapshot predicted the next 13 days of TVL change with Spearman
correlation **+0.353** across 294 matched protocols, with monotone quintiles.
Age pointed the other way in that window (forward Spearman −0.193), consistent
with the window's decay for old protocols.

The honest headline is the error level itself: the best held-out median APE is
0.852. Launch values are genuinely hard to pin down from TVL alone. The radar
therefore never shows a point value without its range (next section) and never
presents implied value as a forecast of a future price.

## 3. Conformal value bands

Each row's "likely range" comes from the split-half residuals of the shipped
formula: for held-out live protocols, the ratio of actual market cap to
predicted value fell in these bands:

- **Middle half (25th–75th percentile): ×[0.324, 4.685]** — the range shown on
  the board. Half of held-out live protocols landed inside it.
- **10th–90th percentile: ×[0.048, 8.946]** — the wide band, shown in the
  model panel.

These are split-conformal-style bands in the loose sense: empirical quantiles
of held-out residuals, applied multiplicatively to each row's implied value.
They are wide because the market is wide — a new token's value at launch
routinely lands several-fold away from any TVL-based estimate. Example from
the board: Sentora Curator (rank 1, TVL $2.76B) has an implied value of $91.3M
with a likely range of $29.6M–$427.8M. A reader who wants a tighter number
should not use this radar; a reader who wants to know the order of magnitude
and how uncertain it is, can.

## 4. Token odds and the launch clock

Odds answer a different question from value: *will* this protocol launch a
token within 12 months? They are estimated from the peers' record — the
snapshot's own cross-section of who already has a token, by age.

The share of protocols carrying a token rises with age: about 27% under 180
days, about 85% at 3–5 years. From that share curve, the 12-month launch
hazard for a still-pre-token protocol of age `a` is

```
odds(a) = (share(a + ~1y) − share(a)) / (1 − share(a))
```

computed over ±half-year age windows, then smoothed with a 3-point moving
average over an age grid and capped to [0.02, 0.60]. The shipped global curve:

| Age | 90d | 180d | 270d | 365d | 545d | 730d | 910d | 1095d | 1460d | 1825d |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 12m odds | 0.126 | 0.113 | 0.131 | 0.199 | 0.344 | 0.483 | 0.507 | 0.361 | 0.229 | 0.083 |

The hazard peaks near 2–2.5 years (~0.50) and falls to ~0.08 past 5 years: a
protocol that has gone five years without a token is, on the peers' record,
unlikely to launch one in the next year. Category curves are computed the
same way and blended toward the global curve by pool size (weight
`n/(n+40)`), so small categories borrow most of the global shape; nine
categories have their own blended points in the shipped model. Protocols with
no listing date are scored at age 365 days.

The **launch clock** converts odds into an expected wait:
`clock = 12 / odds` months, capped at 60. At the peak hazard (~0.50) the
clock reads ~24 months; at the 5-year hazard (~0.08) it hits the 60-month
cap. The clock is an expectation under a constant-hazard reading of the odds,
not a scheduled date.

## 5. Costed verdicts ($/hour)

A high implied value is not by itself a reason to farm: the farm costs time,
and the launch may be years away or never come. Each row therefore carries a
costed verdict in expected dollars per hour:

```
EV/hour = implied value × odds × capture share ÷ hours
hours   = 1 setup hour + 15 min/week until the clock, capped at 52 weeks
```

The **capture share is 0.01%** of launch value — a stated assumption about
what fraction of a launch's value one farmer's activity might capture. It is
not estimated from data; scale every $/hour figure linearly for your own
expected share. Verdicts: **FARM** at ≥ $50/hour (a skilled-work opportunity
cost), **WATCH** at ≥ $10/hour, otherwise **SKIP**. The board's 198 rows
split **18 FARM / 106 WATCH / 74 SKIP**.

The verdict is where value and odds meet, and it changes the reading of the
top of the board. Nonce Capital (rank 7, implied $30.3M) has only 8% odds and
a 60-month clock, so it prices at $16/hour — a watch, not a farm. Steakhouse
Financial (rank 2, implied $89.2M, 34% odds, 35-month clock) prices at
$218/hour, the board's highest. Ranking by implied value alone would treat
the two as near-neighbours; the costed verdict does not.

## 6. Out-of-sample check on fresh data (27 November)

Thirteen days after the snapshot, the radar was checked against live
DefiLlama data fetched 2026-11-27 — data the model never saw:

- **Launches:** of 294 snapshot pre-token protocols matched in the fresh
  data, **2 launched** in the 13 days: doppler-finance and infinifi. The
  previous board (radar-2) had ranked them 28th and 33rd of 226, aged 638
  and 535 days — both near the odds curve's peak age. Two launches is a
  small sample and is stated as such; it is consistent with the odds curve
  but does not validate it.
- **Growth term:** snapshot 7-day growth predicted the next 13 days of TVL
  change with Spearman +0.353 (n=294, quintiles monotone) — the forward test
  cited in section 2.
- **Market context:** median 13-day TVL change was −8.3% (a down market).
  The old board's top 20 did **not** hold TVL better than the rest: their
  median change was −10.4% against −8.2% for the rest. Whatever the ranking
  measures, it is not short-term TVL resilience, and the radar does not
  claim otherwise.

## 7. Limitations

- **The snapshot is frozen at 2026-11-14.** Protocols launch, die, and move
  TVL after that date; the board is a statement about the snapshot, and the
  27 November check exists precisely because the world moved.
- **"No token on record" is not proof none exists.** A protocol may have a
  token the snapshot does not record, a points program, or an announced
  launch the snapshot cannot see. The radar says nothing about points
  programs or announcements after 14 November.
- **Implied value is a model, not a promise.** It is what the fitted curve
  says a token *would* be worth at snapshot conditions if one launched,
  with a held-out median error of 85%. Tokenomics (supply, float, lockups,
  airdrop share) are entirely outside the model.
- **Odds are ecological.** The hazard is read off a cross-section of peers,
  not from each protocol's own history or intentions; a protocol that has
  publicly ruled out a token still gets the peers' odds for its age.
- **The capture share (0.01%) is assumed, not measured.** Every $/hour figure
  inherits that assumption linearly.
- **Survivorship in the fit.** The value curve is fitted on protocols that
  both have tokens and are still listed with positive TVL and market cap;
  tokens that launched and died are absent, which likely flatters the curve.

## 8. What the numbers at the top of the board say

For orientation, the first five rows as shipped (TVL and implied value in
USD; odds are 12-month; EV/hour at the stated 0.01% capture):

| # | Protocol | TVL | Implied | Likely range | Odds | Clock | EV/h | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Sentora Curator | $2.76B | $91.3M | $29.6M–$427.8M | 23% | 52 mo | $152 | FARM |
| 2 | Steakhouse Financial | $2.75B | $89.2M | $28.9M–$417.9M | 34% | 35 mo | $218 | FARM |
| 3 | Gauntlet | $1.58B | $69.3M | $22.5M–$324.8M | 34% | 35 mo | $170 | FARM |
| 4 | Veda | $1.56B | $64.3M | $20.8M–$301.3M | 44% | 27 mo | $200 | FARM |
| 5 | USDD | $1.06B | $53.9M | $17.5M–$252.5M | 39% | 30 mo | $152 | FARM |

Read rank 1 against rank 2: near-identical TVL, but Steakhouse is 543 days
old (near the odds peak) against Sentora's 407, so the same value at higher
odds and a shorter clock prices 43% higher per hour. That difference — value
× odds ÷ time — is the radar's actual output; the implied-value ranking is
only its first column.

## 9. How to reproduce

Two commands regenerate everything, from the sealed snapshot alone:

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
python3 tools/analyze.py <snapshot.json> <fresh_protocols.json>
```

- `main.ts` reads the snapshot and writes `board.json`, `data.js`, and
  `dossier.json` — the exact files this entry ships. It is deterministic:
  the same snapshot always produces the same board, byte for byte.
- `tools/analyze.py` refits the value curve, the category multiples, the
  conformal bands, and the odds curves from the snapshot, reruns all three
  held-out tests, and (given a fresh DefiLlama protocols file as its second
  argument) repeats the out-of-sample check of section 6. It writes the
  results to `tools/fitted.json` and prints every number cited in this
  document, so each figure above can be re-derived rather than trusted.

The fitting script needs nothing beyond Python 3's standard library; the
entrypoint needs Node 22. No network is used by either at run time — the
fresh-data file for the out-of-sample check is an input, fetched separately,
and the shipped dashboard is fully static.
