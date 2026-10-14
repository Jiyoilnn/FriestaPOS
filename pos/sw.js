// Friesta POS — offline support.
// App files: network first (fresh when online), cached copy when offline.
// Fonts and the optional Firebase SDK: cached after first use.
const VERSION = 'pos-v2';
const CORE = [
  './', './index.html', './app.js', './pos.css', './manifest.webmanifest', './icon-192.png', './icon-512.png',
  '../shared/base.css', '../shared/util.js', '../shared/store.js', '../shared/metrics.js',
  '../shared/auth-ui.js', '../shared/escpos.js', '../shared/zreport.js', '../shared/config.js', '../shared/logo.jpg'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('pos-') && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const key = req.mode === 'navigate' ? './index.html' : req;
      try {
        const res = await timeout(fetch(req, { cache: 'no-cache' }), 4000);
        if (res.ok) cache.put(key, res.clone());
        return res;
      } catch (err) {
        const hit = await cache.match(key, { ignoreSearch: true });
        return hit || Response.error();
      }
    })());
    return;
  }
  if (/fonts\.(googleapis|gstatic)\.com$|www\.gstatic\.com$/.test(url.hostname)) {
    e.respondWith(caches.open('friesta-cdn').then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      try { const res = await fetch(req); if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }
      catch (err) { return new Response('', { status: 504 }); }
    }));
  }
});
