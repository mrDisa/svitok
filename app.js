'use strict';

/* ======================================================================
   Свиток — лента стихов из Синодального перевода.
   Без сервера: всё хранится на телефоне (localStorage + кэш Service Worker).
   ====================================================================== */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ua = navigator.userAgent;
const IS_IOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_ANDROID = /Android/.test(ua);
const STANDALONE = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

/* ---------- иконки ---------- */
const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" ${extra}>${d}</svg>`;
const I = {
  heart: svg('<path d="M12 20.5s-7.6-4.6-9.4-9.4C1.3 7.6 3.5 4.3 7 4.3c2 0 3.5 1 5 3 1.5-2 3-3 5-3 3.5 0 5.7 3.3 4.4 6.8-1.8 4.8-9.4 9.4-9.4 9.4z"/>'),
  bookmark: svg('<path d="M7 3.5h10a1 1 0 0 1 1 1V21l-6-4-6 4V4.5a1 1 0 0 1 1-1z"/>'),
  share: svg('<path d="M12 3v12M8 7l4-4 4 4M7 11H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/>'),
  book: svg('<path d="M3 5.5C5.5 4 8.5 4 12 6c3.5-2 6.5-2 9-.5V19c-2.5-1.5-5.5-1.5-9 .5-3.5-2-6.5-2-9-.5z"/><path d="M12 6v13.5"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  next: svg('<path d="M9 5l7 7-7 7"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
  image: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>'),
  text: svg('<path d="M5 6h14M5 12h14M5 18h9"/>'),
  friend: svg('<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>'),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/>'),
  heartFill: svg('<path d="M12 20.5s-7.6-4.6-9.4-9.4C1.3 7.6 3.5 4.3 7 4.3c2 0 3.5 1 5 3 1.5-2 3-3 5-3 3.5 0 5.7 3.3 4.4 6.8-1.8 4.8-9.4 9.4-9.4 9.4z"/>'),
};

/* ---------- темы и фоны ---------- */
const TOPICS = [
  ['foryou', 'Для тебя'], ['hope', 'Надежда'], ['anxiety', 'При тревоге'], ['peace', 'Мир и покой'],
  ['love', 'Любовь'], ['strength', 'Сила'], ['comfort', 'Утешение'], ['faith', 'Вера'],
  ['thanks', 'Благодарность'], ['wisdom', 'Мудрость'], ['forgiveness', 'Прощение'],
  ['prayer', 'Молитва'], ['jesus', 'Слова Христа'],
];
const TOPIC_NAME = Object.fromEntries(TOPICS);

const GRADS = [
  ['#2b2118', '#6b4e33'], ['#1d2420', '#4b5e4f'], ['#2a1c1c', '#6e3f36'], ['#1f2328', '#4a5866'],
  ['#2a2516', '#6e6236'], ['#231d1f', '#5a4a4c'], ['#1c2226', '#3f5560'], ['#2b2420', '#7a5c45'],
];
function gradFor(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return GRADS[h % GRADS.length];
}

/* ---------- хранилище (только на этом телефоне) ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem('svitok:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('svitok:' + k, JSON.stringify(v)); } catch { /* приватный режим */ } },
};
const S = {
  likes: new Set(store.get('likes', [])),
  saved: store.get('saved', []),
  weights: store.get('weights', {}),
  seen: store.get('seen', []),
  scale: store.get('scale', 1),
  last: store.get('last', null),
  hinted: store.get('hinted', false),
  pillHidden: store.get('pillHidden', false),
};
const persist = {
  likes() { store.set('likes', [...S.likes]); },
  saved() { store.set('saved', S.saved); },
  weights() { store.set('weights', S.weights); },
  seen() { store.set('seen', S.seen); },
};

/* ---------- данные ---------- */
let FEED = [];
let PAINTINGS = [];
let ART_BY_TOPIC = {};
const ART_BY_ID = new Map();
const recentArt = [];
const cardArt = new Map(); // key карточки -> картина
let FEED_BY_ID = new Map();
let BY_TOPIC = {};
let BOOKS = [];
const bookCache = new Map();

async function loadJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return r.json();
}
function loadBook(b) {
  if (!bookCache.has(b)) {
    const p = loadJSON(`data/bible/${String(b + 1).padStart(2, '0')}.json`).catch((e) => { bookCache.delete(b); throw e; });
    bookCache.set(b, p);
  }
  return bookCache.get(b);
}

/* ---------- мелочи интерфейса ---------- */
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 1800);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* */ }
    ta.remove(); return ok;
  }
}

/* ======================================================================
   ЛЕНТА
   ====================================================================== */
const feedEl = () => $('#feed');
let currentTopic = 'foryou';
let topicQueue = [];
let cardSeq = 0;
const cardItems = new Map(); // key -> item
let activeCard = null;
let activeSince = 0;
let io;

