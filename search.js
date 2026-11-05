'use strict';

/* ======================================================================
   Поиск по Библии — полностью на телефоне.
   Понимает ссылки («Ин 3:16», «Псалом 22», «1 Кор 13») и слова по всему тексту.
   Использует общие помощники из app.js: $, $$, esc, BOOKS, loadBook,
   bibleEl, openChapter, renderChapters, plural, I.
   ====================================================================== */
const Search = (() => {
  let index = null;          // [{ b, c, v, t, n }] — t: исходный текст, n: в нижнем регистре, ё→е
  let indexing = null;
  let query = '';
  let scope = 'all';         // all | ot | nt
  let shown = 100;
  let timer = null;
  let from = null;           // [b, c] — главу открыли из результатов поиска

  const norm = (s) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const nameKey = (s) => s.toLowerCase().replace(/ё/g, 'е').replace(/^от\s+/, '').replace(/(\d)\s*-?\s*(е|я|ое|ая)(?=[\s\p{L}])/u, '$1').replace(/[\s.\-]/g, '');

  /* ---------- ссылки ---------- */
  let keys = null;
  function bookKeys() {
    if (keys) return keys;
    keys = BOOKS.map((bk, i) => {
      const k = new Set([nameKey(bk.n), nameKey(bk.s), nameKey(bk.r)]);
      if (bk.r === 'Псалтирь') { k.add('псалом'); k.add('псалмы'); k.add('пс'); }
      if (i === 42) k.add('иоанн');
      return [...k];
    });
    return keys;
  }
  function findBook(part) {
    const nk = nameKey(part);
    if (nk.length < 2 || !/\p{L}/u.test(nk)) return -1;
    const ks = bookKeys();
    let i = ks.findIndex((k) => k.includes(nk));
    if (i >= 0) return i;
    i = ks.findIndex((k) => k.some((x) => x.startsWith(nk)));
    return i;
  }
  function parseRef(q) {
    const m = q.trim().match(/^(.*?\p{L}[\p{L}.\s-]*?)\s*(\d+)?(?:\s*[:.,]\s*(\d+)(?:\s*[-–—]\s*(\d+))?)?$/u);
    if (!m) return null;
    const b = findBook(m[1]);
    if (b < 0) return null;
    const c = m[2] ? +m[2] : null;
    if (c && (c < 1 || c > BOOKS[b].c)) return null;
    const v1 = m[3] ? +m[3] : null;
    const v2 = m[4] ? +m[4] : v1;
    return { b, c, v1, v2 };
  }
  function refLabel({ b, c, v1, v2 }) {
    const bk = BOOKS[b];
    if (!c) return bk.n;
    const head = bk.r === 'Псалтирь' && !v1 ? `Псалом ${c}` : `${bk.r} ${c}`;
    return v1 ? `${head}:${v1}${v2 && v2 !== v1 ? '–' + v2 : ''}` : head;
  }

  /* ---------- текст ---------- */
  async function ensureIndex(onProgress) {
    if (index) return index;
    if (indexing) return indexing;
    indexing = (async () => {
      const out = [];
      let done = 0;
      const books = BOOKS.map((_, i) => i);
      const worker = async () => {
        while (books.length) {
          const b = books.shift();
          const data = await loadBook(b);
          data.c.forEach((vs, ci) => vs.forEach((t, vi) => out.push({ b, c: ci + 1, v: vi + 1, t, n: norm(t) })));
          done++;
          onProgress && onProgress(done, BOOKS.length);
        }
      };
      await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
      out.sort((x, y) => x.b - y.b || x.c - y.c || x.v - y.v);
      index = out;
      return out;
    })().catch((e) => { indexing = null; throw e; });
    return indexing;
  }
  // слово ищем с начала слова («любов» → «любовь»), короткие (до 3 букв) — только целиком
  const hasWord = (padded, w) => (w.length <= 3 ? padded.includes(` ${w} `) : padded.includes(` ${w}`));
  function findText(q) {
    const words = norm(q).split(' ').filter((w) => w.length >= 2);
    if (!words.length || !index) return { words, hits: [] };
    const phrase = ` ${words.join(' ')}`;
    const exact = [], rest = [];
    for (const e of index) {
      if (scope === 'ot' && BOOKS[e.b].nt) continue;
      if (scope === 'nt' && !BOOKS[e.b].nt) continue;
      const padded = ` ${e.n} `;
      if (!words.every((w) => hasWord(padded, w))) continue;
      (words.length > 1 && padded.includes(phrase) ? exact : rest).push(e);
    }
    return { words, hits: exact.concat(rest) };
  }
  function highlight(text, words) {
    const html = esc(text);
    if (!words.length) return html;
    const alt = words.map((w) => w.replace(/е/g, '[её]') + (w.length <= 3 ? '(?![\\p{L}])' : '')).join('|');
    return html.replace(new RegExp(`(?<![\\p{L}])(${alt})`, 'giu'), '<mark>$1</mark>');
  }

  /* ---------- экран ---------- */
  const resEl = () => $('#bsearch-res');
  const homeEl = () => $('#bible-home');

  async function run() {
    const res = resEl();
    if (!res) return;
    const q = query.trim();
    if (!q) { res.hidden = true; homeEl().hidden = false; return; }
    res.hidden = false;
    homeEl().hidden = true;
    const ref = parseRef(q);
    // ссылка с цифрами («Ин 3:16») — только переход; без цифр («Иоанна», «Плач») — переход и поиск по тексту
    const textQuery = !(ref && /\d/.test(q)) && norm(q).split(' ').filter((w) => w.length >= 2).length && !/^\d/.test(q.trim());
    let html = '';
    if (ref) {
      html += `<button class="bs-ref" data-sref="${ref.b},${ref.c || ''},${ref.v1 || ''},${ref.v2 || ''}">
        <span>${I.book}</span><div><small>Перейти</small><b>${esc(refLabel(ref))}</b></div>${I.next}</button>`;
    }
    html += `<div class="bs-scope">${[['all', 'Вся Библия'], ['ot', 'Ветхий Завет'], ['nt', 'Новый Завет']].map(([k, n]) => `<button class="${k === scope ? 'on' : ''}" data-sscope="${k}">${n}</button>`).join('')}</div>`;
    if (!textQuery) { res.innerHTML = html; return; }
    if (!index) {
      res.innerHTML = html + '<div class="bs-status" id="bs-status">Загружаем текст Библии…</div>';
      try {
        await ensureIndex((d, t) => { const s = $('#bs-status'); if (s) s.textContent = `Загружаем текст Библии… ${Math.round((d / t) * 100)}%`; });
      } catch {
        const s = $('#bs-status');
        if (s) s.textContent = 'Нет соединения. Скачайте Библию для офлайна в «Ещё», чтобы искать без интернета.';
        return;
      }
      if (query.trim() !== q) return;
    }
    const { words, hits } = findText(q);
    const list = hits.slice(0, shown);
    html += `<div class="bs-status">${hits.length ? `Найдено: ${hits.length} ${plural(hits.length, 'стих', 'стиха', 'стихов')}` : 'Ничего не нашлось. Попробуйте другое слово или ссылку вроде «Ин 3:16».'}</div>`;
    html += list.map((e) => `<button class="bs-item" data-shit="${e.b},${e.c},${e.v}">
      <small>${esc(BOOKS[e.b].r)} ${e.c}:${e.v}</small><p>${highlight(textOf(e), words)}</p></button>`).join('');
    if (hits.length > shown) html += `<button class="bs-more" data-smore>Показать ещё (${hits.length - shown})</button>`;
    res.innerHTML = html;
  }
  const textOf = (e) => e.t;

  function onInput(e) {
    if (e.target.id !== 'bsearch') return;
    query = e.target.value;
    shown = 100;
    const clear = $('.bs-clear');
    if (clear) clear.hidden = !query;
    clearTimeout(timer);
    timer = setTimeout(run, 250);
  }

  function open(b, c, v1, v2) {
    from = [b, c];
    openChapter(b, c, v1 ? [v1, v2 || v1] : null);
  }

  function onClick(e) {
    const t = e.target;
    let m;
    if ((m = t.closest('[data-sref]'))) {
      const [b, c, v1, v2] = m.dataset.sref.split(',').map((x) => (x === '' ? null : +x));
      if (!c) { from = null; renderChapters(b); } else open(b, c, v1, v2);
      return true;
    }
    if ((m = t.closest('[data-shit]'))) { const [b, c, v] = m.dataset.shit.split(',').map(Number); open(b, c, v, v); return true; }
    if ((m = t.closest('[data-sscope]'))) { scope = m.dataset.sscope; shown = 100; run(); return true; }
    if (t.closest('[data-smore]')) { shown += 100; run(); return true; }
    if (t.closest('.bs-clear')) {
      query = ''; const inp = $('#bsearch'); if (inp) { inp.value = ''; inp.focus(); }
      t.closest('.bs-clear').hidden = true; run(); return true;
    }
    if (t.closest('[data-nav="search"]')) { from = null; renderBooks(); return true; }
    return false;
  }

  /* для app.js */
  const isFrom = (b, c) => !!from && from[0] === b && from[1] === c;
  function boxHTML() {
    return `<div class="bsearch">${I.search}<input id="bsearch" type="search" placeholder="«не бойся» или «Ин 3:16»" enterkeyhint="search" autocomplete="off" autocorrect="off" spellcheck="false" value="${esc(query)}"><button class="bs-clear" aria-label="Очистить"${query ? '' : ' hidden'}>${I.close}</button></div>
      <div id="bsearch-res" class="bsearch-res" hidden></div>`;
  }
  function afterRender() { if (query.trim()) run(); }

  return { boxHTML, afterRender, onInput, onClick, isFrom, parseRef };
})();
