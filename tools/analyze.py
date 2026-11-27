#!/usr/bin/env python3
"""Token Radar radar-4 — build-time fitting and validation.

Recomputes every fitted constant the model ships, from the sealed snapshot
alone, and re-runs the held-out tests that decided which terms survived:

  * split-half (deterministic md5 slug split, both directions),
  * walk-forward (fit on the older half by listing date, predict the newer),
  * leave-one-out inside each category with at least 8 live protocols,

all scored by median absolute percentage error against live market caps.
It also derives the conformal residual bands of the shipped formula and the
peers'-record launch-odds curves, and — given a fresh DefiLlama protocols
file as a second argument — repeats the out-of-sample check (launches since
the snapshot, and whether 7-day growth predicted the forward TVL move).
Fresh data is used for validation only; the board is computed from the
sealed snapshot by lib/model.ts, never from fresh data.

The script prints each figure beside the constant lib/model.ts ships and
flags any mismatch, then writes tools/fitted.json.

Usage: python3 tools/analyze.py <snapshot.json> [fresh_protocols.json]
"""

import hashlib
import json
import math
import sys
from collections import defaultdict
from datetime import date

SHRINK_K = 5  # pseudo-counts shrinking category medians toward the global median
AGE_GRID = [90, 180, 270, 365, 545, 730, 910, 1095, 1460, 1825, 2555, 3650]

# The constants lib/model.ts ships; this script exists to re-derive them.
SHIPPED = {
    "fit_intercept": 6.964567,
    "fit_exponent": 0.5223,
    "split_half_ape_loglog": 0.852,
    "split_half_ape_global": 0.936,
    "split_half_ape_category": 0.954,
    "walk_forward_ape_global": 0.882,
    "walk_forward_ape_category": 0.989,
    "loo_ape_global": 0.856,
    "loo_ape_category": 0.885,
    "range_likely": [0.324, 4.685],
    "range_wide": [0.048, 8.946],
}


def median(xs):
    xs = sorted(xs)
    n = len(xs)
    if n == 0:
        return None
    return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2


def quantile(xs, q):
    """The empirical quantile at index int(q * n) of the sorted sample."""
    xs = sorted(xs)
    if not xs:
        return None
    return xs[min(len(xs) - 1, max(0, int(q * len(xs))))]


def spearman(xs, ys):
    """Rank correlation, ties averaged."""
    def ranks(vs):
        order = sorted(range(len(vs)), key=lambda i: vs[i])
        out = [0.0] * len(vs)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and vs[order[j + 1]] == vs[order[i]]:
                j += 1
            avg = (i + j) / 2 + 1
            for k in range(i, j + 1):
                out[order[k]] = avg
            i = j + 1
        return out

    rx, ry = ranks(xs), ranks(ys)
    n = len(xs)
    mx, my = sum(rx) / n, sum(ry) / n
    cov = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    vx = sum((a - mx) ** 2 for a in rx)
    vy = sum((b - my) ** 2 for b in ry)
    return cov / math.sqrt(vx * vy) if vx > 0 and vy > 0 else None


