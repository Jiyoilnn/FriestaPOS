// Friesta data store.
//
// Two backends behind one API:
//  - local: IndexedDB on this device (default, fully offline). POS and Back Office
//    opened on the same device/site share the same data, live, across tabs.
//  - cloud: Firebase Auth + Firestore with offline cache (when shared/config.js
//    has a FIREBASE_CONFIG). Works offline too; syncs when the internet is back.
//
// Accounts: one owner account per store (email + password) signs a device in.
// Employees unlock the POS with a 4-digit PIN.

import { FIREBASE_CONFIG, FIREBASE_VERSION } from './config.js';
import { uid, randomHex, pbkdf2, sha256, lsGet, lsSet, sleep } from './util.js';

export const COLS = ['items', 'sales', 'shifts', 'tickets', 'employees', 'discounts'];
export const DEFAULT_SETTINGS = {
  storeName: 'Friesta', address: '', footer: 'Salamat po! Balik kayo sa Friesta.',
  askOrderType: true, defaultOrderType: 'Take-out', requireShift: false,
  refundNeedsManager: true, autoLockMin: 0, pinSalt: ''
};
export const DEFAULT_DISCOUNTS = [
  { id: 'd-promo10', name: 'Promo 10%', type: 'pct', value: 10 },
  { id: 'd-spwd', name: 'Senior/PWD 20%', type: 'pct', value: 20 }
];
const V = (name, price, cost) => ({ name, price, cost });
export const STARTER_ITEMS = [
  { name: 'Classic Salted Fries', category: 'Fries', color: 0, variants: [V('Regular', 59, 22), V('Large', 89, 33), V('Barkada', 149, 55)] },
  { name: 'Cheese Fries', category: 'Flavored', color: 1, variants: [V('Regular', 69, 26), V('Large', 99, 38), V('Barkada', 169, 64)] },
  { name: 'Sour Cream Fries', category: 'Flavored', color: 4, variants: [V('Regular', 69, 26), V('Large', 99, 38), V('Barkada', 169, 64)] },
  { name: 'BBQ Fries', category: 'Flavored', color: 2, variants: [V('Regular', 69, 26), V('Large', 99, 38), V('Barkada', 169, 64)] },
  { name: 'Fries + Iced Tea Combo', category: 'Combos', color: 6, price: 89, cost: 34, variants: [] },
  { name: 'Extra Cheese Dip', category: 'Add-ons', color: 3, price: 20, cost: 7, variants: [] },
  { name: 'Garlic Mayo Dip', category: 'Add-ons', color: 3, price: 20, cost: 6, variants: [] },
  { name: 'Iced Tea', category: 'Drinks', color: 5, variants: [V('Regular', 35, 9), V('Large', 45, 12)] },
  { name: 'Bottled Water', category: 'Drinks', color: 5, price: 20, cost: 11, variants: [] }
];

const sorters = {
  sales: (a, b) => b.ts - a.ts,
  shifts: (a, b) => b.openedAt - a.openedAt,
  tickets: (a, b) => a.ts - b.ts,
  items: (a, b) => (a.category || '').localeCompare(b.category || '') || (a.name || '').localeCompare(b.name || ''),
  employees: (a, b) => (a.createdAt || 0) - (b.createdAt || 0),
  discounts: (a, b) => (a.name || '').localeCompare(b.name || '')
};
const clean = o => JSON.parse(JSON.stringify(o));
const stripId = ({ id, ...rest }) => clean(rest);

/* ---------------- change events ---------------- */
const listeners = new Set();
let pending = new Set(), queued = false;
function emit(what) {
  pending.add(what);
  if (queued) return; queued = true;
  queueMicrotask(() => { const ch = pending; pending = new Set(); queued = false; listeners.forEach(fn => { try { fn(ch); } catch (e) { console.error(e); } }); });
}