function dayIndex() {
  const d = new Date();
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
}
/* картина дня — одна и та же в «Слове дня» и в первой карточке ленты */
function dailyArt() { return artForId('day-' + dayIndex(), verseOfDay().t); }
function verseOfDay() {
  return FEED[(dayIndex() * 7919) % FEED.length];
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function pickForYou() {
  const topics = TOPICS.slice(1).map((t) => t[0]);
  const w = (t) => S.weights[t] ?? 1;
  let r = Math.random() * topics.reduce((a, t) => a + w(t), 0);
  let topic = topics[0];
  for (const t of topics) { r -= w(t); if (r <= 0) { topic = t; break; } }
  const recent = new Set(S.seen);
  let cands = BY_TOPIC[topic].filter((v) => !recent.has(v.id));
  if (!cands.length) cands = FEED.filter((v) => !recent.has(v.id));
  if (!cands.length) { S.seen = []; cands = FEED; }
  const it = cands[Math.random() * cands.length | 0];
  S.seen.push(it.id);
  if (S.seen.length > Math.min(120, FEED.length - 20)) S.seen.shift();
  return it;
}
function pickTopic() {
  if (!topicQueue.length) {
    const last = topicQueue.lastPicked;
    topicQueue = shuffle([...BY_TOPIC[currentTopic]]);
    if (topicQueue[0] === last && topicQueue.length > 1) topicQueue.push(topicQueue.shift());
  }
  const it = topicQueue.shift();
  topicQueue.lastPicked = it;
  return it;
}

/* Картина к стиху: чаще по теме, без повторов среди последних показанных */
function pickArt(topic) {
  if (!PAINTINGS.length) return null;
  const recent = new Set(recentArt);
  const byTopic = (ART_BY_TOPIC[topic] || []).filter((p) => !recent.has(p.id));
  const pool = byTopic.length && Math.random() < 0.75 ? byTopic : PAINTINGS.filter((p) => !recent.has(p.id));
  const p = (pool.length ? pool : PAINTINGS)[Math.random() * (pool.length || PAINTINGS.length) | 0];
  recentArt.push(p.id);
  if (recentArt.length > Math.min(14, PAINTINGS.length - 5)) recentArt.shift();
  return p;
}
/* Постоянная картина для стиха (избранное, входящие) */
function artForId(id, topic) {
  if (!PAINTINGS.length) return null;
  const pool = (topic && ART_BY_TOPIC[topic]) || PAINTINGS;
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return pool[h % pool.length];
}
const artCredit = (p) => `${p.artist} · «${p.title.replace(/^«|»$/g, '')}»`;

function cardHTML(it, tag, forcedArt) {
  const [g1, g2] = gradFor(it.id);
  const n = it.x.length;
  const size = n < 75 ? 'xl' : n < 135 ? 'l' : n < 215 ? 'm' : 's';
  const key = 'c' + (++cardSeq);
  cardItems.set(key, it);
  const liked = S.likes.has(it.id);
  const saved = S.saved.some((s) => s.id === it.id);
  const art = forcedArt || pickArt(it.t);
  if (art) cardArt.set(key, art);
  return `<article class="card size-${size}" data-key="${key}" style="--g1:${g1};--g2:${g2}">
    <div class="art-wrap"></div><div class="scrim"></div>
    ${art ? `<div class="card-credit">${esc(artCredit(art))}</div>` : ''}
    <div class="card-body">
      <div class="card-tag">${esc(tag || TOPIC_NAME[it.t])}</div>
      <p class="verse">${esc(it.x)}</p>
      <div class="ref">${esc(it.r)}</div>
    </div>
    <div class="actions">
      <button class="act${liked ? ' on' : ''}" data-act="like" aria-label="Нравится"><span class="ico">${I.heart}</span>Нравится</button>
      <button class="act${saved ? ' on' : ''}" data-act="save" aria-label="Сохранить"><span class="ico">${I.bookmark}</span>Сохранить</button>
      <button class="act" data-act="share" aria-label="Поделиться"><span class="ico">${I.share}</span>Поделиться</button>
      <button class="act" data-act="read" aria-label="Читать главу"><span class="ico">${I.book}</span>Глава</button>
    </div>
  </article>`;
}

/* Картину грузим только у соседних карточек, чтобы лента оставалась лёгкой */
function syncScenes(cards, idx) {
  cards.forEach((c, i) => {
    const wrap = c.firstElementChild;
    if (!wrap || !wrap.classList.contains('art-wrap')) return;
    const near = i >= idx - 1 && i <= idx + 2;
    const art = cardArt.get(c.dataset.key);
    if (near && !wrap.firstChild && art) {
      wrap.innerHTML = `<img class="art" src="${art.src}" alt="${esc(art.title)}" decoding="async" onload="this.classList.add('ok')">`;
    } else if (!near && wrap.firstChild && Math.abs(i - idx) > 3) wrap.innerHTML = '';
  });
}

function appendCards(n) {
  let html = '';
  for (let i = 0; i < n; i++) html += cardHTML(currentTopic === 'foryou' ? pickForYou() : pickTopic());
  feedEl().insertAdjacentHTML('beforeend', html);
  $$('.card:not([data-obs])', feedEl()).forEach((c) => { c.dataset.obs = '1'; io.observe(c); });
  persist.seen();
}

function resetFeed() {
  const f = feedEl();
  f.innerHTML = '';
  cardItems.clear();
  cardArt.clear();
  activeCard = null;
  topicQueue = [];
  if (currentTopic === 'foryou') {
    const d = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    f.insertAdjacentHTML('beforeend', cardHTML(verseOfDay(), 'Стих дня · ' + d, dailyArt()));
  }
  appendCards(currentTopic === 'foryou' ? 7 : 8);
  f.scrollTop = 0;
  const cards = $$('.card', f);
  cards[0]?.classList.add('is-active');
  syncScenes(cards, 0);
}

function bump(topic, delta) {
  if (!topic) return;
  S.weights[topic] = Math.max(0.3, Math.min(15, (S.weights[topic] ?? 1) + delta));
  persist.weights();
}

function onCardActive(card) {
  if (activeCard === card) return;
  // учёт времени просмотра для рекомендаций
  if (activeCard) {
    const it = cardItems.get(activeCard.dataset.key);
    const dwell = (performance.now() - activeSince) / 1000;
    if (it && currentTopic === 'foryou') {
      if (dwell > 5) bump(it.t, 0.4);
      else if (dwell < 1.2) bump(it.t, -0.25);
    }
    if (dwell >= Goal.DWELL) Goal.count();
  }
  if (activeCard) activeCard.classList.remove('is-active');
  card.classList.add('is-active');
  activeCard = card;
  activeSince = performance.now();
  const cards = $$('.card', feedEl());
  const idx = cards.indexOf(card);
  if (idx > 0 && !S.hinted) { S.hinted = true; store.set('hinted', true); $('#swipe-hint').hidden = true; }
  if (idx >= cards.length - 4) appendCards(8);
  syncScenes($$('.card', feedEl()), idx);
  // держим DOM лёгким
  if (cards.length > 160 && idx > 80) {
    const f = feedEl();
    const drop = cards.slice(0, 40);
    const h = drop.reduce((a, c) => a + c.offsetHeight, 0);
    drop.forEach((c) => { io.unobserve(c); cardItems.delete(c.dataset.key); cardArt.delete(c.dataset.key); c.remove(); });
    f.scrollTop -= h;
  }
}

function toggleLike(card, it, forceOn) {
  const on = forceOn ? true : !S.likes.has(it.id);
  if (on === S.likes.has(it.id)) return;
  if (on) S.likes.add(it.id); else S.likes.delete(it.id);
  persist.likes();
  bump(it.t, on ? 2.5 : -2.5);
  $$(`.card`, feedEl()).forEach((c) => {
    if (cardItems.get(c.dataset.key)?.id === it.id) {
      const b = $('[data-act=like]', c);
      b.classList.toggle('on', on);
      if (c === card) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
    }
  });
}

function isSaved(id) { return S.saved.some((s) => s.id === id); }
function toggleSave(it, silent) {
  const was = isSaved(it.id);
  if (was) S.saved = S.saved.filter((s) => s.id !== it.id);
  else S.saved.unshift({ id: it.id, r: it.r, x: it.x, b: it.b, c: it.c, v: it.v, t: it.t || null, ts: Date.now() });
  persist.saved();
  if (!was && it.t) bump(it.t, 1.5);
  $$('.card', feedEl()).forEach((c) => {
    if (cardItems.get(c.dataset.key)?.id === it.id) $('[data-act=save]', c).classList.toggle('on', !was);
  });
  if (!silent) toast(was ? 'Убрано из избранного' : 'Сохранено в избранное');
  return !was;
}

function burst(card, x, y) {
  const r = card.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'burst';
  el.style.left = (x - r.left) + 'px';
  el.style.top = (y - r.top) + 'px';
  el.innerHTML = I.heartFill;
  card.appendChild(el);
  setTimeout(() => el.remove(), 850);
}

function initFeed() {
  io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) onCardActive(e.target); });
  }, { root: feedEl(), threshold: 0.6 });

  // темы
  $('#chips').innerHTML = TOPICS.map(([k, n]) => `<button class="chip${k === currentTopic ? ' on' : ''}" data-topic="${k}" role="tab">${n}</button>`).join('');
  $('#chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-topic]');
    if (!b) return;
    if (b.dataset.topic === currentTopic) { feedEl().scrollTo({ top: 0, behavior: 'smooth' }); return; }
    currentTopic = b.dataset.topic;
    $$('.chip').forEach((c) => c.classList.toggle('on', c === b));
    b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    resetFeed();
  });

  // кнопки на карточке и двойной тап
  let lastTap = { t: 0, card: null };
  feedEl().addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const it = cardItems.get(card.dataset.key);
    const btn = e.target.closest('[data-act]');
    if (btn) {
      const act = btn.dataset.act;
      if (act === 'like') toggleLike(card, it);
      else if (act === 'save') toggleSave(it);
      else if (act === 'share') openShare({ ...it, art: cardArt.get(card.dataset.key) });
      else if (act === 'read') { openTab('bible'); openChapter(it.b, it.c, it.v); }
      return;
    }
    const now = Date.now();
    if (lastTap.card === card && now - lastTap.t < 320) {
      toggleLike(card, it, true);
      burst(card, e.clientX, e.clientY);
      lastTap = { t: 0, card: null };
    } else lastTap = { t: now, card };
  });

  // клавиатура на компьютере: ↓/↑, PageDown/PageUp, пробел — листать; L — «нравится»
  document.addEventListener('keydown', (e) => {
    if (!$('[data-view=feed]').classList.contains('on') || !$('#sheet').hidden) return;
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const f = feedEl();
    const k = e.key;
    if (k === 'ArrowDown' || k === 'PageDown' || k === ' ' || k === 'j') { e.preventDefault(); f.scrollBy({ top: f.clientHeight, behavior: 'smooth' }); }
    else if (k === 'ArrowUp' || k === 'PageUp' || k === 'k') { e.preventDefault(); f.scrollBy({ top: -f.clientHeight, behavior: 'smooth' }); }
    else if ((k === 'l' || k === 'д') && activeCard) toggleLike(activeCard, cardItems.get(activeCard.dataset.key));
  });

  resetFeed();
  if (!S.hinted) $('#swipe-hint').hidden = false;
}

