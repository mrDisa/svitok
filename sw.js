/* Service Worker «Свитка»: офлайн-работа без сервера.
   При каждом обновлении сайта увеличивайте VERSION, чтобы телефоны получили новую версию. */
const VERSION = 'svitok-v50';
const ART = 'svitok-art-v1'; // картины не меняются, кэш живёт между версиями
const BIBLE = 'svitok-bible-v1'; // текст Библии не меняется, кэш живёт между версиями

const SHELL = [
  './',
  'index.html',
  'styles.css',
  'config.js',
  'vendor/supabase-2.45.4.js',
  'social.js',
  'chats.js',
  'onboarding.js',
  'plans.js',
  'search.js',
  'tg.js',
  'reminders.js',
  'comments.js',
  'app.js',
  'manifest.webmanifest',
  'data/feed.json',
  'data/books.json',
  'data/paintings.json',
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
  // cache:'reload' — берём свежие файлы с сервера, а не из HTTP-кэша браузера (GitHub Pages держит их 10 минут)
  e.waitUntil(caches.open(VERSION)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== BIBLE && k !== ART).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Книги Библии и картины: сначала кэш, потом сеть (и сохраняем)
  const isArt = url.pathname.includes('/img/art/');
  if (url.pathname.includes('/data/bible/') || isArt) {
    e.respondWith(
      caches.open(isArt ? ART : BIBLE).then(async (c) => {
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
      fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
        .then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put('index.html', copy)); return res; })
        .catch(() => caches.match('index.html', { ignoreSearch: true }))
    );
    return;
  }

  // Остальное: сначала сеть (чтобы обновления приходили сразу), без сети или
  // при медленной сети — из кэша
  e.respondWith(
    caches.open(VERSION).then(async (c) => {
      const net = fetch(req, { cache: 'no-cache' }).then((res) => { if (res.ok) c.put(req, res.clone()); return res; });
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
  const client = e.source;
  e.waitUntil((async () => {
    const bible = await caches.open(BIBLE);
    const artCache = await caches.open(ART);
    let done = 0, failed = 0;
    const art = Array.isArray(e.data.art) ? e.data.art.filter((u) => /^img\/art\/[\w-]+\.jpg$/.test(u)) : [];
    const urls = [...Array.from({ length: e.data.total || 66 }, (_, i) => `data/bible/${String(i + 1).padStart(2, '0')}.json`), ...art];
    const all = urls.length;
    const worker = async () => {
      while (urls.length) {
        const u = urls.shift();
        const c = u.startsWith('img/art/') ? artCache : bible;
        try {
          if (!(await c.match(u))) {
            const res = await fetch(u);
            if (!res.ok) throw new Error(res.status);
            await c.put(u, res);
          }
        } catch { failed++; }
        done++;
        if (client && (done % 3 === 0 || done === all)) client.postMessage({ type: 'bible-progress', done, total: all, failed });
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  })());
});

// Пуш «Слово дня»
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Свиток', {
    body: d.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: d.tag || 'daily',
    data: { url: d.url || './?pwa=1' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) { if ('focus' in w) { await w.focus(); return; } }
    await self.clients.openWindow((e.notification.data && e.notification.data.url) || './?pwa=1');
  })());
});
