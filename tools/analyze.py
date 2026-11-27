#!/usr/bin/env python3
"""Token Radar rebuild — build-time fitting and validation.

Fits every value term on the sealed snapshot (14 Nov 2026) and tests it held-out
three ways: split-half by slug hash, walk-forward older->newer by listed_at, and
leave-one-out per category. Then runs a true out-of-sample check against fresh
DefiLlama data fetched 2026-11-27 (13 days after the snapshot): which snapshot
pre-token protocols launched, and how the top-ranked fared on TVL.

Outputs tools/fitted.json: the constants lib/model.ts ships (category multiples,
conformal range factors, odds base rates, validation summary). Every number in
the dashboard traces to this file or to the snapshot itself.

Usage: python3 tools/analyze.py <snapshot.json> <fresh_protocols.json>
"""
import json, math, sys, hashlib
from collections import defaultdict
from datetime import date

SNAP_PATH = sys.argv[1] if len(sys.argv) > 1 else "token-radar-01-kit/input/snapshot.json"
FRESH_PATH = sys.argv[2] if len(sys.argv) > 2 else None
OUT_PATH = "tools/fitted.json"

snap = json.load(open(SNAP_PATH))
AS_OF = date.fromisoformat(snap["as_of"])
protos = snap["protocols"]

def age_days(p):
    if not p.get("listed_at"): return None
    try: return max(0, (AS_OF - date.fromisoformat(p["listed_at"])).days)
    except ValueError: return None

def is_pre_token(p):
    return p["mcap_usd"] is None and p["gecko_id"] is None and p["symbol"] is None

