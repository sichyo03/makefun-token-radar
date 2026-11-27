// Token Radar, radar-4 — the scoring engine.
//
// One sealed snapshot goes in; one ranked board comes out. Every number on the
// board is recomputed here from the snapshot's own figures plus a short list of
// stated assumptions, so the whole arithmetic can be checked in the page.
//
// radar-4 keeps radar-3's statistical core exactly (same fitted curve, same
// held-out numbers, same odds, same clock) and changes how a farm is priced:
//
//   * per-chain gas costing — each plan is farmed on the cheapest chain the
//     protocol supports, at a stated USD-per-transaction assumption per chain,
//     and the gas bill (3 setup transactions + one qualifying transaction a
//     week) is subtracted before the $/hour verdict is read;
//   * minimum viable capital — the reward share is assumed to scale with the
//     capital deployed, so each row also carries the smallest deposit (on a
//     $10 grid) whose expected reward still covers gas plus a 5% yearly
//     opportunity cost on the capital itself. A FARM verdict now also requires
//     that this minimum fits a stated retail budget of $1,000.
//
// The fitted terms, and the held-out tests that kept or killed them (median
// absolute percentage error predicting live market caps, tools/analyze.py):
//
//   value curve    log-log fit exp(a) * TVL^b, split-half 0.852 — kept. A flat
//                  mcap/TVL multiple scored 0.936; category medians 0.954 and
//                  lost all three tests (split-half, walk-forward, LOO).
//   growth term    kept: 0.929 vs 0.936 on the multiple base, and 7-day growth
//                  predicted the next 13 days of TVL change out of sample
//                  (Spearman +0.353, n=294).
//   launch window  kept: 0.925 vs 0.936; age also drives the odds curve.
//   chain breadth  dropped: 0.972 vs 0.936 — it made predictions worse.
//   value ranges   split-half residuals: actual/predicted in [0.324, 4.685]
//                  for the middle half, [0.048, 8.946] for the 10-90% band.
//   token odds     the peers' record: the tokened share by age, differenced
//                  into a 12-month hazard. Peaks ~0.50 at 2-2.5 years, falls
//                  to ~0.08 past 5 years.
//   launch clock   12 / odds months, capped at 60.
//
// Board membership: every watchlist slug, plus every pre-token protocol at any
// TVL that is not a wrapped, staked or bridged product of a token that already
// trades (the house's rule). All snapshot protocols are accounted for once.

// ---------------------------------------------------------------------------
// Snapshot shape
// ---------------------------------------------------------------------------

/** One protocol record, exactly as the sealed input carries it. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

// ---------------------------------------------------------------------------
// Fitted constants and stated assumptions
// ---------------------------------------------------------------------------

export interface ModelConstants {
  /** a in exp(a) * TVL^b. */
  fit_intercept: number;
  /** b in exp(a) * TVL^b. */
  fit_exponent: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  window_ramp_days: number;
  window_full_days: number;
  window_decay_days: number;
  window_floor: number;
  unknown_window: number;
  /** Middle-half residual band, actual / predicted. */
  range_likely: [number, number];
  /** 10-90% residual band. */
  range_wide: [number, number];
  /** Assumed share of launch value one farmer's activity captures, at the plan's reference capital. */
  capture_share: number;
  /** Yearly opportunity cost charged on deployed capital in the minimum-capital test. */
  capital_apy: number;
  /** Largest minimum capital a FARM verdict may require (a stated retail budget). */
  farm_capital_cap_usd: number;
  farm_threshold_usd_h: number;
  watch_threshold_usd_h: number;
}

export const MODEL: ModelConstants = {
  fit_intercept: 6.964567,
  fit_exponent: 0.5223,
  growth_weight: 0.5,
  growth_floor: -50,
  growth_cap: 150,
  window_ramp_days: 90,
  window_full_days: 1095,
  window_decay_days: 3650,
  window_floor: 0.6,
  unknown_window: 0.85,
  range_likely: [0.324, 4.685],
  range_wide: [0.048, 8.946],
  capture_share: 0.0001,
  capital_apy: 0.05,
  farm_capital_cap_usd: 1000,
  farm_threshold_usd_h: 50,
  watch_threshold_usd_h: 10,
};

/** The model's version label, named on the dashboard. */
export const MODEL_VERSION = 'radar-4';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/**
 * Stated gas assumption: what one typical qualifying transaction (a swap, a
 * deposit, a claim) costs in USD on each chain, at snapshot-era prices. These
 * are assumptions, not measurements — the dashboard prints the whole table so
 * a reader can rescale. Chains not listed cost the default.
 */
