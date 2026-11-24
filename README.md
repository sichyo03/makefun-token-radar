# Token Radar — make.fun bounty entry (`token-radar-01`)

[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/sichyo03/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/sichyo03/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

A token launch radar: it reads a sealed DefiLlama snapshot (as of 2026-11-14), finds the
protocols that still record no token and are not a wrapped or staked product of one that
trades, ranks them by what their launch would be worth, and hands in a static dashboard
(board, per-protocol detail view, farm steps) plus `board.json` and `dossier.json`.

- **Bounty:** Build the best token launch radar — $1,325 total (1st $1,000; 2nd–5th $50;
  6th–10th $25). Deadline **2026-12-14T10:00:00Z (14 Dec 17:00 WIB)**.
- **Result:** **226 rows** — the whole 40-protocol watchlist plus all 186 rankable pre-token
  protocols below the $50M floor. Top implied value: **Steakhouse Financial, $599.2M**.

## Files

| Path | What it is |
| --- | --- |
| `main.ts` | Node 22 entry point (standard library only). Reads the snapshot, writes `board.json`, `data.js`, copies `dashboard/` and `screenshots/`, writes `dossier.json` via `vendor/makefun-board.ts`. |
| `lib/model.ts` | The ranking model (radar-2), the watchlist/early split, the live-token set-aside, farm-plan builder. |
| `vendor/makefun-board.ts` | The kit's dossier builder, copied byte-for-byte from the kit starter, plus the kit's MIT `LICENSE`. |
| `dashboard/index.html`, `dashboard/app.css`, `dashboard/app.js` | The static dashboard (3 files, 40,030 bytes). No network: no external fonts, scripts or links. |
| `board.json` | 226 ranked rows (352 KB). |
| `data.js` | The same board in the form the page reads (`window.RADAR`). |
| `dossier.json` | Built by `buildDossier` from `dashboard/` and `screenshots/` (765,910 bytes, under the 1.5 MiB cap). |
| `screenshots/1-board.png` | The board (1440×900, 163 KB). |
| `screenshots/2-detail.png` | The detail view of rank 1, Steakhouse Financial (1440×900, 204 KB). |
| `screenshots/3-filtered.png` | The board filtered to the Risk Curators category, 33 rows (1440×900, 164 KB). |
| `token-radar-01-kit/` | The downloaded kit (README/spec, `competition.yaml`, `RULES.txt`, starter, sealed snapshot). |
| `kit.tar.gz` | The kit archive as downloaded. |

## Methodology

The snapshot holds 758 protocols at or above $5M TVL (`as_of` 2026-11-14, source
DefiLlama `https://api.llama.fi/protocols`). Of those, 40 are on the kit's watchlist:
TVL ≥ $50M, no token recorded (both `gecko_id` and `symbol` null), name does not end in a
version marker, and not a wrapped/staked/bridged product (no parent protocol, category not
Bridge/Canonical Bridge/Liquid Staking/Liquid Restaking/Restaked BTC/CEX, no whole word
wrapped/staked/staking, does not begin with an exchange name). The board covers all 40,
then adds **every** other rankable pre-token protocol below the floor (186), not just the
160 highest-TVL ones the starter adds — the watchlist is a floor, never a ceiling. 24
live-token protocols are set aside on a separate tab so the board never mixes a token
that already trades with one still to come.

## Ranking logic (model radar-2)

Each protocol's implied value is:

```
implied = round(TVL × 0.20 × growth × window × breadth), minimum $1
```

- **Base multiple 0.20** — the market's own multiple: the median mcap/TVL of the 128
  live-token protocols in this snapshot that carry a market cap (median 0.2138), rounded
  down to 0.20 and clamped to [0.05, 0.50]. A launch is priced off what the market
  already pays per dollar of TVL, not off a hand-picked number.
- **Growth** — the protocol's 7-day TVL change, clamped to −50%…+150%, weighted 0.5:
  `1 + clamp(change_7d, −50, 150) / 100 × 0.5`. Unknown change counts as 0%. The median
  watchlist protocol was shrinking (−8.23% over 7 days), so growth moves ranks but never
  dominates them.
- **Launch window** — how long the protocol has run with no token: 0.7 ramping to 1.0
  under 90 days, 1.0 from 90 days to 3 years, decaying toward a 0.6 floor over 3,650
  days. Unknown age (`listed_at` null, 113 protocols) counts as 0.85. The point is
  maturity, not novelty: a protocol that has held TVL for years without a token is the
  more credible launch candidate.
- **Chain breadth** — `1 + 0.02 × min(chains − 1, 5)`, up to 1.10: a protocol live on more
  chains has more surface for a launch, worth a little, not a lot.

No protocol name is special-cased anywhere; the same formula scores every row. The
detail view recomputes each row from these factors in the page, and says whether the
recomputation matches `board.json` (it does — the page carries the multipliers at full
precision for exactly this check).

## Farm plans

Every row carries 7 steps (124–260 characters each): use a fresh wallet that holds only
the funds you plan to farm; a category-specific first action (deposit into a vault,
provide liquidity, stake, and so on) with a concrete amount and chain; one qualifying
action each week; hold the position at least 30 days; check points/claim status;
a category-specific risk check; and keep a farm log. Each step names its cost
(gas/capital) and the time it takes. Steps are templates filled from the protocol's own
category, chains and TVL — no protocol gets a plan written by hand, and no step promises
a token or a date.

## The dashboard

- **Board:** top-5 "farm first" spotlight cards with a one-line reason each; a sortable
  table (rank, protocol, TVL, 7d change, age, implied value with a bar, Watchlist/Early
  badge); rows sorted by implied value by default.
- **Detail view:** click any row (or open `#p=<slug>`): the factor breakdown with the
  page-side recomputation, why it ranks here, the 7-step farm plan with costs and times,
  and what could change the ranking.
- **Filter:** search by name/category/chain, category and chain dropdowns, watchlist-only
  toggle, sort by implied value/TVL/growth/age/name, Pre-token / Live token tabs.
  State lives in the URL hash (`#q`, `#category`, `#chain`, `#watchlist`, `#p`, `#sort`,
  `#tab`), so any view is a deep link — the screenshots were taken from such links.
- **Model panel:** the formula, the factor table and the limits, on the page itself.

## Regenerate and view locally

```bash
# from this directory; Node 22 (tested on Node 24.22.1)
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input token-radar-01-kit/input/snapshot.json
# then open out/dashboard/index.html in a browser (it loads ../data.js; no server needed)
```

`main.ts` exits non-zero if the board fails the gate (fewer than 100 rows, watchlist
incomplete, ranks not 1..N, implied values not non-increasing, farm steps out of range)
or if fewer than 3 screenshots exist. Two runs write byte-identical output (verified).

Screenshots were taken with Playwright's stock Chromium headless shell
(131.0.6778.33) at 1440×900 — `/opt/meta-chromium/chrome` refuses to start in this
environment, so the system browser was not usable. To retake them:

```bash
# with playwright-core installed and the headless shell downloaded
node shot.mjs <output-dir> <screenshots-dir>   # see /tmp/pw/shot.mjs if kept
```

## Submission steps (for Sichyo — not done here)

1. **Public GitHub repo, created after 2026-11-14**, with an OSI-approved license
   (this repo carries the kit's MIT `LICENSE`). The repo must be yours: its owner is the
   GitHub account you sign in with, or it holds `.makefun/owner.json` at the submitted
   commit, `{"wallet": "<address>"}`, naming a wallet linked to your account. Push this
   directory's contents (except `token-radar-01-kit/` and `kit.tar.gz`) and note the
   commit.
2. **make.fun account — already connected.** Sichyo's make.fun account is `@sichyo03`,
   connected on 2026-11-23 via a local agent keypair (file kept locally, mode 600,
   never sent anywhere) with `makefun login` (approval code GJMX-FPTZ). Agent wallet
   `93rmiFQfdiqwtTuEwjiCfNpwJ3zPjvmTZPbMRhw14Xcb`, API key good until 2026-12-23,
   permissions enter + comment only. The entry message is signed by a wallet linked
   to the account; a prize is claimed in USDC on Solana to that wallet. Never send a
   keypair file to anyone — it contains the private key.
3. **Transcripts via the kit CLI.** Every submission must include the transcripts of
   the AI coding-agent sessions that built it (up to 200 MB), as a makefun bundle or
   loose files — the kit's `RULES.txt` ("Before you submit, then Enter") and
   `competition.yaml` give the commands. The transcripts are matched against the code
   for authorship and priced for build cost; they are never published.
4. Submit before **2026-12-14T10:00:00Z (14 Dec 17:00 WIB)**. At most 5 submissions
   per entrant per UTC day, 10 in all; the last submission before the deadline is
   final. The program runs twice in the grader and both runs must write the same
   bytes (verified locally).
5. A snapshot identical to one already submitted is refused — but this entry's
   snapshot is this account's own build, so submit it under your own account.

## Limits and honest caveats

- **No prize is guaranteed.** An AI judge compares dashboards pairwise and entries
  rank by win rate; the judging is subjective, the same pair can be answered
  differently on a re-ask, and the final heat screens entries on their dev rating
  (the line sits at place 40). A house bot that finishes in a paid place holds that
  place and its prize is not awarded.
- **The ranking is a model, not a prediction.** Implied value is what a launch would
  be worth *if the protocol's record stayed as it is*; it does not predict whether or
  when a token is issued. The base multiple comes from live tokens' mcap/TVL, which
  assumes a new token would be priced like existing ones — a rough analogy, and the
  0.20 multiple, the 0.5 growth weight and the window/breadth factors are choices,
  not measurements.
- **"No token on record" is not proof a protocol has none.** The snapshot is
  DefiLlama's record as of 2026-11-14; a protocol on the watchlist may still have a
  token its record does not carry, and the data is already a month old by the
  deadline — a points program, a token announcement or a sharp TVL move after
  2026-11-14 would move rows more than any factor here. Re-run on a fresh snapshot
  to refresh the board.
- **Farm plans are templates, not advice.** They name costs and times, but they cannot
  know a protocol's points rules, eligibility or risks; check the protocol itself
  before depositing anything, and never farm with funds you cannot afford to lose.
- **Local grading was not possible.** The kit is a program/v1 competition whose scorer
  and reference data are not published, so `grade-local` refuses to run locally
  ("its scorer and reference data are not published in the kit"). What was verified
  instead: the kit's own gate checks inside `main.ts`, an independent re-check of
  board shape (226 rows, ranks 1..226, implied values non-increasing, watchlist fully
  covered, farm steps 20–600 chars), the page-side recomputation matching `board.json`
  on all 226 rows, determinism across two runs, no network references in the
  dashboard, and the three screenshots visually inspected (board, detail, filtered).
- **Gate limits, all inside:** dashboard 3 files / 40,030 bytes (cap 400 files /
  4 MiB); board 226 rows (cap 100–4,000, ≤8 MiB); screenshots 1440×900, 163–204 KB
  each (cap 512 KiB, long side ≤1440, short side ≥800); dossier 765,910 bytes
  (cap 1.5 MiB) with text 40,294 bytes (cap 65,536).

---

Built by an AI agent for [make.fun](https://make.fun/r/p3gwn12d)'s "Build the best token launch radar" bounty, $1,325 in USDC.
