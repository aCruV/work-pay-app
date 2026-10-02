// Lets the app open with no connection. App files are network-first (so updates show up on
// the next launch while online) with the saved copy as a fallback; the version-pinned Firebase
// libraries never change, so they're served from the saved copy. Bump CACHE when shipping changes.
const CACHE = 'work-pay-2026-10-02-4';
const APP_FILES = ['./', 'index.html', 'money.boot.js', 'money.firebase.js', 'money.i18n.js', 'money.app.js', 'icon-180.png', 'splash-logo.png', 'favicon-32.png'];
const LIB_FILES = [
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore-compat.js'
];
const NETWORK_TIMEOUT_MS = 3500;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => Promise.all([
    cache.addAll(APP_FILES.map(url => new Request(url, { cache: 'no-cache' }))),
    ...LIB_FILES.map(url => fetch(url, { mode: 'cors' }).then(res => res.ok ? cache.put(url, res) : null).catch(() => null))
  ])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('work-pay-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === 'https://www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    event.respondWith(cacheFirst(req));
    return;
  }
  // Firebase sign-in and database traffic (googleapis.com) is never intercepted.
  if (url.origin !== self.location.origin) return;
  event.respondWith(networkFirst(req));
});

function cacheFirst(req) {
  return caches.match(req.url).then(hit => hit || fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req.url, copy)); }
    return res;
  }));
}

function networkFirst(req) {
  return caches.open(CACHE).then(cache => {
    const key = req.mode === 'navigate' ? 'index.html' : req;
    // no-cache revalidates with GitHub Pages instead of reusing its 10-minute HTTP cache.
    const network = fetch(req, { cache: 'no-cache' }).then(res => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    });
    const timeout = new Promise(resolve => setTimeout(resolve, NETWORK_TIMEOUT_MS)).then(() => cache.match(key));
    return Promise.race([network, timeout])
      .then(res => res || network)
      .catch(() => cache.match(key).then(hit => hit || Response.error()));
  });
}
