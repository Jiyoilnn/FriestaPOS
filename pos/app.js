// Friesta POS — selling app (menu, order, checkout, receipts, shift, printer).
import { Store, STARTER_ITEMS } from '../shared/store.js';
import { $, esc, uid, r2, pad3, peso, peso0, dayStart, addDays, fmtTime, fmtDT, lsGet, lsSet, toast, modal, closeModal, modalOpen, Modal, head, armed, ICON, registerSW, catchErrors, keepAwake } from '../shared/util.js';
import { renderGate, pinPad } from '../shared/auth-ui.js';
import { shiftNumbers } from '../shared/metrics.js';
import { Printer, printerCfg, savePrinterCfg, canPrint, receiptBytes, kitchenBytes, testBytes, setLogo } from '../shared/escpos.js';

const NCOL = 8;
const NOTE_CHIPS = ['Less salt', 'No salt', 'Extra crispy', 'Sauce on the side', 'No ice', 'Pa-hiwalay'];
const METHODS = ['Cash', 'GCash', 'Maya', 'Card'];
const tcol = i => `--tb:var(--c${(+i || 0) % NCOL});--ti:var(--i${(+i || 0) % NCOL})`;
const hasVariants = it => Array.isArray(it.variants) && it.variants.length > 0;
const minPrice = it => hasVariants(it) ? Math.min(...it.variants.map(v => +v.price)) : +it.price;
const tracked = it => it && it.stock !== null && it.stock !== undefined && it.stock !== '';
const isLow = it => tracked(it) && +it.stock <= (+it.lowAt || 5);
const itemById = id => Store.data.items.find(x => x.id === id);
const isMgr = e => !!e && (e.role === 'owner' || e.role === 'manager');

document.querySelectorAll('[data-ic]').forEach(el => { el.outerHTML = ICON[el.dataset.ic]; });

let me = null;            // employee using the POS
let sales = [];           // last 14 days (+ refunds), live
let unwatch = null;
let view = 'sale', cat = 'All', bumpId = null, padKey = null;
let cart = loadCart();
const deviceId = lsGet('deviceId') || (lsSet('deviceId', uid().slice(-6)), lsGet('deviceId'));

/* ================= boot + routing ================= */
async function boot() {
  catchErrors(); registerSW(); keepAwake();
  setLogo($('logoimg'));
  Printer.onChange = () => { if (view === 'settings') renderPrinter(); };
  Store.onError = e => { if (/permission/i.test((e && (e.code || e.message)) || '')) toast('Hindi ma-save sa cloud (permission). Mag-sign in ulit.'); else console.error(e); };
  await Store.init();
  Store.on(onChange);
  route();
}
function onChange(ch) {
  if (ch.has('status')) return route();
  if (Store.status !== 'ready') return;
  if (ch.has('employees') && me && me.id !== 'account') {
    const e = Store.data.employees.find(x => x.id === me.id);
    if (!e || e.active === false) return lock(); me = e;
  }
  if (!me) return;
  renderAll();
}
function route() {
  const ready = Store.status === 'ready';
  $('gate').hidden = ready;
  if (!ready) { $('app').hidden = true; $('lock').hidden = true; stopWatch(); me = null; renderGate($('gate'), 'pos'); return; }
  startWatch();
  const saved = sessionStorage.getItem('friesta:me');
  if (!me && saved) me = Store.data.employees.find(e => e.id === saved && e.active !== false) || null;
  if (me) showApp(); else showLock();
}
function startWatch() { if (unwatch) return; unwatch = Store.watchSales(addDays(dayStart(), -14), Infinity, arr => { sales = arr; if (me) renderAll(); }); }
function stopWatch() { if (unwatch) { unwatch(); unwatch = null; } sales = []; }

/* ================= PIN lock ================= */
let clockT;
function showLock() {
  closeModal(); $('app').hidden = true; $('lock').hidden = false;
  $('lock').innerHTML = `<div class="lockscreen"><div class="lockbrand"><img src="../shared/logo.jpg" alt="Friesta"><div class="clock num" id="lclock"></div><div class="sub" id="ldate"></div><div class="sub">${esc(Store.settings.storeName)}</div></div><div class="lockpad" id="lpad"></div></div>`;
  const tick = () => { const c = $('lclock'); if (!c) return clearInterval(clockT); c.textContent = fmtTime(Date.now()); $('ldate').textContent = new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' }); };
  clearInterval(clockT); tick(); clockT = setInterval(tick, 15000);
  const none = !Store.data.employees.length;
  const pad = pinPad($('lpad'), {
    title: 'Enter PIN', sub: none ? 'Wala pang employee na may PIN. Gamitin ang account password.' : '',
    check: async pin => { const e = await Store.employeeByPin(pin); if (!e) return false; unlock(e); return true; },
    extra: `<button type="button" class="link" id="lpw">Gamitin ang account password</button>`
  });
  padKey = pad.key;
  $('lpw').addEventListener('click', usePassword);
}
function usePassword() {
  const m = modal(head('Owner sign in', esc(Store.account && Store.account.email || '')) + `<form id="pwf" style="display:flex;flex-direction:column;gap:12px"><div class="field"><label for="opw">Account password</label><input id="opw" type="password" autocomplete="current-password"></div><div class="err" id="operr" hidden></div><button class="btn">Unlock</button></form>`, { focus: '#opw' });
  m.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault();
    try { await Store.signIn(Store.account.email, $('opw').value); closeModal(); unlock({ id: 'account', name: Store.account.name || 'Owner', role: 'owner' }); }
    catch (x) { $('operr').textContent = 'Mali ang password.'; $('operr').hidden = false; }
  });
}
function unlock(e) {
  me = e; padKey = null; sessionStorage.setItem('friesta:me', e.id);
  $('lock').hidden = true; showApp(); bumpIdle(); toast(`Hi, ${e.name}!`);
}
function lock() { me = null; sessionStorage.removeItem('friesta:me'); $('ticket').classList.remove('open'); showLock(); }
let idleT;
function bumpIdle() {
  clearTimeout(idleT); const m = +(lsGet('autoLock') || 0);
  if (m > 0 && me) idleT = setTimeout(() => { if (me && !modalOpen()) lock(); else bumpIdle(); }, m * 60000);
}
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, bumpIdle, { passive: true }));

function showApp() {
  $('app').hidden = false;
  $('bolink').hidden = !isMgr(me);
  renderAll();
}