/* ======================================================================
   ПОДЕЛИТЬСЯ — карточка-картинка 1080×1920
   ====================================================================== */
function wrapLines(ctx, text, maxW) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}
async function renderShareImage(it) {
  try {
    await Promise.all([
      document.fonts.load('400 60px "PT Serif"', 'Аа'),
      document.fonts.load('italic 400 40px "PT Serif"', 'Аа'),
      document.fonts.load('700 40px "PT Serif"', 'Аа'),
    ]);
  } catch { /* шрифт по умолчанию */ }
  const W = 1080, H = 1920;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const [g1, g2] = gradFor(it.id);
  let g = ctx.createLinearGradient(0, 0, W * 0.45, H);
  g.addColorStop(0, g1); g.addColorStop(1, g2);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  g = ctx.createRadialGradient(W * 0.2, H * 0.12, 0, W * 0.2, H * 0.12, W * 1.1);
  g.addColorStop(0, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  g = ctx.createRadialGradient(W * 0.9, H, 0, W * 0.9, H, W);
  g.addColorStop(0, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const art = it.art || pickArt(it.t);
  if (art) {
    try {
      // та же картина, что и на карточке; растягиваем «по обложке»
      const img = new Image();
      img.src = art.src;
      await img.decode();
      const k = Math.max(W / img.naturalWidth, H / img.naturalHeight);
      const dw = img.naturalWidth * k, dh = img.naturalHeight * k;
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } catch { /* остаётся градиент */ }
  }
  // затемнение под текстом для читаемости
  g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0.25)'); g.addColorStop(0.5, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  const maxW = W - 200;
  let size = 100, lines, lh;
  for (; size >= 34; size -= 2) {
    ctx.font = `400 ${size}px "PT Serif", Georgia, serif`;
    lines = wrapLines(ctx, it.x, maxW);
    lh = size * 1.42;
    if (lines.length * lh <= 1050 && lines.length <= Math.max(4, 14 - size / 10)) break;
  }
  const block = lines.length * lh;
  let y = (H - block) / 2 - 40;

  ctx.fillStyle = 'rgba(246,213,154,0.55)';
  ctx.font = '700 200px "PT Serif", Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('“', W / 2, y - 20);

  ctx.fillStyle = '#fff8ee';
  ctx.font = `400 ${size}px "PT Serif", Georgia, serif`;
  ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 24;
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, W / 2, y + i * lh));
  ctx.shadowBlur = 0;

  y += block + 50;
  ctx.fillStyle = 'rgba(246,213,154,0.95)';
  ctx.font = 'italic 400 46px "PT Serif", Georgia, serif';
  ctx.fillText('— ' + it.r, W / 2, y);

  if (art) {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = 'italic 400 26px "PT Serif", Georgia, serif';
    ctx.fillText(artCredit(art), W / 2, H - 230);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '700 38px "PT Serif", Georgia, serif';
  ctx.fillText('Свиток', W / 2, H - 170);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '400 28px -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('Библия, которую хочется листать', W / 2, H - 120);

  return new Promise((res) => cv.toBlob(res, 'image/png'));
}