def median(xs):
    xs = sorted(xs)
    n = len(xs)
    if n == 0: return None
    return xs[n//2] if n % 2 else (xs[n//2 - 1] + xs[n//2]) / 2

def quantile(xs, q):
    xs = sorted(xs)
    if not xs: return None
    i = min(len(xs) - 1, max(0, int(q * len(xs))))
    return xs[i]

live = [p for p in protos if p["mcap_usd"] and p["mcap_usd"] > 0 and p["tvl_usd"] > 0]
for p in live: p["_ratio"] = p["mcap_usd"] / p["tvl_usd"]; p["_age"] = age_days(p)
print(f"snapshot {snap['as_of']}: {len(protos)} protocols, {len(live)} live with mcap")

global_med = median([p["_ratio"] for p in live])
print(f"global median mcap/TVL = {global_med:.4f}")

# ---- category multiples with shrinkage toward the global median (k=5 pseudo-count)
K = 5
by_cat = defaultdict(list)
for p in live: by_cat[p["category"] or "Other"].append(p["_ratio"])
cat_mult = {}
for cat, rs in by_cat.items():
    m = median(rs)
    cat_mult[cat] = {"n": len(rs), "median": m, "shrunk": (len(rs) * m + K * global_med) / (len(rs) + K)}
for cat in sorted(cat_mult, key=lambda c: -cat_mult[c]["n"]):
    c = cat_mult[cat]
    print(f"  {cat:28s} n={c['n']:3d} median={c['median']:.4f} shrunk={c['shrunk']:.4f}")

def predict(p, mult_map, fallback):
    m = mult_map.get(p["category"] or "Other", fallback)
    return p["tvl_usd"] * m

def ape_errors(test, mult_map, fallback, extra=None):
    errs = []
    for p in test:
        pred = predict(p, mult_map, fallback)
        if extra: pred *= extra(p)
        if pred > 0: errs.append(abs(pred - p["mcap_usd"]) / p["mcap_usd"])
    return errs

def fit_map(train):
    g = median([p["_ratio"] for p in train])
    bc = defaultdict(list)
    for p in train: bc[p["category"] or "Other"].append(p["_ratio"])
    return {c: (len(rs) * median(rs) + K * g) / (len(rs) + K) for c, rs in bc.items()}, g

# ---- Test 1: split-half by slug hash (deterministic)
half = lambda p: int(hashlib.md5(p["slug"].encode()).hexdigest(), 16) % 2
A = [p for p in live if half(p) == 0]; B = [p for p in live if half(p) == 1]
mapA, gA = fit_map(A); mapB, gB = fit_map(B)
err_cat = ape_errors(B, mapA, gA) + ape_errors(A, mapB, gB)
err_glob = ape_errors(B, {}, gA) + ape_errors(A, {}, gB)
err_fixed = ape_errors(live, {}, 0.20)  # radar-2's fixed multiple, in-sample for reference
print(f"\n[split-half] category-median median APE = {median(err_cat):.3f}  global-median = {median(err_glob):.3f}  fixed 0.20 (in-sample) = {median(err_fixed):.3f}")

# ---- Test 2: walk-forward older -> newer by listed_at
dated = sorted([p for p in live if p["_age"] is not None], key=lambda p: -p["_age"])
cut = len(dated) // 2
older, newer = dated[:cut], dated[cut:]
mapO, gO = fit_map(older)
err_wf_cat = ape_errors(newer, mapO, gO)
err_wf_glob = ape_errors(newer, {}, gO)
print(f"[walk-forward older->newer] category median APE = {median(err_wf_cat):.3f}  global = {median(err_wf_glob):.3f}  (n_test={len(newer)})")

# ---- Test 3: leave-one-out per category (categories with >=8 live)
loo_errs, loo_glob = [], []
for cat, rs in by_cat.items():
    if len(rs) < 8: continue
    members = [p for p in live if (p["category"] or "Other") == cat]
    for p in members:
        rest = [q["_ratio"] for q in members if q is not p]
        pred = p["tvl_usd"] * median(rest)
        loo_errs.append(abs(pred - p["mcap_usd"]) / p["mcap_usd"])
        loo_glob.append(abs(p["tvl_usd"] * global_med - p["mcap_usd"]) / p["mcap_usd"])
print(f"[leave-one-out, cats n>=8] category median APE = {median(loo_errs):.3f}  global = {median(loo_glob):.3f}  (n={len(loo_errs)})")

# ---- Term tests: do radar-2's growth / window / breadth factors help held-out?
def growth_mult(p):
    g = max(-50, min(150, p["change_7d"] or 0))
    return 1 + (g / 100) * 0.5
def window_mult(p):
    a = p["_age"]
    if a is None: return 0.85
    if a < 90: return 0.7 + 0.3 * a / 90
    if a <= 1095: return 1.0
    return max(0.6, 1 - (a - 1095) / 3650)
def breadth_mult(p):
    return 1 + 0.02 * min(max(len(p["chains"]) - 1, 0), 5)
for name, fn in [("growth", growth_mult), ("window", window_mult), ("breadth", breadth_mult),
                 ("all three", lambda p: growth_mult(p) * window_mult(p) * breadth_mult(p))]:
    e = ape_errors(B, mapA, gA, fn) + ape_errors(A, mapB, gB, fn)
    print(f"[term test split-half] +{name:10s} median APE = {median(e):.3f}  (base {median(err_cat):.3f})")

# ---- Conformal ranges: held-out log-residual quantiles (split-half predictions)
resid = []
for test, mp, g in [(B, mapA, gA), (A, mapB, gB)]:
    for p in test:
        pred = predict(p, mp, g)
        if pred > 0: resid.append((p["category"] or "Other", math.log(p["mcap_usd"] / pred)))
all_res = [r for _, r in resid]
lo_q, hi_q = quantile(all_res, 0.10), quantile(all_res, 0.90)
print(f"\n[conformal] global 10-90% log-residual: [{lo_q:.3f}, {hi_q:.3f}] -> range x{math.exp(lo_q):.2f} .. x{math.exp(hi_q):.2f}")
cat_res = defaultdict(list)
for c, r in resid: cat_res[c].append(r)
cat_range = {}
for c, rs in cat_res.items():
    if len(rs) >= 10:
        cat_range[c] = [round(math.exp(quantile(rs, 0.10)), 3), round(math.exp(quantile(rs, 0.90)), 3)]
print(f"[conformal] per-category ranges for {len(cat_range)} categories (n>=10)")

# ---- Token odds from the peers' record: tokened share by age, hazard over next 12 months
allp = [p for p in protos if p["category"] != "CEX"]
for p in allp: p["_age"] = age_days(p); p["_tok"] = not is_pre_token(p)
def tokened_share(pool, lo, hi):
    xs = [p for p in pool if p["_age"] is not None and lo <= p["_age"] < hi]
    if len(xs) < 5: return None, len(xs)
    return sum(p["_tok"] for p in xs) / len(xs), len(xs)
print("\n[odds] tokened share by age bucket (all non-CEX):")
buckets = [(0,180),(180,365),(365,730),(730,1095),(1095,1825),(1825,99999)]
shares = []
for lo, hi in buckets:
    s, n = tokened_share(allp, lo, hi)
    shares.append(s)
    print(f"  age {lo:5d}-{hi if hi<99999 else '+':>5} d: share={s if s is None else round(s,3)} n={n}")
# hazard: P(launch in next 365d | pre-token at age a) from share curve, per category where possible
def hazard_12m(pool, age):
    s_now, _ = tokened_share(pool, max(0, age-182), age+183)
    s_next, _ = tokened_share(pool, age+183, age+548)
    if s_now is None or s_next is None or s_now >= 0.999: return None
    return max(0.0, min(0.95, (s_next - s_now) / (1 - s_now)))
cat_pools = defaultdict(list)
for p in allp: cat_pools[p["category"] or "Other"].append(p)
odds_table = {}
for cat, pool in cat_pools.items():
    row = {}
    for age in [90, 270, 545, 910, 1460, 2555]:
        h = hazard_12m(pool, age)
        if h is not None: row[str(age)] = round(h, 3)
    if row: odds_table[cat] = row
global_odds = {str(a): round(hazard_12m(allp, a), 3) for a in [90,270,545,910,1460,2555] if hazard_12m(allp, a) is not None}
print("[odds] global 12m hazard by age:", global_odds)
print(f"[odds] category tables for {len(odds_table)} categories")

# ---- Term tests on the GLOBAL base (the model the tests actually select)
print("\n[term tests on global base, split-half]")
for name, fn in [("growth", growth_mult), ("window", window_mult), ("breadth", breadth_mult)]:
    e = ape_errors(B, {}, gA, fn) + ape_errors(A, {}, gB, fn)
    print(f"  +{name:8s} median APE = {median(e):.3f}  (base {median(err_glob):.3f})")

# ---- Fitted TVL exponent: log(mcap) = a + b*log(TVL), split-half
def fit_loglog(train):
    xs = [math.log(p["tvl_usd"]) for p in train]; ys = [math.log(p["mcap_usd"]) for p in train]
    mx, my = sum(xs)/len(xs), sum(ys)/len(ys)
    b = sum((x-mx)*(y-my) for x, y in zip(xs, ys)) / sum((x-mx)**2 for x in xs)
    return my - b*mx, b
aA, bA = fit_loglog(A); aB, bB = fit_loglog(B)
err_ll = []
for test, (a, b) in [(B, (aA, bA)), (A, (aB, bB))]:
    for p in test:
        pred = math.exp(a + b * math.log(p["tvl_usd"]))
        err_ll.append(abs(pred - p["mcap_usd"]) / p["mcap_usd"])
aF, bF = fit_loglog(live)
print(f"[log-log fit] split-half median APE = {median(err_ll):.3f} (global-median base {median(err_glob):.3f}); full-sample exponent b={bF:.3f}")

# ---- Ratio quantiles for value ranges (global + categories with n>=8)
all_ratios = [p["_ratio"] for p in live]
rq = {f"q{int(q*100)}": round(quantile(all_ratios, q), 4) for q in (0.10, 0.25, 0.50, 0.75, 0.90)}
print("[ratio quantiles global]", rq)
cat_q = {}
for cat, rs in by_cat.items():
    if len(rs) >= 8:
        cat_q[cat] = [round(quantile(rs, 0.25), 4), round(quantile(rs, 0.75), 4)]
print("[ratio IQR by category n>=8]", cat_q)

# ---- Smoothed 12m launch hazard: 3-point moving average over age grid, capped [0.02, 0.60]
grid = [90, 180, 270, 365, 545, 730, 910, 1095, 1460, 1825, 2555, 3650]
raw_h = [hazard_12m(allp, a) for a in grid]
smooth = []
for i in range(len(grid)):
    vals = [raw_h[j] for j in (i-1, i, i+1) if 0 <= j < len(grid) and raw_h[j] is not None]
    smooth.append(round(max(0.02, min(0.60, sum(vals)/len(vals))), 3) if vals else None)
odds_smooth = {str(a): h for a, h in zip(grid, smooth) if h is not None}
print("[odds smoothed global]", odds_smooth)
# category odds: same grid, blended with global by pool size (weight n/(n+40))
odds_cat_smooth = {}
for cat, pool in cat_pools.items():
    if len(pool) < 15: continue
    row = {}
    for a, hg in zip(grid, smooth):
        hc = hazard_12m(pool, a)
        if hc is None or hg is None: continue
        w = len(pool) / (len(pool) + 40)
        row[str(a)] = round(max(0.02, min(0.60, w * hc + (1 - w) * hg)), 3)
    if row: odds_cat_smooth[cat] = row
print(f"[odds smoothed] category tables for {len(odds_cat_smooth)} categories")

# ---- Fresh-data walk-forward: snapshot (14 Nov) -> fresh DefiLlama (27 Nov)
fresh_summary = None
if FRESH_PATH:
    fresh = {p["slug"]: p for p in json.load(open(FRESH_PATH))}
    pre = [p for p in protos if is_pre_token(p) and p["category"] != "CEX"]
    launched, tvl_moves = [], []
    for p in pre:
        f = fresh.get(p["slug"])
        if not f: continue
        if f.get("gecko_id") or (f.get("mcap") or 0) > 0:
            launched.append(p["slug"])
        if f.get("tvl") and p["tvl_usd"] > 0:
            tvl_moves.append((p["slug"], f["tvl"] / p["tvl_usd"] - 1))
    print(f"\n[fresh walk-forward] pre-token in snapshot matched in fresh: {len(tvl_moves)}; launched since: {len(launched)} {launched[:10]}")
    if tvl_moves:
        tvl_moves.sort(key=lambda x: -x[1])
        print(f"  median TVL change 13d: {median([m for _,m in tvl_moves]):+.1%}; top gainers: {[(s, round(m,2)) for s,m in tvl_moves[:5]]}")
    # where did the launched protocols sit on the radar-2 board, and did top ranks hold TVL better?
    try:
        old_board = json.load(open("/home/hatch/workspace/makefun-token-radar/board.json"))["rows"]
        rank_of = {r["slug"]: r["rank"] for r in old_board}
        launched_ranks = {s: rank_of.get(s) for s in launched}
        move_of = dict(tvl_moves)
        top20 = [move_of[r["slug"]] for r in old_board[:20] if r["slug"] in move_of]
        rest = [m for s, m in tvl_moves if rank_of.get(s, 9999) > 20]
        print(f"[fresh] launched protocols' radar-2 ranks: {launched_ranks}")
        print(f"[fresh] median 13d TVL change: radar-2 top20 {median(top20):+.1%} (n={len(top20)}) vs rest {median(rest):+.1%} (n={len(rest)})")
    except Exception as e:
        launched_ranks, top20, rest = {}, [], []
        print(f"[fresh] old board comparison skipped: {e}")
    fresh_summary = {"matched": len(tvl_moves), "launched": launched,
                     "launched_radar2_ranks": launched_ranks,
                     "median_tvl_change": median([m for _, m in tvl_moves]) if tvl_moves else None,
                     "top20_median_tvl_change": median(top20) if top20 else None,
                     "rest_median_tvl_change": median(rest) if rest else None}

fitted = {
    "fitted_on": snap["as_of"], "source": snap["source"],
    "global_multiple": round(global_med, 4), "live_n": len(live),
    "category_multiples": {c: {"n": v["n"], "median": round(v["median"], 4), "shrunk": round(v["shrunk"], 4)} for c, v in cat_mult.items()},
    "shrinkage_k": K,
    "validation": {
        "split_half_median_ape_category": round(median(err_cat), 3),
        "split_half_median_ape_global": round(median(err_glob), 3),
        "walk_forward_median_ape_category": round(median(err_wf_cat), 3),
        "walk_forward_median_ape_global": round(median(err_wf_glob), 3),
        "loo_median_ape_category": round(median(loo_errs), 3),
        "loo_median_ape_global": round(median(loo_glob), 3),
        "conformal_global_range": [round(math.exp(lo_q), 3), round(math.exp(hi_q), 3)],
    },
    "category_ranges": cat_range,
    "ratio_quantiles_global": rq,
    "ratio_iqr_by_category": cat_q,
    "loglog_exponent_full": round(bF, 4),
    "loglog_split_half_median_ape": round(median(err_ll), 3),
    "odds_global_by_age": global_odds,
    "odds_global_smoothed": odds_smooth,
    "odds_by_category_age": odds_table,
    "odds_by_category_smoothed": odds_cat_smooth,
    "fresh_walk_forward": fresh_summary,
}
json.dump(fitted, open(OUT_PATH, "w"), indent=1)
print(f"\nwrote {OUT_PATH}")
