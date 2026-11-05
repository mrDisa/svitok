/* Service Worker «Свитка»: офлайн-работа без сервера.
   При каждом обновлении сайта увеличивайте VERSION, чтобы телефоны получили новую версию. */
const VERSION = 'svitok-v5';
const BIBLE = 'svitok-bible-v1'; // текст Библии не меняется, кэш живёт между версиями

const SHELL = [
  './',
  'index.html',
  'styles.css',
  'scenes.js',
  'app.js',
  'manifest.webmanifest',
  'data/feed.json',
  'data/books.json',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'fonts/ptserif-400-cyrillic.woff2',
  'fonts/ptserif-400-latin.woff2',
  'fonts/ptserif-700-cyrillic.woff2',
  'fonts/ptserif-700-latin.woff2',
  'fonts/ptserif-400i-cyrillic.woff2',
  'fonts/ptserif-400i-latin.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== BIBLE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Книги Библии: сначала кэш, потом сеть (и сохраняем)
  if (url.pathname.includes('/data/bible/')) {
    e.respondWith(
      caches.open(BIBLE).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  // Страница: сеть с запасным вариантом из кэша (так обновления приходят сразу)
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put('index.html', copy)); return res; })
        .catch(() => caches.match('index.html', { ignoreSearch: true }))
    );
    return;
  }

  // Остальное: сначала сеть (чтобы обновления приходили сразу), без сети или
  // при медленной сети — из кэша
  e.respondWith(
    caches.open(VERSION).then(async (c) => {
      const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; });
      const slow = new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 3500));
      try {
        return await Promise.race([net, slow]);
      } catch {
        const hit = await c.match(req, { ignoreSearch: true });
        return hit || net;
      }
    })
  );
});

// Скачивание всей Библии для офлайна по запросу приложения
self.addEventListener('message', (e) => {
  if (!e.data || e.data.type !== 'precache-bible') return;
  const total = e.data.total || 66;
  const client = e.source;
  e.waitUntil((async () => {
    const c = await caches.open(BIBLE);
    let done = 0, failed = 0;
    const urls = Array.from({ length: total }, (_, i) => `data/bible/${String(i + 1).padStart(2, '0')}.json`);
    const worker = async () => {
      while (urls.length) {
        const u = urls.shift();
        try {
          if (!(await c.match(u))) {
            const res = await fetch(u);
            if (!res.ok) throw new Error(res.status);
            await c.put(u, res);
          }
        } catch { failed++; }
        done++;
        if (client && (done % 3 === 0 || done === total)) client.postMessage({ type: 'bible-progress', done, total, failed });
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  })());
});
