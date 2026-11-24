/* Offline support: cache the app shell, serve it cache-first (works with no signal).
 * Bump VERSION whenever any app file changes so phones pick up the update.
 * Files are fetched with cache:'reload' so a new version never picks up stale
 * copies from the browser's HTTP cache (GitHub Pages caches files for 10 min). */
const VERSION = '1.15-build18';
const CACHE = `inventory-${VERSION}`;
// Barcode and text-reader files (1.15, about 11 MB) are only fetched when first used, and
// kept in their own cache that app updates don't clear, so they download just once.
// Bump VENDOR only when a file in vendor/ changes.
const VENDOR = 'inventory-vendor-1';
const SHELL = [
  './', 'index.html', 'styles.css', 'changelog.js', 'db.js', 'app.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE && k !== VENDOR) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(new URL(req.url).pathname.includes('/vendor/') ? VENDOR : CACHE);
    const key = req.mode === 'navigate' ? 'index.html' : req;
    const hit = await cache.match(key, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      // Only pages fall back to the app; a missing file (like the text reader with no
      // signal) must fail so the app can say so.
      return (req.mode === 'navigate' && await cache.match('index.html')) || Response.error();
    }
  })());
});