export const GAS_USD_PER_TX: Record<string, number> = {
  Ethereum: 6.0,
  Bitcoin: 2.0,
  Tron: 0.5,
  Avalanche: 0.35,
  Arbitrum: 0.25,
  Optimism: 0.2,
  'zkSync Era': 0.2,
  Linea: 0.15,
  Scroll: 0.15,
  Base: 0.12,
  Binance: 0.12,
  Blast: 0.1,
  Mantle: 0.05,
  Sonic: 0.05,
  Berachain: 0.05,
  'Hyperliquid L1': 0.05,
  TON: 0.05,
  Polygon: 0.03,
  Fantom: 0.02,
  Sei: 0.02,
  Solana: 0.01,
  Sui: 0.01,
  Aptos: 0.01,
  Near: 0.01,
  xDai: 0.01,
  Celo: 0.01,
};

/** Gas assumption for any chain the table does not name. */
export const GAS_DEFAULT_USD = 0.5;

/** Transactions a farm plan spends before the weekly rhythm starts (fund, approve, first deposit). */
export const SETUP_TXS = 3;

/** 12-month launch hazard by age in days, smoothed, from the peers' record (global). */
export const ODDS_GLOBAL: [number, number][] = [
  [90, 0.126], [180, 0.113], [270, 0.131], [365, 0.199], [545, 0.344],
  [730, 0.483], [910, 0.507], [1095, 0.361], [1460, 0.229], [1825, 0.083],
];

/** Category hazard points where the peers' record supports them; missing ages use the global curve. */
export const ODDS_BY_CATEGORY: Record<string, Record<number, number>> = {
  'Risk Curators': { 90: 0.076, 180: 0.076, 270: 0.066 },
  'Lending': { 90: 0.044, 180: 0.039, 270: 0.232, 365: 0.265, 545: 0.484, 730: 0.6, 910: 0.176, 1460: 0.6 },
  'Basis Trading': { 180: 0.189, 270: 0.086, 365: 0.13 },
  'Onchain Capital Allocator': { 180: 0.082, 270: 0.196, 365: 0.263, 545: 0.395 },
  'Dexs': { 90: 0.333, 180: 0.45, 270: 0.275, 365: 0.493, 545: 0.099, 730: 0.281, 910: 0.34, 1095: 0.104, 1460: 0.066 },
  'Yield': { 90: 0.086, 180: 0.057, 270: 0.066, 365: 0.265 },
  'RWA': { 90: 0.345, 180: 0.206, 270: 0.072, 365: 0.147, 545: 0.188, 730: 0.536 },
  'Liquid Staking': { 90: 0.08, 180: 0.05, 270: 0.139, 365: 0.244, 545: 0.31, 730: 0.352, 910: 0.535, 1095: 0.435, 1460: 0.261 },
  'Bridge': { 90: 0.294, 180: 0.192, 270: 0.055, 365: 0.084, 545: 0.223, 730: 0.528 },
};

/** Validation summary from tools/analyze.py, headlined on the dashboard. */
export const VALIDATION = {
  live_fitted_n: 128,
  split_half_ape_loglog: 0.852,
  split_half_ape_global_median: 0.936,
  split_half_ape_category: 0.954,
  walk_forward_ape_category: 0.989,
  walk_forward_ape_global: 0.882,
  loo_ape_category: 0.885,
  loo_ape_global: 0.856,
  forward_growth_spearman: 0.353,
  forward_matched_n: 294,
  forward_launched: ['doppler-finance', 'infinifi'],
  forward_launched_prev_ranks: [28, 33],
  forward_days: 13,
};

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

/** One step of a farm plan before it is flattened to a string: action, cost, time. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export type Verdict = 'FARM' | 'WATCH' | 'SKIP';

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    fit_intercept: number;
    fit_exponent: number;
    growth_pct: number;
    growth_multiplier: number;
    window_multiplier: number;
    age_days: number | null;
    value_low_usd: number;
    value_high_usd: number;
    odds_12m: number;
    clock_months: number;
    farm_chain: string;
    gas_per_tx_usd: number;
    gas_total_usd: number;
    gross_ev_per_hour_usd: number;
    ev_per_hour_usd: number;
    reference_capital_usd: number;
    min_capital_usd: number | null;
    verdict: Verdict;
  };
  farm_steps: string[];
}

/** The dashboard's compact row: everything the page needs to explain one protocol. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  watchlist: boolean;
  growth_pct: number;
  growth_multiplier: number;
  window_multiplier: number;
  value_low_usd: number;
  value_high_usd: number;
  odds_12m: number;
  clock_months: number;
  farm_chain: string;
  gas_per_tx_usd: number;
  gas_total_usd: number;
  gross_ev_per_hour_usd: number;
  ev_per_hour_usd: number;
  reference_capital_usd: number;
  min_capital_usd: number | null;
  verdict: Verdict;
  /** The board's own farm steps, carried so the detail view shows board.json's words exactly. */
  farm_steps: string[];
}

