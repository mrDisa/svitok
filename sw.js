/* Service Worker «Свитка»: офлайн-работа без сервера.
   При каждом обновлении сайта увеличивайте VERSION, чтобы телефоны получили новую версию. */
const VERSION = 'svitok-v81';
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
  'posts.js',
  'onboarding.js',
  'plans.js',
  'search.js',
  'tg.js',
  'reminders.js',
  'comments.js',
  'app.js',
  'support.js',
  'img/support-qr.png',
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
  e.waitUntil((async () => {
    // Шрифты и иконки кэшируются при использовании: их загрузка не задерживает обновление.
    const cache = await caches.open(VERSION);
    await Promise.all(SHELL.filter(url => url !== './' && !url.startsWith('fonts/') && !url.startsWith('icons/')).map(async url => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(new Request(url, { cache: 'reload', signal: controller.signal }));
        if (!response.ok) throw new Error(`Не удалось загрузить ${url}`);
        await cache.put(url, response);
      } finally { clearTimeout(timer); }
    }));
    await self.skipWaiting();
  })());
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

  // Установленная версия уже скачала оболочку. Открываем её сразу, без ожидания сети.
  // Код и документ обновляются вместе при установке нового VERSION, без смешивания версий.
  const scope = self.registration.scope;
  const shellPath = SHELL.find(path => new URL(path, scope).pathname === url.pathname);
  if (req.mode === 'navigate' || shellPath) {
    e.respondWith(caches.open(VERSION).then(async cache => {
      const key = req.mode === 'navigate' ? 'index.html' : shellPath;
      const hit = await cache.match(key, { ignoreSearch: true });
      if (hit) return hit;
      const response = await fetch(req, { cache: 'no-cache' });
      if (response.ok) await cache.put(key, response.clone());
      return response;
    }));
    return;
  }

  // Прочие статические ресурсы тоже не задерживают запуск при наличии локальной копии.
  e.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const response = await fetch(req);
    if (response.ok) await cache.put(req, response.clone());
    return response;
  }));
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
  // Открываем установку, получившую push: в том числе локальную HTTPS-версию.
  const target = new URL(self.registration.scope);
  const requested = new URL(d.url || '?pwa=1', target);
  target.search = requested.search; target.hash = requested.hash;
  e.waitUntil(self.registration.showNotification(d.title || 'Свиток', {
    body: d.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: d.tag || 'daily',
    data: { url: target.href },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) { if ('focus' in w) { await w.navigate((e.notification.data && e.notification.data.url) || './?pwa=1'); await w.focus(); return; } }
    await self.clients.openWindow((e.notification.data && e.notification.data.url) || './?pwa=1');
  })());
});
