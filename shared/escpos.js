// Bluetooth (BLE) thermal receipt printer — ESC/POS.
// Works in Chrome on Android, Windows, macOS and ChromeOS (Web Bluetooth).

import { lsGet, lsSet, sleep, peso, pad3, fmtDT, fmtTime } from './util.js';
import { vatSplit } from './zreport.js';

const SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', '0000ff00-0000-1000-8000-00805f9b34fb', '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000fee7-0000-1000-8000-00805f9b34fb', '0000ae30-0000-1000-8000-00805f9b34fb', '0000ae00-0000-1000-8000-00805f9b34fb',
  '0000af30-0000-1000-8000-00805f9b34fb', '49535343-fe7d-4ae5-8fa9-9fafd205e455', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '0000ff12-0000-1000-8000-00805f9b34fb'
];
const CFG_DEFAULT = { paper: 58, logo: true, auto: true, kitchen: false };
export const printerCfg = () => ({ ...CFG_DEFAULT, ...(lsGet('printer') || {}) });
export const savePrinterCfg = c => lsSet('printer', c);
export const canPrint = () => !!navigator.bluetooth;

async function findWritable(server) {
  for (const s of await server.getPrimaryServices()) {
    try { for (const c of await s.getCharacteristics()) if (c.properties.write || c.properties.writeWithoutResponse) return c; } catch (e) {}
  }
  return null;
}

export const Printer = {
  dev: null, ch: null, name: lsGet('printerName') || '', q: Promise.resolve(), onChange: () => {},
  get connected() { return !!(this.ch && this.dev && this.dev.gatt.connected); },
  async pick() {
    const dev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERVICES });
    await this.attach(dev);
  },
  async attach(dev) {
    this.dev = dev;
    dev.addEventListener('gattserverdisconnected', () => { this.ch = null; this.onChange(); });
    this.ch = await findWritable(await dev.gatt.connect());
    if (!this.ch) { try { dev.gatt.disconnect(); } catch (e) {} throw { code: 'not-a-printer' }; }
    this.name = dev.name || 'Bluetooth printer';
    lsSet('printerId', dev.id); lsSet('printerName', this.name);
    this.onChange();
  },
  async ready() {
    if (this.connected) return true;
    if (this.dev) { try { this.ch = await findWritable(await this.dev.gatt.connect()); this.onChange(); return !!this.ch; } catch (e) { return false; } }
    if (navigator.bluetooth && navigator.bluetooth.getDevices) {
      try { const d = (await navigator.bluetooth.getDevices()).find(x => x.id === lsGet('printerId')); if (d) { await this.attach(d); return true; } } catch (e) {}
    }
    return false;
  },
  forget() { try { this.dev && this.dev.gatt.disconnect(); } catch (e) {} this.dev = null; this.ch = null; this.name = ''; lsSet('printerId', null); lsSet('printerName', null); this.onChange(); },
  write(bytes) {
    const job = this.q.then(async () => {
      const c = this.ch; if (!c) throw { code: 'no-printer' };
      const withResp = !!c.properties.write;
      let size = lsGet('bleChunk') || (withResp ? 180 : 100), i = 0;
      while (i < bytes.length) {
        const part = bytes.slice(i, i + size);
        try {
          if (withResp) await (c.writeValueWithResponse ? c.writeValueWithResponse(part) : c.writeValue(part));
          else { await c.writeValueWithoutResponse(part); await sleep(14); }
          i += part.length;
        } catch (e) { if (size > 20) { size = 20; lsSet('bleChunk', 20); } else throw e; }
      }
    });
    this.q = job.catch(() => {});
    return job;
  }
};