/* ================= cart (kept on the device so a reload never loses an order) ================= */
function newCart() { return { lines: [], orderType: Store.settings.defaultOrderType || 'Take-out', disc: { id: 'none', label: '', type: 'none', v: 0 }, ticketId: null, name: '' }; }
function loadCart() { const c = lsGet('cart'); return c && Array.isArray(c.lines) ? c : { lines: [], orderType: 'Take-out', disc: { id: 'none', label: '', type: 'none', v: 0 }, ticketId: null, name: '' }; }
function saveCart() { lsSet('cart', cart); }
function addLine(it, variant) {
  const vname = variant ? variant.name : '';
  const price = +(variant ? variant.price : it.price) || 0, cost = +(variant ? variant.cost : it.cost) || 0;
  const ex = cart.lines.find(l => l.itemId === it.id && l.variant === vname && !l.note && l.price === price);
  if (ex) ex.qty++; else cart.lines.push({ key: uid(), itemId: it.id, name: it.name, variant: vname, category: it.category || 'Other', price, cost, qty: 1, note: '' });
  if (tracked(it)) { const n = cart.lines.filter(l => l.itemId === it.id).reduce((a, l) => a + l.qty, 0); if (n > +it.stock) toast(`${Math.max(0, +it.stock)} na lang ang stock ng ${it.name}`); }
  saveCart(); renderSale(it.id);
}
function totals() {
  const subtotal = r2(cart.lines.reduce((a, l) => a + l.price * l.qty, 0));
  const d = cart.disc; let discount = 0;
  if (d.type === 'pct') discount = r2(subtotal * d.v / 100); else if (d.type === 'amt') discount = Math.min(subtotal, +d.v);
  return { subtotal, discount, total: r2(Math.max(0, subtotal - discount)), count: cart.lines.reduce((a, l) => a + l.qty, 0) };
}
const openShift = () => Store.data.shifts.find(s => s.status === 'open') || null;
function nextOrderNo() { const t = dayStart(); return sales.filter(s => s.ts >= t).reduce((m, s) => Math.max(m, +s.orderNo || 0), 0) + 1; }

