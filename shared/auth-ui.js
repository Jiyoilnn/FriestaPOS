// Account screens (create account, sign in, reset) and the PIN pad.
import { Store } from './store.js';
import { $, esc, ICON } from './util.js';

const LOGO = new URL('./logo.jpg', import.meta.url).href;
const ERR = {
  'wrong-password': 'Mali ang email o password.',
  'no-account': 'Walang account na ganyan sa device na ito.',
  'exists': 'May account na. Mag-sign in na lang.',
  'weak-password': 'Gumamit ng password na hindi bababa sa 6 na character.',
  'invalid-email': 'Tingnan ulit ang email.',
  'offline': 'Walang internet. Kailangan ng internet para mag-sign in sa unang beses.',
  'too-many': 'Masyadong maraming subok. Maghintay ng ilang minuto.',
  'wrong-pin': 'Mali ang owner PIN.'
};
const msg = e => ERR[e && e.code] || 'Hindi natuloy. Subukan ulit.';

/* Render the right account screen into `root` for the current Store.status. */
export function renderGate(root, appName) {
  const st = Store.status;
  if (st === 'cloud-unavailable') {
    root.innerHTML = card(`<h1>Kailangan ng internet</h1><p>Naka-on ang cloud sync, pero hindi pa na-download ang sync tools sa device na ito. Kumonekta sa internet isang beses, tapos i-reload.</p><button class="btn" onclick="location.reload()">Reload</button>`);
    return;
  }
  if (st === 'needs-setup') return setup(root, appName);
  return signIn(root, appName);
}
const card = inner => `<div class="gate"><form class="gatecard" novalidate><img class="logo" src="${LOGO}" alt="Friesta">${inner}</form></div>`;

function setup(root, appName, fromSignIn) {
  root.innerHTML = card(`
    <h1>Gumawa ng account</h1>
    <p>${Store.mode === 'cloud' ? 'Ito ang account ng may-ari. Gamitin ito sa lahat ng device ng tindahan.' : 'Isang beses lang ito. Ang account ang gagamitin mo para mag-login sa Back Office.'}</p>
    <div class="field"><label for="a-store">Pangalan ng tindahan</label><input id="a-store" value="Friesta" maxlength="40" autocomplete="organization"></div>
    <div class="field"><label for="a-name">Pangalan mo (owner)</label><input id="a-name" maxlength="40" autocomplete="name" placeholder="e.g. Ilana"></div>
    <div class="field"><label for="a-email">Email</label><input id="a-email" type="email" autocomplete="email" inputmode="email" placeholder="you@email.com"></div>
    <div class="field"><label for="a-pw">Password</label><input id="a-pw" type="password" autocomplete="new-password" placeholder="At least 6 characters"></div>
    <div class="field"><label for="a-pin">Owner PIN para sa POS (4 digits)</label><input id="a-pin" type="password" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="••••"></div>
    <div class="err" id="a-err" hidden></div>
    <button class="btn lg" id="a-go" type="submit">Create account</button>
    ${Store.mode === 'cloud' || fromSignIn ? `<p>May account na? <button type="button" class="link" id="a-switch">Sign in</button></p>` : ''}`);
  const f = root.querySelector('form'), err = $('a-err');
  const sw = $('a-switch'); if (sw) sw.addEventListener('click', () => signIn(root, appName));
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const v = id => $(id).value.trim();
    const pin = v('a-pin');
    const bad = !v('a-name') ? 'Ilagay ang pangalan mo.' : !/^\S+@\S+\.\S+$/.test(v('a-email')) ? 'Tingnan ulit ang email.' : $('a-pw').value.length < 6 ? ERR['weak-password'] : !/^\d{4}$/.test(pin) ? 'Ang PIN ay 4 na numero.' : '';
    if (bad) { err.textContent = bad; err.hidden = false; return; }
    const b = $('a-go'); b.disabled = true; b.textContent = 'Creating…'; err.hidden = true;
    try { await Store.createAccount({ storeName: v('a-store'), name: v('a-name'), email: v('a-email'), password: $('a-pw').value, pin }); }
    catch (x) { err.textContent = msg(x); err.hidden = false; b.disabled = false; b.textContent = 'Create account'; }
  });
}

