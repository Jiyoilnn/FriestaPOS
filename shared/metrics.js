// Sales math shared by the POS (shift report) and the Back Office.
//
// Definitions (same as Loyverse):
//   Gross sales   = item prices sold in the period, before discounts
//   Discounts     = discounts given on those receipts
//   Refunds       = amount refunded in the period (counted on the day of the refund)
//   Net sales     = Gross sales − Discounts − Refunds
//   Cost of goods = item cost of what was sold, minus cost of what was refunded
//   Gross profit  = Net sales − Cost of goods

import { addDays, addMonths, dayStart, monthStart, weekStart } from './util.js';

const inR = (t, from, to) => t != null && t >= from && t < to;
export const saleIn = (s, f, t) => inR(s.ts, f, t);
export const refundIn = (s, f, t) => s.status === 'refunded' && inR(s.refundedAt, f, t);
const lineGross = l => (+l.price || 0) * (+l.qty || 0);
const lineCost = l => (+l.cost || 0) * (+l.qty || 0);
export const saleCost = s => (s.lines || []).reduce((a, l) => a + lineCost(l), 0);
const discShare = (s, l) => (s.subtotal > 0 ? (+s.discount || 0) * lineGross(l) / s.subtotal : 0);

export function summarize(sales, from, to, pred = () => true) {
  let gross = 0, discounts = 0, refunds = 0, cogs = 0, receipts = 0, refundCount = 0, itemsSold = 0;
  for (const s of sales) {
    if (!pred(s)) continue;
    if (saleIn(s, from, to)) { gross += +s.subtotal || 0; discounts += +s.discount || 0; cogs += saleCost(s); receipts++; itemsSold += (s.lines || []).reduce((a, l) => a + l.qty, 0); }
    if (refundIn(s, from, to)) { refunds += +s.total || 0; cogs -= saleCost(s); refundCount++; }
  }
  const net = gross - discounts - refunds;
  return { gross, discounts, refunds, net, cogs, profit: net - cogs, receipts, refundCount, itemsSold, avg: receipts ? (gross - discounts) / receipts : 0, margin: net ? (net - cogs) / net : 0 };
}

/* Pick a sensible bucket size for a range. */
export function autoUnit(from, to) {
  const days = Math.round((to - from) / 864e5);
  if (days <= 1) return 'hour';
  if (days <= 62) return 'day';
  if (days <= 200) return 'week';
  return 'month';
}
export function buckets(from, to, unit) {
  const out = [];
  if (unit === 'hour') { for (let h = 0; h < 24; h++) out.push([from + h * 36e5, from + (h + 1) * 36e5]); return out; }
  let t = unit === 'week' ? weekStart(from) : unit === 'month' ? monthStart(from) : dayStart(from);
  while (t < to) {
    const n = unit === 'day' ? addDays(t, 1) : unit === 'week' ? addDays(t, 7) : addMonths(t, 1);
    out.push([Math.max(t, from), Math.min(n, to)]); t = n;
  }
  return out;
}
export function series(sales, from, to, unit, pred) {
  const pre = sales.filter(s => saleIn(s, from, to) || refundIn(s, from, to));
  return buckets(from, to, unit).map(([a, b]) => ({ from: a, to: b, ...summarize(pre, a, b, pred) }));
}

