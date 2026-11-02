/* Mine plan 3D service worker: keeps the app usable offline.
 *  - App shell (index.html + built JS/CSS from precache-manifest.json): cached at install,
 *    navigation is network-first with the cached shell as fallback.
 *  - Plan images, 3D asset files and thumbnails: cache-first (they never change for a given URL),
 *    so plans and models opened once also work offline.
 *  - Other /api requests are left to the app, which keeps its own copy in IndexedDB.
 */
// replaced with a build id by vite.config.ts, so each deploy installs a fresh app shell
const VERSION = 'dev';
const SHELL = `mineplan-shell-${VERSION}`;
// plan images and model files keep their cache across deploys (their URLs never change content)
const MEDIA = 'mineplan-media-v1';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    let files = ['/', '/index.html'];
    try {
      const r = await fetch('/precache-manifest.json', { cache: 'no-store' });
      if (r.ok) files = files.concat((await r.json()).files || []);
    } catch { /* offline install: runtime caching fills in */ }
    await Promise.all(files.map((f) => cache.add(new Request(f, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('mineplan-shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isMedia = (url) =>
  /^\/api\/plans\/[^/]+\/image$/.test(url.pathname) ||
  /^\/api\/assets\/[^/]+\/(files\/.+|thumbnail)$/.test(url.pathname) ||
  url.hostname === 'www.gstatic.com'; // Draco decoder

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (req.mode === 'navigate' && !url.pathname.startsWith('/api/')) {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(SHELL);
        cache.put('/index.html', res.clone());
        return res;
      } catch {
        return (await caches.match('/index.html')) || (await caches.match('/')) || Response.error();
      }
    })());
    return;
  }

  if (isMedia(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(MEDIA);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  if (url.origin === self.location.origin && !url.pathname.startsWith('/api/')) {
    // built assets have content hashes: cache-first, then network (and remember)
    event.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
      return res;
    })());
  }
});