/* ---------- text + layout ---------- */
const asc = s => String(s ?? '').replace(/₱/g, 'P').replace(/−/g, '-').replace(/[–—]/g, '-').replace(/×/g, 'x').replace(/↳/g, '>')
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/·/g, '|').replace(/…/g, '...').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '?');
function wrap(s, w) {
  const out = []; let cur = '';
  asc(s).split(/\s+/).filter(Boolean).forEach(word => {
    while (word.length > w) { if (cur) { out.push(cur); cur = ''; } out.push(word.slice(0, w)); word = word.slice(w); }
    if (!cur) cur = word; else if ((cur + ' ' + word).length <= w) cur += ' ' + word; else { out.push(cur); cur = word; }
  });
  if (cur) out.push(cur); return out.length ? out : [''];
}
class Esc {
  constructor(cols) { this.b = []; this.cols = cols; this.raw([0x1b, 0x40, 0x1b, 0x74, 0x00]); }
  raw(a) { for (const x of a) this.b.push(x); return this; }
  text(s) { const t = asc(s); for (let i = 0; i < t.length; i++) this.b.push(t.charCodeAt(i)); return this; }
  line(s = '') { return this.text(s).raw([0x0a]); }
  align(n) { return this.raw([0x1b, 0x61, n]); }
  bold(on) { return this.raw([0x1b, 0x45, on ? 1 : 0]); }
  size(w, h) { return this.raw([0x1d, 0x21, ((w - 1) << 4) | (h - 1)]); }
  wrapped(s) { wrap(s, this.cols).forEach(l => this.line(l)); return this; }
  lr(l, r) { r = asc(r); const w = Math.max(8, this.cols - r.length - 1); wrap(l, w).forEach((p, i) => this.line(i === 0 ? p.padEnd(this.cols - r.length) + r : '  ' + p)); return this; }
  hr() { return this.line('-'.repeat(this.cols)); }
  feed(n) { return this.raw([0x1b, 0x64, n]); }
  cut() { return this.raw([0x1d, 0x56, 0x42, 0x00]); }
  raster(img) {
    const bpr = img.w / 8;
    for (let y = 0; y < img.h; y += 48) {
      const h = Math.min(48, img.h - y);
      this.raw([0x1d, 0x76, 0x30, 0x00, bpr & 0xff, (bpr >> 8) & 0xff, h & 0xff, (h >> 8) & 0xff]);
      this.raw(img.data.subarray(y * bpr, (y + h) * bpr));
    }
    return this;
  }
  bytes() { return new Uint8Array(this.b); }
}

let logoImg = null; const rasterCache = {};
export function setLogo(img) { logoImg = img; }
function logoRaster(paper) {
  if (rasterCache[paper]) return rasterCache[paper];
  if (!logoImg || !logoImg.naturalWidth) return null;
  const dots = paper === 80 ? 576 : 384, w = Math.floor(dots * 0.72 / 8) * 8, h = Math.round(w * logoImg.naturalHeight / logoImg.naturalWidth);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(logoImg, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data, bpr = w / 8, data = new Uint8Array(bpr * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; if (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2] < 150) data[y * bpr + (x >> 3)] |= (0x80 >> (x & 7));
  }
  return rasterCache[paper] = { w, h, data };
}