function shareText(it) { return `«${it.x}»\n— ${it.r}`; }
function appUrl() { return location.origin + location.pathname.replace(/index\.html$/, ''); }

function openShare(it) {
  let file = null, url = null;
  openSheet(`
    <h2>Поделиться</h2>
    <div class="share-preview"><div class="ph" id="share-img"></div></div>
    <div class="sheet-actions">
      <button class="primary" data-s="image" disabled>${I.image}Поделиться картинкой</button>
      ${Social.enabled ? `<button class="wide" data-s="friend">${I.friend}Отправить другу в «Свитке»</button>` : ''}
      <button data-s="text">${I.text}Текстом</button>
      <button data-s="copy">${I.copy}Скопировать</button>
    </div>`, (sheet) => {
    renderShareImage(it).then((blob) => {
      if (!blob || !sheet.isConnected) return;
      file = new File([blob], 'stih.png', { type: 'image/png' });
      url = URL.createObjectURL(blob);
      const img = new Image(); img.src = url; img.alt = it.r;
      $('#share-img', sheet).replaceWith(img);
      $('[data-s=image]', sheet).disabled = false;
    });
    sheet.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-s]');
      if (!b) return;
      const kind = b.dataset.s;
      if (kind === 'friend') { Social.sendVerse(it); return; }
      try {
        if (kind === 'image' && file) {
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file] });
          } else {
            const a = document.createElement('a');
            a.href = url; a.download = 'stih.png'; a.click();
            toast('Картинка сохранена');
          }
        } else if (kind === 'text') {
          if (Tg.inTg && Tg.shareText(shareText(it), appUrl())) return;
          if (navigator.share) await navigator.share({ text: shareText(it) + '\n\n' + appUrl() });
          else { await copyText(shareText(it)); toast('Текст скопирован'); }
        } else if (kind === 'copy') {
          await copyText(shareText(it)); toast('Скопировано');
        }
      } catch (err) { if (err && err.name !== 'AbortError') toast('Не получилось поделиться'); }
    });
  }, () => { if (url) URL.revokeObjectURL(url); });
}

/* ---------- шторка ---------- */
let sheetCleanup = null;
function openSheet(html, onMount, onClose) {
  const sh = $('#sheet');
  sh.innerHTML = '<div class="grab"></div>' + html;
  sh.hidden = false;
  $('#sheet-backdrop').hidden = false;
  sheetCleanup = onClose || null;
  onMount && onMount(sh);
}
function closeSheet() {
  const sh = $('#sheet');
  if (sh.hidden) return;
  sh.hidden = true;
  $('#sheet-backdrop').hidden = true;
  sh.replaceWith(sh.cloneNode(false)); // снимаем обработчики
  $('#sheet').hidden = true;
  if (sheetCleanup) { sheetCleanup(); sheetCleanup = null; }
}

/* ======================================================================
   БИБЛИЯ
   ====================================================================== */
const bibleEl = () => $('#bible');
let bibleRoute = { view: 'books' };
let selected = new Set();

