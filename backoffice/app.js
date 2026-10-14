// Friesta Back Office — reports, items, discounts, employees, settings.
import { Store, STARTER_ITEMS, normaliseBackup } from '../shared/store.js';
import { $, esc, uid, r2, pad3, peso, peso0, pesoShort, dayStart, addDays, addMonths, monthStart, weekStart, fmtTime, fmtDT, isoDate, lsGet, lsSet, toast, modal, closeModal, modalOpen, Modal, head, armed, ICON, registerSW, catchErrors, toCSV, download } from '../shared/util.js';
import { renderGate } from '../shared/auth-ui.js';
import * as M from '../shared/metrics.js';

document.querySelectorAll('[data-ic]').forEach(el => { el.outerHTML = ICON[el.dataset.ic]; });
const NCOL = 8;
const tcol = i => `--tb:var(--c${(+i || 0) % NCOL});--ti:var(--i${(+i || 0) % NCOL})`;
const hasVariants = it => Array.isArray(it.variants) && it.variants.length > 0;
const tracked = it => it && it.stock !== null && it.stock !== undefined && it.stock !== '';
const ROLE = { owner: 'Owner', manager: 'Manager', cashier: 'Cashier' };
const fmtD = t => new Date(t).toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric' });
const pct = v => (v * 100).toFixed(1) + '%';

/* ================= state ================= */
const PRESETS = [
  ['today', 'Today', () => [dayStart(), addDays(dayStart(), 1)]],
  ['yesterday', 'Yesterday', () => [addDays(dayStart(), -1), dayStart()]],
  ['this-week', 'This week', () => [weekStart(Date.now()), addDays(weekStart(Date.now()), 7)]],
  ['last-week', 'Last week', () => [addDays(weekStart(Date.now()), -7), weekStart(Date.now())]],
  ['this-month', 'This month', () => [monthStart(Date.now()), addMonths(Date.now(), 1)]],
  ['last-month', 'Last month', () => [addMonths(Date.now(), -1), monthStart(Date.now())]],
  ['last-7', 'Last 7 days', () => [addDays(dayStart(), -6), addDays(dayStart(), 1)]],
  ['last-30', 'Last 30 days', () => [addDays(dayStart(), -29), addDays(dayStart(), 1)]]
];
function presetRange(id) { const p = PRESETS.find(x => x[0] === id) || PRESETS[7]; const [from, to] = p[2](); return { from, to, preset: p[0] }; }
let range = (() => { try { const r = JSON.parse(sessionStorage.getItem('friesta:range')); if (r && r.preset) return presetRange(r.preset); if (r && r.from) return r; } catch (e) {} return presetRange('last-30'); })();
let emp = sessionStorage.getItem('friesta:emp') || '';
let route = 'summary', metric = 'net', unit = null, sales = [], watched = null;
let rptTab = 'all';

const ROUTES = {
  'summary': { t: 'Sales summary', report: true },
  'by-item': { t: 'Sales by item', report: true, search: true },
  'by-category': { t: 'Sales by category', report: true },
  'by-employee': { t: 'Sales by employee', report: true, noEmp: true },
  'by-payment': { t: 'Sales by payment type', report: true },
  'receipts': { t: 'Receipts', report: true, search: true },
  'discount-report': { t: 'Discounts', report: true },
  'shifts': { t: 'Shifts', report: true, noEmp: true },
  'items': { t: 'Item list' },
  'categories': { t: 'Categories' },
  'discounts': { t: 'Discounts' },
  'employees': { t: 'Employees & PIN' },
  'settings': { t: 'Settings' }
};

/* ================= boot ================= */
async function boot() {
  catchErrors(); registerSW();
  Store.onError = e => { if (/permission/i.test((e && (e.code || e.message)) || '')) toast('Hindi ma-save sa cloud (permission). Mag-sign in ulit.'); else console.error(e); };
  await Store.init();
  let raf = 0;
  Store.on(ch => {
    if (ch.has('status')) return gate();
    if (Store.status !== 'ready') return;
    cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { header(); refreshBody(); });
  });
  addEventListener('hashchange', () => setRoute());
  gate();
}
function gate() {
  const ready = Store.status === 'ready';
  $('gate').hidden = ready; $('app').hidden = !ready;
  if (!ready) { if (watched) { watched.unsub(); watched = null; } renderGate($('gate'), 'bo'); return; }
  header(); setRoute();
}
function header() {
  const a = Store.account || {}; const name = Store.data.employees.find(e => e.role === 'owner')?.name || a.name || a.email || '';
  $('acctav').textContent = (name || '?').charAt(0).toUpperCase(); $('acctname').textContent = name;
  const st = $('status'), cloud = Store.mode === 'cloud';
  st.className = 'status' + (cloud && !Store.online ? ' off' : '');
  st.querySelector('span').textContent = cloud ? (Store.online ? 'Synced' : 'Offline – will sync') : 'Saved on this device';
}

