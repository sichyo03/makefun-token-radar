// Token Radar, radar-3: one snapshot of the protocol universe in, one ranked board out —
// with every value term fitted on the snapshot's own live protocols and tested held-out,
// token odds from the peers' record, a launch clock, conformal value ranges, and costed
// farm verdicts in $/hour. Fitting and testing happened at build time (tools/analyze.py,
// which writes tools/fitted.json); this file ships the fitted constants and recomputes
// every row from the snapshot, so the arithmetic stays checkable in the page.
//
// What the tests decided (median absolute percentage error predicting live market caps):
//   value form      log-log fit exp(a) * TVL^b, split-half 0.852 — kept. A flat mcap/TVL
//                   multiple scored 0.936 (global median) and 0.954 (category medians);
//                   category multiples lost all three held-out tests and were dropped.
//   growth term     kept: 0.929 vs 0.936 on the multiple base, and on the forward test
//                   (snapshot 14 Nov -> live DefiLlama 27 Nov) 7-day growth predicted the
//                   next 13 days of TVL change with Spearman +0.353, quintiles monotone.
//   launch window   kept: 0.925 vs 0.936; age also drives the odds curve below.
//   chain breadth   dropped: 0.972 vs 0.936 — it made held-out predictions worse.
//   value ranges    split-half residuals of this formula: actual/predicted fell in
//                   [0.324, 4.685] for the middle half and [0.048, 8.946] for 10-90%.
//                   The board shows the middle-half range; it is wide because the market is.
//   token odds      from the peers' record: the share of protocols carrying a token rises
//                   with age (27% under 180 days, 85% at 3-5 years); the 12-month launch
//                   hazard for a still-pre-token protocol peaks near 2-2.5 years (~0.50)
//                   and falls to ~0.08 past 5 years. Category curves blend toward the
//                   global curve by pool size. Out-of-sample: in the 13 days after the
//                   snapshot, 2 of 294 matched pre-token protocols launched; the previous
//                   board ranked them 28th and 33rd of 226, aged 638 and 535 days.
//   launch clock    expected months to launch = 12 / odds, capped at 60.
//   costed verdict  EV/hour = implied * odds * capture / hours, with capture = 0.01% of
//                   launch value (a stated assumption; scale it linearly for your share)
//                   and hours = 1 setup hour + 15 min/week until the clock, capped at a
//                   year of weeks. FARM at $50/hour or more (skilled-work opportunity
//                   cost), WATCH at $10, else SKIP.
//
// The board covers every watchlist slug and every pre-token protocol at any TVL that is
// not a wrapped, staked or bridged product of another protocol (the house's own rule:
// WBTC is Bitcoin on Ethereum, not a launch still to come). Live-token protocols are set
// aside with the market's own values. The accounting strip counts all 758 snapshot
// protocols exactly once.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The fitted constants, as the dashboard states them. Fitted by tools/analyze.py. */
export interface ModelConstants {
  fit_intercept: number; // a in exp(a) * TVL^b
  fit_exponent: number; // b
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  window_ramp_days: number;
  window_full_days: number;
  window_decay_days: number;
  window_floor: number;
  unknown_window: number;
  range_likely: [number, number]; // middle-half residual band, actual/predicted
  range_wide: [number, number]; // 10-90% residual band
  capture_share: number; // assumed farmer share of launch value
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
  farm_threshold_usd_h: 50,
  watch_threshold_usd_h: 10,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** 12-month launch hazard by age in days, smoothed, from the peers' record (global). */
export const ODDS_GLOBAL: [number, number][] = [
  [90, 0.126], [180, 0.113], [270, 0.131], [365, 0.199], [545, 0.344],
  [730, 0.483], [910, 0.507], [1095, 0.361], [1460, 0.229], [1825, 0.083],
];

/** Category hazard points where the peers' record supports them; missing ages use global. */
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

/** Validation summary from tools/analyze.py, shown on the integrity strip. */
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

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
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
    ev_per_hour_usd: number;
    verdict: 'FARM' | 'WATCH' | 'SKIP';
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with everything the page needs to explain it. */
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
  ev_per_hour_usd: number;
  verdict: 'FARM' | 'WATCH' | 'SKIP';
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  validation: typeof VALIDATION;
  odds_global: [number, number][];
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
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The launch-window factor for an age in days; null age scores the unknown factor. */
export function windowMultiplier(age: number | null, model: ModelConstants): number {
  if (age === null) return model.unknown_window;
  if (age < model.window_ramp_days) return 0.7 + (0.3 * age) / model.window_ramp_days;
  if (age <= model.window_full_days) return 1;
  return Math.max(model.window_floor, 1 - (age - model.window_full_days) / model.window_decay_days);
}

/** Linear interpolation over [age, odds] points; outside the grid, the nearest point holds. */
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

/** 12-month launch odds from the peers' record: category points where they exist, else global. */
export function launchOdds(age: number | null, category: string | null): number {
  const a = age ?? 365;
  const cat = category !== null ? ODDS_BY_CATEGORY[category] : undefined;
  const points: [number, number][] = ODDS_GLOBAL.map(([d, g]) => [d, cat?.[d] ?? g]);
  return Math.min(0.95, Math.max(0.01, interpOdds(points, a)));
}

/** Expected months to launch at a constant annual hazard: 12 / odds, capped at 60. */
export function launchClockMonths(odds: number): number {
  return Math.min(60, Math.max(1, Math.round(12 / Math.max(odds, 0.01))));
}

/** Costed verdict: expected dollars per hour of farming, under the stated capture share. */
export function evPerHour(implied: number, odds: number, clockMonths: number, model: ModelConstants): number {
  const weeks = Math.min(52, clockMonths * 4.33);
  const hours = 1 + 0.25 * weeks;
  return (implied * odds * model.capture_share) / hours;
}

export function verdictFor(evH: number, model: ModelConstants): 'FARM' | 'WATCH' | 'SKIP' {
  if (evH >= model.farm_threshold_usd_h) return 'FARM';
  if (evH >= model.watch_threshold_usd_h) return 'WATCH';
  return 'SKIP';
}

/** The fitted factors and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; windowMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const windowMult = windowMultiplier(age, model);
  const base = Math.exp(model.fit_intercept) * Math.pow(Math.max(protocol.tvl_usd, 1), model.fit_exponent);
  const implied = Math.max(1, Math.round(base * growthMult * windowMult));
  return { implied, growthPct, growthMult, windowMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The house's own wrapped-product rule (kit input/README.md): a wrapped, staked or bridged
    product of a token that already trades is not a protocol waiting on a launch of its own. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

export function isWrappedProduct(p: SnapshotProtocol): boolean {
  return WRAPPED_CATEGORIES.has(p.category ?? '') || WRAPPED_WORD.test(p.name) || EXCHANGE_PREFIX.test(p.name);
}

/** Whether a protocol is one the board may rank: pre-token, not a versioned pool, and not a
    wrapped, staked or bridged product of another protocol. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !VERSIONED.test(p.name) && !isWrappedProduct(p);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // Every rankable pre-token protocol, at any TVL, under the house's wrapped-product rule:
  // radar-2 ranked below-floor bridges and wrapped products it should have set aside, and
  // its floor rule also hid eligible protocols above the floor that were not on the watchlist.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const { implied, growthPct, growthMult, windowMult, age } = impliedValue(p, snapshot.as_of, model);
    const odds = launchOdds(age, p.category);
    const clock = launchClockMonths(odds);
    const evH = evPerHour(implied, odds, clock, model);
    return { p, implied, growthPct, growthMult, windowMult, age, odds, clock, evH };
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
      ev_per_hour_usd: round4(s.evH),
      verdict: verdictFor(s.evH, model),
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main action, in the words a farmer can follow. */
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

/** The category's weekly qualifying action. */
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

/** The category's main risk to check before committing capital. */
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

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const extraChain = p.chains.length > 1 ? ` If ${p.chains[1]} is cheaper to use, do the same action there instead and keep one chain per wallet.` : '';
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: `${action}${extraChain}`,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyFor(p),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: riskFor(p),
      cost: 'nothing but the check',
      time: '15 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
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

/** Every snapshot protocol counted exactly once, for the integrity strip. */
export function accounting(snapshot: Snapshot, board: BoardRow[]): RadarData['accounting'] {
  const boardSlugs = new Set(board.map((r) => r.slug));
  let liveTokened = 0;
  let excludedPreToken = 0;
  let tokenedCex = 0;
  for (const p of snapshot.protocols) {
    if (boardSlugs.has(p.slug)) continue;
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

/** A board row's compact form for data.js, with the factors the page explains. The multipliers
    are carried at full precision here (board.json rounds them to 4 places for reading), so the
    page's recomputation of the implied value is bit-for-bit the model's own arithmetic. */
export function radarRow(
  row: BoardRow,
  watchlist: Set<string>,
  full: { growthMult: number; windowMult: number },
): RadarRow {
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
    ev_per_hour_usd: row.model.ev_per_hour_usd,
    verdict: row.model.verdict,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const watchlist = new Set(snapshot.watchlist);
  const bySlugMap = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    validation: VALIDATION,
    odds_global: ODDS_GLOBAL,
    accounting: accounting(snapshot, board),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    farm_count: board.filter((r) => r.model.verdict === 'FARM').length,
    watch_count: board.filter((r) => r.model.verdict === 'WATCH').length,
    rows: board.map((r) => {
      const p = bySlugMap.get(r.slug) as SnapshotProtocol;
      const full = impliedValue(p, snapshot.as_of, model);
      return radarRow(r, watchlist, { growthMult: full.growthMult, windowMult: full.windowMult });
    }),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
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

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
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

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