/** A protocol whose token already trades: the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders, derived from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  validation: typeof VALIDATION;
  odds_global: [number, number][];
  gas_usd_per_tx: Record<string, number>;
  gas_default_usd: number;
  setup_txs: number;
  accounting: {
    total: number;
    board: number;
    live_tokened: number;
    excluded_pre_token: number;
    tokened_cex: number;
  };
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  farm_count: number;
  watch_count: number;
  skip_count: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Raised when the input is not a snapshot this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

// ---------------------------------------------------------------------------
// The value model (unchanged from radar-3)
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from listing to the snapshot date; null when either date is missing or unreadable. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const from = Date.parse(`${listedAt}T00:00:00Z`);
  const to = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(0, Math.floor((to - from) / DAY_MS));
}

/** The launch-window factor: ramps in over 90 days, full to 3 years, then decays to the floor. */
export function windowMultiplier(age: number | null, model: ModelConstants): number {
  if (age === null) return model.unknown_window;
  if (age < model.window_ramp_days) return 0.7 + (0.3 * age) / model.window_ramp_days;
  if (age <= model.window_full_days) return 1;
  return Math.max(model.window_floor, 1 - (age - model.window_full_days) / model.window_decay_days);
}

/** Implied launch value for one protocol, with the factors that produced it. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; windowMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finiteOr(protocol.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const windowMult = windowMultiplier(age, model);
  const curve = Math.exp(model.fit_intercept) * Math.pow(Math.max(protocol.tvl_usd, 1), model.fit_exponent);
  const implied = Math.max(1, Math.round(curve * growthMult * windowMult));
  return { implied, growthPct, growthMult, windowMult, age };
}

// ---------------------------------------------------------------------------
// Launch odds and the clock (unchanged from radar-3)
// ---------------------------------------------------------------------------

/** Linear interpolation over [age, odds] points; the nearest point holds outside the grid. */
function interpOdds(points: [number, number][], age: number): number {
  if (age <= points[0]![0]) return points[0]![1];
  for (let i = 1; i < points.length; i++) {
    if (age <= points[i]![0]) {
      const [x0, y0] = points[i - 1]!;
      const [x1, y1] = points[i]!;
      return y0 + ((y1 - y0) * (age - x0)) / (x1 - x0);
    }
  }
  return points[points.length - 1]![1];
}

/** 12-month launch odds: category points where the peers' record has them, the global curve elsewhere. */
export function launchOdds(age: number | null, category: string | null): number {
  const a = age ?? 365;
  const cat = category !== null ? ODDS_BY_CATEGORY[category] : undefined;
  const points: [number, number][] = ODDS_GLOBAL.map(([d, g]) => [d, cat?.[d] ?? g]);
  return Math.min(0.95, Math.max(0.01, interpOdds(points, a)));
}

/** Expected months to launch at a constant annual hazard, capped at 60. */
export function launchClockMonths(odds: number): number {
  return Math.min(60, Math.max(1, Math.round(12 / Math.max(odds, 0.01))));
}

// ---------------------------------------------------------------------------
// Farm costing (new in radar-4): per-chain gas and minimum viable capital
// ---------------------------------------------------------------------------

/** The farming horizon in weeks: the launch clock, capped at a year. */
export function farmWeeks(clockMonths: number): number {
  return Math.min(52, clockMonths * 4.33);
}

/** Hours of work over the horizon: one setup hour, then 15 minutes a week. */
export function farmHours(clockMonths: number): number {
  return 1 + 0.25 * farmWeeks(clockMonths);
}

/**
 * The chain a plan is farmed on: the cheapest of the protocol's chains under
 * the stated gas table (a farmer picks the cheapest venue the protocol
 * supports), with its per-transaction cost. A protocol naming no chain farms
 * on "its main chain" at the default cost.
 */
