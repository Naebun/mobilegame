// Network-first so edits always show up on reload; cache is only an offline fallback.
const CACHE = 'mobilegame-v5';
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'icons/icon.svg', 'src/style.css', 'src/main.js', 'src/engine.js',
  'src/game3d.js', 'src/audio.js', 'src/data.js', 'src/consts.js', 'src/draw.js', 'src/world.js', 'src/models.js', 'src/drink-meshes.js',
  'src/hud.js', 'src/screens.js', 'vendor/three.module.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
