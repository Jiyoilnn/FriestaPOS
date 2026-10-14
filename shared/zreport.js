// X-reading / Z-reading (end-of-day) reports, per device.
// X-reading = sales since the last Z-reading, nothing is saved.
// Z-reading = closes the period: saved with a Z number and accumulated sales.
import { esc, peso, fmtDT } from './util.js';

const isSC = s => /senior|pwd/i.test(s.discountLabel || '');
const sum = (arr, f) => arr.reduce((a, s) => a + (+f(s) || 0), 0);

export function zSummary(sales, from, to, deviceId) {
  const own = sales.filter(s => (s.deviceId || '') === deviceId && s.ts >= from && s.ts < to).sort((a, b) => a.ts - b.ts);
  const ref = sales.filter(s => s.status === 'refunded' && (s.refundDeviceId || s.deviceId) === deviceId && s.refundedAt >= from && s.refundedAt < to);
  const gross = sum(own, s => s.subtotal), discounts = sum(own, s => s.discount), refunds = sum(ref, s => s.total);
  const scDiscount = sum(own.filter(isSC), s => s.discount);
  const scSales = sum(own.filter(isSC), s => s.total) - sum(ref.filter(isSC), s => s.total);
  const byMethod = {};
  own.forEach(s => byMethod[s.method] = (byMethod[s.method] || 0) + (+s.total || 0));
  ref.forEach(s => byMethod[s.method] = (byMethod[s.method] || 0) - (+s.total || 0));
  return {
    from, to, deviceId,
    begNo: own.length ? own[0].no : '', endNo: own.length ? own[own.length - 1].no : '',
    count: own.length, refundCount: ref.length,
    gross, discounts, scDiscount, otherDiscount: discounts - scDiscount, refunds,
    net: gross - discounts - refunds, scSales, byMethod
  };
}
export function vatSplit(z, vatRegistered) {
  if (!vatRegistered) return null;
  const exempt = Math.max(0, z.scSales || 0), base = z.net - exempt, vatable = base / 1.12;
  return { vatable, vat: base - vatable, exempt };
}

/* On-screen paper version (same look as the receipt). */
export function zHTML(z, st, kind = 'Z') {
  const v = vatSplit(z, st.vatRegistered);
  const row = (k, val, b) => `<div class="row"${b ? ' style="font-weight:900"' : ''}><span>${k}</span><span>${val}</span></div>`;
  return `<div class="receipt">
    <div class="c" style="font-weight:900;font-size:14px;color:#2A0A0C">${esc(st.regName || st.storeName)}</div>
    ${st.address ? `<div class="c">${esc(st.address)}</div>` : ''}
    ${st.tin ? `<div class="c">TIN ${esc(st.tin)} · ${st.vatRegistered ? 'VAT REG' : 'NON-VAT'}</div>` : ''}
    <div class="on" style="font-size:24px;margin-top:6px">${kind === 'Z' ? 'Z-READING' : 'X-READING'}</div>
    <div class="c">${kind === 'Z' ? `Z No. ${String(z.zNo).padStart(4, '0')} · ` : ''}Device ${esc((z.deviceId || '').toUpperCase())}</div>
    <div class="c">${fmtDT(z.from || z.to)} – ${fmtDT(z.to)}</div><hr>
    ${row('Beginning receipt', esc(z.begNo || '—'))}${row('Ending receipt', esc(z.endNo || '—'))}
    ${row('Sales transactions', z.count)}${row('Refund transactions', z.refundCount)}<hr>
    ${row('Gross sales', peso(z.gross))}
    ${row('Less: Senior/PWD discount', peso(z.scDiscount))}${row('Less: Other discounts', peso(z.otherDiscount))}
    ${row('Less: Refunds', peso(z.refunds))}${row('NET SALES', peso(z.net), true)}
    ${v ? `<hr>${row('VATable sales', peso(v.vatable))}${row('VAT (12%)', peso(v.vat))}${row('VAT-exempt sales', peso(v.exempt))}` : ''}
    <hr>${Object.entries(z.byMethod || {}).map(([m, a]) => row(esc(m), peso(a))).join('') || row('Payments', peso(0))}
    <hr>${row('Beginning accumulated sales', peso(z.begGT || 0))}${row('Ending accumulated sales', peso(z.endGT || 0), true)}
    <hr><div class="c">${kind === 'Z' ? 'Generated' : 'Printed'} ${fmtDT(z.createdAt || Date.now())}${z.by ? ' · ' + esc(z.by) : ''}</div>
    ${st.showNotice !== false && st.receiptNotice ? `<div class="c" style="font-weight:900">${esc(st.receiptNotice)}</div>` : ''}
  </div>`;
}