export function receiptBytes(s, settings, cfg = printerCfg()) {
  const e = new Esc(cfg.paper === 80 ? 48 : 32);
  e.align(1);
  const logo = cfg.logo ? logoRaster(cfg.paper) : null;
  if (logo) e.raster(logo).line(); else e.bold(1).size(2, 2).line(settings.storeName).size(1, 1).bold(0);
  if (settings.regName && settings.regName !== settings.storeName) e.wrapped(settings.regName);
  if (settings.address) e.wrapped(settings.address);
  if (settings.tin) e.line('TIN ' + settings.tin + (settings.vatRegistered ? ' VAT REG' : ' NON-VAT'));
  e.line().line('ORDER').bold(1).size(2, 2).line('#' + pad3(s.orderNo)).size(1, 1).bold(0);
  const sub = [s.orderType, s.name].filter(Boolean).join(' - '); if (sub) e.line(sub);
  e.line(fmtDT(s.ts));
  if (s.employeeName) e.line('Cashier: ' + s.employeeName);
  e.align(0).hr();
  (s.lines || []).forEach(l => { e.lr(`${l.qty} x ${l.name}${l.variant ? ' (' + l.variant + ')' : ''}`, peso(l.price * l.qty)); if (l.note) e.wrapped('   > ' + l.note); });
  e.hr().lr('Subtotal', peso(s.subtotal));
  if (s.discount) e.lr(s.discountLabel || 'Discount', '-' + peso(s.discount));
  e.bold(1).size(1, 2).lr('TOTAL', peso(s.total)).size(1, 1).bold(0);
  e.lr(s.method + (s.ref ? ' Ref ' + s.ref : ''), peso(s.tendered));
  if (s.method === 'Cash') e.lr('Change', peso(s.change));
  if (s.status === 'refunded') e.align(1).bold(1).line('*** REFUNDED ***').bold(0).align(0);
  e.hr().align(1);
  if (settings.footer) e.wrapped(settings.footer);
  e.line('Receipt ' + s.no);
  if (settings.showNotice !== false && settings.receiptNotice) e.bold(1).wrapped(settings.receiptNotice).bold(0);
  e.feed(4).cut();
  return e.bytes();
}
export function kitchenBytes(s, cfg = printerCfg()) {
  const e = new Esc(cfg.paper === 80 ? 48 : 32);
  e.align(1).bold(1).line('KITCHEN').size(2, 2).line('#' + pad3(s.orderNo)).size(1, 1);
  const sub = [s.orderType, s.name].filter(Boolean).join(' - '); if (sub) e.line(sub);
  e.bold(0).line(fmtTime(s.ts)).align(0).hr();
  (s.lines || []).forEach(l => { e.bold(1).size(1, 2).wrapped(`${l.qty} x ${l.name}${l.variant ? ' (' + l.variant + ')' : ''}`).size(1, 1); if (l.note) e.wrapped('  >> ' + l.note); e.bold(0); });
  return e.hr().feed(4).cut().bytes();
}
export function testBytes(settings, cfg = printerCfg()) {
  const e = new Esc(cfg.paper === 80 ? 48 : 32); e.align(1);
  const logo = cfg.logo ? logoRaster(cfg.paper) : null; if (logo) e.raster(logo).line();
  e.bold(1).line('Printer connected!').bold(0).line(settings.storeName + ' POS').line(fmtDT(Date.now())).align(0).hr();
  e.line('1234567890'.repeat(5).slice(0, e.cols)).lr('Left', 'Right').lr('Sample item', 'P99.00');
  return e.hr().feed(4).cut().bytes();
}

export function zBytes(z, settings, kind = 'Z', cfg = printerCfg()) {
  const e = new Esc(cfg.paper === 80 ? 48 : 32), v = vatSplit(z, settings.vatRegistered);
  e.align(1).bold(1).wrapped(settings.regName || settings.storeName).bold(0);
  if (settings.address) e.wrapped(settings.address);
  if (settings.tin) e.line('TIN ' + settings.tin + (settings.vatRegistered ? ' VAT REG' : ' NON-VAT'));
  e.line().bold(1).size(2, 2).line(kind === 'Z' ? 'Z-READING' : 'X-READING').size(1, 1).bold(0);
  if (kind === 'Z') e.line('Z No. ' + String(z.zNo).padStart(4, '0'));
  e.line('Device ' + (z.deviceId || '').toUpperCase()).line(fmtDT(z.from || z.to)).line('to ' + fmtDT(z.to)).align(0).hr();
  e.lr('Beginning receipt', z.begNo || '-').lr('Ending receipt', z.endNo || '-').lr('Sales transactions', String(z.count)).lr('Refund transactions', String(z.refundCount)).hr();
  e.lr('Gross sales', peso(z.gross)).lr('Less: Senior/PWD disc.', peso(z.scDiscount)).lr('Less: Other discounts', peso(z.otherDiscount)).lr('Less: Refunds', peso(z.refunds));
  e.bold(1).lr('NET SALES', peso(z.net)).bold(0);
  if (v) e.hr().lr('VATable sales', peso(v.vatable)).lr('VAT (12%)', peso(v.vat)).lr('VAT-exempt sales', peso(v.exempt));
  e.hr(); Object.entries(z.byMethod || {}).forEach(([m, a]) => e.lr(m, peso(a)));
  e.hr().lr('Beg. accumulated sales', peso(z.begGT || 0)).bold(1).lr('End accumulated sales', peso(z.endGT || 0)).bold(0).hr();
  e.align(1).line((kind === 'Z' ? 'Generated ' : 'Printed ') + fmtDT(z.createdAt || Date.now()));
  if (z.by) e.line(z.by);
  if (settings.showNotice !== false && settings.receiptNotice) e.bold(1).wrapped(settings.receiptNotice).bold(0);
  return e.feed(4).cut().bytes();
}