function renderBooks() {
  bibleRoute = { view: 'books' };
  clearSelection();
  const book = (b, i) => `<button data-book="${i}">${esc(b.n)}<small>${b.c} ${plural(b.c, 'глава', 'главы', 'глав')}</small></button>`;
  const last = S.last && BOOKS[S.last.b] ? S.last : null;
  bibleEl().innerHTML = `
    <div class="page-head"><h1>Библия</h1><p>Синодальный перевод</p></div>
    ${Search.boxHTML()}
    <div id="bible-home">
    ${last ? `<button class="continue" data-continue><div><small>Продолжить чтение</small><b>${esc(BOOKS[last.b].n)}, глава ${last.c}</b></div>${I.next}</button>` : ''}
    ${Plans.sectionHTML()}
    <div class="sec-title">Ветхий Завет</div>
    <div class="book-list">${BOOKS.map((b, i) => (b.nt ? '' : book(b, i))).join('')}</div>
    <div class="sec-title">Новый Завет</div>
    <div class="book-list">${BOOKS.map((b, i) => (b.nt ? book(b, i) : '')).join('')}</div>
    </div>`;
  bibleEl().scrollTop = 0;
  Search.afterRender();
}

function renderChapters(b) {
  bibleRoute = { view: 'chapters', b };
  clearSelection();
  const bk = BOOKS[b];
  if (bk.c === 1) { openChapter(b, 1); return; }
  bibleEl().innerHTML = `
    <div class="sub-head"><button class="icon-btn" data-nav="books" aria-label="Назад">${I.back}</button><h1>${esc(bk.n)}</h1></div>
    <div class="ch-grid">${Array.from({ length: bk.c }, (_, i) => `<button data-ch="${i + 1}">${i + 1}</button>`).join('')}</div>`;
  bibleEl().scrollTop = 0;
}

async function openChapter(b, c, hl) {
  bibleRoute = { view: 'chapter', b, c };
  clearSelection();
  const bk = BOOKS[b];
  const el = bibleEl();
  const title = bk.r === 'Псалтирь' ? `Псалом ${c}` : `${bk.n}, глава ${c}`;
  el.innerHTML = `
    <div class="sub-head"><button class="icon-btn" data-nav="${Plans.inPlan(b, c) ? 'plan' : Search.isFrom(b, c) ? 'search' : bk.c === 1 ? 'books' : 'chapters'}" aria-label="Назад">${I.back}</button><h1>${esc(title)}</h1></div>
    <div class="loading">Загрузка…</div>`;
  el.scrollTop = 0;
  S.last = { b, c }; store.set('last', S.last);
  let data;
  try { data = await loadBook(b); } catch {
    $('.loading', el).textContent = 'Нет соединения. Глава ещё не скачана на телефон.';
    return;
  }
  if (bibleRoute.b !== b || bibleRoute.c !== c) return;
  const verses = data.c[c - 1];
  const [h1, h2] = hl || [0, -1];
  const prev = c > 1 ? [b, c - 1] : b > 0 ? [b - 1, BOOKS[b - 1].c] : null;
  const next = c < bk.c ? [b, c + 1] : b < BOOKS.length - 1 ? [b + 1, 1] : null;
  $('.loading', el).outerHTML = `
    <div class="reader">${verses.map((t, i) => {
      const n = i + 1;
      return `<span class="v${n >= h1 && n <= h2 ? ' hl' : ''}" data-v="${n}"><sup>${n}</sup>${esc(t)} </span>`;
    }).join('')}</div>
    <div class="ch-nav">
      <button data-go="${prev ? prev.join(',') : ''}" ${prev ? '' : 'disabled'}>← ${prev ? esc(chLabel(prev)) : ''}</button>
      <button data-go="${next ? next.join(',') : ''}" ${next ? '' : 'disabled'}>${next ? esc(chLabel(next)) : ''} →</button>
    </div>
    ${Plans.readerBar(b, c)}`;
  if (hl) {
    const target = $(`.v[data-v="${h1}"]`, el);
    if (target) requestAnimationFrame(() => {
      el.scrollTop = Math.max(0, target.offsetTop - el.clientHeight * 0.3);
    });
  }
}
function chLabel([b, c]) { return BOOKS[b].c === 1 ? BOOKS[b].s : `${BOOKS[b].s} ${c}`; }

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/* выбор стихов в читалке */
function clearSelection() {
  selected = new Set();
  $$('.reader .v.sel').forEach((v) => v.classList.remove('sel'));
  $('#sel-bar').hidden = true;
}
async function selectionItem() {
  const { b, c } = bibleRoute;
  const data = await loadBook(b);
  const vs = [...selected].sort((x, y) => x - y);
  const contiguous = vs.every((v, i) => i === 0 || v === vs[i - 1] + 1);
  const refVs = contiguous
    ? (vs.length > 1 ? `${vs[0]}–${vs[vs.length - 1]}` : `${vs[0]}`)
    : vs.join(', ');
  let x = vs.map((v) => data.c[c - 1][v - 1]).join(contiguous ? ' ' : ' … ');
  x = x.charAt(0).toUpperCase() + x.slice(1);
  return { id: `${b + 1}.${c}.${vs[0]}${vs.length > 1 ? '-' + vs[vs.length - 1] : ''}`, r: `${BOOKS[b].r} ${c}:${refVs}`, x, b, c, v: [vs[0], vs[vs.length - 1]] };
}
function updateSelBar() {
  const bar = $('#sel-bar');
  if (!selected.size) { bar.hidden = true; return; }
  bar.hidden = false;
  bar.innerHTML = `
    <button data-sel="save">${I.bookmark}Сохранить</button>
    <button data-sel="share">${I.share}Поделиться</button>
    <button data-sel="copy">${I.copy}Копировать</button>
    <button data-sel="clear">${I.close}Отмена</button>`;
}

