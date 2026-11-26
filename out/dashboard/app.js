// Token Radar dashboard. Reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked pre-token board, the calibration the model used, a per-protocol detail
// drawer with the model's own arithmetic and farm plan, and the live-token view. No network:
// every byte shown is in data.js. The page recomputes each row's implied value from the
// snapshot figures and marks it when the recomputation matches board.json, so the code and
// the board visibly run the same arithmetic. Deep links: #detail=<slug> opens a protocol,
// #cat=<category> applies a category filter.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', watchlistOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

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

  // The model in one function: the same arithmetic lib/model.ts runs. The page recomputes a
  // row from its snapshot figures and checks the number board.json carries.
  function impliedOf(row) {
    var growth = Math.min(100, Math.max(-50, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * 0.4;
    var age = row.age_days === null || row.age_days === undefined ? 365 : row.age_days;
    var maturity = 0.55 + (Math.min(Math.max(age, 0), 1095) / 1095) * 0.45;
    return Math.max(1, Math.round(row.tvl_usd * row.category_multiple * growthMult * maturity));
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

  // The farm plan derivation, mirrored from lib/model.ts: category, chains, TVL and age decide
  // the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 2e9) return 500;
    if (p.tvl_usd >= 5e8) return 250;
    if (p.tvl_usd >= 1e8) return 150;
    if (p.tvl_usd >= 2e7) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 75;
    if (age < 365) return 60;
    if (age < 730) return 45;
    return 30;
  }
  function gasFor(chain) {
    var c = chain.toLowerCase();
    if (c.indexOf('ethereum') >= 0 || c.indexOf('mainnet') >= 0) return '$3-12 of Ethereum gas';
    if (c.indexOf('solana') >= 0) return 'under $0.05 of Solana fees';
    if (c.indexOf('tron') >= 0 || c.indexOf('bsc') >= 0 || c.indexOf('bnb') >= 0) return 'about $0.10-1 of gas';
    return 'about $0.50-3 of gas';
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ', then borrow a small amount against it so both sides of the market count you.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('options') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s deepest pool on " + chain + ' and leave it earning.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC into ' + chain + ' through ' + name + ', then use the bridged funds once in the destination app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' and keep the receipt token.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small, hedged position.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and take one small position in a liquid market on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('aggregator') >= 0) return 'Deposit $' + capital + ' into ' + name + "'s largest vault on " + chain + ' and keep the vault shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + ' of ' + name + "'s yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    if (c.indexOf('privacy') >= 0) return 'Deposit $' + capital + ' into ' + name + ' on ' + chain + ' and keep the balance parked there.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function weeklyFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0) return 'add a small supply or repay and re-borrow, so the account stays active on both sides';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0) return 'make one small swap or rebalance the LP position';
    if (c.indexOf('bridge') >= 0) return 'bridge a small amount back or forth';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'open and close one small trade';
    if (c.indexOf('prediction') >= 0) return 'take one small position in a new market';
    return 'make one small deposit, withdrawal or governance action';
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasFor(chain);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm with ' + p.name + '; keep the seed phrase offline and never connect it to a claim site.', cost: gas + ' for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital plus ' + gas, time: '15 minutes to set up' },
      { text: 'Each week, ' + weeklyFor(p) + ', so the wallet reads as an active user and not a one-day deposit.', cost: gas + ' a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + " days so the activity lands in more than one snapshot of the protocol's user base.", cost: 'the $' + capital + ' stays in the position; smart-contract risk is real and no airdrop is promised', time: hold + ' days' },
      { text: "Check " + p.name + "'s own points or rewards page from its official link only; a real claim never asks you to pay or to reveal your seed phrase.", cost: 'nothing to check, and never pay to claim', time: '10 minutes' },
      { text: 'Log the wallet, dates, amounts and transaction hashes so you can repeat the position or unwind it cleanly.', cost: 'nothing but the log', time: '5 minutes' }
    ];
  }

  function badge(row) {
    return row.on_watchlist
      ? el('span', { class: 'badge wl', text: 'WATCHLIST' })
      : el('span', { class: 'badge early', text: 'EARLY' });
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.watchlistOnly && !r.on_watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorized') !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    rows.sort(function (a, b) {
      var av, bv;
      if (key === 'implied') { av = a.implied_value_usd; bv = b.implied_value_usd; }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -1e9 : a.change_7d; bv = b.change_7d === null ? -1e9 : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else { av = a.rank; bv = b.rank; }
      if (av !== bv) return (av - bv) * dir;
      return a.slug < b.slug ? -1 : 1;
    });
    return rows;
  }

  function th(label, key) {
    var arrow = state.sort === key ? (state.dir === -1 ? ' \u25BC' : ' \u25B2') : '';
    return el('th', {
      class: 'sortable',
      text: label + arrow,
      onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'rank' ? 1 : -1; }
        render();
      }
    });
  }

  function boardTable() {
    var rows = filteredRows();
    var head = el('thead', null, el('tr', null,
      th('#', 'rank'),
      el('th', { class: 'left', text: 'Protocol' }),
      el('th', { class: 'left', text: 'Category' }),
      el('th', { class: 'left', text: 'Chains' }),
      th('TVL', 'tvl'),
      th('7d change', 'growth'),
      th('Token-less age', 'age'),
      th('Implied value', 'implied'),
      el('th', { text: 'Implied / TVL' })
    ));
    var body = el('tbody');
    rows.forEach(function (r) {
      var ratio = r.tvl_usd > 0 ? (r.implied_value_usd / r.tvl_usd).toFixed(3) + 'x' : 'n/a';
      var tr = el('tr', { class: state.selected === r.slug ? 'sel' : '', onclick: function () { openDetail(r.slug); } },
        el('td', { class: 'rankcell', text: String(r.rank) }),
        el('td', { class: 'left proto' }, el('span', { class: 'pname', text: r.name }), badge(r), el('span', { class: 'pslug', text: r.slug })),
        el('td', { class: 'left', text: r.category || 'Uncategorized' }),
        el('td', { class: 'left', text: r.chains.length > 2 ? r.chains.slice(0, 2).join(', ') + ' +' + (r.chains.length - 2) : r.chains.join(', ') || 'n/a' }),
        el('td', { text: fmtUsd(r.tvl_usd) }),
        el('td', { class: r.change_7d !== null && r.change_7d < 0 ? 'neg' : 'pos', text: fmtPct(r.change_7d) }),
        el('td', { text: fmtAge(r.age_days) }),
        el('td', { class: 'implied', text: fmtUsd(r.implied_value_usd) }),
        el('td', { text: ratio })
      );
      body.appendChild(tr);
    });
    var table = el('table', { class: 'board' }, head, body);
    var wrap = el('div', { class: 'table-wrap' }, table);
    if (rows.length === 0) wrap.appendChild(el('div', { class: 'empty', text: 'No protocol matches these filters.' }));
    return wrap;
  }

  function liveTable() {
    var head = el('thead', null, el('tr', null,
      el('th', { class: 'left', text: 'Protocol' }),
      el('th', { class: 'left', text: 'Category' }),
      el('th', { class: 'left', text: 'Chains' }),
      el('th', { text: 'TVL' }),
      el('th', { text: 'Market cap' }),
      el('th', { text: 'mcap / TVL' }),
      el('th', { text: '7d change' })
    ));
    var body = el('tbody');
    DATA.live.forEach(function (r) {
      body.appendChild(el('tr', null,
        el('td', { class: 'left proto' }, el('span', { class: 'pname', text: r.name }), el('span', { class: 'pslug', text: r.slug })),
        el('td', { class: 'left', text: r.category || 'Uncategorized' }),
        el('td', { class: 'left', text: r.chains.length > 2 ? r.chains.slice(0, 2).join(', ') + ' +' + (r.chains.length - 2) : r.chains.join(', ') || 'n/a' }),
        el('td', { text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'implied', text: fmtUsd(r.mcap_usd) }),
        el('td', { text: r.mcap_tvl === null ? 'n/a' : r.mcap_tvl.toFixed(3) + 'x' }),
        el('td', { class: r.change_7d !== null && r.change_7d < 0 ? 'neg' : 'pos', text: fmtPct(r.change_7d) })
      ));
    });
    return el('div', { class: 'table-wrap' }, el('table', { class: 'board' }, head, body));
  }

  function calibrationTable() {
    function half(rows) {
      var head = el('thead', null, el('tr', null,
        el('th', { class: 'cat', text: 'Category' }),
        el('th', { text: 'Live n' }),
        el('th', { text: 'Median' }),
        el('th', { text: 'Used' })
      ));
      var body = el('tbody');
      rows.forEach(function (c) {
        var fallback = c.live_n < 3;
        body.appendChild(el('tr', null,
          el('td', { class: 'cat', text: c.category }),
          el('td', { text: String(c.live_n) }),
          el('td', { text: c.median_multiple === 0 ? 'n/a' : c.median_multiple.toFixed(3) + 'x' }),
          el('td', { class: fallback ? 'fallback' : 'used', text: c.used_multiple.toFixed(3) + 'x' + (fallback ? ' (global)' : '') })
        ));
      });
      return el('table', { class: 'cal' }, head, body);
    }
    var priced = DATA.calibration.filter(function (c) { return c.live_n >= 1; });
    var unpriced = DATA.calibration.length - priced.length;
    var mid = Math.ceil(priced.length / 2);
    var grid = el('div', { class: 'cal-grid' }, half(priced.slice(0, mid)), half(priced.slice(mid)));
    var wrap = el('div', null, grid);
    if (unpriced > 0) {
      wrap.appendChild(el('p', { class: 'note', text: unpriced + ' further categories have no live token in the snapshot and use the global median of ' + DATA.global_multiple.toFixed(3) + 'x.' }));
    }
    return wrap;
  }

  function openDetail(slug) {
    state.selected = slug;
    render();
  }
  function closeDetail() {
    state.selected = null;
    render();
  }

  function detailDrawer() {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === state.selected) row = r; });
    if (!row) return null;
    var recomputed = impliedOf(row);
    var agrees = recomputed === row.implied_value_usd;
    var cal = null;
    DATA.calibration.forEach(function (c) { if (c.category === (row.category || 'Uncategorized')) cal = c; });
    var steps = farmSteps(row);
    var farm = el('ol', { class: 'farm' });
    steps.forEach(function (s) {
      farm.appendChild(el('li', null, s.text, el('span', { class: 'meta', text: 'Cost: ' + s.cost + ' \u00B7 Time: ' + s.time })));
    });
    var kv = el('dl', { class: 'kv' },
      el('dt', { text: 'Category' }), el('dd', { text: row.category || 'Uncategorized' }),
      el('dt', { text: 'Chains' }), el('dd', { text: row.chains.join(', ') || 'n/a' }),
      el('dt', { text: 'TVL' }), el('dd', { text: usd.format(row.tvl_usd) }),
      el('dt', { text: '7d TVL change' }), el('dd', { text: fmtPct(row.change_7d) }),
      el('dt', { text: 'Listed (DefiLlama)' }), el('dd', { text: row.listed_at || 'unknown' }),
      el('dt', { text: 'Token-less age' }), el('dd', { text: fmtAge(row.age_days) }),
      el('dt', { text: 'On watchlist' }), el('dd', { text: row.on_watchlist ? 'yes (house floor)' : 'no (early radar)' })
    );
    var arith = el('div', { class: 'arith' },
      el('div', { text: fmtUsd(row.tvl_usd) + ' TVL \u00D7 ' + row.category_multiple.toFixed(3) + ' (' + (cal && cal.live_n >= 3 ? 'median of ' + cal.live_n + ' live ' + cal.category + ' tokens' : 'global median') + ')' }),
      el('div', { text: '\u00D7 ' + row.growth_multiplier.toFixed(3) + ' growth \u00D7 ' + row.maturity_multiplier.toFixed(3) + ' maturity' }),
      el('div', null, '= ', el('span', { class: 'big', text: usd.format(row.implied_value_usd) }), ' implied value'),
      el('div', { class: agrees ? 'pos' : 'neg', text: agrees ? 'Page recomputation agrees with board.json.' : 'Page recomputation: ' + usd.format(recomputed) + ' (differs)' })
    );
    return el('aside', { class: 'drawer', role: 'dialog', 'aria-label': row.name + ' detail' },
      el('button', { class: 'close', text: '\u00D7', onclick: closeDetail, 'aria-label': 'Close detail' }),
      el('h3', { text: row.name }),
      el('div', { class: 'sub', text: '#' + row.rank + ' \u00B7 ' + row.slug + ' \u00B7 pre-token' }),
      el('h4', { text: 'Snapshot record' }), kv,
      el('h4', { text: 'Model arithmetic' }), arith,
      el('h4', { text: 'Farm plan' }), farm,
      el('div', { class: 'risk', text: 'Farming is not free money: capital sits in smart contracts, gas and time are spent either way, and no protocol owes anyone a token. Size positions so a zero outcome is survivable.' })
    );
  }

  function render() {
    app.textContent = '';
    var totalTvl = DATA.rows.reduce(function (s, r) { return s + r.tvl_usd; }, 0);
    var masthead = el('header', { class: 'masthead' },
      el('div', null,
        el('h1', null, 'TOKEN RADAR', el('span', { class: 'dot', text: '.' })),
        el('p', { class: 'tagline', text: 'Protocols with no token yet, ranked by what the market already pays for their category.' })
      ),
      el('div', { class: 'asof' },
        el('div', null, 'Snapshot as of ', el('b', { text: DATA.as_of })),
        el('div', { text: DATA.source }),
        el('div', null, 'Model ', el('b', { text: DATA.model_version }))
      )
    );
    var stats = el('div', { class: 'stats' },
      el('div', { class: 'stat' }, el('div', { class: 'v', text: String(DATA.board_size) }), el('div', { class: 'k', text: 'Pre-token ranked' })),
      el('div', { class: 'stat' }, el('div', { class: 'v', text: String(DATA.watchlist_size) }), el('div', { class: 'k', text: 'On watchlist' })),
      el('div', { class: 'stat' }, el('div', { class: 'v', text: String(DATA.early_size) }), el('div', { class: 'k', text: 'Early radar' })),
      el('div', { class: 'stat' }, el('div', { class: 'v', text: String(DATA.live_size) }), el('div', { class: 'k', text: 'Live tokens set aside' })),
      el('div', { class: 'stat' }, el('div', { class: 'v', text: fmtUsd(totalTvl) }), el('div', { class: 'k', text: 'Board TVL' }))
    );
    var model = el('section', { class: 'model' },
      el('h2', { text: 'The value model' }),
      el('p', { class: 'formula', text: DATA.formula }),
      el('p', { class: 'note', text: 'The category multiple is not a guess: it is the median market-cap-to-TVL ratio of the snapshot\'s own live-token protocols in that category (mcap at least $1M, TVL at least $10M), clamped to 0.05x\u20131.5x. Categories with fewer than 3 live samples use the global median of ' + DATA.global_multiple.toFixed(3) + 'x. Growth and maturity then adjust for the protocol\'s own 7-day TVL change and how long it has run with no token. Implied value is this entry\'s claim, never a prediction that a token will launch.' }),
      calibrationTable()
    );
    var tabs = el('div', { class: 'tabs', role: 'tablist' },
      el('button', { role: 'tab', 'aria-selected': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token board (' + DATA.board_size + ')', onclick: function () { state.tab = 'pre-token'; render(); } }),
      el('button', { role: 'tab', 'aria-selected': state.tab === 'live' ? 'true' : 'false', text: 'Live tokens (' + DATA.live_size + ')', onclick: function () { state.tab = 'live'; render(); } })
    );

    var categories = ['all'];
    DATA.rows.forEach(function (r) { var c = r.category || 'Uncategorized'; if (categories.indexOf(c) < 0) categories.push(c); });
    categories.sort(function (a, b) { return a === 'all' ? -1 : b === 'all' ? 1 : (a < b ? -1 : 1); });
    var chains = ['all'];
    DATA.rows.forEach(function (r) { r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); }); });
    chains.sort(function (a, b) { return a === 'all' ? -1 : b === 'all' ? 1 : (a < b ? -1 : 1); });

    var catSel = el('select', { 'aria-label': 'Category', onchange: function (e) { state.category = e.target.value; render(); } });
    categories.forEach(function (c) { catSel.appendChild(el('option', { value: c, text: c === 'all' ? 'All categories' : c, selected: state.category === c ? 'selected' : null })); });
    var chainSel = el('select', { 'aria-label': 'Chain', onchange: function (e) { state.chain = e.target.value; render(); } });
    chains.forEach(function (c) { chainSel.appendChild(el('option', { value: c, text: c === 'all' ? 'All chains' : c, selected: state.chain === c ? 'selected' : null })); });
    var search = el('input', { type: 'search', placeholder: 'Search name or slug\u2026', value: state.q, 'aria-label': 'Search', oninput: function (e) { state.q = e.target.value; renderTableOnly(); } });
    var toggle = el('label', { class: 'toggle' }, el('input', { type: 'checkbox', checked: state.watchlistOnly ? 'checked' : null, onchange: function (e) { state.watchlistOnly = e.target.checked; render(); } }), 'Watchlist only');
    var count = el('span', { class: 'count', id: 'rowcount' });
    var controls = el('div', { class: 'controls' }, search, catSel, chainSel, toggle, count);

    var tableSlot = el('div', { id: 'tableslot' });
    var footer = el('footer', null,
      el('div', { text: 'Method: the board ranks the house watchlist plus every rankable pre-token protocol below the $50M floor (no recorded token, not an exchange, not a versioned pool, not a wrapped, staked or bridged product of a token that already trades); the watchlist is the floor, never the ceiling. Live-token protocols are set aside with the market\'s own values. Farm plans are derived from each protocol\'s category, chains, TVL and age. Nothing here is financial advice.' })
    );

    app.appendChild(masthead);
    app.appendChild(stats);
    app.appendChild(model);
    app.appendChild(tabs);
    if (state.tab === 'pre-token') {
      app.appendChild(controls);
      app.appendChild(tableSlot);
      renderTableOnly();
    } else {
      app.appendChild(liveTable());
    }
    app.appendChild(footer);
    var drawer = detailDrawer();
    if (drawer) app.appendChild(drawer);
    app.setAttribute('aria-busy', 'false');
  }

  function renderTableOnly() {
    var slot = document.getElementById('tableslot');
    if (!slot) return;
    slot.textContent = '';
    slot.appendChild(boardTable());
    var count = document.getElementById('rowcount');
    if (count) count.textContent = filteredRows().length + ' of ' + DATA.board_size + ' protocols';
  }

  // Deep links for shared views (and the entry's own screenshots): #detail=<slug>, #cat=<category>.
  function applyHash() {
    var h = window.location.hash.replace(/^#/, '');
    h.split('&').forEach(function (part) {
      var kv = part.split('=');
      if (kv[0] === 'detail' && kv[1]) state.selected = decodeURIComponent(kv[1]);
      if (kv[0] === 'cat' && kv[1]) state.category = decodeURIComponent(kv[1]);
      if (kv[0] === 'tab' && kv[1] === 'live') state.tab = 'live';
    });
  }
  applyHash();
  render();
})();