/* ---------------- Store (public API) ---------------- */
export const Store = {
  mode: FIREBASE_CONFIG ? 'cloud' : 'local',
  status: 'loading', // loading | needs-setup | signed-out | ready | cloud-unavailable
  online: navigator.onLine,
  data: { items: [], sales: [], shifts: [], tickets: [], employees: [], discounts: [] },
  settings: { ...DEFAULT_SETTINGS },
  account: null,
  onError: e => console.error(e),
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  async init() {
    addEventListener('online', () => { Store.online = true; emit('net'); });
    addEventListener('offline', () => { Store.online = false; emit('net'); });
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
    if (Store.mode === 'cloud') await Cloud.init(); else await Local.init();
    emit('status');
    return Store.status;
  },

  /* ----- accounts ----- */
  createAccount: a => B().createAccount(a),
  signIn: (email, pw) => B().signIn(email, pw),
  signOut: () => B().signOut(),
  changePassword: (oldPw, newPw) => B().changePassword(oldPw, newPw),
  resetPassword: (email, pin, newPw) => B().resetPassword(email, pin, newPw),

  async pinHash(pin) { return sha256(`friesta-pin:${Store.settings.pinSalt || 'friesta'}:${pin}`); },
  async employeeByPin(pin) {
    const h = await Store.pinHash(pin);
    return Store.data.employees.find(e => e.active !== false && e.pinHash === h) || null;
  },

  /* ----- data ----- */
  put: (col, obj) => B().put(col, clean(obj)),
  patch: (col, id, partial) => B().patch(col, id, clean(partial)),
  del: (col, id) => B().del(col, id),
  incr: (col, id, field, delta) => B().incr(col, id, field, delta),
  saveSettings: s => B().saveSettings(clean({ ...Store.settings, ...s })),
  watchSales: (from, to, cb) => B().watchSales(from, to ?? Infinity, cb),
  replaceAll: ds => B().replaceAll(ds),
  exportAll: () => B().exportAll()
};
const B = () => (Store.mode === 'cloud' ? Cloud : Local);

function applyPut(col, obj) {
  const a = Store.data[col]; const i = a.findIndex(x => x.id === obj.id);
  if (i >= 0) a[i] = obj; else a.push(obj);
  if (sorters[col]) a.sort(sorters[col]);
}
function applyDel(col, id) { Store.data[col] = Store.data[col].filter(x => x.id !== id); }
function resetMemory() { COLS.forEach(c => Store.data[c] = []); Store.settings = { ...DEFAULT_SETTINGS }; Store.account = null; }

/* Normalise a backup file (current format, or v1 from the first Friesta POS page). */
export function normaliseBackup(d) {
  if (!d || d.app !== 'friesta-pos' || !Array.isArray(d.items)) throw new Error('not-a-backup');
  const items = d.items.map(it => ({
    ...it,
    cost: +it.cost || 0,
    variants: (it.variants || []).map(v => ({ name: v.name, price: +v.price || 0, cost: +v.cost || 0 }))
  }));
  const sales = (d.sales || []).map(s => ({ employeeName: s.employeeName || '', ...s, lines: (s.lines || []).map(l => ({ cost: 0, ...l })) }));
  return {
    items, sales,
    shifts: d.shifts || [], tickets: d.tickets || [],
    employees: Array.isArray(d.employees) ? d.employees : null,
    discounts: Array.isArray(d.discounts) ? d.discounts : null,
    settings: d.settings || {}
  };
}

/* ======================================================================
   LOCAL BACKEND — IndexedDB, one object store per collection
   ====================================================================== */