export function farmChain(p: SnapshotProtocol): { chain: string; gasPerTx: number } {
  if (p.chains.length === 0) return { chain: 'its main chain', gasPerTx: GAS_DEFAULT_USD };
  let best = p.chains[0]!;
  let bestGas = GAS_USD_PER_TX[best] ?? GAS_DEFAULT_USD;
  for (const c of p.chains.slice(1)) {
    const g = GAS_USD_PER_TX[c] ?? GAS_DEFAULT_USD;
    if (g < bestGas) {
      best = c;
      bestGas = g;
    }
  }
  return { chain: best, gasPerTx: bestGas };
}

/** The whole gas bill of a plan: setup transactions plus one qualifying transaction a week. */
export function gasTotalUsd(gasPerTx: number, clockMonths: number): number {
  return (SETUP_TXS + Math.ceil(farmWeeks(clockMonths))) * gasPerTx;
}

/** Expected dollars per hour before costs — radar-3's verdict figure, kept for comparison. */
export function grossEvPerHour(implied: number, odds: number, clockMonths: number, model: ModelConstants): number {
  return (implied * odds * model.capture_share) / farmHours(clockMonths);
}

/** Expected dollars per hour after the plan's gas bill — the figure verdicts read in radar-4. */
export function netEvPerHour(implied: number, odds: number, clockMonths: number, gasTotal: number, model: ModelConstants): number {
  return (implied * odds * model.capture_share - gasTotal) / farmHours(clockMonths);
}

/** The deposit the farm plan suggests, scaled by the protocol's own TVL. */
export function referenceCapital(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/**
 * The smallest deposit whose expected reward covers the plan's costs. The
 * reward share is assumed to scale with capital relative to the plan's
 * reference deposit (at that deposit it equals the stated capture share), so
 *
 *   EV(C) = implied * odds * capture * C / C_ref  -  gas  -  C * apy * years
 *
 * and the minimum viable capital is the first $10 step at which EV(C) >= 0.
 * Null when the per-dollar expected return never beats the opportunity cost —
 * no deposit size makes that plan pay.
 */
export function minCapitalUsd(
  implied: number,
  odds: number,
  clockMonths: number,
  gasTotal: number,
  refCapital: number,
  model: ModelConstants,
): number | null {
  const years = farmWeeks(clockMonths) / 52;
  const perDollar = (implied * odds * model.capture_share) / refCapital - model.capital_apy * years;
  if (perDollar <= 0) return null;
  const breakEven = gasTotal / perDollar;
  const stepped = Math.max(10, Math.ceil(breakEven / 10) * 10);
  return stepped > 100_000 ? null : stepped;
}

/** The verdict: net $/hour against the thresholds, with FARM also requiring an affordable minimum. */
export function verdictFor(netEvH: number, minCapital: number | null, model: ModelConstants): Verdict {
  if (netEvH >= model.farm_threshold_usd_h && minCapital !== null && minCapital <= model.farm_capital_cap_usd) return 'FARM';
  if (netEvH >= model.watch_threshold_usd_h) return 'WATCH';
  return 'SKIP';
}

// ---------------------------------------------------------------------------
// Board membership
// ---------------------------------------------------------------------------

/** A name ending in a version marker is a pool of another protocol, not a launch of its own. */
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** No token recorded at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The house's wrapped-product rule: a wrapped, staked or bridged product of a trading token. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

export function isWrappedProduct(p: SnapshotProtocol): boolean {
  return WRAPPED_CATEGORIES.has(p.category ?? '') || WRAPPED_WORD.test(p.name) || EXCHANGE_PREFIX.test(p.name);
}

/** Rankable: pre-token, not a versioned pool, not a wrapped product of another protocol. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !VERSIONED_NAME.test(p.name) && !isWrappedProduct(p);
}

/** The ranked board: the watchlist in full, plus every rankable pre-token protocol. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    const odds = launchOdds(v.age, p.category);
    const clock = launchClockMonths(odds);
    const { chain, gasPerTx } = farmChain(p);
    const gasTotal = gasTotalUsd(gasPerTx, clock);
    const gross = grossEvPerHour(v.implied, odds, clock, model);
    const net = netEvPerHour(v.implied, odds, clock, gasTotal, model);
    const refCap = referenceCapital(p);
    const minCap = minCapitalUsd(v.implied, odds, clock, gasTotal, refCap, model);
    return { p, ...v, odds, clock, chain, gasPerTx, gasTotal, gross, net, refCap, minCap };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      fit_intercept: model.fit_intercept,
      fit_exponent: model.fit_exponent,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      window_multiplier: round4(s.windowMult),
      age_days: s.age,
      value_low_usd: Math.max(1, Math.round(s.implied * model.range_likely[0])),
      value_high_usd: Math.round(s.implied * model.range_likely[1]),
      odds_12m: round4(s.odds),
      clock_months: s.clock,
      farm_chain: s.chain,
      gas_per_tx_usd: s.gasPerTx,
      gas_total_usd: round4(s.gasTotal),
      gross_ev_per_hour_usd: round4(s.gross),
      ev_per_hour_usd: round4(s.net),
      reference_capital_usd: s.refCap,
      min_capital_usd: s.minCap,
      verdict: verdictFor(s.net, s.minCap, model),
    },
    farm_steps: farmSteps(s.p, s.age, s.chain, s.gasPerTx, s.refCap, s.minCap).map(stepText),
  }));
}

// ---------------------------------------------------------------------------
// Farm plans — derived from each protocol's own record, never hand-written
// ---------------------------------------------------------------------------

/** A step flattened to one string with its cost and time, inside the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The main action for a category, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('payment')) return `Route $${capital} of payments through ${name} on ${chain} and keep the volume on record.`;
  if (c.includes('chain')) return `Use $${capital} in ${name}'s app on ${chain} and keep the position open.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The weekly qualifying action for a category. */
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'Make one qualifying action each week, such as a supply, a borrow or a repay.';
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return 'Make one qualifying action each week, such as a swap, adding liquidity or claiming yield.';
  if (c.includes('bridge')) return 'Make one qualifying action each week, such as a bridge or a swap on the destination chain.';
  if (c.includes('staking') || c.includes('restak')) return 'Make one qualifying action each week, such as restaking, claiming rewards or voting.';
  if (c.includes('perpetual') || c.includes('derivative')) return 'Make one qualifying action each week, such as a trade, a hedge or a funding payment.';
  if (c.includes('prediction')) return 'Make one qualifying action each week, such as a market position or a claim.';
  if (c.includes('curator') || c.includes('allocator')) return 'Make one qualifying action each week, such as a deposit, a rebalance or a vote.';
  if (c.includes('rwa')) return 'Make one qualifying action each week, such as a mint, a hold check or a claim.';
  if (c.includes('governance')) return 'Make one qualifying action each week, such as a vote or a delegation.';
  return 'Make one qualifying action each week, such as a deposit, a swap or a vote.';
}