export function byItem(sales, from, to, pred = () => true, itemsById = {}) {
  const m = new Map();
  const row = l => {
    const k = (l.itemId || l.name) + '|' + (l.variant || '');
    if (!m.has(k)) m.set(k, { name: l.name, variant: l.variant || '', category: l.category || (itemsById[l.itemId] && itemsById[l.itemId].category) || 'Other', sold: 0, refundedQty: 0, gross: 0, discounts: 0, refunds: 0, cogs: 0 });
    return m.get(k);
  };
  for (const s of sales) {
    if (!pred(s)) continue;
    if (saleIn(s, from, to)) for (const l of s.lines || []) { const r = row(l); r.sold += l.qty; r.gross += lineGross(l); r.discounts += discShare(s, l); r.cogs += lineCost(l); }
    if (refundIn(s, from, to)) for (const l of s.lines || []) { const r = row(l); r.refundedQty += l.qty; r.refunds += lineGross(l) - discShare(s, l); r.cogs -= lineCost(l); }
  }
  return [...m.values()].map(r => { const net = r.gross - r.discounts - r.refunds; return { ...r, net, profit: net - r.cogs }; }).sort((a, b) => b.net - a.net);
}
export function byCategory(sales, from, to, pred, itemsById) {
  const m = new Map();
  for (const r of byItem(sales, from, to, pred, itemsById)) {
    const c = m.get(r.category) || { name: r.category, sold: 0, refundedQty: 0, gross: 0, discounts: 0, refunds: 0, net: 0, cogs: 0, profit: 0 };
    ['sold', 'refundedQty', 'gross', 'discounts', 'refunds', 'net', 'cogs', 'profit'].forEach(k => c[k] += r[k]);
    m.set(r.category, c);
  }
  return [...m.values()].sort((a, b) => b.net - a.net);
}
export function byEmployee(sales, from, to) {
  const keys = new Map();
  for (const s of sales) if (saleIn(s, from, to) || refundIn(s, from, to)) { const k = s.employeeId || 'unknown'; if (!keys.has(k)) keys.set(k, s.employeeName || 'Unknown'); }
  return [...keys].map(([id, name]) => ({ id, name, ...summarize(sales, from, to, s => (s.employeeId || 'unknown') === id) })).sort((a, b) => b.net - a.net);
}
export function byPayment(sales, from, to, pred = () => true) {
  const m = new Map();
  const row = k => { if (!m.has(k)) m.set(k, { name: k, count: 0, amount: 0, refundCount: 0, refunds: 0 }); return m.get(k); };
  for (const s of sales) {
    if (!pred(s)) continue;
    if (saleIn(s, from, to)) { const r = row(s.method || 'Cash'); r.count++; r.amount += +s.total || 0; }
    if (refundIn(s, from, to)) { const r = row(s.method || 'Cash'); r.refundCount++; r.refunds += +s.total || 0; }
  }
  return [...m.values()].map(r => ({ ...r, net: r.amount - r.refunds })).sort((a, b) => b.net - a.net);
}
export function byDiscount(sales, from, to, pred = () => true) {
  const m = new Map();
  for (const s of sales) {
    if (!pred(s) || !saleIn(s, from, to) || !(+s.discount)) continue;
    const k = s.discountLabel || 'Discount'; const r = m.get(k) || { name: k, count: 0, amount: 0 };
    r.count++; r.amount += +s.discount; m.set(k, r);
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount);
}

/* Cash drawer math for one shift. */
export function shiftNumbers(sh, sales) {
  const end = sh.closedAt || Infinity;
  const inShift = s => s.shiftId === sh.id || (!s.shiftId && s.ts >= sh.openedAt && s.ts < end);
  const own = sales.filter(inShift);
  const refundedHere = sales.filter(s => s.status === 'refunded' && s.refundShiftId === sh.id);
  const sum = (arr, f = () => true) => arr.filter(f).reduce((a, s) => a + (+s.total || 0), 0);
  const cashSales = sum(own, s => s.method === 'Cash');
  const cashRefunds = sum(refundedHere, s => s.method === 'Cash');
  const payIn = (sh.moves || []).filter(m => m.type === 'in').reduce((a, m) => a + +m.amt, 0);
  const payOut = (sh.moves || []).filter(m => m.type === 'out').reduce((a, m) => a + +m.amt, 0);
  const byMethod = {};
  own.forEach(s => byMethod[s.method] = (byMethod[s.method] || 0) + (+s.total || 0));
  const gross = own.reduce((a, s) => a + (+s.subtotal || 0), 0);
  const discounts = own.reduce((a, s) => a + (+s.discount || 0), 0);
  const refunds = sum(refundedHere);
  return {
    receipts: own.length, gross, discounts, refunds, net: gross - discounts - refunds,
    cashSales, cashRefunds, payIn, payOut, byMethod,
    expected: Math.round((+sh.startCash + cashSales - cashRefunds + payIn - payOut) * 100) / 100
  };
}
