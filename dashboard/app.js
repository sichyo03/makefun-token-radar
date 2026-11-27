// Token Radar, radar-4 dashboard. Renders window.RADAR (written by main.ts
// beside dashboard/) as a ranked board of pre-token protocols: fitted launch
// values with conformal ranges, launch odds from the peers' record, a launch
// clock, and farm verdicts costed per chain in $/hour at minimum viable
// capital. No network: every figure on the page comes out of data.js, and the
// page recomputes each row's implied value from the model's own constants.
//
// The methodology the first screen headlines, in numbers: implied value =
// exp(6.964567) x TVL^0.5223 x growth x window, fitted by OLS on 128 live
// protocols. Held-out median APE: split-half 0.852 (fitted log-log) vs 0.936
// (flat multiple) vs 0.954 (category medians); walk-forward 0.882 vs 0.989;
// leave-one-out 0.856 vs 0.885. Conformal bands from split-half residuals of
// the shipped formula: middle half x[0.324, 4.685], 10-90% x[0.048, 8.946].
// Forward check 13 days out: growth Spearman +0.353 (n=294), 2 launches
// caught. 198 rows; all 758 snapshot protocols accounted exactly once.
// Verdicts: 18 FARM / 90 WATCH / 90 SKIP, net of per-chain gas at a stated
// $/transaction, FARM additionally requiring minimum viable capital <= $1,000.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', verdict: 'all', watchlistOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtGas(n) { return n >= 1 ? '$' + n.toFixed(2) : '$' + n.toFixed(2); }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return (Math.round(n * 100) / 100).toFixed(2) + 'x'; }
  function fmtOdds(n) { return Math.round(n * 100) + '%'; }
  function fmtClock(m) { return m >= 60 ? '5y+' : m + ' mo'; }
  function fmtEvH(n) { return '$' + (Math.abs(n) >= 100 ? Math.round(n) : n.toFixed(1)) + '/h'; }
  function fmtCapital(n) { return n === null || n === undefined ? 'never pays' : fmtUsd(n); }

  // The value model, recomputed in the page from a row's own factors: the
  // board's data and the page's code are the same arithmetic, visibly.
  function impliedOf(row, model) {
    var curve = Math.exp(model.fit_intercept) * Math.pow(Math.max(row.tvl_usd, 1), model.fit_exponent);
    return Math.max(1, Math.round(curve * row.growth_multiplier * row.window_multiplier));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // Why a row sits where it does, in its own numbers.
  function whyLine(r) {
    var bits = [fmtUsd(r.tvl_usd) + ' TVL at ' + fmtAge(r.age_days) + ' with no token'];
    if (r.change_7d !== null && r.change_7d >= 5) bits.push('growing ' + fmtPct(r.change_7d) + ' in 7 days');
    else if (r.change_7d !== null && r.change_7d <= -10) bits.push('TVL down ' + fmtPct(r.change_7d) + ' in 7 days, so the value is size, not momentum');
    bits.push(fmtOdds(r.odds_12m) + ' launch odds in 12 months, clock ' + fmtClock(r.clock_months));
    bits.push('farmed on ' + r.farm_chain + ' at ' + fmtGas(r.gas_per_tx_usd) + ' a transaction');
    bits.push(r.verdict + ' at ' + fmtEvH(r.ev_per_hour_usd) + ' net of gas, minimum capital ' + fmtCapital(r.min_capital_usd));
    return bits.join('; ') + '.';
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('verdict')) state.verdict = params.get('verdict');
    if (params.get('watchlist')) state.watchlistOnly = params.get('watchlist') === '1';
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('sort')) state.sort = params.get('sort');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.verdict !== 'all') params.set('verdict', state.verdict);
    if (state.watchlistOnly) params.set('watchlist', '1');
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.sort !== 'implied') params.set('sort', state.sort);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (state.watchlistOnly && !r.watchlist) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' '), r.farm_chain].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'odds') { av = a.odds_12m; bv = b.odds_12m; }
      else if (key === 'clock') { av = a.clock_months; bv = b.clock_months; }
      else if (key === 'ev') { av = a.ev_per_hour_usd; bv = b.ev_per_hour_usd; }
      else if (key === 'capital') { av = a.min_capital_usd === null ? Infinity : a.min_capital_usd; bv = b.min_capital_usd === null ? Infinity : b.min_capital_usd; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // The first screen: the methodology, with its numbers, before the board.
  function band() {
    var m = DATA.model;
    var v = DATA.validation;
    var acc = DATA.accounting;
    function kpi(label, value, note) {
      return el('div', { class: 'kpi' },
        el('span', { text: label }),
        el('b', { text: value }),
        el('small', { text: note })
      );
    }
    return el('header', { class: 'band' },
      el('div', { class: 'top' },
        el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar · ' + DATA.model_version })),
        el('div', { class: 'top-meta' },
          el('span', { text: 'Sealed snapshot ' + DATA.as_of }),
          el('span', { text: 'DefiLlama protocol index' }),
          el('span', { text: acc.total + ' protocols · ' + DATA.watchlist_size + ' on the watchlist' })
        )
      ),
      el('div', { class: 'headline' },
        el('h1', null,
          'Every value term ', el('span', { class: 'hl', text: 'fitted' }), ' on live protocols and kept only if it survives ',
          el('span', { class: 'hl', text: 'held-out tests' }), ' — launch odds from the peers’ record, farm plans ',
          el('span', { class: 'hl', text: 'costed per chain' }), ' at minimum viable capital.'
        ),
        el('p', { text: DATA.board_size + ' pre-token protocols ranked by fitted launch value, each with a conformal range, 12-month launch odds, a launch clock, and a farm verdict in $/hour net of gas. Implied value is what a launch could be worth at snapshot conditions, not a promise — and “no token on record” is not proof a protocol has none.' })
      ),
      el('div', { class: 'kpis' },
        kpi('Held-out median error', v.split_half_ape_loglog + ' vs ' + v.split_half_ape_global_median, 'fitted log-log curve vs a flat multiple, split-half on ' + v.live_fitted_n + ' live protocols'),
        kpi('Walk-forward test', v.walk_forward_ape_global + ' vs ' + v.walk_forward_ape_category, 'older protocols predict newer ones; category multiples lost and were dropped'),
        kpi('Conformal range', 'x[' + m.range_likely[0] + ', ' + m.range_likely[1] + ']', 'middle half of held-out actual/predicted; 10-90% band x[' + m.range_wide[0] + ', ' + m.range_wide[1] + ']'),
        kpi('Forward check', 'Spearman +' + v.forward_growth_spearman, '7-day growth predicted the next ' + v.forward_days + ' days of TVL change, n=' + v.forward_matched_n + '; 2 of 2 launches caught'),
        kpi('Coverage', acc.total + ' / ' + acc.total + ' accounted', acc.board + ' board + ' + acc.live_tokened + ' live + ' + acc.excluded_pre_token + ' excluded + ' + acc.tokened_cex + ' CEX, each once'),
        kpi('Farm verdicts', DATA.farm_count + ' FARM · ' + DATA.watch_count + ' WATCH · ' + DATA.skip_count + ' SKIP', 'net of per-chain gas at a stated ' + (m.capture_share * 100) + '% capture; FARM needs minimum capital ≤ ' + fmtUsd(m.farm_capital_cap_usd))
      ),
      el('p', { class: 'equation-line' },
        'implied = round( ', el('b', { text: 'exp(' + m.fit_intercept + ') × TVL^' + m.fit_exponent }),
        ' × (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 × ' + m.growth_weight + ') × window(age) ) · clock = 12 / odds · EV/h net = (implied × odds × ' + (m.capture_share * 100) + '% − gas) / hours'
      )
    );
  }

  function integrityStrip() {
    var v = DATA.validation;
    var m = DATA.model;
    return el('section', { class: 'strip', 'aria-label': 'Validation and costing summary' },
      el('span', null, el('b', { text: 'Terms tested held-out three ways: ' }), 'split-half ' + v.split_half_ape_loglog + ' (log-log) vs ' + v.split_half_ape_global_median + ' (flat) vs ' + v.split_half_ape_category + ' (category medians); walk-forward ' + v.walk_forward_ape_global + ' vs ' + v.walk_forward_ape_category + '; leave-one-out ' + v.loo_ape_global + ' vs ' + v.loo_ape_category + '. Category multiples and chain breadth lost and were dropped.'),
      el('span', null, el('b', { text: 'Costing: ' }), 'each plan farms on the cheapest chain the protocol supports at a stated $/transaction (Ethereum ' + fmtGas(DATA.gas_usd_per_tx.Ethereum) + ', Arbitrum ' + fmtGas(DATA.gas_usd_per_tx.Arbitrum) + ', Solana ' + fmtGas(DATA.gas_usd_per_tx.Solana) + ', unlisted chains ' + fmtGas(DATA.gas_default_usd) + '); ' + DATA.setup_txs + ' setup transactions plus one a week. Minimum capital assumes the reward share scales with the deposit and charges ' + Math.round(m.capital_apy * 100) + '% a year on it.')
    );
  }

  function spotlight() {
    var top = DATA.rows.filter(function (r) { return r.verdict === 'FARM'; }).slice(0, 5);
    if (top.length === 0) top = DATA.rows.slice(0, 5);
    return el('section', { class: 'spot', 'aria-label': 'Top five farm plans to run first' },
      top.map(function (r) {
        return el('button', { type: 'button', class: 'spot-card', onclick: function () { openDetail(r.slug); } },
          el('span', { class: 'rank', text: '#' + r.rank + ' · ' + r.verdict + ' ' + fmtEvH(r.ev_per_hour_usd) + ' net' }),
          el('b', { text: r.name }),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) + ' implied · ' + fmtOdds(r.odds_12m) + ' odds · ' + fmtClock(r.clock_months) }),
          el('span', { class: 'plan', text: 'Farm on ' + r.farm_chain + ' · minimum capital ' + fmtCapital(r.min_capital_usd) }),
          el('span', { class: 'why', text: whyLine(r) })
        );
      })
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var chain = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chain.addEventListener('change', function () { state.chain = chain.value; writeHash(); render(); });
    var verdict = el('select', { id: 'verdict', 'aria-label': 'Filter by verdict' },
      el('option', { value: 'all', text: 'All verdicts' }),
      ['FARM', 'WATCH', 'SKIP'].map(function (c) { return el('option', { value: c, text: c, selected: c === state.verdict ? 'selected' : null }); })
    );
    verdict.addEventListener('change', function () { state.verdict = verdict.value; writeHash(); render(); });
    var wl = el('input', { type: 'checkbox', id: 'wl', checked: state.watchlistOnly ? 'checked' : null, 'aria-label': 'Watchlist only' });
    wl.addEventListener('change', function () { state.watchlistOnly = wl.checked; writeHash(); render(); });
    var sort = el('select', { id: 'sort', 'aria-label': 'Sort the board' },
      ['implied', 'ev', 'capital', 'odds', 'clock', 'tvl', 'growth', 'age', 'name'].map(function (k) {
        return el('option', { value: k, text: { implied: 'Implied value', ev: 'Net $/hour', capital: 'Minimum capital', odds: 'Launch odds', clock: 'Launch clock', tvl: 'TVL', growth: '7-day growth', age: 'Age', name: 'Name' }[k], selected: k === state.sort ? 'selected' : null });
      })
    );
    sort.addEventListener('change', function () { state.sort = sort.value; state.dir = -1; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chain),
      el('div', { class: 'field' }, el('label', { for: 'verdict', text: 'Verdict' }), verdict),
      el('div', { class: 'field' }, el('label', { for: 'sort', text: 'Sort by' }), sort),
      el('label', { class: 'check' }, wl, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } writeHash(); render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.verdict = 'all'; state.watchlistOnly = false; writeHash(); render(); } })
      ));
    }
    var max = Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; })) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' · farm on ' + r.farm_chain + ' (' + fmtGas(r.gas_per_tx_usd) + '/tx)' })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', null,
            el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
            el('span', { class: 'sub', text: fmtUsd(r.value_low_usd) + ' – ' + fmtUsd(r.value_high_usd) })
          )
        )),
        el('td', { class: 'num', text: fmtOdds(r.odds_12m) }),
        el('td', { class: 'num', text: fmtClock(r.clock_months) }),
        el('td', { class: 'num', text: fmtCapital(r.min_capital_usd) }),
        el('td', null, el('span', { class: 'badge verdict-' + r.verdict.toLowerCase(), text: r.verdict + ' ' + fmtEvH(r.ev_per_hour_usd) }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest fitted launch value first. The range under each value is the middle-half conformal band; the verdict is $/hour net of per-chain gas, and minimum capital is the smallest deposit whose expected reward covers the plan’s costs. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value (likely range)'),
            sortHeader('odds', 'Odds 12m'),
            sortHeader('clock', 'Clock'),
            sortHeader('capital', 'Min capital'),
            sortHeader('ev', 'Verdict (net)')
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'badge plain', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking; the fitted value curve comes from all ' + DATA.validation.live_fitted_n + ' of them that carry a market cap.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var v = DATA.validation;
    var gasEntries = Object.keys(DATA.gas_usd_per_tx).sort(function (a, b) { return DATA.gas_usd_per_tx[b] - DATA.gas_usd_per_tx[a] || (a < b ? -1 : 1); });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value, odds, costs and verdicts are computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased and no row is hand-picked. Terms were kept or dropped on held-out tests; tools/analyze.py refits and retests everything from the snapshot.' }),
      el('div', { class: 'formula', text: 'implied = round( exp(' + m.fit_intercept + ') x tvl_usd^' + m.fit_exponent + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x window(age) )' }),
      el('table', { class: 'factors' },
        el('thead', null, el('tr', null, el('th', { text: 'Term' }), el('th', { text: 'What it is' }), el('th', { text: 'Held-out verdict' }))),
        el('tbody', null,
          el('tr', null, el('td', { text: 'Fitted value curve' }), el('td', { text: 'log(mcap) on log(TVL) over the ' + v.live_fitted_n + ' live protocols with a market cap: value scales as TVL^' + m.fit_exponent + ', so big protocols price at a lower multiple.' }), el('td', { class: 'num', text: 'kept: ' + v.split_half_ape_loglog + ' vs ' + v.split_half_ape_global_median })),
          el('tr', null, el('td', { text: 'Category multiples' }), el('td', { text: 'Per-category median mcap/TVL with shrinkage. Tested three ways (split-half, walk-forward, leave-one-out) and lost every time.' }), el('td', { class: 'num', text: 'dropped' })),
          el('tr', null, el('td', { text: 'Growth' }), el('td', { text: 'Seven-day TVL change, clamped, half-weighted. On the forward test it predicted the next ' + v.forward_days + ' days of TVL change (Spearman +' + v.forward_growth_spearman + ').' }), el('td', { class: 'num', text: 'kept' })),
          el('tr', null, el('td', { text: 'Launch window' }), el('td', { text: 'Ramps from 0.70 under 90 days to 1.00 from 90 days to 3 years, then decays toward 0.60: old protocols with no token launch less often (see odds).' }), el('td', { class: 'num', text: 'kept' })),
          el('tr', null, el('td', { text: 'Chain breadth' }), el('td', { text: 'Two per cent per extra chain. Made held-out predictions worse (0.972 vs 0.936).' }), el('td', { class: 'num', text: 'dropped' })),
          el('tr', null, el('td', { text: 'Value range' }), el('td', { text: 'Conformal band from split-half residuals: actual/predicted fell in [' + m.range_likely[0] + ', ' + m.range_likely[1] + '] for the middle half, [' + m.range_wide[0] + ', ' + m.range_wide[1] + '] for 10-90%. Wide because the market is.' }), el('td', { class: 'num', text: 'middle half' })),
          el('tr', null, el('td', { text: 'Launch odds (12m)' }), el('td', { text: 'Hazard from the peers’ record: the tokened share by age, differenced over the next year, smoothed, blended by category where the record supports it. Peaks near 2-2.5 years, falls after.' }), el('td', { class: 'num', text: '2 of 2 caught' })),
          el('tr', null, el('td', { text: 'Launch clock' }), el('td', { text: 'Expected months to launch = 12 / odds, capped at 60.' }), el('td', { class: 'num', text: '3 - 60 mo' })),
          el('tr', null, el('td', { text: 'Per-chain gas costing' }), el('td', { text: 'Each plan farms on the cheapest chain the protocol supports at the stated $/transaction below; the bill is ' + DATA.setup_txs + ' setup transactions plus one qualifying transaction a week to the clock (max a year), subtracted before the $/hour verdict. Unlisted chains cost ' + fmtGas(DATA.gas_default_usd) + '.' }), el('td', { class: 'num', text: 'new in radar-4' })),
          el('tr', null, el('td', { text: 'Minimum viable capital' }), el('td', { text: 'The reward share is assumed to scale with the deposit (at the plan’s reference deposit it is the stated ' + (m.capture_share * 100) + '% capture). Minimum capital is the smallest $10 step whose expected reward covers gas plus ' + Math.round(m.capital_apy * 100) + '% a year on the capital; “never pays” when no size clears it. FARM also requires it to fit ' + fmtUsd(m.farm_capital_cap_usd) + '.' }), el('td', { class: 'num', text: 'new in radar-4' })),
          el('tr', null, el('td', { text: 'Costed verdict' }), el('td', { text: 'Net EV/hour = (implied x odds x ' + (m.capture_share * 100) + '% capture − gas) / (1 setup hour + 15 min/week to the clock, max a year). FARM ≥ $' + m.farm_threshold_usd_h + '/h with an affordable minimum, WATCH ≥ $' + m.watch_threshold_usd_h + '/h. The capture share is a stated assumption: scale it linearly for your own.' }), el('td', { class: 'num', text: DATA.farm_count + ' FARM' }))
        )
      ),
      el('h3', { text: 'Stated gas assumptions ($ per qualifying transaction)' }),
      el('div', { class: 'gas-grid' },
        gasEntries.map(function (c) {
          return el('div', null, el('span', { text: c }), el('b', { text: fmtGas(DATA.gas_usd_per_tx[c]) }));
        }),
        el('div', null, el('span', { text: 'Any other chain' }), el('b', { text: fmtGas(DATA.gas_default_usd) }))
      ),
      el('ul', { class: 'limits' },
        el('li', { text: 'The snapshot is frozen at ' + DATA.as_of + ': it says nothing about points programs, yields or announcements after that date, and "no token on record" is not proof a protocol has none.' }),
        el('li', { text: 'Held-out median error is ' + Math.round(v.split_half_ape_loglog * 100) + '%: launch values are genuinely hard to pin down, which is why every row carries a range instead of a point promise.' }),
        el('li', { text: 'Out-of-sample, ' + v.forward_days + ' days on: ' + v.forward_launched.join(' and ') + ' launched; the previous board ranked them ' + v.forward_launched_prev_ranks.join(' and ') + ' of 226. Two launches is a small sample, stated as such.' }),
        el('li', { text: 'Gas prices, the capture share and the capital cost are stated assumptions, printed above so every $/hour and minimum-capital figure can be rescaled; they are not measured from chain data.' }),
        el('li', { text: 'Implied value estimates what a launch could be worth in total, not a price and not what any one farmer would receive.' })
      )
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var recomputed = impliedOf(row, DATA.model);
    var weeks = Math.min(52, row.clock_months * 4.33);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' - watchlist' : ' - early find') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value, odds and verdict' }),
      el('div', { class: 'kv' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Fitted curve' }), el('b', { class: 'num', text: 'exp(' + DATA.model.fit_intercept + ') x TVL^' + DATA.model.fit_exponent })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) + ' -> ' + fmtMult(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) + ' -> ' + fmtMult(row.window_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Likely range' }), el('b', { class: 'num', text: fmtUsd(row.value_low_usd) + ' – ' + fmtUsd(row.value_high_usd) })),
        el('div', null, el('span', { text: 'Launch odds (12m)' }), el('b', { class: 'num', text: fmtOdds(row.odds_12m) })),
        el('div', null, el('span', { text: 'Launch clock' }), el('b', { class: 'num', text: fmtClock(row.clock_months) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' Odds come from the peers’ record at this age and category.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'What the farm costs, and the smallest deposit that pays' }),
      el('div', { class: 'kv' },
        el('div', null, el('span', { text: 'Farm chain (cheapest supported)' }), el('b', { class: 'num', text: row.farm_chain })),
        el('div', null, el('span', { text: 'Gas per transaction (stated)' }), el('b', { class: 'num', text: fmtGas(row.gas_per_tx_usd) })),
        el('div', null, el('span', { text: 'Transactions' }), el('b', { class: 'num', text: DATA.setup_txs + ' setup + ' + Math.ceil(weeks) + ' weekly' })),
        el('div', null, el('span', { text: 'Gas bill over the horizon' }), el('b', { class: 'num', text: fmtUsd(row.gas_total_usd) })),
        el('div', null, el('span', { text: 'Gross EV/hour (before gas)' }), el('b', { class: 'num', text: fmtEvH(row.gross_ev_per_hour_usd) })),
        el('div', null, el('span', { text: 'Net EV/hour (after gas)' }), el('b', { class: 'num', text: fmtEvH(row.ev_per_hour_usd) })),
        el('div', null, el('span', { text: 'Reference deposit' }), el('b', { class: 'num', text: fmtUsd(row.reference_capital_usd) })),
        el('div', null, el('span', { text: 'Minimum viable capital' }), el('b', { class: 'num', text: fmtCapital(row.min_capital_usd) })),
        el('div', null, el('span', { text: 'Verdict' }), el('b', { class: 'num', text: row.verdict + ' at ' + fmtEvH(row.ev_per_hour_usd) + ' net' }))
      ),
      el('p', { class: 'sub', text: 'Minimum capital: the smallest deposit (on a $10 grid) whose expected reward — share assumed to scale with the deposit from the stated ' + (DATA.model.capture_share * 100) + '% capture at the reference deposit — still covers the gas bill plus ' + Math.round(DATA.model.capital_apy * 100) + '% a year on the capital. “Never pays” means no deposit size clears that bar.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Why it ranks here' }),
      el('ul', { class: 'why' }, el('li', { text: whyLine(row) }))
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, (row.farm_steps || []).map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'What could change this' }),
      el('p', { class: 'sub', text: 'A points program, a token announcement or a sharp TVL move after ' + DATA.as_of + ' would move this row more than any factor here. Re-run the program on a fresh snapshot to refresh the board.' })
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(band());
    if (state.tab === 'pre-token') shell.appendChild(integrityStrip());
    if (state.tab === 'pre-token') shell.appendChild(spotlight());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