/** The main risk to check for a category before committing capital. */
function riskFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'Check the liquidation terms and the oracle the protocol uses before you supply: a sharp price move can liquidate a borrow.';
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return 'Check the pool for impermanent loss and for thin liquidity before you provide it: a one-sided move can cost more than the yield.';
  if (c.includes('bridge')) return 'Check the bridge for its security model and its delay before you move funds: a bridge failure can strand them.';
  if (c.includes('staking') || c.includes('restak')) return 'Check the unstaking delay and any slashing terms before you stake: the funds may be locked longer than the farm.';
  if (c.includes('perpetual') || c.includes('derivative')) return 'Check the leverage and the liquidation price before you open a position: derivatives can lose the margin fast.';
  if (c.includes('rwa')) return 'Check what backs the yield asset and who custodies it before you mint: off-chain backing is a counterparty risk.';
  if (c.includes('insurance')) return 'Check what the cover actually pays for before you buy it: a policy that never pays is a sunk cost.';
  return 'Check the protocol for an audit, its contracts and its team before you deposit: unaudited code can lose the funds.';
}

/** A USD figure for step text: whole dollars at $1+, cents below. */
function fmtStepUsd(n: number): string {
  return n >= 1 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`;
}

/**
 * One protocol's farm plan: seven steps, each an action with a cost and a
 * time. radar-4 prices the plan on its farm chain — the cheapest chain the
 * protocol supports — and sizes the deposit from the minimum viable capital
 * when the plan can pay at all.
 */
export function farmSteps(
  p: SnapshotProtocol,
  age: number | null,
  chain: string,
  gasPerTx: number,
  refCapital: number,
  minCapital: number | null,
): FarmStep[] {
  const hold = holdDaysFor(age);
  const deposit = minCapital !== null ? Math.max(refCapital, minCapital) : refCapital;
  const multiChain = p.chains.length > 1;
  const sizing =
    minCapital !== null
      ? `Deposit at least $${minCapital}: below that, the expected reward does not cover this plan's gas and a 5% yearly cost on the capital.`
      : `No deposit size makes this plan's expected reward cover its costs at a 5% yearly capital cost — size it as a watch, not a farm.`;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `about ${fmtStepUsd(gasPerTx)} of gas for the first transaction on ${chain}`,
      time: '5 minutes',
    },
    {
      text: `${actionFor(p, deposit, chain)}${multiChain ? ` ${chain} is the cheapest of its ${p.chains.length} chains at about ${fmtStepUsd(gasPerTx)} a transaction; keep one chain per wallet.` : ''}`,
      cost: `$${deposit} of capital and about ${fmtStepUsd(SETUP_TXS * gasPerTx)} of gas for the setup transactions`,
      time: '15 minutes to set up',
    },
    {
      text: `${sizing} The plan's reference deposit is $${refCapital}; the verdicts assume the reward share scales with the capital deployed.`,
      cost: 'nothing but the sizing check',
      time: '5 minutes',
    },
    {
      text: weeklyFor(p),
      cost: `about ${fmtStepUsd(gasPerTx)} of gas a week on ${chain}`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${deposit} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes. ${riskFor(p)}`,
      cost: 'no fee to check, and never pay to claim',
      time: '15 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

// ---------------------------------------------------------------------------
// Live set, accounting, radar assembly
// ---------------------------------------------------------------------------

/** Live-token protocols by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Every snapshot protocol counted exactly once, for the accounting strip. */
export function accounting(snapshot: Snapshot, board: BoardRow[]): RadarData['accounting'] {
  const onBoard = new Set(board.map((r) => r.slug));
  let liveTokened = 0;
  let excludedPreToken = 0;
  let tokenedCex = 0;
  for (const p of snapshot.protocols) {
    if (onBoard.has(p.slug)) continue;
    if (isPreToken(p)) excludedPreToken++;
    else if (p.category === 'CEX') tokenedCex++;
    else liveTokened++;
  }
  return {
    total: snapshot.protocols.length,
    board: board.length,
    live_tokened: liveTokened,
    excluded_pre_token: excludedPreToken,
    tokened_cex: tokenedCex,
  };
}

/**
 * A board row's compact dashboard form. The multipliers ride at full
 * precision here (board.json rounds them to 4 places), so the page's
 * recomputation of the implied value is the model's own arithmetic.
 */
export function radarRow(row: BoardRow, watchlist: Set<string>, full: { growthMult: number; windowMult: number }): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    watchlist: watchlist.has(row.slug),
    growth_pct: row.model.growth_pct,
    growth_multiplier: full.growthMult,
    window_multiplier: full.windowMult,
    value_low_usd: row.model.value_low_usd,
    value_high_usd: row.model.value_high_usd,
    odds_12m: row.model.odds_12m,
    clock_months: row.model.clock_months,
    farm_chain: row.model.farm_chain,
    gas_per_tx_usd: row.model.gas_per_tx_usd,
    gas_total_usd: row.model.gas_total_usd,
    gross_ev_per_hour_usd: row.model.gross_ev_per_hour_usd,
    ev_per_hour_usd: row.model.ev_per_hour_usd,
    reference_capital_usd: row.model.reference_capital_usd,
    min_capital_usd: row.model.min_capital_usd,
    verdict: row.model.verdict,
    farm_steps: row.farm_steps,
  };
}

/** The board plus everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    validation: VALIDATION,
    odds_global: ODDS_GLOBAL,
    gas_usd_per_tx: GAS_USD_PER_TX,
    gas_default_usd: GAS_DEFAULT_USD,
    setup_txs: SETUP_TXS,
    accounting: accounting(snapshot, board),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watchlist.has(r.slug)).length,
    live_size: live.length,
    farm_count: board.filter((r) => r.model.verdict === 'FARM').length,
    watch_count: board.filter((r) => r.model.verdict === 'WATCH').length,
    skip_count: board.filter((r) => r.model.verdict === 'SKIP').length,
    rows: board.map((r) => {
      const full = impliedValue(bySlug.get(r.slug) as SnapshotProtocol, snapshot.as_of, model);
      return radarRow(r, watchlist, { growthMult: full.growthMult, windowMult: full.windowMult });
    }),
    live,
  };
  return { board, radar };
}

// ---------------------------------------------------------------------------
// Parsing, gate self-check, dashboard data
// ---------------------------------------------------------------------------

/** The snapshot out of a file's text, refused unless it has the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why the gate would refuse this board, or null: coverage, ranks, order, farm steps, values. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's whole dataset as one script: no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