function initBible() {
  bibleEl().addEventListener('click', (e) => {
    const t = e.target;
    let m;
    if (Plans.onClick(e) || Search.onClick(e)) return;
    if ((m = t.closest('[data-book]'))) renderChapters(+m.dataset.book);
    else if ((m = t.closest('[data-ch]'))) openChapter(bibleRoute.b, +m.dataset.ch);
    else if ((m = t.closest('[data-continue]'))) openChapter(S.last.b, S.last.c);
    else if ((m = t.closest('[data-nav]'))) {
      if (m.dataset.nav === 'books') renderBooks(); else renderChapters(bibleRoute.b);
    } else if ((m = t.closest('[data-go]'))) {
      if (!m.dataset.go) return;
      const [b, c] = m.dataset.go.split(',').map(Number);
      openChapter(b, c);
    } else if ((m = t.closest('.reader .v'))) {
      if (window.getSelection && String(window.getSelection()).length) return;
      const n = +m.dataset.v;
      if (selected.has(n)) { selected.delete(n); m.classList.remove('sel'); } else { selected.add(n); m.classList.add('sel'); }
      updateSelBar();
    }
  });
  bibleEl().addEventListener('input', (e) => Search.onInput(e));
  $('#sel-bar').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-sel]');
    if (!b) return;
    const act = b.dataset.sel;
    if (act === 'clear') { clearSelection(); return; }
    const it = await selectionItem();
    if (act === 'save') { if (!isSaved(it.id)) toggleSave(it); else toast('Уже в избранном'); }
    else if (act === 'share') openShare(it);
    else if (act === 'copy') { await copyText(shareText(it)); toast('Скопировано'); }
    if (act !== 'share') clearSelection();
  });
  renderBooks();
}

/* ======================================================================
   ИЗБРАННОЕ
   ====================================================================== */
let savedTab = 'saved';
function renderSaved() {
  const list = savedTab === 'saved'
    ? S.saved
    : [...S.likes].map((id) => FEED_BY_ID.get(id)).filter(Boolean).reverse();
  const item = (it) => {
    const [g1, g2] = gradFor(it.id);
    const art = artForId(it.id, it.t);
    return `<div class="saved-item" role="button" tabindex="0" data-open="${esc(it.id)}" style="--g1:${g1};--g2:${g2}${art ? `;--img:url('${art.src}')` : ''}">
      <p>${esc(it.x)}</p><small>${esc(it.r)}</small>
      <button class="rm" data-rm="${esc(it.id)}" aria-label="Убрать">${savedTab === 'saved' ? I.close : I.heartFill}</button>
    </div>`;
  };
  $('#saved').innerHTML = `
    <div class="page-head"><h1>Избранное</h1></div>
    <div class="seg">
      <button class="${savedTab === 'saved' ? 'on' : ''}" data-seg="saved">Сохранённое · ${S.saved.length}</button>
      <button class="${savedTab === 'liked' ? 'on' : ''}" data-seg="liked">Понравилось · ${S.likes.size}</button>
    </div>
    ${list.length ? list.map(item).join('') : `<div class="empty">${savedTab === 'saved' ? I.bookmark : I.heart}<br>${savedTab === 'saved'
      ? 'Здесь будут стихи, которые вы сохраните.<br>Нажмите «Сохранить» в ленте или выделите стих в Библии.'
      : 'Здесь будут стихи, которым вы поставили «нравится».<br>Дважды коснитесь стиха в ленте.'}</div>`}`;
}
function findAny(id) {
  return S.saved.find((s) => s.id === id) || FEED_BY_ID.get(id);
}
function initSaved() {
  $('#saved').addEventListener('click', (e) => {
    let m;
    if ((m = e.target.closest('[data-seg]'))) { savedTab = m.dataset.seg; renderSaved(); return; }
    if ((m = e.target.closest('[data-rm]'))) {
      const id = m.dataset.rm;
      if (savedTab === 'saved') { const it = findAny(id); if (it) toggleSave(it, true); }
      else { S.likes.delete(id); persist.likes(); const it = FEED_BY_ID.get(id); if (it) bump(it.t, -2.5); }
      renderSaved();
      return;
    }
    if ((m = e.target.closest('[data-open]'))) {
      const it = findAny(m.dataset.open);
      if (it) { openTab('bible'); openChapter(it.b, it.c, it.v); }
    }
  });
}

/* ======================================================================
   ЕЩЁ (настройки)
   ====================================================================== */
