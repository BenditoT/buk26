const BUILD = '20261002T093137';
const CACHE = 'buk-' + BUILD;
const TILES = 'buk-tiles-' + BUILD;
const ASSETS = ["./","./.nojekyll","./app.css","./data.enc.json","./icons/icon-180.png","./icons/icon-192.png","./icons/icon-512.png","./index.html","./js/app.js","./js/buildinfo.js","./js/commands.js","./js/crypto.js","./js/mapview.js","./js/model.js","./js/render.js","./js/storage.js","./js/time.js","./js/toast.js","./js/util.js","./manifest.webmanifest","./robots.txt","./sw.js","./vendor/leaflet/images/marker-icon-2x.png","./vendor/leaflet/images/marker-icon.png","./vendor/leaflet/images/marker-shadow.png","./vendor/leaflet/leaflet.css","./vendor/leaflet/leaflet.js","./vendor/qrcode.js"];
const TILE_LIMIT = 400;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE && n !== TILES && n.startsWith('buk-')).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('basemaps.cartocdn.com')) {
    event.respondWith(tileCache(req));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/data.enc.json')) {
    event.respondWith(networkFirst(req));
    return;
  }
  if (req.mode === 'navigate') {
    event.respondWith(caches.match('./index.html').then((hit) => hit || fetch(req)));
    return;
  }
  event.respondWith(cacheFirst(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put('./data.enc.json', res.clone());
    return res;
  } catch {
    const hit = await cache.match('./data.enc.json');
    if (hit) return hit;
    return new Response('', { status: 503 });
  }
}

async function tileCache(req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    await cache.put(req, res.clone());
    const keys = await cache.keys();
    if (keys.length > TILE_LIMIT) await cache.delete(keys[0]);
  }
  return res;
}
