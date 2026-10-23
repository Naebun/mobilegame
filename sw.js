// Network-first so edits always show up on reload; cache is only an offline fallback.
const CACHE = 'mobilegame-v9';
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'icons/icon.svg', 'src/style.css', 'src/main.js', 'src/engine.js',
  'src/game3d.js', 'src/save.js', 'src/audio.js', 'src/data.js', 'src/consts.js', 'src/draw.js', 'src/world.js', 'src/levels/cowgate.js', 'src/levels/vaults.js', 'src/levels/vaults-decor.js', 'src/models.js', 'src/arsenal.js', 'src/arsenal-play.js', 'src/arsenal-meshes.js', 'src/drink-meshes.js', 'src/weapon-meshes.js', 'src/prop-meshes.js', 'src/textures.js', 'src/textures-inline.js',
  'src/hud.js', 'src/screens.js', 'vendor/three.module.min.js',
  // baked textures (about 0.6 MB); keep in step with assets/textures/ (addAll fails if one is missing)
  'assets/textures/boards-albedo.webp', 'assets/textures/boards-normal.webp', 'assets/textures/boards-rough.webp', 'assets/textures/brick-albedo.webp', 'assets/textures/brick-normal.webp', 'assets/textures/brick-rough.webp', 'assets/textures/flag-albedo.webp', 'assets/textures/flag-normal.webp', 'assets/textures/flag-rough.webp', 'assets/textures/paint-albedo.webp', 'assets/textures/stone-albedo.webp', 'assets/textures/stone-normal.webp', 'assets/textures/stone-rough.webp',
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
