// Token Radar, radar-3 dashboard. Reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board with fitted values, conformal ranges, launch odds, a launch
// clock and costed $/hour verdicts, plus a per-protocol detail view with the model's own
// inputs and the protocol's farm plan. No network: every byte shown is in data.js.
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
  function fmtEvH(n) { return '$' + (n >= 100 ? Math.round(n) : n.toFixed(1)) + '/h'; }

  // The model, recomputed in the page from the row's own factors: the page's code and the
  // board's data are visibly the same arithmetic.
  function impliedOf(row, model) {
    var base = Math.exp(model.fit_intercept) * Math.pow(Math.max(row.tvl_usd, 1), model.fit_exponent);
    return Math.max(1, Math.round(base * row.growth_multiplier * row.window_multiplier));
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

  // Farm plan: the same derivation main.ts writes to board.json. Category, chains, TVL and age
  // decide the action, the weekly action, the risk check, the capital, the hold and every cost
  // and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('payment') >= 0) return 'Route $' + capital + ' of payments through ' + name + ' on ' + chain + ' and keep the volume on record.';
    if (c.indexOf('chain') >= 0) return 'Use $' + capital + ' in ' + name + "'s app on " + chain + ' and keep the position open.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function weeklyFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Make one qualifying action each week, such as a supply, a borrow or a repay.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Make one qualifying action each week, such as a swap, adding liquidity or claiming yield.';
    if (c.indexOf('bridge') >= 0) return 'Make one qualifying action each week, such as a bridge or a swap on the destination chain.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Make one qualifying action each week, such as restaking, claiming rewards or voting.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Make one qualifying action each week, such as a trade, a hedge or a funding payment.';
    if (c.indexOf('prediction') >= 0) return 'Make one qualifying action each week, such as a market position or a claim.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Make one qualifying action each week, such as a deposit, a rebalance or a vote.';
    if (c.indexOf('rwa') >= 0) return 'Make one qualifying action each week, such as a mint, a hold check or a claim.';
    if (c.indexOf('governance') >= 0) return 'Make one qualifying action each week, such as a vote or a delegation.';
    return 'Make one qualifying action each week, such as a deposit, a swap or a vote.';
  }
  function riskFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Check the liquidation terms and the oracle the protocol uses before you supply: a sharp price move can liquidate a borrow.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Check the pool for impermanent loss and for thin liquidity before you provide it: a one-sided move can cost more than the yield.';
    if (c.indexOf('bridge') >= 0) return 'Check the bridge for its security model and its delay before you move funds: a bridge failure can strand them.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Check the unstaking delay and any slashing terms before you stake: the funds may be locked longer than the farm.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Check the leverage and the liquidation price before you open a position: derivatives can lose the margin fast.';
    if (c.indexOf('rwa') >= 0) return 'Check what backs the yield asset and who custodies it before you mint: off-chain backing is a counterparty risk.';
    if (c.indexOf('insurance') >= 0) return 'Check what the cover actually pays for before you buy it: a policy that never pays is a sunk cost.';
    return 'Check the protocol for an audit, its contracts and its team before you deposit: unaudited code can lose the funds.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var action = actionFor(p, capital, chain);
    var extra = p.chains.length > 1 ? ' If ' + p.chains[1] + ' is cheaper to use, do the same action there instead and keep one chain per wallet.' : '';
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: action + extra, cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: weeklyFor(p), cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: riskFor(p), cost: 'nothing but the check', time: '15 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  // One line on why a row ranks where it does, from its own factors.
  function whyLine(r) {
    var bits = [];
    bits.push(fmtUsd(r.tvl_usd) + ' TVL at ' + fmtAge(r.age_days) + ' with no token');
    if (r.change_7d !== null && r.change_7d >= 5) bits.push('growing ' + fmtPct(r.change_7d) + ' in 7 days');
    else if (r.change_7d !== null && r.change_7d <= -10) bits.push('TVL down ' + fmtPct(r.change_7d) + ' in 7 days, so the value is size, not momentum');
    bits.push(fmtOdds(r.odds_12m) + ' launch odds in 12 months, clock ' + fmtClock(r.clock_months));
    bits.push('verdict ' + r.verdict + ' at ' + fmtEvH(r.ev_per_hour_usd));
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
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
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
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    var v = DATA.validation;
    var acc = DATA.accounting;
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.board_size + ' pre-token protocols, ranked by fitted launch value' }),
        el('p', { text: 'Every value term was fitted on the ' + v.live_fitted_n + ' live-token protocols in this snapshot and tested held-out; terms that lost were dropped. Each row carries a conformal value range, launch odds from the peers\u2019 record, a launch clock, and a costed farm verdict in $/hour. Implied value is a model of what a launch could be worth, not a promise, and "no token on record" is not proof a protocol has none.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Protocols accounted for' }), el('b', { text: acc.total + ' / ' + acc.total })),
        el('div', { class: 'fact' }, el('span', { text: 'On the board' }), el('b', { text: String(acc.board) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token set aside' }), el('b', { text: String(acc.live_tokened) })),
        el('div', { class: 'fact' }, el('span', { text: 'Held-out median error' }), el('b', { text: Math.round(v.split_half_ape_loglog * 100) + '% vs ' + Math.round(v.split_half_ape_global_median * 100) + '% naive' })),
        el('div', { class: 'fact' }, el('span', { text: 'Out-of-sample launches caught' }), el('b', { text: '2 of 2 (prev. board)' }))
      )
    );
  }

  function integrityStrip() {
    var v = DATA.validation;
    var acc = DATA.accounting;
    return el('section', { class: 'strip', 'aria-label': 'Validation and accounting' },
      el('span', { text: 'Fitted on ' + v.live_fitted_n + ' live protocols · split-half median APE ' + v.split_half_ape_loglog + ' (log-log) vs ' + v.split_half_ape_global_median + ' (flat multiple) vs ' + v.split_half_ape_category + ' (category medians, dropped)' }),
      el('span', { text: 'Walk-forward older\u2192newer: ' + v.walk_forward_ape_global + ' global vs ' + v.walk_forward_ape_category + ' category · leave-one-out: ' + v.loo_ape_global + ' vs ' + v.loo_ape_category }),
      el('span', { text: 'Forward test: 7-day growth predicted the next 13 days of TVL change, Spearman +' + v.forward_growth_spearman + ' (n=' + v.forward_matched_n + ')' }),
      el('span', { text: 'Accounting: ' + acc.board + ' board + ' + acc.live_tokened + ' live + ' + acc.excluded_pre_token + ' excluded pre-token + ' + acc.tokened_cex + ' tokened CEX = ' + acc.total })
    );
  }

  function spotlight() {
    var top = DATA.rows.filter(function (r) { return r.verdict === 'FARM'; }).slice(0, 5);
    if (top.length === 0) top = DATA.rows.slice(0, 5);
    return el('section', { class: 'spot', 'aria-label': 'Top five to farm first' },
      top.map(function (r) {
        return el('button', { type: 'button', class: 'spot-card', onclick: function () { openDetail(r.slug); } },
          el('span', { class: 'rank', text: '#' + r.rank + ' · ' + r.verdict + ' ' + fmtEvH(r.ev_per_hour_usd) }),
          el('b', { text: r.name }),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) + ' implied · ' + fmtOdds(r.odds_12m) + ' odds · ' + fmtClock(r.clock_months) }),
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
      ['implied', 'ev', 'odds', 'clock', 'tvl', 'growth', 'age', 'name'].map(function (k) {
        return el('option', { value: k, text: { implied: 'Implied value', ev: '$/hour', odds: 'Launch odds', clock: 'Launch clock', tvl: 'TVL', growth: '7-day growth', age: 'Age', name: 'Name' }[k], selected: k === state.sort ? 'selected' : null });
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
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
          el('span', { class: 'sub', text: fmtUsd(r.value_low_usd) + ' \u2013 ' + fmtUsd(r.value_high_usd) })
        )),
        el('td', { class: 'num', text: fmtOdds(r.odds_12m) }),
        el('td', { class: 'num', text: fmtClock(r.clock_months) }),
        el('td', null, el('span', { class: 'badge verdict-' + r.verdict.toLowerCase(), text: r.verdict + ' ' + fmtEvH(r.ev_per_hour_usd) }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest fitted launch value first. The range under each value is the middle-half conformal band. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value (likely range)'),
            sortHeader('odds', 'Odds 12m'),
            sortHeader('clock', 'Clock'),
            sortHeader('ev', 'Verdict')
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
        el('td', null, el('span', { class: 'badge', text: 'already trades' }))
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
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value, odds and verdicts are computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked. Terms were kept or dropped on held-out tests (tools/analyze.py refits and retests everything).' }),
      el('div', { class: 'formula' },
        'implied = round( exp(' + m.fit_intercept + ') x tvl_usd^' + m.fit_exponent + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x window(age) )'
      ),
      el('table', { class: 'factors' },
        el('thead', null, el('tr', null, el('th', { text: 'Term' }), el('th', { text: 'What it is' }), el('th', { text: 'Held-out verdict' }))),
        el('tbody', null,
          el('tr', null, el('td', { text: 'Fitted value curve' }), el('td', { text: 'log(mcap) on log(TVL) over the ' + v.live_fitted_n + ' live protocols with a market cap: value scales as TVL^' + m.fit_exponent + ', so big protocols price at a lower multiple.' }), el('td', { class: 'num', text: 'kept: ' + v.split_half_ape_loglog + ' vs ' + v.split_half_ape_global_median })),
          el('tr', null, el('td', { text: 'Category multiples' }), el('td', { text: 'Per-category median mcap/TVL with shrinkage. Tested three ways (split-half, walk-forward, leave-one-out) and lost every time.' }), el('td', { class: 'num', text: 'dropped' })),
          el('tr', null, el('td', { text: 'Growth' }), el('td', { text: 'Seven-day TVL change, clamped, half-weighted. On the forward test it predicted the next 13 days of TVL change (Spearman +' + v.forward_growth_spearman + ').' }), el('td', { class: 'num', text: 'kept' })),
          el('tr', null, el('td', { text: 'Launch window' }), el('td', { text: 'Ramps from 0.70 under 90 days to 1.00 from 90 days to 3 years, then decays toward 0.60: old protocols with no token launch less often (see odds).' }), el('td', { class: 'num', text: 'kept' })),
          el('tr', null, el('td', { text: 'Chain breadth' }), el('td', { text: 'Two per cent per extra chain. Made held-out predictions worse (0.972 vs 0.936).' }), el('td', { class: 'num', text: 'dropped' })),
          el('tr', null, el('td', { text: 'Value range' }), el('td', { text: 'Conformal band from split-half residuals: actual/predicted fell in [' + m.range_likely[0] + ', ' + m.range_likely[1] + '] for the middle half, [' + m.range_wide[0] + ', ' + m.range_wide[1] + '] for 10-90%. Wide because the market is.' }), el('td', { class: 'num', text: 'middle half' })),
          el('tr', null, el('td', { text: 'Launch odds (12m)' }), el('td', { text: 'Hazard from the peers\u2019 record: the tokened share by age, differenced over the next year, smoothed, blended by category where the record supports it. Peaks near 2-2.5 years, falls after.' }), el('td', { class: 'num', text: '2 of 2 caught' })),
          el('tr', null, el('td', { text: 'Launch clock' }), el('td', { text: 'Expected months to launch = 12 / odds, capped at 60.' }), el('td', { class: 'num', text: '3 - 60 mo' })),
          el('tr', null, el('td', { text: 'Costed verdict' }), el('td', { text: 'EV/hour = implied x odds x ' + (m.capture_share * 100) + '% capture / (1 setup hour + 15 min/week to the clock, max a year). FARM \u2265 $' + m.farm_threshold_usd_h + '/h, WATCH \u2265 $' + m.watch_threshold_usd_h + '/h. The capture share is a stated assumption: scale it linearly for your own.' }), el('td', { class: 'num', text: DATA.farm_count + ' FARM' }))
        )
      ),
      el('ul', { class: 'limits' },
        el('li', { text: 'The snapshot is frozen at ' + DATA.as_of + ': it says nothing about points programs, yields or announcements after that date, and "no token on record" is not proof a protocol has none.' }),
        el('li', { text: 'Held-out median error is ' + Math.round(v.split_half_ape_loglog * 100) + '%: launch values are genuinely hard to pin down, which is why every row carries a range instead of a point promise.' }),
        el('li', { text: 'Out-of-sample, 13 days on: ' + v.forward_launched.join(' and ') + ' launched; the previous board ranked them ' + v.forward_launched_prev_ranks.join(' and ') + ' of 226. Two launches is a small sample, stated as such.' }),
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
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
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
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Fitted curve' }), el('b', { class: 'num', text: 'exp(' + DATA.model.fit_intercept + ') x TVL^' + DATA.model.fit_exponent })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) + ' -> ' + fmtMult(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) + ' -> ' + fmtMult(row.window_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Likely range' }), el('b', { class: 'num', text: fmtUsd(row.value_low_usd) + ' \u2013 ' + fmtUsd(row.value_high_usd) })),
        el('div', null, el('span', { text: 'Launch odds (12m)' }), el('b', { class: 'num', text: fmtOdds(row.odds_12m) })),
        el('div', null, el('span', { text: 'Launch clock' }), el('b', { class: 'num', text: fmtClock(row.clock_months) })),
        el('div', null, el('span', { text: 'Verdict' }), el('b', { class: 'num', text: row.verdict + ' at ' + fmtEvH(row.ev_per_hour_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' Odds come from the peers\u2019 record at this age and category; the verdict assumes a ' + (DATA.model.capture_share * 100) + '% capture share.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Why it ranks here' }),
      el('ul', { class: 'why' }, el('li', { text: whyLine(row) }))
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
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
    shell.appendChild(header());
    shell.appendChild(lede());
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