/* ================= routing ================= */
function setRoute() {
  const h = location.hash.slice(1); route = ROUTES[h] ? h : 'summary';
  document.querySelectorAll('.side a[href^="#"]').forEach(a => { if (a.getAttribute('href') === '#' + route) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  $('title').textContent = ROUTES[route].t; document.title = ROUTES[route].t + ' · Friesta Back Office';
  $('side').classList.remove('open'); $('scrimside').classList.remove('open');
  if (ROUTES[route].report) ensureWatch();
  renderShell(); $('content').scrollTop = 0;
}
function ensureWatch() {
  const n = Math.max(1, Math.round((range.to - range.from) / 864e5));
  const from = addDays(range.from, -n), to = range.to;
  if (watched && watched.from <= from && watched.to >= to) return;
  if (watched) watched.unsub();
  watched = { from, to, unsub: Store.watchSales(from, to, arr => { sales = arr; if (ROUTES[route].report) refreshBody(); }) };
}
function setRange(r) {
  range = r; unit = null;
  sessionStorage.setItem('friesta:range', JSON.stringify(r.preset ? { preset: r.preset } : r));
  ensureWatch(); renderShell();
}

/* ================= page shell ================= */
function rangeLabel() { const last = addDays(range.to, -1); return range.to - range.from <= 864e5 ? fmtD(range.from) : `${fmtD(range.from)} – ${fmtD(last)}`; }
function filtersHTML() {
  const r = ROUTES[route];
  return `<div class="filters">
    <div class="range"><button id="rprev" aria-label="Previous period">${ICON.back}</button><button class="mid" id="rpick">${ICON.cal}<span>${esc(rangeLabel())}</span></button><button id="rnext" aria-label="Next period" ${range.to > Date.now() ? 'disabled style="opacity:.35"' : ''}>${ICON.next}</button></div>
    ${r.noEmp ? '' : `<label class="selwrap">${ICON.user}<select id="remp" aria-label="Employee"><option value="">All employees</option>${Store.data.employees.map(e => `<option value="${e.id}" ${emp === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>${ICON.down}</label>`}
    ${r.search ? `<label class="search" style="flex:1 1 220px;max-width:320px">${ICON.search}<input id="psearch" type="search" placeholder="Search" aria-label="Search"></label>` : ''}
  </div>`;
}
function renderShell() {
  const r = ROUTES[route], page = $('page');
  page.innerHTML = (r.report ? filtersHTML() : '') + `<div id="pbody" style="display:flex;flex-direction:column;gap:16px"></div>`;
  if (r.report) {
    $('rprev').addEventListener('click', () => shiftRange(-1));
    $('rnext').addEventListener('click', () => shiftRange(1));
    $('rpick').addEventListener('click', openPicker);
    const se = $('remp'); if (se) se.addEventListener('change', () => { emp = se.value; sessionStorage.setItem('friesta:emp', emp); refreshBody(); });
    const ps = $('psearch'); if (ps) ps.addEventListener('input', refreshBody);
  }
  refreshBody();
}
function refreshBody() {
  const b = $('pbody'); if (!b) return;
  const a = document.activeElement; if (b.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return;
  const fn = { 'summary': pSummary, 'by-item': pByItem, 'by-category': pByCategory, 'by-employee': pByEmployee, 'by-payment': pByPayment, 'receipts': pReceipts, 'discount-report': pDiscReport, 'shifts': pShifts, 'items': pItems, 'categories': pCategories, 'discounts': pDiscounts, 'employees': pEmployees, 'settings': pSettings }[route];
  fn(b);
}
function shiftRange(dir) {
  const fullMonth = range.from === monthStart(range.from) && range.to === addMonths(range.from, 1);
  if (fullMonth) return setRange({ from: addMonths(range.from, dir), to: addMonths(range.from, dir + 1) });
  const n = Math.round((range.to - range.from) / 864e5);
  setRange({ from: addDays(range.from, dir * n), to: addDays(range.to, dir * n) });
}
const empPred = () => emp ? (s => s.employeeId === emp) : (() => true);
const searchQ = () => { const s = $('psearch'); return s ? s.value.trim().toLowerCase() : ''; };
const prevRange = () => { const n = Math.round((range.to - range.from) / 864e5); return [addDays(range.from, -n), range.from]; };

/* ================= date range picker ================= */
function openPicker() {
  let selA = range.from, selB = addDays(range.to, -1), picking = false, view = monthStart(selB);
  const today = dayStart();
  const m = modal(`<div class="dp"><div class="calcol"><div class="cal" id="cal"></div></div><div class="pres">${PRESETS.map(p => `<button data-p="${p[0]}" aria-pressed="${range.preset === p[0]}">${p[1]}</button>`).join('')}</div></div>
    <div class="dpfoot"><div class="se"><div><small>Start date</small><span id="dpa"></span></div><div><small>End date</small><span id="dpb"></span></div></div><div class="actions"><button class="btn ghost sm" data-close>Cancel</button><button class="btn sm" id="dpok">Done</button></div></div>`, { wide: true, cls: 'dpm' });
  m.style.maxWidth = '620px';
  const draw = () => {
    const first = new Date(view), lead = (first.getDay() + 6) % 7; let t = addDays(view, -lead);
    const lo = Math.min(selA, selB ?? selA), hi = Math.max(selA, selB ?? selA);
    let rows = '';
    for (let w = 0; w < 6; w++) {
      rows += '<tr>';
      for (let d = 0; d < 7; d++) {
        const cls = [new Date(t).getMonth() !== first.getMonth() ? 'out' : '', t > lo && t < hi ? 'in' : '', t === lo || t === hi ? 'end' : '', t === today ? 'today' : ''].join(' ');
        rows += `<td><button data-d="${t}" class="${cls}" ${t > today ? 'disabled' : ''}>${new Date(t).getDate()}</button></td>`;
        t = addDays(t, 1);
      }
      rows += '</tr>';
    }
    $('cal').innerHTML = `<div class="mon"><button class="iconbtn" id="cprev" aria-label="Previous month">${ICON.back}</button><b>${new Date(view).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}</b><button class="iconbtn" id="cnext" aria-label="Next month" ${addMonths(view, 1) > today ? 'disabled style="opacity:.35"' : ''}>${ICON.next}</button></div>
      <table><thead><tr>${['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(d => `<th>${d}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
    $('dpa').textContent = fmtD(lo); $('dpb').textContent = selB == null ? '—' : fmtD(hi);
    $('cprev').addEventListener('click', () => { view = addMonths(view, -1); draw(); });
    $('cnext').addEventListener('click', () => { if (addMonths(view, 1) <= today) { view = addMonths(view, 1); draw(); } });
    $('cal').querySelectorAll('[data-d]').forEach(b => b.addEventListener('click', () => {
      const d = +b.dataset.d;
      if (!picking) { selA = d; selB = null; picking = true; } else { selB = d; picking = false; }
      m.querySelectorAll('[data-p]').forEach(x => x.setAttribute('aria-pressed', 'false')); draw();
    }));
  };
  draw();
  m.querySelectorAll('[data-p]').forEach(b => b.addEventListener('click', () => { closeModal(); setRange(presetRange(b.dataset.p)); }));
  $('dpok').addEventListener('click', () => {
    const lo = Math.min(selA, selB ?? selA), hi = Math.max(selA, selB ?? selA);
    closeModal(); setRange({ from: lo, to: addDays(hi, 1) });
  });
}

/* ================= chart ================= */
function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
function ticks(min, max) {
  if (max === min) { max = min + 1000; }
  const step = niceStep((max - min) / 4), lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}
function drawChart(host, pts) {
  const draw = () => {
    const W = Math.max(300, host.clientWidth - 20), H = 270, L = 62, R = 18, T = 14, rot = pts.length > 10, B = rot ? 58 : 34;
    const vals = pts.map(p => p.v), tk = ticks(Math.min(0, ...vals), Math.max(0, ...vals)), y0 = tk[0], y1 = tk[tk.length - 1];
    const span = W - L - R, X = i => L + (pts.length === 1 ? span / 2 : i * span / (pts.length - 1)), Y = v => T + (H - T - B) * (1 - (v - y0) / (y1 - y0 || 1));
    const step = Math.max(1, Math.ceil(pts.length / Math.max(2, Math.floor(span / (rot ? 34 : 60)))));
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
    const area = pts.length > 1 ? `${line}L${X(pts.length - 1).toFixed(1)},${Y(Math.max(y0, 0)).toFixed(1)}L${X(0).toFixed(1)},${Y(Math.max(y0, 0)).toFixed(1)}Z` : '';
    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Chart">
      ${tk.map(v => `<line class="gl" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="axis" x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${esc(pesoShort(v))}</text>`).join('')}
      <line class="base" x1="${L}" x2="${W - R}" y1="${Y(Math.max(y0, 0))}" y2="${Y(Math.max(y0, 0))}"/>
      <path class="ar" d="${area}"/><path class="ln" d="${line}"/>
      ${pts.length <= 45 ? pts.map((p, i) => `<circle class="pt" data-i="${i}" cx="${X(i)}" cy="${Y(p.v)}" r="4"/>`).join('') : ''}
      ${pts.map((p, i) => i % step === 0 ? (rot ? `<text class="axis" transform="translate(${X(i)},${H - B + 14}) rotate(-40)" text-anchor="end">${esc(p.label)}</text>` : `<text class="axis" x="${X(i)}" y="${H - B + 18}" text-anchor="middle">${esc(p.label)}</text>`) : '').join('')}
      <line class="xh" id="xh" y1="${T}" y2="${H - B}" x1="0" x2="0" visibility="hidden"/>
      <rect x="${L - 10}" y="0" width="${span + 20}" height="${H - B}" fill="transparent" id="hit"/>
    </svg><div class="tip" id="tip" hidden></div>`;
    const svg = host.querySelector('svg'), tip = host.querySelector('#tip'), xh = host.querySelector('#xh');
    const show = e => {
      const rc = svg.getBoundingClientRect(), xv = (e.clientX - rc.left) * W / rc.width;
      const i = pts.length === 1 ? 0 : Math.max(0, Math.min(pts.length - 1, Math.round((xv - L) / (span / (pts.length - 1)))));
      const p = pts[i]; xh.setAttribute('x1', X(i)); xh.setAttribute('x2', X(i)); xh.setAttribute('visibility', 'visible');
      host.querySelectorAll('.pt').forEach(c => c.classList.toggle('on', +c.dataset.i === i));
      tip.hidden = false; tip.innerHTML = `${esc(p.full)}<b class="num">${esc(peso(p.v))}</b>`;
      const px = X(i) * rc.width / W + 10, py = Y(p.v) * rc.height / H + 8;
      tip.style.left = Math.min(Math.max(px, 70), host.clientWidth - 70) + 'px'; tip.style.top = Math.max(py - 8, 46) + 'px';
    };
    const hide = () => { tip.hidden = true; xh.setAttribute('visibility', 'hidden'); host.querySelectorAll('.pt.on').forEach(c => c.classList.remove('on')); };
    svg.addEventListener('pointermove', show); svg.addEventListener('pointerdown', show); svg.addEventListener('pointerleave', hide);
  };
  draw();
  let w = host.clientWidth;
  const ro = new ResizeObserver(() => { if (!host.isConnected) return ro.disconnect(); if (Math.abs(host.clientWidth - w) > 4) { w = host.clientWidth; draw(); } });
  ro.observe(host);
}
function bucketLabel(a, u) {
  const d = new Date(a);
  if (u === 'hour') { const h = d.getHours(); return [(h % 12 || 12) + (h < 12 ? 'am' : 'pm'), fmtD(a) + ' · ' + (h % 12 || 12) + (h < 12 ? ' AM' : ' PM')]; }
  if (u === 'day') return [d.toLocaleDateString('en-PH', { day: 'numeric', month: 'short' }), d.toLocaleDateString('en-PH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })];
  if (u === 'week') return [d.toLocaleDateString('en-PH', { day: 'numeric', month: 'short' }), 'Week of ' + fmtD(a)];
  return [d.toLocaleDateString('en-PH', { month: 'short', year: '2-digit' }), d.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })];
}

/* ================= REPORTS ================= */
const KPIS = [['gross', 'Gross sales', 1], ['refunds', 'Refunds', -1], ['discounts', 'Discounts', -1], ['net', 'Net sales', 1], ['profit', 'Gross profit', 1]];
function delta(cur, prev, dir) {
  const d = cur - prev; if (Math.abs(d) < 0.005) return `<span class="d flat">No change</span>`;
  const p = prev ? ` (${d > 0 ? '+' : '−'}${Math.abs(d / Math.abs(prev) * 100).toFixed(2)}%)` : '';
  return `<span class="d ${d * dir > 0 ? 'up' : 'down'}">${d > 0 ? '+' : '−'}${peso(Math.abs(d))}${p}</span>`;
}
function pSummary(b) {
  const pred = empPred(), [pf, pt] = prevRange();
  const cur = M.summarize(sales, range.from, range.to, pred), prev = M.summarize(sales, pf, pt, pred);
  const days = Math.round((range.to - range.from) / 864e5);
  const units = [days <= 1 ? 'hour' : null, days > 1 && days <= 92 ? 'day' : null, days >= 14 ? 'week' : null, days >= 60 ? 'month' : null].filter(Boolean);
  if (!unit || !units.includes(unit)) unit = M.autoUnit(range.from, range.to);
  const ser = M.series(sales, range.from, range.to, unit, pred);
  const mlabel = KPIS.find(k => k[0] === metric)[1];
  b.innerHTML = `<div class="card">
    <div class="kpistrip">${KPIS.map(([k, l, dir]) => `<button class="kpi" data-k="${k}" aria-pressed="${metric === k}"><span class="k">${l}</span><span class="v num">${peso(cur[k])}</span>${delta(cur[k], prev[k], dir)}</button>`).join('')}</div>
    <div class="minis"><span>Receipts<b class="num">${cur.receipts}</b></span><span>Average sale<b class="num">${peso(cur.avg)}</b></span><span>Items sold<b class="num">${cur.itemsSold}</b></span><span>Cost of goods<b class="num">${peso(cur.cogs)}</b></span><span>Gross margin<b class="num">${cur.net ? pct(cur.margin) : '—'}</b></span></div>
    <div class="charthead"><h3>${mlabel}</h3>${units.length > 1 ? `<div class="seg" id="units">${units.map(u => `<button data-u="${u}" aria-pressed="${u === unit}">${{ hour: 'Hours', day: 'Days', week: 'Weeks', month: 'Months' }[u]}</button>`).join('')}</div>` : ''}</div>
    <div class="chart" id="chart"></div>
  </div>
  <div class="card"><div class="secthead"><h3>Export</h3><button class="btn ghost sm" id="csv">${ICON.download} Download CSV</button></div>
    <div class="tblwrap"><table class="tbl"><thead><tr><th>${unit === 'hour' ? 'Hour' : 'Date'}</th><th class="r">Gross sales</th><th class="r">Refunds</th><th class="r">Discounts</th><th class="r">Net sales</th><th class="r">Cost of goods</th><th class="r">Gross profit</th></tr></thead>
    <tbody>${ser.slice().reverse().filter(s => unit !== 'hour' || s.gross || s.refunds).map(s => `<tr><td>${esc(bucketLabel(s.from, unit)[1])}</td><td class="r num">${peso(s.gross)}</td><td class="r num">${peso(s.refunds)}</td><td class="r num">${peso(s.discounts)}</td><td class="r num">${peso(s.net)}</td><td class="r num">${peso(s.cogs)}</td><td class="r num">${peso(s.profit)}</td></tr>`).join('') || `<tr><td colspan="7" class="sub">Walang benta sa panahong ito</td></tr>`}</tbody>
    <tfoot><tr><td>Total</td><td class="r num">${peso(cur.gross)}</td><td class="r num">${peso(cur.refunds)}</td><td class="r num">${peso(cur.discounts)}</td><td class="r num">${peso(cur.net)}</td><td class="r num">${peso(cur.cogs)}</td><td class="r num">${peso(cur.profit)}</td></tr></tfoot></table></div></div>`;
  drawChart($('chart'), ser.map(s => { const [label, full] = bucketLabel(s.from, unit); return { label, full, v: s[metric] }; }));
  b.querySelectorAll('[data-k]').forEach(x => x.addEventListener('click', () => { metric = x.dataset.k; refreshBody(); }));
  b.querySelectorAll('[data-u]').forEach(x => x.addEventListener('click', () => { unit = x.dataset.u; refreshBody(); }));
  $('csv').addEventListener('click', () => csvOut('sales-summary', [[unit === 'hour' ? 'Hour' : 'Date', 'Gross sales', 'Refunds', 'Discounts', 'Net sales', 'Cost of goods', 'Gross profit'], ...ser.map(s => [bucketLabel(s.from, unit)[1], r2(s.gross), r2(s.refunds), r2(s.discounts), r2(s.net), r2(s.cogs), r2(s.profit)]), ['Total', r2(cur.gross), r2(cur.refunds), r2(cur.discounts), r2(cur.net), r2(cur.cogs), r2(cur.profit)]]));
}
function csvOut(name, rows) { download(`friesta-${name}-${isoDate(range.from)}_${isoDate(addDays(range.to, -1))}.csv`, toCSV(rows), 'text/csv'); }
function bars(rows, key = 'net') {
  const top = rows.filter(r => r[key] > 0).slice(0, 5); if (!top.length) return '';
  const mx = Math.max(...top.map(r => r[key]));
  return `<div class="card" style="padding:12px 0"><div class="secthead" style="border:0;padding-top:4px"><h3>Top 5 by net sales</h3></div>${top.map(r => `<div class="hbar"><span class="nm">${esc(r.label || r.name)}</span><span class="tr" style="width:${Math.max(1, r[key] / mx * 100)}%"></span><span class="vv num">${peso(r[key])}</span></div>`).join('')}</div>`;
}
function pByItem(b) {
  const q = searchQ(), byId = Object.fromEntries(Store.data.items.map(i => [i.id, i]));
  const rows = M.byItem(sales, range.from, range.to, empPred(), byId).map(r => ({ ...r, label: r.name + (r.variant ? ' – ' + r.variant : '') })).filter(r => !q || r.label.toLowerCase().includes(q) || r.category.toLowerCase().includes(q));
  const T = rows.reduce((a, r) => { ['sold', 'refundedQty', 'gross', 'discounts', 'refunds', 'net', 'cogs', 'profit'].forEach(k => a[k] = (a[k] || 0) + r[k]); return a; }, {});
  b.innerHTML = bars(rows) + `<div class="card"><div class="secthead"><h3>Items</h3><button class="btn ghost sm" id="csv">${ICON.download} Download CSV</button></div>
    <div class="tblwrap"><table class="tbl"><thead><tr><th>Item</th><th>Category</th><th class="r">Items sold</th><th class="r">Gross sales</th><th class="r">Items refunded</th><th class="r">Refunds</th><th class="r">Discounts</th><th class="r">Net sales</th><th class="r">Cost of goods</th><th class="r">Gross profit</th><th class="r">Margin</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td class="t1">${esc(r.label)}</td><td>${esc(r.category)}</td><td class="r num">${r.sold}</td><td class="r num">${peso(r.gross)}</td><td class="r num">${r.refundedQty}</td><td class="r num">${peso(r.refunds)}</td><td class="r num">${peso(r.discounts)}</td><td class="r num">${peso(r.net)}</td><td class="r num">${peso(r.cogs)}</td><td class="r num">${peso(r.profit)}</td><td class="r num">${r.net ? pct(r.profit / r.net) : '—'}</td></tr>`).join('') || `<tr><td colspan="11" class="sub">Walang benta sa panahong ito</td></tr>`}</tbody>
    ${rows.length ? `<tfoot><tr><td colspan="2">Total</td><td class="r num">${T.sold}</td><td class="r num">${peso(T.gross)}</td><td class="r num">${T.refundedQty}</td><td class="r num">${peso(T.refunds)}</td><td class="r num">${peso(T.discounts)}</td><td class="r num">${peso(T.net)}</td><td class="r num">${peso(T.cogs)}</td><td class="r num">${peso(T.profit)}</td><td class="r num">${T.net ? pct(T.profit / T.net) : '—'}</td></tr></tfoot>` : ''}</table></div></div>`;
  $('csv').addEventListener('click', () => csvOut('sales-by-item', [['Item', 'Size', 'Category', 'Items sold', 'Gross sales', 'Items refunded', 'Refunds', 'Discounts', 'Net sales', 'Cost of goods', 'Gross profit'], ...rows.map(r => [r.name, r.variant, r.category, r.sold, r2(r.gross), r.refundedQty, r2(r.refunds), r2(r.discounts), r2(r.net), r2(r.cogs), r2(r.profit)])]));
}
function pByCategory(b) {
  const byId = Object.fromEntries(Store.data.items.map(i => [i.id, i]));
  const rows = M.byCategory(sales, range.from, range.to, empPred(), byId);
  b.innerHTML = bars(rows) + `<div class="card"><div class="secthead"><h3>Categories</h3><button class="btn ghost sm" id="csv">${ICON.download} Download CSV</button></div>
    <div class="tblwrap"><table class="tbl"><thead><tr><th>Category</th><th class="r">Items sold</th><th class="r">Gross sales</th><th class="r">Items refunded</th><th class="r">Refunds</th><th class="r">Discounts</th><th class="r">Net sales</th><th class="r">Cost of goods</th><th class="r">Gross profit</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td class="t1">${esc(r.name)}</td><td class="r num">${r.sold}</td><td class="r num">${peso(r.gross)}</td><td class="r num">${r.refundedQty}</td><td class="r num">${peso(r.refunds)}</td><td class="r num">${peso(r.discounts)}</td><td class="r num">${peso(r.net)}</td><td class="r num">${peso(r.cogs)}</td><td class="r num">${peso(r.profit)}</td></tr>`).join('') || `<tr><td colspan="9" class="sub">Walang benta sa panahong ito</td></tr>`}</tbody></table></div></div>`;
  $('csv').addEventListener('click', () => csvOut('sales-by-category', [['Category', 'Items sold', 'Gross sales', 'Items refunded', 'Refunds', 'Discounts', 'Net sales', 'Cost of goods', 'Gross profit'], ...rows.map(r => [r.name, r.sold, r2(r.gross), r.refundedQty, r2(r.refunds), r2(r.discounts), r2(r.net), r2(r.cogs), r2(r.profit)])]));
}
function pByEmployee(b) {
  const rows = M.byEmployee(sales, range.from, range.to);
  b.innerHTML = `<div class="card"><div class="secthead"><h3>Employees</h3><button class="btn ghost sm" id="csv">${ICON.download} Download CSV</button></div>
    <div class="tblwrap"><table class="tbl"><thead><tr><th>Name</th><th class="r">Gross sales</th><th class="r">Refunds</th><th class="r">Discounts</th><th class="r">Net sales</th><th class="r">Receipts</th><th class="r">Average sale</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td class="t1">${esc(r.name)}</td><td class="r num">${peso(r.gross)}</td><td class="r num">${peso(r.refunds)}</td><td class="r num">${peso(r.discounts)}</td><td class="r num">${peso(r.net)}</td><td class="r num">${r.receipts}</td><td class="r num">${peso(r.avg)}</td></tr>`).join('') || `<tr><td colspan="7" class="sub">Walang benta sa panahong ito</td></tr>`}</tbody></table></div></div>`;
  $('csv').addEventListener('click', () => csvOut('sales-by-employee', [['Name', 'Gross sales', 'Refunds', 'Discounts', 'Net sales', 'Receipts', 'Average sale'], ...rows.map(r => [r.name, r2(r.gross), r2(r.refunds), r2(r.discounts), r2(r.net), r.receipts, r2(r.avg)])]));
}
function pByPayment(b) {
  const rows = M.byPayment(sales, range.from, range.to, empPred());
  const T = rows.reduce((a, r) => { ['count', 'amount', 'refundCount', 'refunds', 'net'].forEach(k => a[k] = (a[k] || 0) + r[k]); return a; }, {});
  b.innerHTML = `<div class="card"><div class="secthead"><h3>Payment types</h3><button class="btn ghost sm" id="csv">${ICON.download} Download CSV</button></div>
    <div class="tblwrap"><table class="tbl"><thead><tr><th>Payment type</th><th class="r">Payment transactions</th><th class="r">Payment amount</th><th class="r">Refund transactions</th><th class="r">Refund amount</th><th class="r">Net amount</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td class="t1">${esc(r.name)}</td><td class="r num">${r.count}</td><td class="r num">${peso(r.amount)}</td><td class="r num">${r.refundCount}</td><td class="r num">${peso(r.refunds)}</td><td class="r num">${peso(r.net)}</td></tr>`).join('') || `<tr><td colspan="6" class="sub">Walang benta sa panahong ito</td></tr>`}</tbody>
    ${rows.length ? `<tfoot><tr><td>Total</td><td class="r num">${T.count}</td><td class="r num">${peso(T.amount)}</td><td class="r num">${T.refundCount}</td><td class="r num">${peso(T.refunds)}</td><td class="r num">${peso(T.net)}</td></tr></tfoot>` : ''}</table></div></div>`;
  $('csv').addEventListener('click', () => csvOut('sales-by-payment', [['Payment type', 'Payment transactions', 'Payment amount', 'Refund transactions', 'Refund amount', 'Net amount'], ...rows.map(r => [r.name, r.count, r2(r.amount), r.refundCount, r2(r.refunds), r2(r.net)])]));
}
function pReceipts(b) {
  const pred = empPred(), q = searchQ();
  const entries = [];
  for (const s of sales) {
    if (!pred(s)) continue;
    if (M.saleIn(s, range.from, range.to)) entries.push({ s, kind: 'sale', ts: s.ts, amt: s.total });
    if (M.refundIn(s, range.from, range.to)) entries.push({ s, kind: 'refund', ts: s.refundedAt, amt: -s.total });
  }
  entries.sort((a, z) => z.ts - a.ts);
  const nSale = entries.filter(e => e.kind === 'sale').length, nRef = entries.length - nSale;
  const list = entries.filter(e => (rptTab === 'all' || e.kind === rptTab) && (!q || String(e.s.no).includes(q) || pad3(e.s.orderNo).includes(q.replace('#', '')) || (e.s.employeeName || '').toLowerCase().includes(q) || (e.s.lines || []).some(l => l.name.toLowerCase().includes(q))));
  b.innerHTML = `<div class="card"><div class="tabs">${[['all', 'All receipts', entries.length], ['sale', 'Sales', nSale], ['refund', 'Refunds', nRef]].map(([k, l, n]) => `<button data-tab="${k}" aria-pressed="${rptTab === k}">${l}<b class="num">${n}</b></button>`).join('')}</div>
    <div class="tblwrap"><table class="tbl"><thead><tr><th>Receipt no.</th><th>Date</th><th>Employee</th><th>Order</th><th>Payment</th><th>Type</th><th class="r">Total</th></tr></thead>
    <tbody>${list.slice(0, 500).map(e => `<tr class="click" data-r="${e.s.id}"><td class="num t1">${esc(e.s.no)}</td><td class="num">${fmtDT(e.ts)}</td><td>${esc(e.s.employeeName || '—')}</td><td class="num">#${pad3(e.s.orderNo)}${e.s.orderType ? ' · ' + esc(e.s.orderType) : ''}</td><td>${esc(e.s.method)}</td><td>${e.kind === 'refund' ? '<span class="pill ref">Refund</span>' : '<span class="pill ok">Sale</span>'}</td><td class="r num">${peso(e.amt)}</td></tr>`).join('') || `<tr><td colspan="7" class="sub">Walang resibo</td></tr>`}</tbody></table></div>
    ${list.length > 500 ? `<div class="sub" style="padding:12px 18px">Ipinapakita ang unang 500. Paikliin ang date range para makita ang iba.</div>` : ''}</div>`;
  b.querySelectorAll('[data-tab]').forEach(x => x.addEventListener('click', () => { rptTab = x.dataset.tab; refreshBody(); }));
  b.querySelectorAll('[data-r]').forEach(x => x.addEventListener('click', () => showReceipt(sales.find(s => s.id === x.dataset.r))));
}
function showReceipt(s) {
  if (!s) return; const st = Store.settings;
  modal(head('Receipt #' + esc(s.no), esc(s.employeeName || '')) + `<div class="receipt"><img src="../shared/logo.jpg" alt="Friesta">${st.address ? `<div class="c">${esc(st.address)}</div>` : ''}
    <div class="c" style="margin-top:6px">ORDER</div><div class="on num">#${pad3(s.orderNo)}</div><div class="c">${s.orderType ? esc(s.orderType) + ' · ' : ''}${fmtDT(s.ts)}${s.name ? ' · ' + esc(s.name) : ''}</div><hr>
    ${(s.lines || []).map(l => `<div class="row"><span>${l.qty} × ${esc(l.name)}${l.variant ? ' (' + esc(l.variant) + ')' : ''}</span><span>${peso(l.price * l.qty)}</span></div>${l.note ? `<div class="nt">↳ ${esc(l.note)}</div>` : ''}`).join('')}<hr>
    <div class="row"><span>Subtotal</span><span>${peso(s.subtotal)}</span></div>${s.discount ? `<div class="row"><span>${esc(s.discountLabel)}</span><span>−${peso(s.discount)}</span></div>` : ''}
    <div class="row" style="font-weight:900;font-size:18px"><span>TOTAL</span><span>${peso(s.total)}</span></div>
    <div class="row"><span>${esc(s.method)}${s.ref ? ' · Ref ' + esc(s.ref) : ''}</span><span>${peso(s.tendered)}</span></div>${s.method === 'Cash' ? `<div class="row"><span>Change</span><span>${peso(s.change)}</span></div>` : ''}
    ${s.status === 'refunded' ? `<div class="row" style="color:#B3261E;font-weight:900"><span>REFUNDED${s.refundedBy ? ' · ' + esc(s.refundedBy) : ''}</span><span>${fmtDT(s.refundedAt)}</span></div>` : ''}
    <hr><div class="row"><span>Cost of goods</span><span>${peso(M.saleCost(s))}</span></div><div class="row"><span>Gross profit</span><span>${peso(s.total - M.saleCost(s))}</span></div></div>
    <div class="actions"><button class="btn" data-close>Close</button></div>`);
}
function pDiscReport(b) {
  const rows = M.byDiscount(sales, range.from, range.to, empPred());
  b.innerHTML = `<div class="card"><div class="secthead"><h3>Discounts</h3><button class="btn ghost sm" id="csv">${ICON.download} Download CSV</button></div>
    <div class="tblwrap"><table class="tbl"><thead><tr><th>Name</th><th class="r">Discounts applied</th><th class="r">Amount discounted</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td class="t1">${esc(r.name)}</td><td class="r num">${r.count}</td><td class="r num">${peso(r.amount)}</td></tr>`).join('') || `<tr><td colspan="3" class="sub">Walang discount sa panahong ito</td></tr>`}</tbody></table></div></div>`;
  $('csv').addEventListener('click', () => csvOut('discounts', [['Name', 'Discounts applied', 'Amount discounted'], ...rows.map(r => [r.name, r.count, r2(r.amount)])]));
}
function pShifts(b) {
  const list = Store.data.shifts.filter(s => s.openedAt >= range.from && s.openedAt < range.to);
  b.innerHTML = `<div class="card"><div class="secthead"><h3>Shifts</h3></div>
    <div class="tblwrap"><table class="tbl"><thead><tr><th>Opened</th><th>Closed</th><th>Opened by</th><th>Closed by</th><th class="r">Starting cash</th><th class="r">Expected cash</th><th class="r">Actual cash</th><th class="r">Difference</th></tr></thead>
    <tbody>${list.map(s => { const n = s.status === 'closed' ? null : M.shiftNumbers(s, sales); const exp = n ? n.expected : +s.expected; const diff = s.status === 'closed' ? r2((+s.counted || 0) - (+s.expected || 0)) : null;
      return `<tr class="click" data-s="${s.id}"><td class="num">${fmtDT(s.openedAt)}</td><td class="num">${s.closedAt ? fmtDT(s.closedAt) : '<span class="pill ok">Open</span>'}</td><td>${esc(s.openedBy || '—')}</td><td>${esc(s.closedBy || '—')}</td><td class="r num">${peso(s.startCash)}</td><td class="r num">${peso(exp)}</td><td class="r num">${s.status === 'closed' ? peso(s.counted) : '—'}</td><td class="r">${diff === null ? '—' : `<span class="pill ${Math.abs(diff) < 0.01 ? 'ok' : diff < 0 ? 'ref' : 'low'} num">${Math.abs(diff) < 0.01 ? 'Balanced' : (diff < 0 ? '−' : '+') + peso(Math.abs(diff))}</span>`}</td></tr>`; }).join('') || `<tr><td colspan="8" class="sub">Walang shift sa panahong ito</td></tr>`}</tbody></table></div></div>`;
  b.querySelectorAll('[data-s]').forEach(x => x.addEventListener('click', () => {
    const s = Store.data.shifts.find(z => z.id === x.dataset.s); const n = M.shiftNumbers(s, sales);
    modal(head('Shift', `${fmtDT(s.openedAt)}${s.closedAt ? ' – ' + fmtTime(s.closedAt) : ' · open'}`) + `<div class="card list">
      ${[['Starting cash', s.startCash], ['Cash payments', n.cashSales], ['Cash refunds', -n.cashRefunds], ['Pay in', n.payIn], ['Pay out', -n.payOut], ['Expected cash', s.status === 'closed' ? s.expected : n.expected], ...(s.status === 'closed' ? [['Actual cash', s.counted], ['Difference', (+s.counted || 0) - (+s.expected || 0)]] : []), ['Gross sales', n.gross], ['Net sales', n.net]].map(([k, v]) => `<div class="it"><span class="grow">${k}</span><b class="num">${peso(v)}</b></div>`).join('')}</div>
      ${(s.moves || []).length ? `<div class="glabel">Cash movements</div><div class="card list">${s.moves.map(m => `<div class="it"><span class="grow"><span class="t1">${m.type === 'in' ? 'Pay in' : 'Pay out'}${m.note ? ' · ' + esc(m.note) : ''}</span><div class="sub">${fmtTime(m.ts)}${m.by ? ' · ' + esc(m.by) : ''}</div></span><b class="num">${m.type === 'in' ? '+' : '−'}${peso(m.amt)}</b></div>`).join('')}</div>` : ''}
      <div class="actions"><button class="btn" data-close>Close</button></div>`);
  }));
}

/* ================= ITEMS ================= */
let itemQ = '', itemCat = '', itemStock = 'all';
function pItems(b) {
  const items = Store.data.items, cats = [...new Set(items.map(i => i.category || 'Other'))].sort();
  const list = items.filter(i => (!itemQ || i.name.toLowerCase().includes(itemQ)) && (!itemCat || (i.category || 'Other') === itemCat) && (itemStock === 'all' || (itemStock === 'low' ? tracked(i) && +i.stock <= (+i.lowAt || 5) : tracked(i) && +i.stock <= 0)));
  const priceTxt = i => hasVariants(i) ? (() => { const ps = i.variants.map(v => +v.price); const lo = Math.min(...ps), hi = Math.max(...ps); return lo === hi ? peso(lo) : `${peso(lo)} – ${peso(hi)}`; })() : peso(i.price);
  const costTxt = i => hasVariants(i) ? (() => { const cs = i.variants.map(v => +v.cost || 0); const lo = Math.min(...cs), hi = Math.max(...cs); return lo === hi ? peso(lo) : `${peso(lo)} – ${peso(hi)}`; })() : peso(i.cost || 0);
  const margin = i => { const p = hasVariants(i) ? i.variants[0] : i; return +p.price ? pct((+p.price - (+p.cost || 0)) / +p.price) : '—'; };
  b.innerHTML = `<div class="ph"><div class="filters">
      <label class="search" style="flex:1 1 220px">${ICON.search}<input id="iq" type="search" placeholder="Search items" value="${esc(itemQ)}" aria-label="Search items"></label>
      <label class="selwrap">${ICON.tag}<select id="icat" aria-label="Category"><option value="">All categories</option>${cats.map(c => `<option ${c === itemCat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>${ICON.down}</label>
      <div class="seg" id="istock">${[['all', 'All'], ['low', 'Low stock'], ['out', 'Out of stock']].map(([k, l]) => `<button data-st="${k}" aria-pressed="${itemStock === k}">${l}</button>`).join('')}</div>
    </div><button class="btn" id="additem">${ICON.plus} Add item</button></div>
    <div class="card">${!items.length ? `<div class="empty"><h3>Wala pang items</h3><p>Idagdag ang bawat produkto na may presyo at cost, para makita ang gross profit sa reports.</p><div class="actions" style="justify-content:center"><button class="btn" id="starter">Use starter menu</button></div></div>` :
    `<div class="tblwrap"><table class="tbl"><thead><tr><th>Item name</th><th>Category</th><th class="r">Price</th><th class="r">Cost</th><th class="r">Margin</th><th class="r">In stock</th></tr></thead><tbody>
    ${list.map(i => `<tr class="click" data-i="${i.id}"><td><span style="display:flex;align-items:center;gap:10px"><span class="sw" style="${tcol(i.color)};width:32px;height:32px;border-radius:9px;font-size:13px">${esc(initials(i.name))}</span><span><span class="t1">${esc(i.name)}</span>${i.active === false ? ' <span class="pill n">Hidden</span>' : ''}${hasVariants(i) ? `<div class="sub">${i.variants.map(v => esc(v.name)).join(' · ')}</div>` : ''}</span></span></td><td>${esc(i.category || 'Other')}</td><td class="r num">${priceTxt(i)}</td><td class="r num">${costTxt(i)}</td><td class="r num">${margin(i)}</td><td class="r num">${tracked(i) ? `<span class="pill ${+i.stock <= 0 ? 'ref' : +i.stock <= (+i.lowAt || 5) ? 'low' : 'ok'}">${+i.stock}</span>` : '—'}</td></tr>`).join('') || `<tr><td colspan="6" class="sub">Walang tugma</td></tr>`}</tbody></table></div>`}</div>`;
  const iq = $('iq'); iq.addEventListener('input', () => { itemQ = iq.value.trim().toLowerCase(); const p = iq.selectionStart; pItems(b); const n = $('iq'); n.focus(); n.setSelectionRange(p, p); });
  $('icat').addEventListener('change', e => { itemCat = e.target.value; pItems(b); });
  b.querySelectorAll('[data-st]').forEach(x => x.addEventListener('click', () => { itemStock = x.dataset.st; pItems(b); }));
  $('additem').addEventListener('click', () => editItem(null));
  const st = $('starter'); if (st) st.addEventListener('click', async () => { st.disabled = true; for (const s of STARTER_ITEMS) await Store.put('items', { ...s, id: uid(), price: s.price ?? Math.min(...s.variants.map(v => v.price)), cost: s.cost ?? 0, stock: null, lowAt: 5 }); toast('Naidagdag ang starter menu. Palitan ang presyo at cost.'); });
  b.querySelectorAll('[data-i]').forEach(x => x.addEventListener('click', () => editItem(Store.data.items.find(i => i.id === x.dataset.i))));
}
const initials = n => String(n || '').replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
function editItem(it) {
  const isNew = !it;
  it = it ? JSON.parse(JSON.stringify(it)) : { id: uid(), name: '', price: '', cost: '', category: itemCat || '', color: 0, variants: [], stock: null, lowAt: 5, active: true };
  let color = +it.color || 0, useV = hasVariants(it), track = tracked(it), active = it.active !== false;
  let vars = useV ? it.variants.map(v => ({ ...v })) : [{ name: 'Regular', price: '', cost: '' }, { name: 'Large', price: '', cost: '' }];
  const cats = [...new Set(Store.data.items.map(i => i.category || 'Other'))];
  const m = modal(head(isNew ? 'New item' : 'Edit item') + `<form id="itf" style="display:flex;flex-direction:column;gap:14px">
    <div class="field"><label for="iname">Name</label><input id="iname" required maxlength="50" value="${esc(it.name)}" placeholder="e.g. Cheese Fries"></div>
    <div class="field"><label for="icatn">Category</label><input id="icatn" list="catlist" maxlength="24" value="${esc(it.category)}" placeholder="e.g. Fries"><datalist id="catlist">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
    <div class="toggle"><span>May sizes<div class="sub">Regular, Large, Barkada… bawat isa may presyo at cost</div></span><button type="button" class="switch" role="switch" id="iv" aria-checked="${useV}" aria-label="Has sizes"></button></div>
    <div id="pricebox" style="display:grid;grid-template-columns:1fr 1fr;gap:10px" ${useV ? 'hidden' : ''}><div class="field"><label for="iprice">Price (₱)</label><input id="iprice" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(it.price ?? '')}"></div><div class="field"><label for="icost">Cost (₱)</label><input id="icost" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(it.cost ?? '')}"></div></div>
    <div class="field" id="varbox" ${useV ? '' : 'hidden'}><div class="vhead"><span>Size</span><span>Price ₱</span><span>Cost ₱</span><span></span></div><div id="vrows" style="display:flex;flex-direction:column;gap:8px"></div><button type="button" class="btn ghost sm" id="vadd">+ Add size</button></div>
    <div class="field"><span class="flabel">Kulay ng tile sa POS</span><div class="swatches" id="sws">${[...Array(NCOL)].map((_, i) => `<button type="button" style="${tcol(i)}" aria-label="Color ${i + 1}" aria-pressed="${i === color}" data-c="${i}"></button>`).join('')}</div></div>
    <div class="toggle"><span>Track stock<div class="sub">Bumababa sa bawat benta, may babala kapag paubos</div></span><button type="button" class="switch" role="switch" id="its" aria-checked="${track}" aria-label="Track stock"></button></div>
    <div id="stockbox" style="display:grid;grid-template-columns:1fr 1fr;gap:10px" ${track ? '' : 'hidden'}><div class="field"><label for="istock">In stock</label><input id="istock" type="number" inputmode="numeric" step="1" value="${track ? esc(it.stock) : ''}"></div><div class="field"><label for="ilow">Low stock alert at</label><input id="ilow" type="number" inputmode="numeric" min="0" step="1" value="${esc(it.lowAt ?? 5)}"></div></div>
    <div class="toggle"><span>Ipakita sa POS</span><button type="button" class="switch" role="switch" id="iact" aria-checked="${active}" aria-label="Show on POS"></button></div>
    <div class="err" id="ierr" hidden></div>
    <div class="actions">${isNew ? '' : `<button type="button" class="btn danger" id="idel" style="flex:0 0 auto">${ICON.trash} Delete</button>`}<button class="btn" type="submit">${isNew ? 'Add item' : 'Save changes'}</button></div></form>`, { focus: isNew ? '#iname' : null });
  const drawVars = () => {
    $('vrows').innerHTML = vars.map((v, i) => `<div class="vrow"><input data-vn="${i}" maxlength="20" placeholder="Size" value="${esc(v.name)}" aria-label="Size name"><input data-vp="${i}" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0" value="${esc(v.price)}" aria-label="Price"><input data-vc="${i}" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0" value="${esc(v.cost ?? '')}" aria-label="Cost"><button type="button" class="x" data-vr="${i}" aria-label="Remove size">${ICON.x}</button></div>`).join('');
    $('vrows').querySelectorAll('[data-vn]').forEach(x => x.addEventListener('input', () => vars[+x.dataset.vn].name = x.value));
    $('vrows').querySelectorAll('[data-vp]').forEach(x => x.addEventListener('input', () => vars[+x.dataset.vp].price = x.value));
    $('vrows').querySelectorAll('[data-vc]').forEach(x => x.addEventListener('input', () => vars[+x.dataset.vc].cost = x.value));
    $('vrows').querySelectorAll('[data-vr]').forEach(x => x.addEventListener('click', () => { vars.splice(+x.dataset.vr, 1); drawVars(); }));
  };
  drawVars();
  $('vadd').addEventListener('click', () => { vars.push({ name: '', price: '', cost: '' }); drawVars(); const ins = $('vrows').querySelectorAll('[data-vn]'); ins[ins.length - 1].focus(); });
  const flip = (id, fn) => $(id).addEventListener('click', e => { const v = e.currentTarget.getAttribute('aria-checked') !== 'true'; e.currentTarget.setAttribute('aria-checked', v); fn(v); });
  flip('iv', v => { useV = v; $('pricebox').hidden = v; $('varbox').hidden = !v; });
  flip('its', v => { track = v; $('stockbox').hidden = !v; });
  flip('iact', v => { active = v; });
  m.querySelectorAll('#sws button').forEach(x => x.addEventListener('click', () => { color = +x.dataset.c; m.querySelectorAll('#sws button').forEach(y => y.setAttribute('aria-pressed', y === x)); }));
  const err = t => { $('ierr').textContent = t; $('ierr').hidden = false; };
  $('itf').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('iname').value.trim(); if (!name) return err('Ilagay ang pangalan ng item.');
    const out = { id: it.id, name, category: $('icatn').value.trim() || 'Other', color, variants: [], price: 0, cost: 0, stock: null, lowAt: 5, active };
    if (useV) {
      const vs = vars.filter(v => String(v.name).trim() || v.price !== '').map(v => ({ name: String(v.name).trim(), price: r2(parseFloat(v.price)), cost: r2(parseFloat(v.cost) || 0) }));
      if (!vs.length || vs.some(v => !v.name || isNaN(v.price))) return err('Lagyan ng pangalan at presyo ang bawat size.');
      out.variants = vs; out.price = Math.min(...vs.map(v => v.price)); out.cost = vs[0].cost;
    } else {
      const p = parseFloat($('iprice').value); if (isNaN(p)) return err('Ilagay ang presyo.');
      out.price = r2(p); out.cost = r2(parseFloat($('icost').value) || 0);
    }
    if (track) { const s = parseInt($('istock').value, 10); if (isNaN(s)) return err('Ilagay kung ilan ang stock.'); out.stock = s; out.lowAt = parseInt($('ilow').value, 10) || 0; }
    try { await Store.put('items', out); closeModal(); toast(isNew ? `${name} added` : 'Na-save'); } catch (x) { err('Hindi na-save. Subukan ulit.'); }
  });
  const d = $('idel'); if (d) d.addEventListener('click', async () => { if (!armed(d, 'Tap again to delete')) return; await Store.del('items', it.id); closeModal(); toast('Item deleted'); });
}
function pCategories(b) {
  const by = new Map(); Store.data.items.forEach(i => { const c = i.category || 'Other'; if (!by.has(c)) by.set(c, []); by.get(c).push(i); });
  b.innerHTML = `<div class="card list">${[...by].sort((a, z) => a[0].localeCompare(z[0])).map(([c, arr]) => `<button class="it" data-c="${esc(c)}"><span class="sw" style="${tcol(arr[0].color)}">${esc(initials(c))}</span><span class="grow"><span class="t1">${esc(c)}</span><div class="sub">${arr.length} item${arr.length === 1 ? '' : 's'}</div></span>${ICON.next}</button>`).join('') || `<div class="empty"><p>Lalabas dito ang mga category kapag may items na.</p></div>`}</div>
    <div class="sub">Gumagawa ng category kapag nag-type ka ng bagong category sa isang item.</div>`;
  b.querySelectorAll('[data-c]').forEach(x => x.addEventListener('click', () => {
    const c = x.dataset.c, arr = by.get(c); let color = +arr[0].color || 0;
    const m = modal(head('Edit category', `${arr.length} items`) + `<div class="field"><label for="cn">Name</label><input id="cn" value="${esc(c)}" maxlength="24"></div>
      <div class="field"><span class="flabel">Kulay ng lahat ng items dito</span><div class="swatches" id="csw">${[...Array(NCOL)].map((_, i) => `<button type="button" style="${tcol(i)}" aria-pressed="${i === color}" data-k="${i}" aria-label="Color ${i + 1}"></button>`).join('')}</div></div>
      <div class="actions"><button class="btn" id="csave">Save</button></div>`);
    m.querySelectorAll('[data-k]').forEach(y => y.addEventListener('click', () => { color = +y.dataset.k; m.querySelectorAll('[data-k]').forEach(z => z.setAttribute('aria-pressed', z === y)); }));
    $('csave').addEventListener('click', async () => { const n = $('cn').value.trim() || c; $('csave').disabled = true; for (const i of arr) await Store.put('items', { ...i, category: n, color }); closeModal(); toast('Na-save ang category'); });
  }));
}
function pDiscounts(b) {
  b.innerHTML = `<div class="ph"><span class="sub">Lalabas ang mga ito sa POS kapag pinindot ang “Add discount”.</span><button class="btn" id="adddisc">${ICON.plus} Add discount</button></div>
    <div class="card list">${Store.data.discounts.map(d => `<button class="it" data-d="${d.id}"><span class="sw" style="${tcol(4)}">${ICON.tag}</span><span class="grow"><span class="t1">${esc(d.name)}</span><div class="sub">${d.type === 'pct' ? +d.value + '% off' : peso(d.value) + ' off'}</div></span>${ICON.next}</button>`).join('') || `<div class="empty"><p>Wala pang discount.</p></div>`}</div>`;
  $('adddisc').addEventListener('click', () => editDiscount(null));
  b.querySelectorAll('[data-d]').forEach(x => x.addEventListener('click', () => editDiscount(Store.data.discounts.find(d => d.id === x.dataset.d))));
}
function editDiscount(d) {
  const isNew = !d; d = d || { id: uid(), name: '', type: 'pct', value: '' }; let type = d.type;
  const m = modal(head(isNew ? 'New discount' : 'Edit discount') + `<div class="field"><label for="dn">Name</label><input id="dn" maxlength="30" value="${esc(d.name)}" placeholder="e.g. Student 5%"></div>
    <div class="field"><span class="flabel">Type</span><div class="chips" id="dt"><button type="button" data-t="pct" aria-pressed="${type === 'pct'}">Percentage (%)</button><button type="button" data-t="amt" aria-pressed="${type === 'amt'}">Amount (₱)</button></div></div>
    <div class="field"><label for="dv">Value</label><input id="dv" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(d.value)}"></div>
    <div class="err" id="derr" hidden></div>
    <div class="actions">${isNew ? '' : `<button class="btn danger" id="ddel" style="flex:0 0 auto">${ICON.trash} Delete</button>`}<button class="btn" id="dsave">Save</button></div>`, { focus: '#dn' });
  m.querySelectorAll('[data-t]').forEach(x => x.addEventListener('click', () => { type = x.dataset.t; m.querySelectorAll('[data-t]').forEach(y => y.setAttribute('aria-pressed', y === x)); }));
  $('dsave').addEventListener('click', async () => {
    const name = $('dn').value.trim(), v = parseFloat($('dv').value);
    if (!name || isNaN(v) || v <= 0 || (type === 'pct' && v > 100)) { $('derr').textContent = 'Ilagay ang pangalan at tamang value.'; $('derr').hidden = false; return; }
    await Store.put('discounts', { id: d.id, name, type, value: r2(v) }); closeModal(); toast('Na-save');
  });
  const dd = $('ddel'); if (dd) dd.addEventListener('click', async () => { if (!armed(dd, 'Tap again to delete')) return; await Store.del('discounts', d.id); closeModal(); });
}

/* ================= EMPLOYEES ================= */
function pEmployees(b) {
  b.innerHTML = `<div class="ph"><span class="sub">Bawat employee ay may sariling 4-digit PIN para buksan ang Friesta POS. Lahat ng benta ay naka-record kung sino ang nagbenta.</span><button class="btn" id="addemp">${ICON.plus} Add employee</button></div>
    <div class="card"><div class="tblwrap"><table class="tbl"><thead><tr><th>Name</th><th>Role</th><th>POS PIN</th><th>Status</th></tr></thead><tbody>
    ${Store.data.employees.map(e => `<tr class="click" data-e="${e.id}"><td class="t1">${esc(e.name)}</td><td>${ROLE[e.role] || e.role}</td><td>${e.pinHash ? '•••• <span class="sub">set</span>' : '<span class="pill low">No PIN</span>'}</td><td>${e.active === false ? '<span class="pill n">Inactive</span>' : '<span class="pill ok">Active</span>'}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="card form"><div class="flabel">Roles</div><div class="sub"><b>Owner</b> – lahat. <b>Manager</b> – benta, refund, shift, POS settings, Back Office link. <b>Cashier</b> – benta, saved orders, shift; kailangan ng manager PIN para mag-refund (puwedeng i-off sa Settings).</div></div>`;
  $('addemp').addEventListener('click', () => editEmployee(null));
  b.querySelectorAll('[data-e]').forEach(x => x.addEventListener('click', () => editEmployee(Store.data.employees.find(e => e.id === x.dataset.e))));
}
function editEmployee(e) {
  const isNew = !e; e = e || { id: uid(), name: '', role: 'cashier', active: true, createdAt: Date.now() }; let role = e.role, active = e.active !== false;
  const owner = e.role === 'owner';
  const m = modal(head(isNew ? 'New employee' : 'Edit employee') + `<div class="field"><label for="en">Name</label><input id="en" maxlength="30" value="${esc(e.name)}"></div>
    ${owner ? `<div class="sub">Role: <b>Owner</b></div>` : `<div class="field"><span class="flabel">Role</span><div class="chips" id="er"><button type="button" data-r="manager" aria-pressed="${role === 'manager'}">Manager</button><button type="button" data-r="cashier" aria-pressed="${role === 'cashier'}">Cashier</button></div></div>`}
    <div class="field"><label for="ep">POS PIN (4 digits)${isNew ? '' : ' · iwanang blank para hindi palitan'}</label><input id="ep" type="password" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="••••"></div>
    ${owner ? '' : `<div class="toggle"><span>Active<div class="sub">Ang inactive ay hindi makaka-login sa POS</div></span><button type="button" class="switch" role="switch" id="ea" aria-checked="${active}" aria-label="Active"></button></div>`}
    <div class="err" id="eerr" hidden></div>
    <div class="actions">${isNew || owner ? '' : `<button class="btn danger" id="edel" style="flex:0 0 auto">${ICON.trash} Delete</button>`}<button class="btn" id="esave">Save</button></div>`, { focus: '#en' });
  m.querySelectorAll('[data-r]').forEach(x => x.addEventListener('click', () => { role = x.dataset.r; m.querySelectorAll('[data-r]').forEach(y => y.setAttribute('aria-pressed', y === x)); }));
  const ea = $('ea'); if (ea) ea.addEventListener('click', () => { active = !active; ea.setAttribute('aria-checked', active); });
  const err = t => { $('eerr').textContent = t; $('eerr').hidden = false; };
  $('esave').addEventListener('click', async () => {
    const name = $('en').value.trim(), pin = $('ep').value.trim();
    if (!name) return err('Ilagay ang pangalan.');
    if ((isNew || pin) && !/^\d{4}$/.test(pin)) return err('Ang PIN ay 4 na numero.');
    const out = { ...e, name, role: owner ? 'owner' : role, active: owner ? true : active };
    if (pin) {
      const h = await Store.pinHash(pin);
      if (Store.data.employees.some(x => x.id !== e.id && x.pinHash === h)) return err('Gamit na ng ibang employee ang PIN na iyan.');
      out.pinHash = h;
    }
    await Store.put('employees', out); closeModal(); toast('Na-save');
  });
  const d = $('edel'); if (d) d.addEventListener('click', async () => { if (!armed(d, 'Tap again to delete')) return; await Store.del('employees', e.id); closeModal(); });
}

/* ================= SETTINGS ================= */
function pSettings(b) {
  const s = Store.settings, cloud = Store.mode === 'cloud';
  b.innerHTML = `<form class="card form" id="stf"><div class="flabel">Tindahan at resibo</div>
      <div class="field"><label for="sn">Store name</label><input id="sn" maxlength="40" value="${esc(s.storeName)}"></div>
      <div class="field"><label for="sa">Address / contact sa resibo</label><input id="sa" maxlength="90" value="${esc(s.address)}" placeholder="e.g. Stall 5, SM City · 0917 123 4567"></div>
      <div class="field"><label for="sf">Mensahe sa resibo</label><input id="sf" maxlength="90" value="${esc(s.footer)}"></div>
      <div class="flabel" style="margin-top:6px">POS</div>
      <div class="toggle"><span>Itanong ang Dine-in o Take-out</span><button type="button" class="switch" role="switch" id="s-ot" aria-checked="${!!s.askOrderType}" aria-label="Ask order type"></button></div>
      <div class="toggle"><span>Kailangan ng bukas na shift bago magbenta</span><button type="button" class="switch" role="switch" id="s-rs" aria-checked="${!!s.requireShift}" aria-label="Require shift"></button></div>
      <div class="toggle"><span>Refund ng cashier kailangan ng manager PIN</span><button type="button" class="switch" role="switch" id="s-rm" aria-checked="${s.refundNeedsManager !== false}" aria-label="Refund needs manager"></button></div>
      <div class="actions"><button class="btn" type="submit">Save</button></div></form>
    <form class="card form" id="pwf"><div class="flabel">Account</div>
      <div class="row"><span><span class="t1">${esc(Store.account ? Store.account.email : '')}</span><div class="sub">Owner account · ${cloud ? 'Cloud' : 'Naka-save sa device na ito'}</div></span></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px"><div class="field"><label for="op">Current password</label><input id="op" type="password" autocomplete="current-password"></div><div class="field"><label for="np">New password</label><input id="np" type="password" autocomplete="new-password"></div></div>
      <div class="err" id="pwerr" hidden></div>
      <div class="actions"><button class="btn ghost" type="submit">Change password</button></div></form>
    <div class="card form"><div class="flabel">Sync</div>
      ${cloud ? `<div class="sub">Naka-on ang <b>cloud sync</b>. Makikita mo ang benta mula sa kahit anong device na naka-sign in sa account na ito. Gumagana pa rin offline; magsi-sync pagbalik ng internet.</div>`
      : `<div class="sub"><b>Offline mode.</b> Naka-save ang lahat sa device na ito. Kung bubuksan mo ang POS at Back Office sa parehong device, pareho ang data. Para makita ang benta mula sa ibang phone (hal. sa bahay), i-on ang libreng cloud sync: sundan ang <b>docs/SETUP.md</b> sa repository.</div>`}
    </div>
    <div class="card form"><div class="flabel">Backup</div>
      <div class="sub">I-download ang backup linggo-linggo at itago sa Google Drive o Messenger. Puwede ring i-restore dito ang backup mula sa lumang Friesta POS.</div>
      <div class="actions"><button class="btn ghost" id="bkp">${ICON.download} Download backup</button><label class="btn ghost" style="cursor:pointer">Restore backup<input type="file" id="rst" accept="application/json,.json" hidden></label></div></div>`;
  const on = id => $(id).getAttribute('aria-checked') === 'true';
  b.querySelectorAll('#stf .switch').forEach(x => x.addEventListener('click', () => x.setAttribute('aria-checked', x.getAttribute('aria-checked') !== 'true')));
  $('stf').addEventListener('submit', async e => { e.preventDefault(); await Store.saveSettings({ storeName: $('sn').value.trim() || 'Friesta', address: $('sa').value.trim(), footer: $('sf').value.trim(), askOrderType: on('s-ot'), requireShift: on('s-rs'), refundNeedsManager: on('s-rm') }); document.activeElement.blur(); toast('Na-save ang settings'); });
  $('pwf').addEventListener('submit', async e => {
    e.preventDefault(); const er = $('pwerr'); er.hidden = true;
    if ($('np').value.length < 6) { er.textContent = 'Gumamit ng password na hindi bababa sa 6 na character.'; er.hidden = false; return; }
    try { await Store.changePassword($('op').value, $('np').value); $('op').value = ''; $('np').value = ''; document.activeElement.blur(); toast('Napalitan ang password'); }
    catch (x) { er.textContent = 'Mali ang current password.'; er.hidden = false; }
  });
  $('bkp').addEventListener('click', async () => { const d = await Store.exportAll(); download(`friesta-backup-${isoDate(Date.now())}.json`, JSON.stringify({ app: 'friesta-pos', version: 2, exportedAt: new Date().toISOString(), ...d }), 'application/json'); });
  const rs = $('rst'); rs.addEventListener('change', async () => {
    const f = rs.files[0]; rs.value = ''; if (!f) return;
    let ds; try { ds = normaliseBackup(JSON.parse(await f.text())); } catch (e) { toast('Hindi ito Friesta backup file'); return; }
    const m = modal(head('Restore backup', esc(f.name)) + `<div class="sub num">${ds.items.length} items · ${ds.sales.length} receipts · ${ds.shifts.length} shifts${ds.employees ? ' · ' + ds.employees.length + ' employees' : ''}</div>
      <span class="pill low" style="align-self:flex-start">${cloud ? 'Idadagdag ang laman ng backup sa cloud' : 'Papalitan nito ang lahat ng data sa device na ito'}</span>
      <div class="actions"><button class="btn ghost" data-close>Cancel</button><button class="btn danger" id="rsok">Restore</button></div>`);
    $('rsok').addEventListener('click', async () => { $('rsok').disabled = true; try { await Store.replaceAll(ds); closeModal(); toast('Na-restore ang backup'); } catch (e) { console.error(e); toast('Hindi na-restore. Subukan ulit.'); $('rsok').disabled = false; } });
  });
}

/* ================= chrome ================= */
$('burger').addEventListener('click', () => { $('side').classList.add('open'); $('scrimside').classList.add('open'); });
$('scrimside').addEventListener('click', () => { $('side').classList.remove('open'); $('scrimside').classList.remove('open'); });
$('signout').addEventListener('click', e => {
  e.preventDefault();
  const m = modal(head('Sign out?') + `<div class="sub">${Store.mode === 'cloud' ? 'Kailangan mong mag-sign in ulit gamit ang email at password.' : 'Mase-sign out din ang Friesta POS sa device na ito. Hindi mabubura ang data.'}</div><div class="actions"><button class="btn ghost" data-close>Cancel</button><button class="btn danger" id="soOK">Sign out</button></div>`);
  $('soOK').addEventListener('click', async () => { closeModal(); await Store.signOut(); });
});
document.addEventListener('keydown', e => { if (modalOpen()) { if (e.key === 'Escape') closeModal(); else if (Modal.onKey) Modal.onKey(e); } });

boot();
