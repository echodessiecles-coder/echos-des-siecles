// Service worker minimal : l'admin s'ouvre même avec un réseau faible.
// Les données (API GitHub) ne sont jamais mises en cache.
const CACHE = 'echos-console-v3';
const SHELL = ['./', 'index.html', 'app.mjs', 'demo.mjs', 'icon.svg', 'manifest.webmanifest', '../engine/src/model.mjs', '../engine/src/pricing.mjs', '../engine/src/crypto.mjs', 'vendor/sealbox.mjs'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE).map((x) => caches.delete(x)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // Réseau d'abord (toujours la dernière version), cache en secours.
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
