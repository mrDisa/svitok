'use strict';

/* ======================================================================
   Обсуждения под стихами: комментарии к стиху и ответы на них.
   Читают все — гости смотрят обсуждение без входа (через view verse_comments),
   пишут только вошедшие. Грубые слова и слишком частую отправку отсекает
   база (см. supabase/migrations/20261111120000_comments.sql), а не этот код,
   поэтому обойти правила правкой на телефоне нельзя.

   Использует из app.js: $, $$, esc, toast, openSheet, closeSheet, openTab,
   store, I, feedEl, bibleEl, bibleRoute, BOOKS, cardItems, loadBook;
   из social.js: Social.sb, Social.me, Social.avatar, Social.ago, Social.updateBadge.
   ====================================================================== */
const Comments = (() => {
  const sb = () => Social.sb;
  const me = () => Social.me;
  const enabled = () => Social.enabled && !broken;

  let broken = false;        // базы с обсуждениями ещё нет — молчим и не показываем кнопок
  const counts = new Map();  // «43.3.16» -> сколько комментариев
  const asked = new Set();   // про какие стихи уже спрашивали (даже если ответ 0)
  let notices = [];          // ответы мне, ещё не прочитанные
  let noticesAt = 0;

  /* ---------- ключи стихов ---------- */
  const parseKey = (key) => { const [b, c, v] = String(key).split('.').map(Number); return { b, c, v }; };
  const keyOf = (it) => String(it.id || '').split('-')[0];   // «24.3.22-23» -> «24.3.22»
  const keyOfVerse = (b, c, v) => `${b + 1}.${c}.${v}`;
  const refOf = (key) => {
    const { b, c, v } = parseKey(key);
    const bk = BOOKS[b - 1];
    return bk ? `${bk.r} ${c}:${v}` : `${c}:${v}`;
  };
  const cut = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  // признак того, что базы с обсуждениями ещё нет (миграция не применена)
  const missing = (e) => /PGRST202|PGRST205|does not exist|schema cache|404/i.test(`${e?.code || ''} ${e?.message || ''}`);

  /* ---------- сколько комментариев у стиха ---------- */
  async function askCounts(keys) {
    if (!enabled()) return;
    const want = [...new Set(keys)].filter((k) => k && !asked.has(k));
    if (!want.length) return;
    want.forEach((k) => asked.add(k));
    try {
      const { data, error } = await sb().rpc('comment_counts', { keys: want });
      if (error) {
        if (missing(error)) broken = true; else want.forEach((k) => asked.delete(k));
        return;
      }
      want.forEach((k) => counts.set(k, 0));
      (data || []).forEach((r) => counts.set(r.verse_key, Number(r.n) || 0));
    } catch { want.forEach((k) => asked.delete(k)); }
  }

  /* ---------- кнопка «Обсуждение» в ленте ---------- */
  function actionHTML(it) {
    if (!enabled()) return '';
    const n = counts.get(keyOf(it)) || 0;
    return `<button class="act" data-act="talk" aria-label="Обсуждение"><span class="ico">${I.talk}${n ? `<i class="cnt">${n > 99 ? '99+' : n}</i>` : ''}</span>Обсуждение</button>`;
  }
  const badge = (n) => (n > 99 ? '99+' : String(n));

  /* отметки на карточках: спрашиваем про соседние с открытой, остальным хватает кэша */
  function decorate(idx = 0) {
    if (!enabled()) return;
    const cards = $$('.card', feedEl());
    const keys = cards.slice(Math.max(0, idx - 1), idx + 4)
      .map((c) => cardItems.get(c.dataset.key)).filter(Boolean).map(keyOf);
    paint();
    askCounts(keys).then(paint);
  }
  function paint() {
    $$('.card', feedEl()).forEach((card) => {
      const ico = $('[data-act=talk] .ico', card);
      if (!ico) return;
      const it = cardItems.get(card.dataset.key);
      const n = it ? counts.get(keyOf(it)) || 0 : 0;
      let el = $('.cnt', ico);
      if (!n) { if (el) el.remove(); return; }
      if (!el) { el = document.createElement('i'); el.className = 'cnt'; ico.appendChild(el); }
      el.textContent = badge(n);
    });
  }
  /* число изменилось: обновляем ленту и отметку в открытой главе */
  function bump(key, delta) {
    counts.set(key, Math.max(0, (counts.get(key) || 0) + delta));
    asked.add(key);
    paint();
    const { b, c, v } = parseKey(key);
    if (bibleRoute.view === 'chapter' && bibleRoute.b === b - 1 && bibleRoute.c === c) chip(b - 1, c, v, counts.get(key));
  }

  /* ---------- отметки в главе Библии ---------- */
  async function markChapter(b, c) {
    if (!enabled()) return;
    let rows;
    try {
      const r = await sb().rpc('chapter_comment_counts', { p_book: b + 1, p_chapter: c });
      if (r.error) { if (missing(r.error)) broken = true; return; }
      rows = r.data || [];
    } catch { return; }
    if (bibleRoute.view !== 'chapter' || bibleRoute.b !== b || bibleRoute.c !== c) return;
    rows.forEach(({ verse, n }) => {
      counts.set(keyOfVerse(b, c, verse), Number(n) || 0);
      chip(b, c, verse, Number(n) || 0);
    });
  }
  /* кружок с числом в конце стиха: видно, что тут уже кто-то писал */
  function chip(b, c, v, n) {
    const span = $(`.reader .v[data-v="${v}"]`, bibleEl());
    if (!span) return;
    let el = $('.vcm', span);
    if (!n) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('button');
      el.type = 'button';
      el.className = 'vcm';
      el.dataset.cmv = v;
      span.appendChild(el);
    }
    el.innerHTML = `<i>${I.talk}</i>${badge(n)}`;
  }
  /* тап по кружку в главе (app.js спрашивает первым) */
  function onBibleClick(e) {
    const el = e.target.closest('.reader [data-cmv]');
    if (!el) return false;
    openByKey(keyOfVerse(bibleRoute.b, bibleRoute.c, +el.dataset.cmv));
    return true;
  }

  /* ---------- шторка обсуждения ---------- */
  /* из ленты и из выделения: подпись берём только у одиночного стиха,
     у диапазона («Плач Иеремии 3:22–23») показываем текст первого стиха из Библии */
  function openFromItem(it) {
    const single = Array.isArray(it.v) ? it.v[0] === it.v[1] : !/-/.test(String(it.id));
    openByKey(keyOf(it), single ? it.x : '');
  }
  async function openByKey(key, hint) {
    if (!Social.enabled) { toast('Обсуждения скоро появятся'); return; }
    const mine = me();
    let replyTo = null;
    let rows = [];
    openSheet(`
      <h2>Обсуждение</h2>
      <div class="cm-verse"><p id="cm-verse">${esc(hint || '')}</p><small>${esc(refOf(key))}</small></div>
      <div class="cm-list" id="cm-list"><div class="cm-load">Загружаем…</div></div>
      <form class="cm-form" id="cm-form">
        <div class="cm-replying" id="cm-replying" hidden></div>
        ${mine
          ? `<textarea name="text" rows="2" maxlength="1000" placeholder="Чем отозвался этот стих?" enterkeyhint="send"></textarea>
             <button class="as-btn" type="submit">Отправить</button>`
          : `<button class="as-btn" type="button" data-cm="login">Войдите, чтобы написать</button>`}
      </form>`, (sheet) => {
      const list = $('#cm-list', sheet);

      const reload = async () => {
        try {
          const { data, error } = await sb().from('verse_comments')
            .select('id, verse_key, parent_id, body, created_at, hidden, author, display_name, username, avatar_color, avatar_url')
            .eq('verse_key', key).order('created_at', { ascending: true }).limit(300);
          if (error) {
            if (missing(error)) broken = true;
            list.innerHTML = `<div class="cm-load">${missing(error) ? 'Обсуждения пока недоступны' : 'Не получилось загрузить. Проверьте связь'}</div>`;
            return;
          }
          rows = data || [];
        } catch {
          list.innerHTML = `<div class="cm-load">Нет соединения. Обсуждение откроется, когда появится сеть.</div>`;
          return;
        }
        if (!sheet.isConnected) return;
        list.innerHTML = listHTML(rows);
        counts.set(key, rows.filter((r) => !r.hidden).length);
        asked.add(key);
        paint();
        const { b, c, v } = parseKey(key);
        if (bibleRoute.view === 'chapter' && bibleRoute.b === b - 1 && bibleRoute.c === c) chip(b - 1, c, v, counts.get(key));
        list.scrollTop = list.scrollHeight;
      };
      void reload();

      // текст стиха берём из Библии, чтобы подпись всегда совпадала со стихом
      if (!hint) loadBookFromKey(key).then((t) => {
        const p = $('#cm-verse', sheet);
        if (t && p && sheet.isConnected) p.textContent = t;
      });

      function setReply(id, name) {
        replyTo = id || null;
        const box = $('#cm-replying', sheet);
        box.hidden = !replyTo;
        box.innerHTML = replyTo ? `<span>Ответ ${esc(name)}</span><button type="button" data-cm="unreply" aria-label="Отменить">✕</button>` : '';
        if (replyTo) $('textarea', sheet)?.focus();
      }

      sheet.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-cm]');
        if (!b) return;
        const act = b.dataset.cm;
        if (act === 'login') { closeSheet(); openTab('profile'); toast('Войдите, чтобы писать в обсуждении'); return; }
        if (act === 'unreply') { setReply(null); return; }
        if (act === 'reply') { setReply(b.dataset.id, b.dataset.name); return; }
        if (act === 'del') {
          if (!confirm('Удалить свой комментарий?')) return;
          const { error } = await sb().from('comments').delete().eq('id', b.dataset.id);
          if (error) { toast('Не получилось удалить'); return; }
          toast('Удалено');
          await reload();
          return;
        }
        if (act === 'report') {
          if (!me()) { closeSheet(); openTab('profile'); toast('Войдите, чтобы пожаловаться'); return; }
          const { error } = await sb().from('comment_reports').insert({ comment_id: +b.dataset.id, reporter: me().id });
          if (error?.code === '23505') toast('Вы уже жаловались на этот комментарий');
          else if (error) toast('Не получилось отправить жалобу');
          else toast('Спасибо, мы посмотрим');
        }
      });

      // на компьютере Enter отправляет, Shift+Enter — перенос строки
      if (!IS_IOS && !IS_ANDROID) $('textarea', sheet)?.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.shiftKey) return;
        e.preventDefault();
        $('#cm-form', sheet).dispatchEvent(new Event('submit', { cancelable: true }));
      });

      $('#cm-form', sheet).addEventListener('submit', async (e) => {
        e.preventDefault();
        const ta = $('textarea', sheet);
        const text = ta.value.trim();
        if (!text) { toast('Напишите пару слов'); return; }
        const wasReply = !!replyTo;
        const btn = $('button[type=submit]', sheet);
        btn.disabled = true;
        let error = null;
        try {
          const { b, c, v } = parseKey(key);
          const r = await sb().from('comments').insert({
            verse_key: key, book: b, chapter: c, verse: v, parent_id: replyTo, author: me().id, body: text,
          });
          error = r.error;
        } catch (err) { error = err; }
        btn.disabled = false;
        if (error) { toast(errText(error)); return; }
        ta.value = '';
        setReply(null);
        toast(wasReply ? 'Ответ отправлен' : 'Спасибо! Комментарий добавлен');
        await reload();
      });
    });
  }

  async function loadBookFromKey(key) {
    const { b, c, v } = parseKey(key);
    try {
      const data = await loadBook(b - 1);
      return data.c[c - 1]?.[v - 1] || '';
    } catch { return ''; }
  }

  const errText = (e) => {
    const m = `${e?.message || ''} ${e?.code || ''}`;
    if (/bad_words/.test(m)) return 'Пожалуйста, без грубых слов';
    if (/rate_limit/.test(m)) return 'Слишком часто. Отдохните немного и напишите снова';
    if (/too_deep|no_parent|wrong_verse/.test(m)) return 'На этот комментарий ответить нельзя';
    if (/empty/.test(m)) return 'Напишите пару слов';
    if (/23514/.test(m)) return 'Слишком длинный комментарий';
    if (missing(e)) return 'Обсуждения пока недоступны';
    return 'Не получилось отправить. Проверьте связь';
  };

  function listHTML(rows) {
    const mine = me();
    if (!rows.length) return `<div class="cm-empty">Пока никто не писал.<br>Скажите первым, чем отозвался этот стих.</div>`;
    const kids = new Map();
    rows.forEach((r) => {
      if (!r.parent_id) return;
      if (!kids.has(r.parent_id)) kids.set(r.parent_id, []);
      kids.get(r.parent_id).push(r);
    });
    return rows.filter((r) => !r.parent_id)
      .map((r) => itemHTML(r, false, mine) + (kids.get(r.id) || []).map((k) => itemHTML(k, true, mine)).join(''))
      .join('');
  }
  function itemHTML(r, isReply, mine) {
    const own = mine && r.author === mine.id;
    return `<div class="cm${isReply ? ' cm-kid' : ''}" data-id="${r.id}">
      <div class="cm-who">${Social.avatar({ display_name: r.display_name, avatar_color: r.avatar_color, avatar_url: r.avatar_url }, isReply ? 28 : 34)}
        <b>${esc(r.display_name || 'Друг')}</b><span>${esc(Social.ago(r.created_at))}</span></div>
      <p>${esc(r.body)}</p>
      ${r.hidden ? `<div class="cm-hid">Скрыт до проверки — виден только вам</div>` : ''}
      <div class="cm-acts">
        ${isReply ? '' : `<button type="button" data-cm="reply" data-id="${r.id}" data-name="${esc(r.display_name || '')}">Ответить</button>`}
        ${own
          ? `<button type="button" data-cm="del" data-id="${r.id}">Удалить</button>`
          : `<button type="button" data-cm="report" data-id="${r.id}">Пожаловаться</button>`}
      </div>
    </div>`;
  }

  /* ---------- «вам ответили» в профиле ---------- */
  const notifyOn = () => store.get('notifyReplies', true) !== false;

  async function load(force) {
    if (!Social.enabled) return;
    if (!me() || !notifyOn()) {
      if (notices.length) { notices = []; renderNotices(); }
      return;
    }
    if (!force && Date.now() - noticesAt < 30_000) return;
    noticesAt = Date.now();
    try {
      const { data, error } = await sb().from('comment_notices')
        .select('id, created_at, comment:comments!comment_notices_comment_id_fkey(id, body, verse_key, author, ap:profiles!comments_author_fkey(display_name, avatar_color, avatar_url))')
        .eq('recipient', me().id).is('read_at', null)
        .order('created_at', { ascending: false }).limit(20);
      if (error) { if (missing(error)) broken = true; return; }
      notices = data || [];
    } catch { return; }
    renderNotices();
  }
  function renderNotices() {
    Social.updateBadge();
    const box = $('#profile .cm-notices');
    if (box) box.innerHTML = noticesHTML();
  }
  function noticesHTML() {
    if (!notices.length) return '';
    return `<div class="sec-title">Ответы вам · ${notices.length}</div>
      <div class="group">${notices.map((n) => {
        const c = n.comment || {};
        const a = c.ap || {};
        return `<button class="row cm-notice" data-cm-notice="${esc(c.verse_key || '')}" data-nid="${n.id}">
          ${Social.avatar(a, 38)}
          <div class="grow"><b>${esc(a.display_name || 'Друг')} ответил вам</b><small>${esc(cut(c.body, 140))}</small>
          <small class="cm-ref">${esc(c.verse_key ? refOf(c.verse_key) : '')} · ${esc(Social.ago(n.created_at))}</small></div>
          ${I.next}</button>`;
      }).join('')}</div>`;
  }
  /* сколько непрочитанных ответов — для значка на вкладке «Профиль» */
  const unread = () => (notifyOn() ? notices.length : 0);

  function readNotice(id, key) {
    notices = notices.filter((n) => String(n.id) !== String(id));
    renderNotices();
    sb().from('comment_notices').update({ read_at: new Date().toISOString() }).eq('id', id).then(() => {}, () => {});
    if (key) openByKey(key);
  }
  function toggleNotify() {
    const next = !notifyOn();
    store.set('notifyReplies', next);
    if (next) load(true);
    else { notices = []; renderNotices(); }
    return next;
  }

  /* ---------- запуск ---------- */
  function init() {
    $('#profile').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cm-notice]');
      if (!b || !b.dataset.cmNotice) return;
      readNotice(b.dataset.nid, b.dataset.cmNotice);
    });
    if (Social.enabled) load();
  }

  return {
    init, load, unread, toggleNotify, profileHTML: noticesHTML,
    get available() { return enabled(); },
    actionHTML, decorate, markChapter, onBibleClick, openByKey, openFromItem, bump,
    keyOf, refOf, notifyOn,
  };
})();