def main():
    snap_path = sys.argv[1] if len(sys.argv) > 1 else "token-radar-01-kit/input/snapshot.json"
    fresh_path = sys.argv[2] if len(sys.argv) > 2 else None
    snap = json.load(open(snap_path))
    as_of = date.fromisoformat(snap["as_of"])
    protos = snap["protocols"]

    def age_days(p):
        if not p.get("listed_at"):
            return None
        try:
            return max(0, (as_of - date.fromisoformat(p["listed_at"])).days)
        except ValueError:
            return None

    def pre_token(p):
        return p["mcap_usd"] is None and p["gecko_id"] is None and p["symbol"] is None

    live = [p for p in protos if p["mcap_usd"] and p["mcap_usd"] > 0 and p["tvl_usd"] > 0]
    for p in live:
        p["_ratio"] = p["mcap_usd"] / p["tvl_usd"]
        p["_age"] = age_days(p)
    print(f"snapshot {snap['as_of']}: {len(protos)} protocols, {len(live)} live with a market cap")

    global_med = median([p["_ratio"] for p in live])
    print(f"global median mcap/TVL = {global_med:.4f}")

    # Category multiples, shrunk toward the global median.
    ratios_by_cat = defaultdict(list)
    for p in live:
        ratios_by_cat[p["category"] or "Other"].append(p["_ratio"])

    def shrunk_map(train):
        g = median([p["_ratio"] for p in train])
        bc = defaultdict(list)
        for p in train:
            bc[p["category"] or "Other"].append(p["_ratio"])
        return {c: (len(rs) * median(rs) + SHRINK_K * g) / (len(rs) + SHRINK_K) for c, rs in bc.items()}, g

    def ape_list(test, mult_map, fallback, extra=None):
        errs = []
        for p in test:
            pred = p["tvl_usd"] * mult_map.get(p["category"] or "Other", fallback)
            if extra is not None:
                pred *= extra(p)
            if pred > 0:
                errs.append(abs(pred - p["mcap_usd"]) / p["mcap_usd"])
        return errs

    # Test 1 — split-half by slug hash.
    half = lambda p: int(hashlib.md5(p["slug"].encode()).hexdigest(), 16) % 2
    half_a = [p for p in live if half(p) == 0]
    half_b = [p for p in live if half(p) == 1]
    map_a, g_a = shrunk_map(half_a)
    map_b, g_b = shrunk_map(half_b)
    err_cat = ape_list(half_b, map_a, g_a) + ape_list(half_a, map_b, g_b)
    err_glob = ape_list(half_b, {}, g_a) + ape_list(half_a, {}, g_b)
    print(f"[split-half] category {median(err_cat):.3f}  global {median(err_glob):.3f}")

    # Test 2 — walk-forward: older half fits, newer half is predicted.
    dated = sorted([p for p in live if p["_age"] is not None], key=lambda p: -p["_age"])
    cut = len(dated) // 2
    older, newer = dated[:cut], dated[cut:]
    map_o, g_o = shrunk_map(older)
    err_wf_cat = ape_list(newer, map_o, g_o)
    err_wf_glob = ape_list(newer, {}, g_o)
    print(f"[walk-forward] category {median(err_wf_cat):.3f}  global {median(err_wf_glob):.3f}  (n_test={len(newer)})")

    # Test 3 — leave-one-out inside categories with at least 8 live protocols.
    loo_cat, loo_glob = [], []
    for cat, rs in ratios_by_cat.items():
        if len(rs) < 8:
            continue
        members = [p for p in live if (p["category"] or "Other") == cat]
        for p in members:
            rest = [q["_ratio"] for q in members if q is not p]
            loo_cat.append(abs(p["tvl_usd"] * median(rest) - p["mcap_usd"]) / p["mcap_usd"])
            loo_glob.append(abs(p["tvl_usd"] * global_med - p["mcap_usd"]) / p["mcap_usd"])
    print(f"[leave-one-out] category {median(loo_cat):.3f}  global {median(loo_glob):.3f}  (n={len(loo_cat)})")

    # The shipped value curve: OLS of log(mcap) on log(TVL).
    def fit_loglog(train):
        xs = [math.log(p["tvl_usd"]) for p in train]
        ys = [math.log(p["mcap_usd"]) for p in train]
        mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
        b = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
        return my - b * mx, b

    a_a, b_a = fit_loglog(half_a)
    a_b, b_b = fit_loglog(half_b)
    err_ll = []
    for test, (a, b) in [(half_b, (a_a, b_a)), (half_a, (a_b, b_b))]:
        for p in test:
            pred = math.exp(a + b * math.log(p["tvl_usd"]))
            err_ll.append(abs(pred - p["mcap_usd"]) / p["mcap_usd"])
    a_full, b_full = fit_loglog(live)
    print(f"[log-log] split-half {median(err_ll):.3f}  full fit a={a_full:.6f} b={b_full:.4f}")

    # Term tests on the global base.
    def growth_mult(p):
        g = max(-50, min(150, p["change_7d"] or 0))
        return 1 + (g / 100) * 0.5

    def window_mult(p):
        a = p["_age"]
        if a is None:
            return 0.85
        if a < 90:
            return 0.7 + 0.3 * a / 90
        if a <= 1095:
            return 1.0
        return max(0.6, 1 - (a - 1095) / 3650)

    def breadth_mult(p):
        return 1 + 0.02 * min(max(len(p["chains"]) - 1, 0), 5)

    for name, fn in [("growth", growth_mult), ("window", window_mult), ("breadth", breadth_mult)]:
        e = ape_list(half_b, {}, g_a, fn) + ape_list(half_a, {}, g_b, fn)
        print(f"[term +{name}] split-half on global base {median(e):.3f}  (base {median(err_glob):.3f})")

    # Conformal bands: split-half residuals of the shipped formula itself
    # (log-log curve x growth x window), actual / predicted.
    def shipped_pred(p, a, b):
        return math.exp(a + b * math.log(p["tvl_usd"])) * growth_mult(p) * window_mult(p)

    ratios = []
    for test, (a, b) in [(half_b, (a_a, b_a)), (half_a, (a_b, b_b))]:
        for p in test:
            pred = shipped_pred(p, a, b)
            if pred > 0:
                ratios.append(p["mcap_usd"] / pred)
    band_likely = [round(quantile(ratios, 0.25), 3), round(quantile(ratios, 0.75), 3)]
    band_wide = [round(quantile(ratios, 0.10), 3), round(quantile(ratios, 0.90), 3)]
    print(f"[conformal] shipped-formula residuals: middle half x{band_likely}, 10-90% x{band_wide}")

    # Launch odds from the peers' record.
    pool_all = [p for p in protos if p["category"] != "CEX"]
    for p in pool_all:
        p["_age"] = age_days(p)
        p["_tok"] = not pre_token(p)

    def tokened_share(pool, lo, hi):
        xs = [p for p in pool if p["_age"] is not None and lo <= p["_age"] < hi]
        if len(xs) < 5:
            return None
        return sum(p["_tok"] for p in xs) / len(xs)

    def hazard_12m(pool, age):
        s_now = tokened_share(pool, max(0, age - 182), age + 183)
        s_next = tokened_share(pool, age + 183, age + 548)
        if s_now is None or s_next is None or s_now >= 0.999:
            return None
        return max(0.0, min(0.95, (s_next - s_now) / (1 - s_now)))

    raw_global = [hazard_12m(pool_all, a) for a in AGE_GRID]
    smooth_global = []
    for i in range(len(AGE_GRID)):
        vals = [raw_global[j] for j in (i - 1, i, i + 1) if 0 <= j < len(AGE_GRID) and raw_global[j] is not None]
        smooth_global.append(round(max(0.02, min(0.60, sum(vals) / len(vals))), 3) if vals else None)
    odds_global = {str(a): h for a, h in zip(AGE_GRID, smooth_global) if h is not None}
    print(f"[odds] smoothed global hazard: {odds_global}")

    cat_pools = defaultdict(list)
    for p in pool_all:
        cat_pools[p["category"] or "Other"].append(p)
    odds_cat = {}
    for cat, pool in cat_pools.items():
        if len(pool) < 15:
            continue
        row = {}
        for a, hg in zip(AGE_GRID, smooth_global):
            hc = hazard_12m(pool, a)
            if hc is None or hg is None:
                continue
            w = len(pool) / (len(pool) + 40)
            row[str(a)] = round(max(0.02, min(0.60, w * hc + (1 - w) * hg)), 3)
        if row:
            odds_cat[cat] = row
    print(f"[odds] smoothed category tables: {len(odds_cat)} categories")

    # Out-of-sample check against fresh data (validation only).
    fresh_summary = None
    if fresh_path:
        fresh = {p["slug"]: p for p in json.load(open(fresh_path))}
        launched, moves, growths = [], [], []
        for p in protos:
            if not pre_token(p) or p["category"] == "CEX":
                continue
            f = fresh.get(p["slug"])
            if not f:
                continue
            if f.get("gecko_id") or (f.get("mcap") or 0) > 0:
                launched.append(p["slug"])
            if f.get("tvl") and p["tvl_usd"] > 0:
                moves.append(f["tvl"] / p["tvl_usd"] - 1)
                growths.append(p["change_7d"] or 0)
        rho = spearman(growths, moves) if moves else None
        print(f"[fresh] matched {len(moves)} pre-token protocols; launched since snapshot: {launched}")
        print(f"[fresh] median TVL change {median(moves):+.1%}; growth->forward-move Spearman {rho:+.3f}")
        fresh_summary = {
            "matched": len(moves),
            "launched": launched,
            "median_tvl_change": median(moves),
            "forward_growth_spearman": round(rho, 3) if rho is not None else None,
        }

    # Compare against what lib/model.ts ships.
    checks = [
        ("fit_intercept", round(a_full, 6), SHIPPED["fit_intercept"]),
        ("fit_exponent", round(b_full, 4), SHIPPED["fit_exponent"]),
        ("split_half_ape_loglog", round(median(err_ll), 3), SHIPPED["split_half_ape_loglog"]),
        ("split_half_ape_global", round(median(err_glob), 3), SHIPPED["split_half_ape_global"]),
        ("split_half_ape_category", round(median(err_cat), 3), SHIPPED["split_half_ape_category"]),
        ("walk_forward_ape_global", round(median(err_wf_glob), 3), SHIPPED["walk_forward_ape_global"]),
        ("walk_forward_ape_category", round(median(err_wf_cat), 3), SHIPPED["walk_forward_ape_category"]),
        ("loo_ape_global", round(median(loo_glob), 3), SHIPPED["loo_ape_global"]),
        ("loo_ape_category", round(median(loo_cat), 3), SHIPPED["loo_ape_category"]),
        ("range_likely", band_likely, SHIPPED["range_likely"]),
        ("range_wide", band_wide, SHIPPED["range_wide"]),
    ]
    print("\n[shipped-constant check]")
    ok = True
    for name, got, want in checks:
        match = got == want
        ok = ok and match
        print(f"  {name:28s} recomputed={got}  shipped={want}  {'OK' if match else 'MISMATCH'}")
    print("  all shipped constants reproduced" if ok else "  WARNING: some constants differ — investigate before shipping")

    fitted = {
        "fitted_on": snap["as_of"],
        "source": snap["source"],
        "global_multiple": round(global_med, 4),
        "live_n": len(live),
        "fit_intercept": round(a_full, 6),
        "fit_exponent": round(b_full, 4),
        "validation": {
            "split_half_median_ape_loglog": round(median(err_ll), 3),
            "split_half_median_ape_global": round(median(err_glob), 3),
            "split_half_median_ape_category": round(median(err_cat), 3),
            "walk_forward_median_ape_global": round(median(err_wf_glob), 3),
            "walk_forward_median_ape_category": round(median(err_wf_cat), 3),
            "loo_median_ape_global": round(median(loo_glob), 3),
            "loo_median_ape_category": round(median(loo_cat), 3),
            "conformal_range_likely": band_likely,
            "conformal_range_wide": band_wide,
        },
        "odds_global_smoothed": odds_global,
        "odds_by_category_smoothed": odds_cat,
        "fresh_walk_forward": fresh_summary,
    }
    with open("tools/fitted.json", "w") as fh:
        json.dump(fitted, fh, indent=1)
    print("\nwrote tools/fitted.json")


if __name__ == "__main__":
    main()
