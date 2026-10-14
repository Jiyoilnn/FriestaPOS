// Small helpers shared by Friesta POS and Friesta Back Office.

export const $ = id => document.getElementById(id);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
export const r2 = n => Math.round((+n || 0) * 100) / 100;
export const pad3 = n => String(n || 0).padStart(3, '0');
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export const peso = n => (n < 0 ? '−' : '') + '₱' + Math.abs(r2(n)).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const peso0 = n => '₱' + (+n || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 });
export const pesoShort = n => {
  const a = Math.abs(n);
  if (a >= 1e6) return '₱' + (n / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
  if (a >= 1e3) return '₱' + (n / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k';
  return '₱' + Math.round(n);
};

/* ---------- dates (local time, Asia/Manila on the device) ---------- */
export const dayStart = (t = Date.now()) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
export const addDays = (t, n) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime(); };
export const addMonths = (t, n) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime(); };
export const monthStart = t => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); };
export const weekStart = t => { const d = new Date(dayStart(t)); const wd = (d.getDay() + 6) % 7; return addDays(d.getTime(), -wd); }; // Monday
export const daysBetween = (a, b) => Math.round((dayStart(b) - dayStart(a)) / 864e5);
export const fmtTime = ts => new Date(ts).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
export const fmtDate = ts => new Date(ts).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
export const fmtDay = ts => new Date(ts).toLocaleDateString('en-PH', { day: 'numeric', month: 'short' });
export const fmtDT = ts => new Date(ts).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
export const isoDate = ts => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/* ---------- storage ---------- */
export const lsGet = k => { try { return JSON.parse(localStorage.getItem('friesta:' + k) || 'null'); } catch (e) { return null; } };
export const lsSet = (k, v) => { try { if (v === null || v === undefined) localStorage.removeItem('friesta:' + k); else localStorage.setItem('friesta:' + k, JSON.stringify(v)); return true; } catch (e) { return false; } };

/* ---------- crypto ---------- */
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
export const randomHex = (n = 16) => hex(crypto.getRandomValues(new Uint8Array(n)));
export async function sha256(str) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))); }
export async function pbkdf2(password, saltHex, iterations = 150000) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/../g).map(h => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

/* ---------- files ---------- */
export function toCSV(rows) {
  return '﻿' + rows.map(r => r.map(v => { const x = String(v ?? ''); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; }).join(',')).join('\n');
}
export function download(filename, text, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ---------- UI: toast, modal, two-tap confirm ---------- */
let toastTimer;
export function toast(msg, opt = {}) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.innerHTML = esc(msg) + (opt.action ? ` <button type="button">${esc(opt.action)}</button>` : '');
  if (opt.action) t.querySelector('button').addEventListener('click', () => { t.remove(); opt.onAction && opt.onAction(); });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), opt.ms || (opt.action ? 8000 : 2600));
}

export const Modal = { onKey: null };
export function modal(html, opts = {}) {
  let root = $('modalroot');
  if (!root) { root = document.createElement('div'); root.id = 'modalroot'; document.body.appendChild(root); }
  Modal.onKey = null;
  root.innerHTML = `<div class="scrim${opts.sheet ? ' sheet' : ''}" id="scrim"><div class="modal${opts.wide ? ' wide' : ''}${opts.cls ? ' ' + opts.cls : ''}" role="dialog" aria-modal="true">${html}</div></div>`;
  if (!opts.locked) $('scrim').addEventListener('click', e => { if (e.target.id === 'scrim') closeModal(); });
  root.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeModal));
  if (opts.focus) { const f = root.querySelector(opts.focus); if (f) setTimeout(() => f.focus(), 40); }
  return root.querySelector('.modal');
}
export function closeModal() { const r = $('modalroot'); if (r) r.innerHTML = ''; Modal.onKey = null; }
export const modalOpen = () => { const r = $('modalroot'); return !!(r && r.firstChild); };
export const head = (title, sub) => `<div class="mh"><div><h3>${title}</h3>${sub ? `<div class="sub">${sub}</div>` : ''}</div><button class="x" data-close aria-label="Close">${ICON.x}</button></div>`;
export function armed(btn, label) {
  if (btn.dataset.armed === '1') return true;
  btn.dataset.armed = '1'; const o = btn.innerHTML; btn.textContent = label;
  setTimeout(() => { if (btn.isConnected && btn.dataset.armed === '1') { btn.dataset.armed = ''; btn.innerHTML = o; } }, 3500);
  return false;
}

/* ---------- icons ---------- */
const svg = (d, s = 22) => `<svg class="ic" viewBox="0 0 24 24" style="width:${s}px;height:${s}px">${d}</svg>`;
export const ICON = {
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  check: svg('<path d="m5 12 5 5 9-10"/>', 40),
  back: svg('<path d="m15 18-6-6 6-6"/>'),
  next: svg('<path d="m9 18 6-6-6-6"/>'),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', 20),
  cart: svg('<path d="M3 4h2l2.4 11h11L21 7H6.2"/><circle cx="9" cy="19.5" r="1.5"/><circle cx="17" cy="19.5" r="1.5"/>'),
  receipt: svg('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'),
  grid: svg('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'),
  chart: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  cash: svg('<rect x="3" y="7" width="18" height="12" rx="2"/><circle cx="12" cy="13" r="2.5"/><path d="M7 4h10"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  office: svg('<path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M8 8h3M8 12h3M8 16h3M3 21h18"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  users: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>'),
  tag: svg('<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  ticket: svg('<path d="M4 7h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4z"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  menu: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  cal: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  down: svg('<path d="m6 9 6 6 6-6"/>', 18),
  cloud: svg('<path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 8z"/>'),
  logout: svg('<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>'),
  backspace: svg('<path d="M21 5H9l-6 7 6 7h12z"/><path d="m12 9 6 6M18 9l-6 6"/>'),
  percent: svg('<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>', 16),
  printer: svg('<path d="M6 9V3h12v6M6 18H4v-7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7h-2"/><rect x="6" y="14" width="12" height="7"/>'),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>', 18),
  box: svg('<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>')
};

/* ---------- app shell helpers ---------- */
export function registerSW(path = 'sw.js') {
  if (!('serviceWorker' in navigator) || !/^https:|^http:\/\/localhost/.test(location.href)) return;
  navigator.serviceWorker.register(path).then(reg => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing; if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('May bagong version ng app.', { action: 'I-reload', ms: 20000, onAction: () => location.reload() });
        }
      });
    });
  }).catch(() => {});
}
export function catchErrors() {
  let last = 0;
  const show = e => { console.error(e); if (Date.now() - last > 5000) { last = Date.now(); toast('May error na naayos. Kung may kakaiba, i-reload ang app.'); } };
  window.addEventListener('error', e => show(e.error || e.message));
  window.addEventListener('unhandledrejection', e => show(e.reason));
}
export function keepAwake() {
  let lock = null;
  const wake = async () => { try { if (navigator.wakeLock && document.visibilityState === 'visible' && !lock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => lock = null); } } catch (e) {} };
  document.addEventListener('visibilitychange', wake);
  document.addEventListener('click', wake, { once: true });
}