function signIn(root, appName) {
  const label = appName === 'bo' ? 'Back Office' : 'Friesta POS';
  root.innerHTML = card(`
    <h1>Sign in · ${label}</h1>
    <p>${Store.mode === 'cloud' ? 'Gamitin ang account ng tindahan.' : 'Gamitin ang account na ginawa sa device na ito.'}</p>
    <div class="field"><label for="s-email">Email</label><input id="s-email" type="email" autocomplete="username" inputmode="email"></div>
    <div class="field"><label for="s-pw">Password</label><input id="s-pw" type="password" autocomplete="current-password"></div>
    <div class="err" id="s-err" hidden></div>
    <button class="btn lg" id="s-go" type="submit">Sign in</button>
    <p><button type="button" class="link" id="s-forgot">Nakalimutan ang password?</button>${Store.mode === 'cloud' ? ` · <button type="button" class="link" id="s-new">Create account</button>` : ''}</p>`);
  const f = root.querySelector('form'), err = $('s-err');
  setTimeout(() => $('s-email') && $('s-email').focus(), 50);
  const nw = $('s-new'); if (nw) nw.addEventListener('click', () => setup(root, appName, true));
  $('s-forgot').addEventListener('click', () => forgot(root, appName));
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const b = $('s-go'); b.disabled = true; b.textContent = 'Signing in…'; err.hidden = true;
    try { await Store.signIn($('s-email').value, $('s-pw').value); }
    catch (x) { err.textContent = msg(x); err.hidden = false; b.disabled = false; b.textContent = 'Sign in'; }
  });
}

function forgot(root, appName) {
  const cloud = Store.mode === 'cloud';
  root.innerHTML = card(`
    <h1>I-reset ang password</h1>
    <p>${cloud ? 'Magpapadala kami ng reset link sa email mo.' : 'Gamitin ang owner PIN mo para gumawa ng bagong password.'}</p>
    <div class="field"><label for="r-email">Email ng account</label><input id="r-email" type="email" inputmode="email"></div>
    ${cloud ? '' : `<div class="field"><label for="r-pin">Owner PIN</label><input id="r-pin" type="password" inputmode="numeric" maxlength="4"></div>
    <div class="field"><label for="r-pw">Bagong password</label><input id="r-pw" type="password" autocomplete="new-password"></div>`}
    <div class="err" id="r-err" hidden></div>
    <button class="btn lg" type="submit" id="r-go">${cloud ? 'Send reset link' : 'Set new password'}</button>
    <p><button type="button" class="link" id="r-back">Back to sign in</button></p>`);
  const err = $('r-err');
  $('r-back').addEventListener('click', () => signIn(root, appName));
  root.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault(); err.hidden = true;
    try {
      if (cloud) { await Store.resetPassword($('r-email').value); err.textContent = 'Naipadala na. Tingnan ang email mo.'; err.style.color = 'var(--good)'; err.hidden = false; return; }
      if ($('r-pw').value.length < 6) throw { code: 'weak-password' };
      await Store.resetPassword($('r-email').value, $('r-pin').value, $('r-pw').value);
    } catch (x) { err.textContent = msg(x); err.style.color = ''; err.hidden = false; }
  });
}

/* A 4-digit PIN pad. Calls check(pin) → true to accept, false to shake and clear. */
export function pinPad(el, { title = 'Enter PIN', sub = '', check, extra = '' }) {
  let pin = '';
  el.innerHTML = `<div class="pinwrap">
    <div style="text-align:center"><div class="t1" style="font-size:18px">${esc(title)}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
    <div class="dots" aria-live="polite">${'<i></i>'.repeat(4)}</div>
    <div class="pinpad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button type="button" data-n="${n}">${n}</button>`).join('')}<button type="button" class="txt" data-n="clear">Clear</button><button type="button" data-n="0">0</button><button type="button" class="txt" data-n="del" aria-label="Delete">${ICON.backspace}</button></div>
    ${extra}</div>`;
  const dots = el.querySelector('.dots');
  const draw = () => dots.querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i < pin.length));
  const press = async k => {
    if (k === 'clear') pin = ''; else if (k === 'del') pin = pin.slice(0, -1); else if (pin.length < 4) pin += k;
    draw();
    if (pin.length === 4) {
      const ok = await check(pin);
      if (!ok) { dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake'); pin = ''; setTimeout(draw, 250); }
    }
  };
  el.querySelectorAll('[data-n]').forEach(b => b.addEventListener('click', () => press(b.dataset.n)));
  return { key: e => { if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('del'); else if (e.key === 'Escape') press('clear'); } };
}