/* ================= navigation ================= */
function go(v) {
  view = v;
  document.querySelectorAll('.nav[data-view]').forEach(b => { if (b.dataset.view === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  document.querySelectorAll('.view').forEach(s => s.hidden = s.id !== 'v-' + v);
  renderAll();
}
function renderAll() {
  if (!me) return;
  renderSync(); renderMe(); renderSale();
  if (view === 'receipts') renderReceipts();
  if (view === 'shift') renderShift();
  if (view === 'settings') renderSettings();
}
function renderSync() {
  const el = $('sync'); const cloud = Store.mode === 'cloud';
  const label = cloud ? (Store.online ? 'Synced' : 'Offline') : 'Offline OK';
  el.className = 'syncdot' + (cloud && !Store.online ? ' off' : '');
  el.querySelector('span').textContent = label;
  $('msync').textContent = '● ' + (cloud ? (Store.online ? 'Synced' : 'Offline · will sync later') : 'Works offline');
}
function renderMe() {
  $('meav').textContent = (me.name || '?').trim().charAt(0).toUpperCase();
  $('mename').textContent = me.name;
}

/* ================= SALE ================= */
function sortedItems() { return Store.data.items.filter(i => i.active !== false); }
function renderSale(bump) {
  if (bump) bumpId = bump;
  const items = sortedItems();
  const cats = ['All', ...new Set(items.map(i => i.category || 'Other'))]; if (!cats.includes(cat)) cat = 'All';
  $('cats').innerHTML = items.length ? cats.map(c => `<button class="cat" aria-pressed="${c === cat}" data-cat="${esc(c)}">${esc(c)}</button>`).join('') : '';
  const q = $('q').value.trim().toLowerCase();
  const qty = {}; cart.lines.forEach(l => qty[l.itemId] = (qty[l.itemId] || 0) + l.qty);
  const list = items.filter(i => q ? (i.name.toLowerCase().includes(q) || (i.category || '').toLowerCase().includes(q)) : (cat === 'All' || (i.category || 'Other') === cat));
  const grid = $('grid');
  if (!items.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><h3>Wala pang menu</h3><p>${isMgr(me) ? 'Mag-add ng items sa Back Office, o simulan sa sample fries menu (puwedeng i-edit).' : 'Pakisabi sa owner na mag-add ng items sa Back Office.'}</p>${isMgr(me) ? `<div class="actions" style="justify-content:center"><button class="btn" data-act="starter">Use starter menu</button><a class="btn ghost" href="../backoffice/#items">Open Back Office</a></div>` : ''}</div>`;
  } else if (!list.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><p>Walang item na tugma sa “${esc(q)}”.</p></div>`;
  } else {
    grid.innerHTML = list.map(i => {
      const n = qty[i.id] || 0, out = tracked(i) && +i.stock <= 0;
      return `<button class="tile${out ? ' out' : ''}" style="${tcol(i.color)}" data-tile="${i.id}">
        <span class="nm">${esc(i.name)}</span>
        ${isLow(i) ? `<span class="stk">${out ? 'Out of stock' : +i.stock + ' left'}</span>` : ''}
        <span class="ft"><span class="pr num">${hasVariants(i) ? '<small>from</small> ' + peso0(minPrice(i)) : peso0(i.price)}</span>${hasVariants(i) ? `<span class="vs">${i.variants.length} sizes</span>` : ''}</span>
        ${n ? `<span class="q num${bumpId === i.id ? ' bump' : ''}">${n}</span>` : ''}</button>`;
    }).join('');
  }
  bumpId = null;
  $('shiftnote').hidden = !!openShift();
  document.querySelectorAll('#otype button').forEach(b => b.setAttribute('aria-pressed', b.dataset.ot === cart.orderType));
  $('otype').hidden = !Store.settings.askOrderType;
  $('tname').textContent = cart.name || (cart.lines.length ? 'Current order' : 'New order');
  $('tsub').textContent = (cart.ticketId ? 'Saved order · ' : '') + 'Order #' + pad3(nextOrderNo());
  const tb = $('tixbadge'); tb.hidden = !Store.data.tickets.length; tb.textContent = Store.data.tickets.length;
  $('lines').innerHTML = cart.lines.length ? cart.lines.map(l => `<button class="line" data-line="${l.key}">
      <span class="qty num">${l.qty}</span>
      <span><span class="ln">${esc(l.name)}</span><div class="meta">${l.variant ? esc(l.variant) + ' · ' + peso(l.price) : peso(l.price) + ' each'}</div>${l.note ? `<div class="note">↳ ${esc(l.note)}</div>` : ''}</span>
      <span class="lt num">${peso(l.price * l.qty)}</span></button>`).join('')
    : `<div class="empty" style="padding:40px 16px">${ICON.cart}<p>Tap an item to add it. Tap a line to change quantity or add a note.</p></div>`;
  const t = totals();
  $('subtotal').textContent = peso(t.subtotal);
  $('discbtn').classList.toggle('on', cart.disc.type !== 'none');
  $('disclabel').textContent = cart.disc.type === 'none' ? 'Add discount' : cart.disc.label;
  $('discamt').textContent = t.discount ? '−' + peso(t.discount) : '';
  $('total').textContent = peso(t.total); $('chargeAmt').textContent = peso(t.total);
  $('charge').disabled = !cart.lines.length; $('savebtn').disabled = !cart.lines.length;
  $('cartbar').hidden = !t.count; $('cartcount').textContent = t.count; $('cartTotal').textContent = peso(t.total);
}

function pickVariant(it) {
  const m = modal(head(esc(it.name), 'Choose a size') + `<div class="vgrid">${it.variants.map((v, i) => `<button class="vbtn" style="${tcol(it.color)}" data-vi="${i}"><b>${esc(v.name)}</b><span class="num">${peso(v.price)}</span></button>`).join('')}</div>`, { sheet: true });
  m.querySelectorAll('[data-vi]').forEach(b => b.addEventListener('click', () => { addLine(it, it.variants[+b.dataset.vi]); closeModal(); }));
  Modal.onKey = e => { const n = parseInt(e.key, 10); if (n >= 1 && n <= it.variants.length) { addLine(it, it.variants[n - 1]); closeModal(); } };
}
function editLine(key) {
  const l = cart.lines.find(x => x.key === key); if (!l) return;
  let qty = l.qty; const notes = new Set((l.note || '').split(', ').filter(n => NOTE_CHIPS.includes(n)));
  const custom = (l.note || '').split(', ').filter(n => n && !NOTE_CHIPS.includes(n)).join(', ');
  const m = modal(head(esc(l.name), (l.variant ? esc(l.variant) + ' · ' : '') + peso(l.price) + ' each') + `
    <div class="stepper"><button data-q="-1" aria-label="Less">−</button><span class="num" id="lq">${qty}</span><button data-q="1" aria-label="More">+</button></div>
    <div class="field"><span class="flabel">Notes for the kitchen</span><div class="chips" id="nchips">${NOTE_CHIPS.map(n => `<button type="button" aria-pressed="${notes.has(n)}">${esc(n)}</button>`).join('')}</div>
    <input class="inp" id="lnote" maxlength="80" placeholder="Other note" value="${esc(custom)}" style="margin-top:4px"></div>
    <div class="row"><span class="sub">Line total</span><b class="disp num" id="ltot" style="font-size:22px">${peso(l.price * qty)}</b></div>
    <div class="actions"><button class="btn danger" id="lrm" style="flex:0 0 auto">${ICON.trash}Remove</button><button class="btn" id="lsave">Done</button></div>`, { sheet: true });
  const upd = () => { $('lq').textContent = qty; $('ltot').textContent = peso(l.price * qty); };
  m.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => { qty = Math.max(1, qty + +b.dataset.q); upd(); }));
  m.querySelectorAll('#nchips button').forEach(b => b.addEventListener('click', () => { const n = b.textContent; notes.has(n) ? notes.delete(n) : notes.add(n); b.setAttribute('aria-pressed', notes.has(n)); }));
  $('lrm').addEventListener('click', () => { cart.lines = cart.lines.filter(x => x.key !== key); saveCart(); closeModal(); renderSale(); });
  $('lsave').addEventListener('click', () => { l.qty = qty; l.note = [...notes, $('lnote').value.trim()].filter(Boolean).join(', '); saveCart(); closeModal(); renderSale(); });
}
function pickDiscount() {
  const sub = totals().subtotal; const ds = Store.data.discounts;
  const m = modal(head('Discount', 'Applies to the whole order') + `
    <div class="chips"><button data-d="none" aria-pressed="${cart.disc.type === 'none'}">No discount</button>${ds.map(d => `<button data-d="${d.id}" aria-pressed="${cart.disc.id === d.id}">${esc(d.name)}</button>`).join('')}</div>
    <div class="field"><label for="damt">Custom amount off (₱)</label><input id="damt" type="number" inputmode="decimal" min="0" step="1" placeholder="0" value="${cart.disc.type === 'amt' && cart.disc.id === 'custom' ? cart.disc.v : ''}"></div>
    <div class="actions"><button class="btn" id="dapply">Apply custom amount</button></div>`, { sheet: true });
  m.querySelectorAll('[data-d]').forEach(b => b.addEventListener('click', () => {
    const d = ds.find(x => x.id === b.dataset.d);
    cart.disc = d ? { id: d.id, label: d.name, type: d.type, v: +d.value } : { id: 'none', label: '', type: 'none', v: 0 };
    saveCart(); closeModal(); renderSale();
  }));
  $('dapply').addEventListener('click', () => { const v = Math.min(parseFloat($('damt').value) || 0, sub); if (v > 0) cart.disc = { id: 'custom', label: 'Discount ' + peso0(v), type: 'amt', v: r2(v) }; saveCart(); closeModal(); renderSale(); });
}

/* saved (open) orders */
function saveTicket() {
  const ex = cart.ticketId ? Store.data.tickets.find(t => t.id === cart.ticketId) : null;
  const m = modal(head(ex ? 'Update saved order' : 'Save order', 'Hold it while the customer waits, then charge later.') + `
    <div class="field"><label for="tkn">Name or table</label><input id="tkn" maxlength="30" value="${esc(cart.name || '')}" placeholder="e.g. Table 2, Ate in red"></div>
    <div class="chips" id="tkchips">${['Table 1', 'Table 2', 'Table 3', 'Table 4', 'Pickup', 'Delivery'].map(n => `<button type="button">${n}</button>`).join('')}</div>
    <div class="actions"><button class="btn" id="tksave">Save order</button></div>`, { sheet: true, focus: '#tkn' });
  m.querySelectorAll('#tkchips button').forEach(b => b.addEventListener('click', () => { $('tkn').value = b.textContent; }));
  const save = async () => {
    const name = $('tkn').value.trim() || 'Order ' + (Store.data.tickets.length + 1);
    $('tksave').disabled = true;
    try {
      await Store.put('tickets', { id: cart.ticketId || uid(), name, lines: cart.lines, orderType: cart.orderType, disc: cart.disc, ts: ex ? ex.ts : Date.now(), updatedAt: Date.now(), employeeName: me.name });
      cart = newCart(); saveCart(); closeModal(); $('ticket').classList.remove('open'); renderSale(); toast(`Saved “${name}”`);
    } catch (e) { $('tksave').disabled = false; failed(e); }
  };
  $('tksave').addEventListener('click', save); $('tkn').addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
}
function openTickets() {
  const tk = Store.data.tickets;
  if (!tk.length) { toast('Walang naka-save na order. Gamitin ang Save para mag-hold.'); return; }
  const m = modal(head('Saved orders', tk.length + ' open') + `<div class="card list">${tk.map(t => {
    const sub = t.lines.reduce((a, l) => a + l.price * l.qty, 0), mins = Math.round((Date.now() - t.ts) / 60000);
    return `<button class="it" data-tk="${t.id}"><span class="grow"><span class="t1">${esc(t.name)}</span><div class="sub">${t.lines.reduce((a, l) => a + l.qty, 0)} items · ${esc(t.orderType || '')} · ${mins < 1 ? 'just now' : mins < 60 ? mins + ' min ago' : fmtTime(t.ts)}</div></span><b class="num">${peso(sub)}</b></button>`;
  }).join('')}</div>`);
  m.querySelectorAll('[data-tk]').forEach(b => b.addEventListener('click', () => {
    if (cart.lines.length && cart.ticketId !== b.dataset.tk) { toast('I-save o i-clear muna ang kasalukuyang order'); return; }
    const t = Store.data.tickets.find(x => x.id === b.dataset.tk); if (!t) return;
    cart = { lines: t.lines.map(l => ({ ...l })), orderType: t.orderType || cart.orderType, disc: t.disc || { id: 'none', label: '', type: 'none', v: 0 }, ticketId: t.id, name: t.name };
    saveCart(); closeModal(); renderSale(); if (innerWidth < 700) $('ticket').classList.add('open');
  }));
}

/* checkout */
function suggestions(total) {
  const out = new Set(); [20, 50, 100, 500, 1000].forEach(n => { const v = Math.ceil(total / n) * n; if (v > total + 0.001) out.add(v); });
  return [...out].sort((a, b) => a - b).slice(0, 3);
}
function openCharge() {
  if (Store.settings.requireShift && !openShift()) { toast('Mag-open muna ng shift'); go('shift'); return; }
  const t = totals(); let method = 'Cash', entry = '';
  const m = modal(head('Charge', `${t.count} items${Store.settings.askOrderType ? ' · ' + esc(cart.orderType) : ''}${cart.name ? ' · ' + esc(cart.name) : ''}`) + `
    <div class="paygrid">
      <div class="pleft">
        <div class="due"><small>Amount due</small><div class="amt num">${peso(t.total)}</div>${t.discount ? `<div class="sub num">${esc(cart.disc.label)} −${peso(t.discount)}</div>` : ''}</div>
        <div class="methods" id="pm">${METHODS.map(x => `<button data-m="${x}" aria-pressed="${x === method}">${x}</button>`).join('')}</div>
        <div class="chg" id="chg"><span>Change</span><b class="num">₱0.00</b></div>
      </div>
      <div id="paypane">
        <div id="cashpane" style="display:flex;flex-direction:column;gap:8px">
          <div class="tend"><span class="sub">Cash received</span><span class="v num ph" id="tv">${peso(t.total)}</span></div>
          <div class="sugg"><button data-s="${t.total}">Exact</button>${suggestions(t.total).map(v => `<button data-s="${v}">${peso0(v)}</button>`).join('')}</div>
          <div class="keypad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'].map(k => `<button data-k="${k}" aria-label="${k === 'del' ? 'Delete' : k}">${k === 'del' ? ICON.backspace : k}</button>`).join('')}</div>
        </div>
        <div id="refpane" hidden class="field"><label for="pref">Reference no. (optional)</label><input id="pref" inputmode="numeric" maxlength="30" placeholder="Last 4 digits or full ref"></div>
      </div>
      <button class="btn good lg" id="paybtn">Complete sale</button>
    </div>`, { wide: true });
  const tendered = () => entry === '' ? t.total : parseFloat(entry);
  const upd = () => {
    const tv = $('tv'); tv.textContent = entry === '' ? peso(t.total) : peso(parseFloat(entry) || 0); tv.classList.toggle('ph', entry === '');
    const c = $('chg');
    if (method !== 'Cash') { c.className = 'chg'; c.querySelector('span').textContent = 'Change'; c.querySelector('b').textContent = peso(0); $('paybtn').disabled = false; return; }
    const d = r2((tendered() || 0) - t.total); c.className = 'chg ' + (d >= 0 ? 'ok' : 'short');
    c.querySelector('span').textContent = d >= 0 ? 'Change' : 'Kulang pa'; c.querySelector('b').textContent = peso(Math.abs(d));
    $('paybtn').disabled = d < 0;
  };
  const key = k => {
    if (method !== 'Cash') return;
    if (k === 'del' || k === 'Backspace') entry = entry.slice(0, -1);
    else if (k === '.') { if (!entry.includes('.')) entry = (entry || '0') + '.'; }
    else if (/^\d$/.test(k)) { if (entry.includes('.') && entry.split('.')[1].length >= 2) return; if (entry.replace('.', '').length >= 7) return; entry = (entry === '0' ? '' : entry) + k; }
    upd();
  };
  m.querySelectorAll('[data-k]').forEach(b => b.addEventListener('click', () => key(b.dataset.k)));
  m.querySelectorAll('[data-s]').forEach(b => b.addEventListener('click', () => { entry = String(+b.dataset.s); upd(); }));
  m.querySelectorAll('#pm button').forEach(b => b.addEventListener('click', () => { method = b.dataset.m; m.querySelectorAll('#pm button').forEach(x => x.setAttribute('aria-pressed', x === b)); $('cashpane').hidden = method !== 'Cash'; $('refpane').hidden = method === 'Cash'; upd(); }));
  Modal.onKey = e => {
    if (document.activeElement && document.activeElement.id === 'pref') { if (e.key === 'Enter') complete(); return; }
    if (e.key === 'Enter') { e.preventDefault(); complete(); } else key(e.key);
  };
  async function complete() {
    const btn = $('paybtn'); if (!btn || btn.disabled) return; btn.disabled = true; btn.textContent = 'Saving…';
    const now = new Date(), p = n => String(n).padStart(2, '0');
    const tend = method === 'Cash' ? r2(tendered()) : t.total, sh = openShift();
    const sale = {
      id: uid(), no: `${String(now.getFullYear()).slice(2)}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`,
      orderNo: nextOrderNo(), ts: now.getTime(), orderType: Store.settings.askOrderType ? cart.orderType : '', name: cart.name || '',
      lines: cart.lines.map(({ itemId, name, variant, category, price, cost, qty, note }) => ({ itemId, name, variant, category: category || 'Other', price, cost: +cost || 0, qty, note })),
      subtotal: t.subtotal, discount: t.discount, discountLabel: t.discount ? cart.disc.label : '', total: t.total,
      method, tendered: tend, change: method === 'Cash' ? r2(tend - t.total) : 0, ref: method === 'Cash' ? '' : $('pref').value.trim(),
      status: 'paid', shiftId: sh ? sh.id : null, employeeId: me.id, employeeName: me.name, deviceId
    };
    try {
      await Store.put('sales', sale);
      const tid = cart.ticketId;
      cart = newCart(); saveCart(); $('ticket').classList.remove('open'); renderSale();
      showDone(sale);
      if (tid) Store.del('tickets', tid).catch(() => {});
      adjustStock(sale.lines, -1);
    } catch (e) { btn.disabled = false; btn.textContent = 'Complete sale'; failed(e); }
  }
  $('paybtn').addEventListener('click', complete);
  upd();
}
function adjustStock(lines, sign) {
  const by = {}; lines.forEach(l => { if (l.itemId) by[l.itemId] = (by[l.itemId] || 0) + l.qty; });
  Object.entries(by).forEach(([id, q]) => { if (tracked(itemById(id))) Store.incr('items', id, 'stock', sign * q).catch(() => {}); });
}
function showDone(s) {
  const pc = printerCfg();
  modal(`<div class="done"><div class="ck">${ICON.check}</div>
    ${s.method === 'Cash' ? `<div class="sub" style="margin-top:8px">Change</div><div class="big num">${peso(s.change)}</div><div class="sub num">Received ${peso(s.tendered)} · Total ${peso(s.total)}</div>` : `<div class="big num" style="margin-top:8px">${peso(s.total)}</div><div class="sub">Paid via ${esc(s.method)}${s.ref ? ' · Ref ' + esc(s.ref) : ''}</div>`}
    <div style="margin-top:10px" class="ordno num">Order #${pad3(s.orderNo)}</div></div>
    <div class="actions"><button class="btn ghost" id="vr">Receipt</button>${canPrint() ? `<button class="btn ghost" id="pr">Print</button>` : ''}<button class="btn lg" id="ns" style="flex:2">New sale</button></div>`);
  $('ns').addEventListener('click', closeModal); setTimeout(() => { const b = $('ns'); if (b) b.focus(); }, 60);
  $('vr').addEventListener('click', () => showReceipt(s));
  const pr = $('pr'); if (pr) pr.addEventListener('click', () => printSale(s));
  Modal.onKey = e => { if (e.key === 'Enter') { e.preventDefault(); closeModal(); } };
  if (canPrint() && pc.auto && (Printer.connected || Printer.name)) printSale(s);
}

/* ================= RECEIPTS ================= */
function renderReceipts() {
  const q = $('rq').value.trim().toLowerCase();
  const list = sales.filter(s => !q || String(s.no).includes(q) || pad3(s.orderNo).includes(q.replace('#', '')) || (s.lines || []).some(l => (l.name + ' ' + (l.variant || '')).toLowerCase().includes(q)));
  if (!sales.length) { $('rlist').innerHTML = `<div class="card"><div class="empty"><h3>Wala pang resibo</h3><p>Lahat ng benta sa huling 14 na araw ay makikita dito. Ang mas luma ay nasa Back Office.</p></div></div>`; return; }
  if (!list.length) { $('rlist').innerHTML = `<div class="card"><div class="empty"><p>Walang tugma.</p></div></div>`; return; }
  const groups = new Map();
  list.forEach(s => { const k = dayStart(s.ts); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); });
  const today = dayStart();
  $('rlist').innerHTML = [...groups].map(([k, arr]) => {
    const net = arr.reduce((a, s) => a + (s.status === 'refunded' ? 0 : s.total), 0);
    const lbl = k === today ? 'Today' : k === addDays(today, -1) ? 'Yesterday' : new Date(k).toLocaleDateString('en-PH', { weekday: 'long', month: 'short', day: 'numeric' });
    return `<div class="row glabel" style="margin-top:6px"><span>${lbl}</span><span class="num">${peso(net)}</span></div>
    <div class="card list">${arr.map(s => `<button class="it" data-rcpt="${s.id}">
      <span class="ordno num" style="font-size:16px;padding:4px 10px">#${pad3(s.orderNo)}</span>
      <span class="grow"><span class="t1 num">${peso(s.total)}</span> ${s.status === 'refunded' ? '<span class="pill ref">Refunded</span>' : ''}
      <div class="sub num">${fmtTime(s.ts)} · ${esc(s.method)} · ${(s.lines || []).reduce((a, l) => a + l.qty, 0)} items${s.employeeName ? ' · ' + esc(s.employeeName) : ''}</div></span>
      <span class="sub num">${esc(s.no)}</span></button>`).join('')}</div>`;
  }).join('');
}
function receiptHTML(s) {
  const st = Store.settings;
  return `<div class="receipt">
    <img src="../shared/logo.jpg" alt="Friesta">
    ${st.address ? `<div class="c">${esc(st.address)}</div>` : ''}
    <div class="c" style="margin-top:6px">ORDER</div><div class="on num">#${pad3(s.orderNo)}</div>
    <div class="c">${s.orderType ? esc(s.orderType) + ' · ' : ''}${fmtDT(s.ts)}${s.name ? ' · ' + esc(s.name) : ''}</div>
    ${s.employeeName ? `<div class="c">Cashier: ${esc(s.employeeName)}</div>` : ''}<hr>
    ${(s.lines || []).map(l => `<div class="row"><span>${l.qty} × ${esc(l.name)}${l.variant ? ' <span style="color:#8a6a5a">(' + esc(l.variant) + ')</span>' : ''}</span><span>${peso(l.price * l.qty)}</span></div>${l.note ? `<div class="nt">↳ ${esc(l.note)}</div>` : ''}`).join('')}<hr>
    <div class="row"><span>Subtotal</span><span>${peso(s.subtotal)}</span></div>
    ${s.discount ? `<div class="row"><span>${esc(s.discountLabel)}</span><span>−${peso(s.discount)}</span></div>` : ''}
    <div class="row" style="font-weight:900;font-size:18px"><span>TOTAL</span><span>${peso(s.total)}</span></div>
    <div class="row"><span>${esc(s.method)}${s.ref ? ' · Ref ' + esc(s.ref) : ''}</span><span>${peso(s.tendered)}</span></div>
    ${s.method === 'Cash' ? `<div class="row"><span>Change</span><span>${peso(s.change)}</span></div>` : ''}
    ${s.status === 'refunded' ? `<div class="row" style="color:#B3261E;font-weight:900"><span>REFUNDED${s.refundedBy ? ' · ' + esc(s.refundedBy) : ''}</span><span>${s.refundedAt ? fmtDT(s.refundedAt) : ''}</span></div>` : ''}
    <hr><div class="c">${esc(st.footer)}</div><div class="c">Receipt ${esc(s.no)}</div></div>`;
}
function receiptText(s) {
  const L = [Store.settings.storeName, Store.settings.address || null, `Order #${pad3(s.orderNo)}${s.orderType ? ' · ' + s.orderType : ''}`, `Receipt ${s.no} · ${fmtDT(s.ts)}`, '--------------------------------'];
  (s.lines || []).forEach(l => { L.push(`${l.qty} x ${l.name}${l.variant ? ' (' + l.variant + ')' : ''}  ${peso(l.price * l.qty)}`); if (l.note) L.push('   - ' + l.note); });
  L.push('--------------------------------', `Subtotal  ${peso(s.subtotal)}`); if (s.discount) L.push(`${s.discountLabel}  -${peso(s.discount)}`);
  L.push(`TOTAL  ${peso(s.total)}`, `${s.method}${s.ref ? ' Ref ' + s.ref : ''}  ${peso(s.tendered)}`); if (s.method === 'Cash') L.push(`Change  ${peso(s.change)}`);
  if (s.status === 'refunded') L.push('*** REFUNDED ***'); if (Store.settings.footer) L.push('', Store.settings.footer);
  return L.filter(x => x !== null).join('\n');
}
function showReceipt(s0) {
  const s = sales.find(x => x.id === s0.id) || s0;
  modal(head('Receipt #' + esc(s.no)) + receiptHTML(s) + `
    <div class="actions">${s.status !== 'refunded' ? `<button class="btn danger" id="refund" style="flex:0 0 auto">Refund</button>` : ''}${canPrint() ? `<button class="btn ghost" id="prr">Print</button>` : ''}<button class="btn ghost" id="copyr">Copy</button><button class="btn" data-close>Done</button></div>`);
  $('copyr').addEventListener('click', () => {
    try { navigator.clipboard.writeText(receiptText(s)).then(() => toast('Na-copy ang resibo'), () => toast('Hindi ma-copy dito')); } catch (e) { toast('Hindi ma-copy dito'); }
  });
  const prr = $('prr'); if (prr) prr.addEventListener('click', () => printSale(s, { kitchen: false }));
  const r = $('refund'); if (r) r.addEventListener('click', async () => {
    if (!armed(r, 'Tap again to refund ' + peso(s.total))) return;
    const approver = (Store.settings.refundNeedsManager && !isMgr(me)) ? await managerOK('Refund ' + peso(s.total)) : me;
    if (!approver) return;
    const sh = openShift();
    try {
      await Store.put('sales', { ...s, status: 'refunded', refundedAt: Date.now(), refundShiftId: sh ? sh.id : null, refundedBy: approver.name });
      adjustStock(s.lines || [], +1); closeModal(); toast(`Order #${pad3(s.orderNo)} refunded`);
    } catch (e) { failed(e); }
  });
}
function managerOK(reason) {
  return new Promise(res => {
    const m = modal(head('Manager approval', esc(reason)) + `<div id="mpad"></div>`);
    m.querySelector('[data-close]').addEventListener('click', () => res(null));
    const pad = pinPad($('mpad'), { title: 'Manager or owner PIN', check: async pin => { const e = await Store.employeeByPin(pin); if (isMgr(e)) { closeModal(); res(e); return true; } return false; } });
    Modal.onKey = pad.key;
  });
}