let offlineState = store.get('offline', 'none'); // none | loading | done
let offlineProgress = 0;
function renderMore() {
  const pct = Math.round(S.scale * 100);
  const off = offlineState === 'done' ? 'Скачана ✓'
    : offlineState === 'loading' ? `${offlineProgress}%` : 'Скачать';
  $('#more').innerHTML = `
    <div class="page-head"><h1>Ещё</h1></div>
    <div class="group">
      <div class="row"><div class="grow">Размер текста<small>Для ленты и чтения</small></div>
        <div class="size-ctl"><button data-size="-1" aria-label="Меньше">A−</button><span class="val">${pct}%</span><button data-size="1" aria-label="Больше">A+</button></div></div>
      <button class="row" data-offline><div class="grow">Библия без интернета<small>Все 66 книг и картины на телефоне, около 14 МБ</small></div><span class="val">${off}</span></button>
    </div>
    <div class="group">
      <button class="row" data-remind><div class="grow">Напоминание «Слово дня»<small>${esc(Reminders.label())}</small></div>${I.next}</button>
    </div>
    <div class="group">
      <button class="row" data-share-app><div class="grow">Поделиться приложением<small>Отправьте ссылку друзьям и близким</small></div>${I.share}</button>
      ${STANDALONE || Tg.inTg ? '' : `<a class="row" href="./#install" style="color:inherit;text-decoration:none"><div class="grow">Установить на экран «Домой»<small>Запуск как обычное приложение</small></div>${I.next}</a>`}
      <button class="row" data-goal-open><div class="grow">Цель на день<small>${esc(Goal.label())}</small></div>${I.next}</button>
      <button class="row" data-onb><div class="grow">Как пользоваться<small>Показать знакомство ещё раз</small></div>${I.next}</button>
      <button class="row" data-reset><div class="grow">Сбросить рекомендации<small>Лента снова станет общей</small></div></button>
    </div>
    <p class="about"><b>Свиток</b> — бесплатное приложение без рекламы и подписок. Текст: Синодальный перевод, канонические книги. Лайки, избранное и место чтения хранятся только на этом устройстве.</p>`;
}
function applyScale() { document.documentElement.style.setProperty('--scale', S.scale); }
function initMore() {
  $('#more').addEventListener('click', async (e) => {
    let m;
    if ((m = e.target.closest('[data-size]'))) {
      S.scale = Math.round(Math.max(0.8, Math.min(1.4, S.scale + 0.1 * +m.dataset.size)) * 10) / 10;
      store.set('scale', S.scale); applyScale(); renderMore();
    } else if (e.target.closest('[data-offline]')) {
      if (offlineState !== 'done') startOfflineDownload(true);
    } else if (e.target.closest('[data-share-app]')) {
      const data = { title: 'Свиток', text: 'Библия, которую хочется листать. Бесплатно, без рекламы.', url: appUrl() };
      if (Tg.inTg && Tg.shareText(data.text, data.url)) return;
      try { if (navigator.share) await navigator.share(data); else { await copyText(data.url); toast('Ссылка скопирована'); } } catch { /* отмена */ }
    } else if (e.target.closest('[data-remind]')) {
      Reminders.open();
    } else if (e.target.closest('[data-goal-open]')) {
      Goal.openSheet();
    } else if (e.target.closest('[data-onb]')) {
      Onboarding.start(true);
    } else if (e.target.closest('[data-reset]')) {
      S.weights = {}; S.seen = []; persist.weights(); persist.seen();
      toast('Рекомендации сброшены');
      if (currentTopic === 'foryou') resetFeed();
    }
  });
}

/* ---------- офлайн через Service Worker ---------- */
function startOfflineDownload(manual) {
  if (!navigator.serviceWorker || !navigator.serviceWorker.controller) {
    if (manual) toast('Перезапустите приложение и попробуйте снова');
    return;
  }
  offlineState = 'loading'; offlineProgress = 0;
  navigator.serviceWorker.controller.postMessage({ type: 'precache-bible', total: BOOKS.length, art: PAINTINGS.map((p) => p.src) });
  if ($('[data-view=more]').classList.contains('on')) renderMore();
}
function initSW() {
  if (!('serviceWorker' in navigator)) return;
  // Новая версия сайта → новый Service Worker сразу берёт управление → перезагружаем страницу один раз.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    // iPhone не перезапускает приложение с экрана «Домой», а разворачивает из фона —
    // поэтому проверяем обновления при каждом возвращении в приложение.
    const check = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    window.addEventListener('focus', check);
    setInterval(check, 30 * 60 * 1000);
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.type === 'bible-progress') {
      offlineProgress = Math.round((d.done / d.total) * 100);
      if (d.done >= d.total) { offlineState = d.failed ? 'none' : 'done'; store.set('offline', offlineState); }
      if ($('[data-view=more]').classList.contains('on')) renderMore();
    }
  });
}

/* ======================================================================
   ВКЛАДКИ И ЗАПУСК
   ====================================================================== */
function openTab(name) {
  const cur = $('.view.on')?.dataset.view;
  if (cur === name) {
    if (name === 'feed') feedEl().scrollTo({ top: 0, behavior: 'smooth' });
    if (name === 'bible' && bibleRoute.view !== 'books') renderBooks();
    return;
  }
  closeSheet();
  if (name !== 'bible') clearSelection();
  $('#app').dataset.tab = name;
  $$('.view').forEach((v) => v.classList.toggle('on', v.dataset.view === name));
  $$('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $('.topbar').classList.toggle('hidden', name !== 'feed');
  $('#install-pill').hidden = name !== 'feed' || STANDALONE || Tg.inTg || S.pillHidden;
  if (name === 'saved') renderSaved();
  if (name === 'more') renderMore();
  if (name === 'profile') Social.render();
}

let appStarted = false;
async function startApp() {
  if (appStarted) return;
  appStarted = true;
  applyScale();
  Tg.ready();
  try {
    [FEED, BOOKS, PAINTINGS] = await Promise.all([loadJSON('data/feed.json'), loadJSON('data/books.json'), loadJSON('data/paintings.json').catch(() => [])]);
  } catch {
    $('#feed').innerHTML = '<div class="empty" style="padding-top:40vh">Не удалось загрузить данные.<br>Проверьте интернет и откройте снова.</div>';
    return;
  }
  FEED_BY_ID = new Map(FEED.map((v) => [v.id, v]));
  ART_BY_TOPIC = {};
  PAINTINGS.forEach((p) => { ART_BY_ID.set(p.id, p); p.t.forEach((t) => (ART_BY_TOPIC[t] ||= []).push(p)); });
  BY_TOPIC = {};
  FEED.forEach((v) => (BY_TOPIC[v.t] ||= []).push(v));

  initFeed();
  initBible();
  initSaved();
  initMore();
  Social.init();
  Goal.init();
  Onboarding.init();
  DailyWord.maybeShow();

  $('#tabbar').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) openTab(b.dataset.tab); });
  $('#sheet-backdrop').addEventListener('click', closeSheet);
  $('#install-pill').hidden = STANDALONE || Tg.inTg || S.pillHidden;
  $('[data-hide-pill]').addEventListener('click', () => { S.pillHidden = true; store.set('pillHidden', true); $('#install-pill').hidden = true; });

  // Вся Библия тихо скачивается для офлайна в установленном приложении
  if (STANDALONE && offlineState !== 'done') {
    navigator.serviceWorker?.ready.then(() => setTimeout(() => startOfflineDownload(false), 2500));
  }
}