const bc = 'BroadcastChannel' in self ? new BroadcastChannel('friesta-sync') : null;
const Local = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('friesta', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        COLS.forEach(c => { if (!db.objectStoreNames.contains(c)) db.createObjectStore(c, { keyPath: 'id' }); });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
      };
      r.onsuccess = () => { Local.db = r.result; Local.db.onversionchange = () => Local.db.close(); res(); };
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('blocked'));
    });
  },
  tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = Local.db.transaction(store, mode); let out;
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('abort'));
      out = fn(t.objectStore(store));
    });
  },
  getAll(store) { return new Promise((res, rej) => { const q = Local.db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); }); },
  get(store, id) { return new Promise((res, rej) => { const q = Local.db.transaction(store).objectStore(store).get(id); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },

  async init() {
    await Local.open();
    for (const c of COLS) { Store.data[c] = await Local.getAll(c); if (sorters[c]) Store.data[c].sort(sorters[c]); }
    const s = await Local.get('meta', 'settings');
    Store.settings = { ...DEFAULT_SETTINGS, ...(s ? stripId(s) : {}) };
    const acct = await Local.get('meta', 'account');
    Local.setStatus(acct);
    if (bc) bc.onmessage = e => Local.onRemote(e.data);
  },
  setStatus(acct) {
    const sess = lsGet('session');
    if (!acct) { Store.status = 'needs-setup'; Store.account = null; return; }
    Store.account = { uid: acct.uid, email: acct.email, name: acct.name, storeName: Store.settings.storeName };
    Store.status = sess && sess.uid === acct.uid ? 'ready' : 'signed-out';
  },
  async onRemote(m) {
    if (!m) return;
    if (m.op === 'put') { applyPut(m.col, m.obj); emit(m.col); }
    else if (m.op === 'del') { applyDel(m.col, m.id); emit(m.col); }
    else if (m.op === 'settings') { Store.settings = { ...DEFAULT_SETTINGS, ...m.settings }; emit('settings'); }
    else if (m.op === 'reload') { for (const c of COLS) { Store.data[c] = await Local.getAll(c); if (sorters[c]) Store.data[c].sort(sorters[c]); } const s = await Local.get('meta', 'settings'); Store.settings = { ...DEFAULT_SETTINGS, ...(s ? stripId(s) : {}) }; COLS.forEach(emit); emit('settings'); }
    else if (m.op === 'auth') { const before = Store.status; Local.setStatus(await Local.get('meta', 'account')); if (before !== Store.status) emit('status'); }
  },
  async put(col, obj) {
    await Local.tx(col, 'readwrite', s => s.put(obj));
    applyPut(col, obj); emit(col); bc && bc.postMessage({ op: 'put', col, obj });
  },
  async patch(col, id, partial) {
    const cur = Store.data[col].find(x => x.id === id) || await Local.get(col, id) || { id };
    await Local.put(col, { ...cur, ...partial, id });
  },
  async del(col, id) {
    await Local.tx(col, 'readwrite', s => s.delete(id));
    applyDel(col, id); emit(col); bc && bc.postMessage({ op: 'del', col, id });
  },
  async incr(col, id, field, delta) {
    const cur = await Local.get(col, id); if (!cur) return;
    await Local.put(col, { ...cur, [field]: (+cur[field] || 0) + delta });
  },
  async saveSettings(s) {
    await Local.tx('meta', 'readwrite', st => st.put({ ...s, id: 'settings' }));
    Store.settings = { ...DEFAULT_SETTINGS, ...s };
    if (Store.account) Store.account.storeName = Store.settings.storeName;
    emit('settings'); bc && bc.postMessage({ op: 'settings', settings: Store.settings });
  },
  watchSales(from, to, cb) {
    const run = () => cb(Store.data.sales.filter(s => (s.ts >= from && s.ts < to) || (s.refundedAt && s.refundedAt >= from && s.refundedAt < to)));
    run();
    return Store.on(ch => { if (ch.has('sales')) run(); });
  },

  /* accounts (stored on this device; password kept as a PBKDF2 hash) */
  async createAccount({ storeName, name, email, password, pin }) {
    if (await Local.get('meta', 'account')) throw { code: 'exists' };
    const salt = randomHex(16), acct = { id: 'account', uid: randomHex(8), email: email.trim().toLowerCase(), name: name.trim(), salt, iter: 150000, createdAt: Date.now() };
    acct.hash = await pbkdf2(password, salt, acct.iter);
    await Local.tx('meta', 'readwrite', s => s.put(acct));
    await Local.saveSettings({ ...Store.settings, storeName: storeName.trim() || 'Friesta', pinSalt: randomHex(8) });
    await Local.put('employees', { id: uid(), name: name.trim(), role: 'owner', pinHash: await Store.pinHash(pin), active: true, createdAt: Date.now() });
    if (!Store.data.discounts.length) for (const d of DEFAULT_DISCOUNTS) await Local.put('discounts', d);
    lsSet('session', { uid: acct.uid, at: Date.now() });
    Local.setStatus(acct); emit('status'); bc && bc.postMessage({ op: 'auth' });
  },
  async signIn(email, password) {
    const acct = await Local.get('meta', 'account');
    if (!acct) throw { code: 'no-account' };
    if (acct.email !== email.trim().toLowerCase() || await pbkdf2(password, acct.salt, acct.iter) !== acct.hash) throw { code: 'wrong-password' };
    lsSet('session', { uid: acct.uid, at: Date.now() });
    Local.setStatus(acct); emit('status'); bc && bc.postMessage({ op: 'auth' });
  },
  async signOut() {
    lsSet('session', null); Local.setStatus(await Local.get('meta', 'account')); emit('status'); bc && bc.postMessage({ op: 'auth' });
  },
  async changePassword(oldPw, newPw) {
    const acct = await Local.get('meta', 'account');
    if (await pbkdf2(oldPw, acct.salt, acct.iter) !== acct.hash) throw { code: 'wrong-password' };
    acct.salt = randomHex(16); acct.hash = await pbkdf2(newPw, acct.salt, acct.iter);
    await Local.tx('meta', 'readwrite', s => s.put(acct));
  },
  async resetPassword(email, pin, newPw) {
    const acct = await Local.get('meta', 'account');
    if (!acct || acct.email !== email.trim().toLowerCase()) throw { code: 'no-account' };
    const emp = await Store.employeeByPin(pin);
    if (!emp || emp.role !== 'owner') throw { code: 'wrong-pin' };
    acct.salt = randomHex(16); acct.hash = await pbkdf2(newPw, acct.salt, acct.iter);
    await Local.tx('meta', 'readwrite', s => s.put(acct));
    await Local.signIn(email, newPw);
  },
  async exportAll() {
    const out = {}; for (const c of COLS) out[c] = await Local.getAll(c);
    return { ...out, settings: Store.settings };
  },
  async replaceAll(ds) {
    for (const c of COLS) {
      const arr = ds[c]; if (!arr) continue; // keep current employees/discounts if the backup has none
      await Local.tx(c, 'readwrite', s => { s.clear(); arr.forEach(o => s.put(o)); });
    }
    await Local.saveSettings({ ...Store.settings, ...ds.settings, pinSalt: ds.employees ? (ds.settings.pinSalt || Store.settings.pinSalt) : Store.settings.pinSalt });
    for (const c of COLS) { Store.data[c] = await Local.getAll(c); if (sorters[c]) Store.data[c].sort(sorters[c]); emit(c); }
    bc && bc.postMessage({ op: 'reload' });
  }
};

/* ======================================================================
   CLOUD BACKEND — Firebase Auth + Firestore (offline-capable)
   Data lives at stores/{ownerUid}/{collection}/{id}
   ====================================================================== */
let fb = null, cloudUid = null;
const unsubs = [];
const Cloud = {
  async load() {
    if (fb) return;
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/`;
    const [A, Au, Fs] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]);
    const app = A.initializeApp(FIREBASE_CONFIG);
    const auth = Au.getAuth(app);
    let fs;
    try { fs = Fs.initializeFirestore(app, { localCache: Fs.persistentLocalCache({ tabManager: Fs.persistentMultipleTabManager() }) }); }
    catch (e) { fs = Fs.getFirestore(app); }
    fb = { app, auth, fs, Au, Fs };
  },
  ref(...p) { return fb.Fs.doc(fb.fs, 'stores', cloudUid, ...p); },
  col(c) { return fb.Fs.collection(fb.fs, 'stores', cloudUid, c); },
  fail(e) { Store.onError(e); },

  async init() {
    try { await Cloud.load(); }
    catch (e) { Store.status = 'cloud-unavailable'; return; }
    await new Promise(res => {
      let first = true;
      fb.Au.onAuthStateChanged(fb.auth, async user => {
        if (user) await Cloud.attach(user);
        else { Cloud.detach(); Store.status = 'signed-out'; }
        if (first) { first = false; res(); } else emit('status');
      });
    });
  },
  async attach(user) {
    Cloud.detach();
    cloudUid = user.uid;
    Store.account = { uid: user.uid, email: user.email, name: '', storeName: '' };
    const { onSnapshot, query, orderBy, limit } = fb.Fs;
    const firsts = [];
    const watch = (c, q) => firsts.push(new Promise(res => {
      unsubs.push(onSnapshot(q, s => {
        Store.data[c] = s.docs.map(d => ({ id: d.id, ...d.data() }));
        if (sorters[c]) Store.data[c].sort(sorters[c]);
        emit(c); res();
      }, e => { Cloud.fail(e); res(); }));
    }));
    ['items', 'employees', 'discounts', 'tickets'].forEach(c => watch(c, Cloud.col(c)));
    watch('shifts', query(Cloud.col('shifts'), orderBy('openedAt', 'desc'), limit(150)));
    firsts.push(new Promise(res => {
      unsubs.push(onSnapshot(Cloud.ref('meta', 'settings'), s => {
        Store.settings = { ...DEFAULT_SETTINGS, ...(s.exists() ? s.data() : {}) };
        Store.account.storeName = Store.settings.storeName; Store.account.name = Store.settings.ownerName || '';
        emit('settings'); res();
      }, e => { Cloud.fail(e); res(); }));
    }));
    await Promise.race([Promise.all(firsts), sleep(8000)]);
    Store.status = 'ready';
  },
  detach() { while (unsubs.length) { try { unsubs.pop()(); } catch (e) {} } resetMemory(); },
  // Writes go to the offline cache at once and sync in the background.
  write(p) { p.catch(Cloud.fail); return Promise.resolve(); },
  put(col, obj) { return Cloud.write(fb.Fs.setDoc(Cloud.ref(col, obj.id), stripId(obj))); },
  patch(col, id, partial) { return Cloud.write(fb.Fs.setDoc(Cloud.ref(col, id), partial, { merge: true })); },
  del(col, id) { return Cloud.write(fb.Fs.deleteDoc(Cloud.ref(col, id))); },
  incr(col, id, field, delta) { return Cloud.write(fb.Fs.updateDoc(Cloud.ref(col, id), { [field]: fb.Fs.increment(delta) })); },
  saveSettings(s) { return Cloud.write(fb.Fs.setDoc(Cloud.ref('meta', 'settings'), s, { merge: true })); },
  watchSales(from, to, cb) {
    const { onSnapshot, query, where } = fb.Fs; const col = Cloud.col('sales');
    const range = f => to === Infinity ? query(col, where(f, '>=', from)) : query(col, where(f, '>=', from), where(f, '<', to));
    const a = new Map(), b = new Map();
    const fire = () => cb([...new Map([...b, ...a]).values()].sort(sorters.sales));
    const u1 = onSnapshot(range('ts'), s => { a.clear(); s.forEach(d => a.set(d.id, { id: d.id, ...d.data() })); fire(); }, Cloud.fail);
    const u2 = onSnapshot(range('refundedAt'), s => { b.clear(); s.forEach(d => b.set(d.id, { id: d.id, ...d.data() })); fire(); }, Cloud.fail);
    return () => { u1(); u2(); };
  },
  authError(e) {
    const c = (e && e.code) || '';
    if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(c)) return { code: 'wrong-password' };
    if (/email-already-in-use/.test(c)) return { code: 'exists' };
    if (/weak-password/.test(c)) return { code: 'weak-password' };
    if (/invalid-email/.test(c)) return { code: 'invalid-email' };
    if (/network/.test(c)) return { code: 'offline' };
    if (/too-many-requests/.test(c)) return { code: 'too-many' };
    return { code: c || 'unknown' };
  },
  async createAccount({ storeName, name, email, password, pin }) {
    let cred;
    try { cred = await fb.Au.createUserWithEmailAndPassword(fb.auth, email.trim(), password); } catch (e) { throw Cloud.authError(e); }
    cloudUid = cred.user.uid;
    const settings = { ...DEFAULT_SETTINGS, storeName: storeName.trim() || 'Friesta', ownerName: name.trim(), pinSalt: randomHex(8) };
    const { writeBatch } = fb.Fs; const batch = writeBatch(fb.fs);
    batch.set(Cloud.ref('meta', 'settings'), settings);
    const ownerId = uid();
    const pinHash = await sha256(`friesta-pin:${settings.pinSalt}:${pin}`);
    batch.set(Cloud.ref('employees', ownerId), { name: name.trim(), role: 'owner', pinHash, active: true, createdAt: Date.now() });
    DEFAULT_DISCOUNTS.forEach(d => batch.set(Cloud.ref('discounts', d.id), stripId(d)));
    await batch.commit();
    await Cloud.attach(cred.user); emit('status');
  },
  async signIn(email, password) {
    try { await fb.Au.signInWithEmailAndPassword(fb.auth, email.trim(), password); } catch (e) { throw Cloud.authError(e); }
    // onAuthStateChanged attaches the store
    for (let i = 0; i < 100 && Store.status !== 'ready'; i++) await sleep(100);
  },
  async signOut() { await fb.Au.signOut(fb.auth); },
  async changePassword(oldPw, newPw) {
    const u = fb.auth.currentUser;
    try {
      await fb.Au.reauthenticateWithCredential(u, fb.Au.EmailAuthProvider.credential(u.email, oldPw));
      await fb.Au.updatePassword(u, newPw);
    } catch (e) { throw Cloud.authError(e); }
  },
  async resetPassword(email) {
    try { await fb.Au.sendPasswordResetEmail(fb.auth, email.trim()); } catch (e) { throw Cloud.authError(e); }
    return 'email-sent';
  },
  async exportAll() {
    const out = {};
    for (const c of COLS) { const s = await fb.Fs.getDocs(Cloud.col(c)); out[c] = s.docs.map(d => ({ id: d.id, ...d.data() })); }
    return { ...out, settings: Store.settings };
  },
  async replaceAll(ds) {
    // Cloud restore merges: records in the backup are written; nothing is deleted.
    const writes = [];
    COLS.forEach(c => (ds[c] || []).forEach(o => writes.push([Cloud.ref(c, o.id), stripId(o)])));
    writes.push([Cloud.ref('meta', 'settings'), { ...Store.settings, ...ds.settings, pinSalt: ds.employees ? (ds.settings.pinSalt || Store.settings.pinSalt) : Store.settings.pinSalt }]);
    for (let i = 0; i < writes.length; i += 400) {
      const batch = fb.Fs.writeBatch(fb.fs);
      writes.slice(i, i + 400).forEach(([r, d]) => batch.set(r, d));
      await batch.commit();
    }
  }
};