/* ================= SHIFT ================= */
function renderShift() {
  const sh = openShift(), w = $('shiftwrap');
  const hist = Store.data.shifts.filter(s => s.status === 'closed').slice(0, 15);
  const histHTML = hist.length ? `<div class="glabel" style="margin-top:8px">Closed shifts</div><div class="card list">${hist.map(s => {
    const diff = r2((+s.counted || 0) - (+s.expected || 0));
    return `<div class="it"><span class="grow"><span class="t1">${fmtDT(s.openedAt)} – ${fmtTime(s.closedAt)}</span><div class="sub num">${esc(s.closedBy || '')} · Net ${peso(s.net || 0)} · Expected ${peso(s.expected)} · Counted ${peso(s.counted)}</div></span><span class="pill ${Math.abs(diff) < 0.01 ? 'ok' : diff < 0 ? 'ref' : 'low'} num">${Math.abs(diff) < 0.01 ? 'Balanced' : (diff < 0 ? 'Short ' : 'Over ') + peso(Math.abs(diff))}</span></div>`;
  }).join('')}</div>` : '';
  if (!sh) {
    w.innerHTML = `<div class="ph"><h2>Shift</h2></div><div class="card"><div class="empty"><h3>Walang bukas na shift</h3><p>Mag-open ng shift sa umpisa ng araw at ilagay ang panimulang cash. Sa pagsasara, bilangin ang pera at sasabihin ng Friesta kung short o over.</p><button class="btn lg" data-act="openshift" style="min-width:220px">Open shift</button></div></div>${histHTML}`;
    return;
  }
  const n = shiftNumbers(sh, sales);
  w.innerHTML = `<div class="ph"><h2>Shift</h2><span class="pill ok">Open since ${fmtTime(sh.openedAt)}${sh.openedBy ? ' · ' + esc(sh.openedBy) : ''}</span></div>
  <div class="hero"><div class="k">Expected cash in drawer</div><div class="v num">${peso(n.expected)}</div></div>
  <div class="hstat">
    <div><div class="k">Starting cash</div><div class="v num">${peso(sh.startCash)}</div></div>
    <div><div class="k">Cash payments</div><div class="v num">${peso(n.cashSales)}</div></div>
    <div><div class="k">Cash refunds</div><div class="v num">${peso(n.cashRefunds)}</div></div>
    <div><div class="k">Pay in</div><div class="v num">${peso(n.payIn)}</div></div>
    <div><div class="k">Pay out</div><div class="v num">${peso(n.payOut)}</div></div>
    <div><div class="k">Receipts</div><div class="v num">${n.receipts}</div></div>
    <div><div class="k">Gross sales</div><div class="v num">${peso(n.gross)}</div></div>
    <div><div class="k">Net sales</div><div class="v num">${peso(n.net)}</div></div>
  </div>
  ${Object.keys(n.byMethod).length ? `<div class="card sec"><div class="tblwrap"><table class="tbl"><thead><tr><th>Payment type</th><th class="r">Amount</th></tr></thead><tbody>${Object.entries(n.byMethod).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r num">${peso(v)}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
  <div class="actions"><button class="btn ghost" data-act="payin">Pay in</button><button class="btn ghost" data-act="payout">Pay out</button><button class="btn" data-act="closeshift">Close shift</button></div>
  ${(sh.moves || []).length ? `<div class="glabel" style="margin-top:6px">Cash movements</div><div class="card list">${sh.moves.map(m => `<div class="it"><span class="grow"><span class="t1">${m.type === 'in' ? 'Pay in' : 'Pay out'}${m.note ? ' · ' + esc(m.note) : ''}</span><div class="sub">${fmtTime(m.ts)}${m.by ? ' · ' + esc(m.by) : ''}</div></span><b class="num" style="color:var(${m.type === 'in' ? '--good' : '--bad'})">${m.type === 'in' ? '+' : '−'}${peso(m.amt)}</b></div>`).join('')}</div>` : ''}
  ${histHTML}`;
}
function amountModal(title, sub, label, withNote, cb) {
  modal(head(title, sub) + `<div class="field"><label for="amt">${label}</label><input id="amt" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00"></div>
    ${withNote ? `<div class="field"><label for="amtn">Reason</label><input id="amtn" maxlength="60" placeholder="e.g. Bumili ng yelo, change fund"></div>` : ''}
    <div class="actions"><button class="btn" id="amtok">Confirm</button></div>`, { focus: '#amt' });
  const ok = async () => {
    const v = parseFloat($('amt').value); if (isNaN(v) || v < 0) { toast('Ilagay ang halaga'); return; }
    $('amtok').disabled = true;
    try { await cb(r2(v), withNote ? $('amtn').value.trim() : ''); closeModal(); } catch (e) { $('amtok').disabled = false; failed(e); }
  };
  $('amtok').addEventListener('click', ok); $('amt').addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
}
function shiftAction(a) {
  const sh = openShift();
  if (a === 'openshift') return amountModal('Open shift', 'Bilangin ang cash sa drawer bago magbenta.', 'Starting cash (₱)', false, async v => { await Store.put('shifts', { id: uid(), openedAt: Date.now(), openedBy: me.name, startCash: v, moves: [], status: 'open', closedAt: null, deviceId }); toast('Shift opened'); });
  if (!sh) return;
  if (a === 'payin' || a === 'payout') return amountModal(a === 'payin' ? 'Pay in' : 'Pay out', a === 'payin' ? 'Cash na idinagdag sa drawer' : 'Cash na kinuha sa drawer', 'Amount (₱)', true, async (v, note) => { await Store.patch('shifts', sh.id, { moves: [...(sh.moves || []), { type: a === 'payin' ? 'in' : 'out', amt: v, note, ts: Date.now(), by: me.name }] }); toast('Recorded'); });
  if (a === 'closeshift') {
    const n = shiftNumbers(sh, sales);
    modal(head('Close shift', 'Bilangin lahat ng cash sa drawer.') + `<div class="due"><small>Expected cash</small><div class="amt num" style="font-size:34px">${peso(n.expected)}</div></div>
      <div class="field"><label for="cnt">Actual cash counted (₱)</label><input id="cnt" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00"></div>
      <div class="chg" id="cdiff"><span>Difference</span><b class="num">—</b></div>
      ${Store.data.tickets.length ? `<span class="pill low" style="align-self:flex-start">${Store.data.tickets.length} saved order(s) pa ang bukas</span>` : ''}
      <div class="actions"><button class="btn" id="cls">Close shift</button></div>`, { focus: '#cnt' });
    $('cnt').addEventListener('input', () => {
      const v = parseFloat($('cnt').value), c = $('cdiff');
      if (isNaN(v)) { c.className = 'chg'; c.querySelector('b').textContent = '—'; return; }
      const d = r2(v - n.expected); c.className = 'chg ' + (Math.abs(d) < 0.01 ? 'ok' : 'short');
      c.querySelector('span').textContent = Math.abs(d) < 0.01 ? 'Balanced' : d < 0 ? 'Short' : 'Over'; c.querySelector('b').textContent = peso(Math.abs(d));
    });
    $('cls').addEventListener('click', async () => {
      const v = parseFloat($('cnt').value); if (isNaN(v)) { toast('Ilagay ang nabilang na cash'); return; }
      $('cls').disabled = true;
      try { await Store.patch('shifts', sh.id, { status: 'closed', closedAt: Date.now(), closedBy: me.name, counted: r2(v), expected: n.expected, net: r2(n.net), gross: r2(n.gross), receipts: n.receipts, cashSales: r2(n.cashSales) }); closeModal(); toast('Shift closed'); }
      catch (e) { $('cls').disabled = false; failed(e); }
    });
  }
}

/* ================= SETTINGS (this POS device) ================= */
function renderSettings() {
  const w = $('setwrap'); if (w.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  const s = Store.settings, mgr = isMgr(me), autoLock = +(lsGet('autoLock') || 0);
  w.innerHTML = `<div class="ph"><h2>Settings</h2></div>
  <div class="card form">
    <div class="row"><span><span class="t1">${esc(me.name)}</span><div class="sub">${esc(me.role === 'owner' ? 'Owner' : me.role === 'manager' ? 'Manager' : 'Cashier')} · ${esc(Store.account ? Store.account.email : '')}</div></span><button class="btn sm" id="lockbtn">${ICON.lock} Lock</button></div>
    <div class="field"><span class="flabel">Auto-lock kapag walang gumagamit</span><div class="chips" id="alock">${[0, 1, 5, 15].map(m => `<button type="button" data-m="${m}" aria-pressed="${autoLock === m}">${m ? m + ' min' : 'Off'}</button>`).join('')}</div></div>
  </div>
  <div class="card form" id="prncard"></div>
  ${mgr ? `<form class="card form" id="optform">
    <div class="flabel">Selling options (lahat ng device)</div>
    <div class="toggle"><span>Itanong ang Dine-in o Take-out</span><button type="button" class="switch" role="switch" id="o-ot" aria-checked="${!!s.askOrderType}" aria-label="Ask order type"></button></div>
    <div class="field"><span class="flabel">Default order type</span><div class="chips" id="o-dot">${['Take-out', 'Dine-in'].map(o => `<button type="button" data-v="${o}" aria-pressed="${s.defaultOrderType === o}">${o}</button>`).join('')}</div></div>
    <div class="toggle"><span>Kailangan ng bukas na shift bago magbenta</span><button type="button" class="switch" role="switch" id="o-rs" aria-checked="${!!s.requireShift}" aria-label="Require open shift"></button></div>
    <div class="toggle"><span>Refund ng cashier kailangan ng manager PIN</span><button type="button" class="switch" role="switch" id="o-rm" aria-checked="${s.refundNeedsManager !== false}" aria-label="Refund needs manager"></button></div>
    <div class="actions"><button class="btn" type="submit">Save options</button></div>
  </form>` : ''}
  <div class="card form"><div class="flabel">Data at sync</div>
    <div class="sub">${Store.mode === 'cloud' ? `Naka-on ang cloud sync. ${Store.online ? 'Online ngayon, kaya naka-sync ang lahat.' : 'Offline ngayon. Naka-save ang benta sa device at awtomatikong ise-sync pagbalik ng internet.'}` : 'Naka-save ang lahat sa device na ito at gumagana kahit walang internet. Ang Back Office sa parehong device ay kita agad ang benta. Mag-download ng backup sa Back Office linggo-linggo.'}</div>
    <div class="actions">${mgr ? `<a class="btn ghost" href="../backoffice/">${ICON.office} Open Back Office</a>` : ''}${me.role === 'owner' ? `<button type="button" class="btn ghost" id="signout">${ICON.logout} Sign out device</button>` : ''}</div>
  </div>`;
  $('lockbtn').addEventListener('click', lock);
  w.querySelectorAll('#alock button').forEach(b => b.addEventListener('click', () => { lsSet('autoLock', +b.dataset.m); w.querySelectorAll('#alock button').forEach(x => x.setAttribute('aria-pressed', x === b)); bumpIdle(); }));
  renderPrinter();
  const f = $('optform');
  if (f) {
    let dot = s.defaultOrderType;
    f.querySelectorAll('.switch').forEach(b => b.addEventListener('click', () => b.setAttribute('aria-checked', b.getAttribute('aria-checked') !== 'true')));
    f.querySelectorAll('#o-dot button').forEach(b => b.addEventListener('click', () => { dot = b.dataset.v; f.querySelectorAll('#o-dot button').forEach(x => x.setAttribute('aria-pressed', x === b)); }));
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const on = id => $(id).getAttribute('aria-checked') === 'true';
      try { await Store.saveSettings({ askOrderType: on('o-ot'), defaultOrderType: dot, requireShift: on('o-rs'), refundNeedsManager: on('o-rm') }); toast('Na-save'); } catch (x) { failed(x); }
    });
  }
  const so = $('signout'); if (so) so.addEventListener('click', async () => { if (!armed(so, 'Tap again to sign out')) return; lsSet('cart', null); sessionStorage.removeItem('friesta:me'); await Store.signOut(); });
}
function renderPrinter() {
  const c = $('prncard'); if (!c) return; const cfg = printerCfg();
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let body;
  if (!canPrint()) body = `<span class="pill low" style="align-self:flex-start">Walang Bluetooth printing sa browser na ito</span><div class="sub">${iOS ? 'Hindi pinapayagan ng iPhone/iPad browsers ang Bluetooth printers. Buksan ang Friesta POS sa libreng <b>Bluefy</b> app, o gumamit ng Android phone/tablet na may Chrome.' : 'Buksan ang Friesta POS sa <b>Google Chrome</b> (Android, Windows, Mac o ChromeOS).'}</div>`;
  else body = `<div class="row"><span class="t1">${Printer.connected ? esc(Printer.name) : Printer.name ? esc(Printer.name) + ' <span class="sub">(last used)</span>' : 'Wala pang printer'}</span><span class="pill ${Printer.connected ? 'ok' : 'n'}">${Printer.connected ? 'Connected' : 'Not connected'}</span></div>
    <div class="actions"><button class="btn" data-pa="connect">${Printer.connected ? 'Change printer' : 'Connect printer'}</button><button class="btn ghost" data-pa="test" ${Printer.connected || Printer.name ? '' : 'disabled'}>Test print</button>${Printer.name ? `<button class="btn ghost" data-pa="forget" style="flex:0 0 auto">Forget</button>` : ''}</div>
    <div class="sub">I-on muna ang printer. Dapat may Bluetooth Low Energy (BLE / 4.0). Huwag i-pair sa Bluetooth settings ng phone; dito i-connect.</div>
    <div class="field"><span class="flabel">Paper width</span><div class="chips"><button type="button" data-pp="58" aria-pressed="${cfg.paper === 58}">58 mm</button><button type="button" data-pp="80" aria-pressed="${cfg.paper === 80}">80 mm</button></div></div>
    <div class="toggle"><span>I-print ang resibo pagkatapos ng bawat benta</span><button type="button" class="switch" role="switch" data-pt="auto" aria-checked="${cfg.auto}" aria-label="Auto print"></button></div>
    <div class="toggle"><span>Mag-print din ng kitchen slip<div class="sub">Malaking order number, items at notes para sa nagpi-prito</div></span><button type="button" class="switch" role="switch" data-pt="kitchen" aria-checked="${cfg.kitchen}" aria-label="Kitchen slip"></button></div>
    <div class="toggle"><span>I-print ang logo sa resibo</span><button type="button" class="switch" role="switch" data-pt="logo" aria-checked="${cfg.logo}" aria-label="Print logo"></button></div>`;
  c.innerHTML = `<div class="flabel">Receipt printer · Bluetooth</div>${body}`;
  c.querySelectorAll('[data-pt]').forEach(b => b.addEventListener('click', () => { const v = printerCfg(); v[b.dataset.pt] = !v[b.dataset.pt]; savePrinterCfg(v); b.setAttribute('aria-checked', v[b.dataset.pt]); }));
  c.querySelectorAll('[data-pp]').forEach(b => b.addEventListener('click', () => { const v = printerCfg(); v.paper = +b.dataset.pp; savePrinterCfg(v); c.querySelectorAll('[data-pp]').forEach(x => x.setAttribute('aria-pressed', x === b)); }));
  const cb = c.querySelector('[data-pa="connect"]'); if (cb) cb.addEventListener('click', async () => {
    try { await Printer.pick(); toast('Printer connected'); }
    catch (e) { if (e && e.name === 'NotFoundError') return; toast(e && e.code === 'not-a-printer' ? 'Hindi printer ang device na iyon' : 'Hindi maka-connect. Naka-on ba ang printer at hindi naka-connect sa ibang phone?'); }
  });
  const tb = c.querySelector('[data-pa="test"]'); if (tb) tb.addEventListener('click', async () => {
    if (!(await Printer.ready())) { toast('Hindi connected. Pindutin ang Connect printer.'); return; }
    try { await Printer.write(testBytes(Store.settings)); toast('Naipadala sa printer'); } catch (e) { Printer.ch = null; renderPrinter(); toast('Hindi nag-print. I-on ang printer at i-connect ulit.'); }
  });
  const fb = c.querySelector('[data-pa="forget"]'); if (fb) fb.addEventListener('click', () => Printer.forget());
}
async function printSale(s, opt = {}) {
  if (!canPrint()) { toast('Walang Bluetooth printing sa browser na ito'); return; }
  const cfg = printerCfg();
  if (!(await Printer.ready())) { toast('Hindi connected ang printer. Settings → Connect printer.'); return; }
  toast('Printing…');
  try { await Printer.write(receiptBytes(s, Store.settings, cfg)); if (opt.kitchen ?? cfg.kitchen) await Printer.write(kitchenBytes(s, cfg)); toast('Printed'); }
  catch (e) { Printer.ch = null; toast('Hindi nag-print. I-on ang printer, tapos pindutin ulit ang Print.'); }
}

async function loadStarter(btn) {
  if (btn) btn.disabled = true;
  try { for (const s of STARTER_ITEMS) await Store.put('items', { ...s, id: uid(), price: s.price ?? Math.min(...s.variants.map(v => v.price)), cost: s.cost ?? 0, stock: null, lowAt: 5 }); toast('Naidagdag ang starter menu. I-edit ang presyo sa Back Office.'); }
  catch (e) { failed(e); if (btn) btn.disabled = false; }
}
function failed(e) { console.error(e); toast(e && e.name === 'QuotaExceededError' ? 'Puno na ang storage ng device.' : 'Hindi na-save. Subukan ulit.'); }

/* ================= events ================= */
$('rail').addEventListener('click', e => { const b = e.target.closest('.nav[data-view]'); if (b) go(b.dataset.view); });
$('mebtn').addEventListener('click', lock);
document.body.addEventListener('click', e => {
  const t = e.target.closest('[data-tile],[data-line],[data-cat],[data-rcpt],[data-act],[data-ot]'); if (!t || !me) return;
  if (t.dataset.tile) { const it = itemById(t.dataset.tile); if (!it) return; hasVariants(it) ? pickVariant(it) : addLine(it, null); }
  else if (t.dataset.line) editLine(t.dataset.line);
  else if (t.dataset.cat) { cat = t.dataset.cat; renderSale(); document.querySelector('.gridscroll').scrollTop = 0; }
  else if (t.dataset.rcpt) { const s = sales.find(x => x.id === t.dataset.rcpt); if (s) showReceipt(s); }
  else if (t.dataset.ot) { cart.orderType = t.dataset.ot; saveCart(); renderSale(); }
  else if (t.dataset.act === 'starter') loadStarter(t);
  else shiftAction(t.dataset.act);
});
$('q').addEventListener('input', () => renderSale());
$('rq').addEventListener('input', renderReceipts);
let clearArm = 0;
$('clear').addEventListener('click', () => {
  const c = $('clear'); if (!cart.lines.length && !cart.ticketId) return;
  if (Date.now() - clearArm > 3000) { clearArm = Date.now(); c.classList.add('arm'); toast(cart.ticketId ? 'Pindutin ulit para burahin ang saved order' : 'Pindutin ulit para i-clear ang order'); setTimeout(() => c.classList.remove('arm'), 3000); return; }
  clearArm = 0; c.classList.remove('arm'); const tid = cart.ticketId; cart = newCart(); saveCart(); renderSale();
  if (tid) Store.del('tickets', tid).then(() => toast('Nabura ang saved order'), failed);
});
$('discbtn').addEventListener('click', () => { if (cart.lines.length) pickDiscount(); else toast('Mag-add muna ng items'); });
$('savebtn').addEventListener('click', saveTicket);
$('opentix').addEventListener('click', openTickets);
$('charge').addEventListener('click', openCharge);
$('cartbar').addEventListener('click', () => $('ticket').classList.add('open'));
$('tback').addEventListener('click', () => $('ticket').classList.remove('open'));
$('shiftnote').addEventListener('click', () => go('shift'));
document.addEventListener('keydown', e => {
  if (!$('lock').hidden && padKey && !modalOpen()) { padKey(e); return; }
  if (modalOpen()) { if (e.key === 'Escape') { closeModal(); return; } if (Modal.onKey) Modal.onKey(e); return; }
  if (!me || view !== 'sale' || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  if (e.key === '/') { e.preventDefault(); $('q').focus(); }
  if (e.key === 'Enter' && cart.lines.length) { e.preventDefault(); openCharge(); }
});

boot();