/* ======================================================================
   ЛЕНДИНГ
   ====================================================================== */
let landingStarted = false;
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const b = $('#android-install');
  if (b) b.hidden = false;
});

function startLanding() {
  if (landingStarted) return;
  landingStarted = true;

  // анимация телефона
  const cards = $$('.mini-card');
  ['rembrandt-head', 'aivazovsky-water', 'levitan-bells', 'plockhorst-shepherd'].forEach((id, k) => {
    cards[k]?.insertAdjacentHTML('afterbegin', `<img class="art ok" src="img/art/${id}.jpg" alt="" loading="lazy">`);
  });
  let i = 0;
  cards[0].classList.add('cur');
  setInterval(() => {
    const cur = cards[i], nxt = cards[(i + 1) % cards.length];
    cards.forEach((c) => { if (c !== cur && c !== nxt) { c.style.transition = 'none'; c.classList.remove('cur', 'prev'); void c.offsetWidth; c.style.transition = ''; } });
    cur.classList.remove('cur'); cur.classList.add('prev');
    nxt.classList.remove('prev'); nxt.classList.add('cur');
    i = (i + 1) % cards.length;
  }, 3200);

  // звёздное небо под размер экрана
  const stars = $('#l-stars');
  if (stars) {
    const W = 1600, H = 1100;
    stars.setAttribute('viewBox', `0 0 ${W} ${H}`);
    let s = '';
    for (let k = 0; k < 220; k++) {
      const r = Math.random() < 0.08 ? 1.6 : 0.5 + Math.random() * 0.9;
      const tw = Math.random() < 0.3 ? ` class="tw" style="animation-delay:-${(Math.random() * 4).toFixed(1)}s"` : '';
      s += `<circle cx="${(Math.random() * W).toFixed(0)}" cy="${(Math.random() * H * Math.random()).toFixed(0)}" r="${r.toFixed(1)}" opacity="${(0.25 + Math.random() * 0.7).toFixed(2)}"${tw}/>`;
    }
    stars.innerHTML = s;
  }
  // плавное появление при прокрутке
  const rv = $$('#landing .rv');
  if ('IntersectionObserver' in window) {
    const ob = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); ob.unobserve(e.target); }
    }), { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    rv.forEach((el, k) => { el.style.transitionDelay = `${Math.min(k % 4, 3) * 70}ms`; ob.observe(el); });
  } else rv.forEach((el) => el.classList.add('in'));
  // стеклянная шапка после прокрутки
  const nav = $('#l-nav');
  const onScroll = () => nav && nav.classList.toggle('scrolled', window.scrollY > 20);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // вкладки платформ
  const setOS = (os) => {
    $$('.os-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.os === os));
    $$('.os-pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === os));
    if (os === 'desktop') drawQR();
  };
  $('.os-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-os]'); if (b) setOS(b.dataset.os); });
  setOS(IS_IOS ? 'ios' : IS_ANDROID ? 'android' : 'desktop');

  if (!IS_IOS) $('#cta-install').firstChild.textContent = 'Установить на телефон ';

  // подсказки для iPhone не в Safari
  const notice = $('#ios-notice');
  if (IS_IOS) {
    if (/CriOS|FxiOS|EdgiOS|YaBrowser|OPiOS/.test(ua)) {
      notice.hidden = false;
      notice.textContent = 'Вы открыли страницу не в Safari. Установка надёжнее всего работает из Safari: скопируйте ссылку и откройте её там.';
    } else if (!/Safari/.test(ua)) {
      notice.hidden = false;
      notice.textContent = 'Похоже, страница открыта внутри другого приложения (Telegram, ВКонтакте…). Нажмите «Открыть в Safari» или скопируйте ссылку и вставьте её в Safari.';
    }
  }

  $$('[data-copy-link]').forEach((b) => b.addEventListener('click', async () => {
    const ok = await copyText(appUrl());
    b.textContent = ok ? 'Ссылка скопирована ✓' : appUrl();
  }));

  $('#android-install').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $('#android-install').hidden = true;
  });
}

let qrDrawn = false;
function drawQR() {
  if (qrDrawn) return;
  qrDrawn = true;
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
  s.onload = () => {
    /* global QRCode */
    new QRCode($('#qr'), { text: appUrl(), width: 160, height: 160, colorDark: '#0f0e0c', colorLight: '#ffffff' });
  };
  s.onerror = () => { $('#qr').textContent = appUrl(); $('#qr').style.cssText += ';width:auto;height:auto;color:#0f0e0c;word-break:break-all;font-size:13px'; };
  document.head.appendChild(s);
}

/* ---------- маршрутизация ---------- */
function route() {
  const app = STANDALONE || Tg.inTg || location.hash === '#app' || /[?&]pwa=1/.test(location.search);
  document.documentElement.classList.toggle('mode-app', app);
  if (app) startApp(); else startLanding();
}
window.addEventListener('hashchange', () => {
  if (Tg.inTg) return;
  if (location.hash === '#app' || STANDALONE) { route(); window.scrollTo(0, 0); }
  else if (document.documentElement.classList.contains('mode-app')) {
    route();
    const target = location.hash && document.getElementById(location.hash.slice(1));
    requestAnimationFrame(() => (target ? target.scrollIntoView() : window.scrollTo(0, 0)));
  }
});
initSW();
route();
