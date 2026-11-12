'use strict';

/* Лента личных размышлений. Видимость публикаций проверяет RLS в Supabase. */
const Posts = (() => {
  let items = new Map(), request = 0, savedIds = new Set(), resume = null;
  let route = { author: null, filter: 'all' }, offset = 0, more = false, loading = false;
  const PAGE = 20;
  const draftKey = () => `postDraft:${Social.me?.id}`;
  const emptyDraft = () => ({ body: '', visibility: 'friends' });
  const show = () => $('#app').dataset.tab === 'posts' ? render() : openTab('posts');
  const remember = (it, form) => store.set(draftKey(), { verse: it, body: form.elements.body.value, visibility: form.elements.visibility.value });
  const sb = () => Social.sb;
  const root = () => $('#posts');
  const ready = () => !!Social.me && !!sb();
  const errorText = (error) => {
    console.error('posts operation', error?.code, error?.message);
    if (['PGRST202', 'PGRST205', '42P01', '42703'].includes(error?.code)) return 'Публикации ещё не подключены на сервере. Попробуйте позже';
    if (/bad_words/.test(error?.message || '')) return 'Пожалуйста, уберите грубые слова';
    if (/rate_limit/.test(error?.message || '')) return 'Слишком часто. Попробуйте позже';
    if (error?.code === '42501' || /JWT|session/i.test(error?.message || '')) return 'Нет доступа. Войдите в аккаунт заново и повторите попытку';
    return 'Не удалось выполнить действие. Попробуйте ещё раз';
  };

  function postSheet(html, mount) {
    const previous = document.activeElement;
    openSheet(`<button type="button" class="post-sheet-close" aria-label="Закрыть окно">×</button>${html}`, (sheet) => {
      mount(sheet);
      const close = $('.post-sheet-close', sheet); close.onclick = closeSheet;
      (close.getClientRects().length ? close : $('.grab', sheet)).focus({ preventScroll: true });
      sheet.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return; }
        if (e.key !== 'Tab') return;
        const focusable = $$('button:not(:disabled),input:not([type=hidden]),textarea,select,summary', sheet).filter((node) => node.getClientRects().length && !node.closest('[inert]'));
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      });
    }, () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); });
  }

  function compose(it, draft = { body: '', visibility: 'friends' }) {
    if (!ready()) { toast('Войдите в профиль, чтобы опубликовать мысль'); return; }
    const art = it.art || artForId(it.id, it.t);
    if (!art) return toast('Картины ещё загружаются. Попробуйте снова');
    postSheet(`<div class="compose-heading"><span>НОВЫЙ ПОСТ</span><h2>Ваша мысль о Писании</h2><p>Стих уже прикреплён. Добавьте то, что откликнулось вам.</p></div><div class="compose-verse"${art ? ` style="--post-art:url('${art.src}')"` : ''}><p>${esc(it.x)}</p><b>${esc(it.r)}</b><button type="button" data-change-verse>Изменить стих</button></div><form id="post-compose" class="post-form"><label>Ваша мысль<textarea name="body" required maxlength="2000" rows="4" placeholder="Что эти слова значат для вас сегодня?">${esc(draft.body)}</textarea></label><div class="post-audience"><span id="post-audience-label">Кто увидит</span><input type="hidden" name="visibility" value="friends"><details><summary aria-labelledby="post-audience-label post-audience-value"><span id="post-audience-value">Друзья</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></summary><div class="post-audience-options" role="group" aria-label="Кто увидит"><button type="button" data-audience="friends" aria-pressed="true">Друзья</button><button type="button" data-audience="private" aria-pressed="false">Только я</button></div></details></div><button type="submit" class="post-primary">Опубликовать</button><p role="status" class="post-error"></p></form>`, (sheet) => {
      $('#post-compose', sheet).elements.visibility.value = draft.visibility;
      const composeForm = $('#post-compose', sheet), author = Social.me.id;
      const submit = $('[type=submit]', composeForm);
      const counter = document.createElement('span'); counter.className = 'post-counter';
      $('textarea', composeForm).after(counter);
      const updateDraft = () => {
        const length = composeForm.elements.body.value.length;
        counter.textContent = `Черновик сохранён · ${length} / 2 000`;
        submit.disabled = composeForm.dataset.sending === 'true' || !composeForm.elements.body.value.trim();
        remember(it, composeForm);
      };
      composeForm.addEventListener('input', updateDraft);
      updateDraft();
      const audience = $('.post-audience', sheet), dropdown = $('details', audience);
      const summary = $('summary', dropdown), options = $('.post-audience-options', dropdown);
      let expanded = false, animation = null;
      summary.setAttribute('aria-expanded', 'false');
      const setExpanded = (next) => {
        if (next === expanded) return;
        const from = dropdown.getBoundingClientRect().height;
        animation?.cancel();
        expanded = next;
        // Оставляем details открытым до завершения обратного движения.
        dropdown.open = true;
        dropdown.dataset.expanded = String(next);
        summary.setAttribute('aria-expanded', String(next));
        options.inert = !next;
        const closedHeight = summary.getBoundingClientRect().height + 2;
        const to = closedHeight + (next ? options.getBoundingClientRect().height : 0);
        animation = dropdown.animate([{ height: `${from}px` }, { height: `${to}px` }], {
          duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 240,
          easing: 'cubic-bezier(.2,.8,.2,1)',
        });
        const current = animation;
        current.onfinish = () => {
          if (animation !== current) return;
          dropdown.open = expanded;
          animation = null;
        };
      };
      summary.addEventListener('click', (e) => { e.preventDefault(); setExpanded(!expanded); });
      const updateAudience = (value) => {
        $('#post-compose', sheet).elements.visibility.value = value;
        $('#post-audience-value', sheet).textContent = value === 'private' ? 'Только я' : 'Друзья';
        $$('[data-audience]', audience).forEach((option) => option.setAttribute('aria-pressed', String(option.dataset.audience === value)));
        remember(it, composeForm);
      };
      updateAudience(draft.visibility);
      audience.addEventListener('click', (e) => {
        const option = e.target.closest('[data-audience]');
        if (option) { updateAudience(option.dataset.audience); setExpanded(false); summary.focus(); }
      });
      sheet.addEventListener('click', (e) => { if (!audience.contains(e.target)) setExpanded(false); });
      audience.addEventListener('keydown', (e) => { if (e.key === 'Escape' && expanded) { e.stopPropagation(); setExpanded(false); summary.focus(); } });
      $('[data-change-verse]', sheet).onclick = () => {
        const form = $('#post-compose', sheet);
        chooseVerse({ body: form.elements.body.value, visibility: form.elements.visibility.value });
      };
      $('#post-compose', sheet).onsubmit = async (event) => {
        event.preventDefault(); const form = event.target, button = $('[type=submit]', form);
        if (form.dataset.sending === 'true') return;
        const body = form.elements.body.value.trim(); if (!body) return;
        if (Social.me?.id !== author) return toast('Войдите в свой аккаунт');
        form.dataset.sending = 'true'; button.disabled = true; button.textContent = 'Публикуем…';
        $('.post-error', form).textContent = '';
        try {
          const { error } = await sb().from('posts').insert({ author, body, visibility: form.elements.visibility.value, art_id: art.id, verse: { id: it.id, b: it.b, c: it.c, v: it.v, r: it.r, x: it.x } });
          if (error) throw error;
          const latestDraft = store.get(`postDraft:${author}`, null);
          if (latestDraft?.verse?.id === it.id && latestDraft.body.trim() === body) store.set(`postDraft:${author}`, null);
          if (!form.isConnected) return;
          closeSheet(); route = { author: null, filter: 'all' }; show(); toast('Пост опубликован');
        } catch (error) { $('.post-error', form).textContent = errorText(error); }
        finally { form.dataset.sending = 'false'; button.disabled = false; button.textContent = 'Опубликовать'; }
      };
    });
  }

  function chooseVerse(draft) {
    if (!ready()) { toast('Войдите в профиль, чтобы создать пост'); return; }
    postSheet(`<div class="compose-heading"><span>НОВЫЙ ПОСТ · ВЫБОР СТИХА</span><h2>О чём хотите написать?</h2><p>Укажите местописание или вернитесь в ленту и нажмите «Написать об этом стихе».</p></div><form class="post-form" id="post-verse-picker"><label>Местописание<input name="reference" required placeholder="Например, Ин 3:16 или Пс 22:1–3" autocomplete="off"></label><button class="post-primary">Выбрать стих</button><p class="post-error" role="status"></p></form><button class="verse-day-choice">${I.book}<span>Взять стих дня<small>${esc(verseOfDay().r)}</small></span>${I.next}</button>`, (sheet) => {
      $('.verse-day-choice', sheet).onclick = () => compose(verseOfDay(), draft);
      $('#post-verse-picker', sheet).onsubmit = async (e) => {
        e.preventDefault(); const form = e.target, status = $('.post-error', form);
        if (form.dataset.loading === 'true') return;
        const ref = Search.parseRef(form.elements.reference.value);
        if (!ref?.c || !ref.v1) { status.textContent = 'Укажите книгу, главу и стих, например Ин 3:16'; return; }
        try {
          form.dataset.loading = 'true'; $('button', form).disabled = true;
          const book = await loadBook(ref.b), verses = book.c[ref.c - 1];
          if ($('#post-verse-picker') !== form) return;
          if (ref.v1 < 1 || ref.v2 < ref.v1 || ref.v2 > verses.length || ref.v2 - ref.v1 > 9) { status.textContent = 'Выберите от 1 до 10 существующих стихов одной главы'; return; }
          compose({ id: `${ref.b + 1}.${ref.c}.${ref.v1}`, b: ref.b, c: ref.c, v: [ref.v1, ref.v2], r: `${BOOKS[ref.b].r} ${ref.c}:${ref.v1}${ref.v2 !== ref.v1 ? '–' + ref.v2 : ''}`, x: verses.slice(ref.v1 - 1, ref.v2).join(' ') }, draft);
        } catch { status.textContent = 'Не удалось загрузить главу. Попробуйте ещё раз'; }
        finally { form.dataset.loading = 'false'; $('button', form).disabled = false; }
      };
    });
  }

  function card(post, saved) {
    const art = ART_BY_ID.get(post.art_id), mine = post.author === Social.me.id;
    const count = post.post_comments?.[0]?.count || 0;
    return `<article class="post-card" data-post="${esc(post.id)}"><header><button class="post-person" data-post-action="profile" aria-label="Профиль: ${esc(post.p?.display_name || 'Автор')}">${Social.avatar(post.p,40)}<span><b>${esc(post.p?.display_name || 'Автор')}</b><small>${esc(Social.ago(post.created_at))}<span class="post-audience-badge">${post.visibility === 'private' ? 'Только я' : 'Друзья'}</span></small></span></button>${mine ? '<button class="icon-btn" data-post-action="delete" aria-label="Действия с публикацией">⋯</button>' : ''}</header><button class="post-verse" data-post-action="chapter" aria-label="Открыть главу: ${esc(post.verse.r)}"${art ? ` style="--post-art:url('${art.src}')"` : ''}><span>${esc(post.verse.x)}</span><b>${esc(post.verse.r)} <span aria-hidden="true">↗</span></b>${art ? `<small>${esc(artCredit(art))}</small>` : ''}</button><p class="post-thought">${esc(post.body)}</p><footer><button data-post-action="comments" aria-label="Комментарии: ${count}">${I.talk}<span>Комментарии</span><b class="post-comment-count">${count || ''}</b></button><button data-post-action="save" aria-label="${saved ? 'Убрать из сохранённых' : 'Сохранить пост'}" aria-pressed="${saved}">${I.bookmark}<span>${saved ? 'Сохранён' : 'Сохранить'}</span></button><button data-post-action="share" aria-label="Отправить стих и мысль в чат">${I.share}<span>В чат</span></button></footer></article>`;
  }

  function emptyHTML() {
    const saved = route.filter === 'saved', own = route.filter === 'mine';
    return `<div class="post-empty"><span aria-hidden="true">${saved ? '◇' : '✧'}</span><h2>${saved ? 'Здесь будет то, что откликнулось' : own ? 'Ваша первая мысль' : route.author ? 'Публикаций пока нет' : 'Начните разговор'}</h2><p>${saved ? 'Нажмите «Сохранить» под постом — и он появится здесь, пока доступен вам.' : route.author ? 'Здесь появятся записи, которыми автор поделится с вами.' : 'Выберите стих и расскажите, что он значит для вас. В этой ленте будут ваши публикации и мысли друзей.'}</p>${saved ? '<button class="post-secondary" data-post-filter="all">К ленте</button>' : !route.author ? '<button class="post-primary" data-post-new>Создать первый пост</button>' : ''}</div>`;
  }

  async function render(author, onlySaved) {
    const canResume = author === undefined && resume?.user === Social.me?.id && resume?.route === JSON.stringify(route) && $('.post-card', root());
    resume = null;
    if (canResume) return;
    if (author !== undefined) route = { author, filter: onlySaved ? 'saved' : 'all' };
    ++request; items = new Map(); offset = 0; more = false; loading = false;
    root().scrollTop = 0;
    root().innerHTML = `${route.author ? '<button class="post-back" data-post-profile-back>← Назад в профиль</button>' : ''}<div class="post-page-head"><div><h1>${route.author ? 'Публикации автора' : 'Мысли друзей'}</h1><p>Стихи, которые объединяют. Мысли, которыми делятся.</p></div><button data-post-new class="post-primary">${I.text}<span>Создать пост</span></button></div>${!route.author ? `<div class="post-filters" role="group" aria-label="Публикации">${[['all','Лента'],['mine','Мои посты'],['saved','Сохранённые']].map(([key,label]) => `<button data-post-filter="${key}" aria-pressed="${route.filter === key}">${label}</button>`).join('')}</div>` : ''}<div id="post-list" aria-live="polite"></div><div id="post-pagination"></div>`;
    if (!ready()) { $('#post-list').innerHTML = '<div class="post-empty"><h2>Ближе к тем, кто вам дорог</h2><p>Войдите, чтобы читать мысли друзей, сохранять публикации и делиться своими.</p><button class="post-primary" data-post-login>Войти в профиль</button></div>'; return; }
    await loadPage(true);
  }

  async function loadPage(first = false) {
    if (loading || !ready()) return;
    loading = true; const ticket = request, userId = Social.me.id;
    const list = $('#post-list'), pagination = $('#post-pagination');
    const current = () => ticket === request && Social.me?.id === userId && list.isConnected;
    if (first) list.innerHTML = '<div class="post-skeleton" aria-label="Загружаем публикации"><i></i><i></i><i></i></div>';
    else pagination.innerHTML = '<p class="post-loading" role="status">Загружаем…</p>';
    try {
      if (first) {
        const { data, error } = await sb().from('post_saves').select('post_id');
        if (error) throw error;
        if (!current()) return;
        savedIds = new Set((data || []).map((s) => s.post_id));
      }
      if (route.filter === 'saved' && !savedIds.size) { list.innerHTML = emptyHTML(); pagination.innerHTML = ''; return; }
      let query = sb().from('posts').select('*,post_comments(count),p:profiles!posts_author_fkey(id,display_name,username,avatar_color,avatar_url)').order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + PAGE);
      if (route.author || route.filter === 'mine') query = query.eq('author', route.author || userId);
      if (route.filter === 'saved') query = query.in('id', [...savedIds]);
      const { data, error } = await query;
      if (error) throw error;
      if (!current()) return;
      more = data.length > PAGE;
      const batch = data.slice(0, PAGE); offset += batch.length;
      batch.forEach((post) => items.set(post.id, post));
      if (first) list.innerHTML = '';
      batch.forEach((post) => { if (!$(`[data-post="${post.id}"]`, list)) list.insertAdjacentHTML('beforeend', card(post, savedIds.has(post.id))); });
      if (!items.size) list.innerHTML = emptyHTML();
      pagination.innerHTML = more ? '<button class="post-secondary" data-post-more>Показать ещё</button>' : '';
    } catch (error) {
      if (!current()) return;
      const target = first ? list : pagination;
      target.innerHTML = `<div class="post-load-error" role="status"><p>${esc(errorText(error))}</p><button class="post-secondary" ${first ? 'data-post-retry' : 'data-post-more'}>Попробовать снова</button></div>`;
    } finally { if (ticket === request) loading = false; }
  }

  async function comments(post) {
    postSheet(`<h2>Комментарии</h2><p class="post-discussion-ref">${esc(post.verse.r)}</p><div id="post-comments" aria-live="polite">Загружаем…</div><div id="post-comments-more"></div><form class="post-form" id="post-comment-form"><label>Ваш комментарий<textarea name="body" maxlength="1000" required rows="2" placeholder="Поделитесь мыслью или задайте вопрос…"></textarea></label><button class="post-primary" type="submit" disabled>Отправить</button><p role="status" class="post-error"></p></form>`, (sheet) => {
      let commentOffset = 0, busy = false, refreshPending = false;
      const userId = Social.me.id, form = $('#post-comment-form', sheet), submit = $('[type=submit]', form);
      const available = () => $('#post-comment-form') === form && Social.me?.id === userId;
      const updateCount = (delta) => {
        post.post_comments = [{ count: Math.max(0, (post.post_comments?.[0]?.count || 0) + delta) }];
        const count = post.post_comments[0].count, button = $(`[data-post="${post.id}"] [data-post-action=comments]`, root());
        if (button) { $('.post-comment-count', button).textContent = count || ''; button.setAttribute('aria-label', `Комментарии: ${count}`); }
      };
      const load = async (append = false) => {
        if (busy) { if (!append) refreshPending = true; return; } busy = true;
        if (!append) commentOffset = 0;
        const list = $('#post-comments', sheet), moreEl = $('#post-comments-more', sheet);
        moreEl.innerHTML = '';
        try {
          const { data, error } = await sb().from('post_comments').select('*,p:profiles!post_comments_author_fkey(display_name,avatar_color,avatar_url)').eq('post_id', post.id).order('created_at').order('id').range(commentOffset, commentOffset + 20);
          if (error) throw error;
          if (!available()) return;
          if (!append) list.innerHTML = '';
          const batch = data.slice(0, 20); commentOffset += batch.length;
          list.insertAdjacentHTML('beforeend', batch.map((c) => `<div class="post-comment" data-comment="${c.id}"><div class="post-comment-head">${Social.avatar(c.p,32)}<b>${esc(c.p?.display_name || 'Автор')}</b><small>${esc(Social.ago(c.created_at))}</small>${c.author === userId ? '<button type="button" data-comment-delete aria-label="Удалить свой комментарий">Удалить</button>' : ''}</div><p>${esc(c.body)}</p></div>`).join(''));
          if (!commentOffset) list.innerHTML = '<div class="post-comments-empty">Пока тихо. Ваш комментарий может начать разговор.</div>';
          moreEl.innerHTML = data.length > 20 ? '<button class="post-secondary" data-comments-more>Ещё комментарии</button>' : '';
        } catch (error) { if (available()) moreEl.innerHTML = `<p class="post-error" role="status">${esc(errorText(error))}</p><button class="post-secondary" data-comments-more>Попробовать снова</button>`; }
        finally { busy = false; if (refreshPending && available()) { refreshPending = false; load(); } }
      };
      sheet.addEventListener('click', async (e) => {
        if (e.target.closest('[data-comments-more]')) return load(commentOffset > 0);
        const button = e.target.closest('[data-comment-delete]'); if (!button || button.disabled) return;
        if (!available()) return;
        const row = button.closest('[data-comment]'); button.disabled = true;
        try {
          const { data, error } = await sb().from('post_comments').delete().eq('id', row.dataset.comment).eq('author', userId).select('id');
          if (error) throw error;
          if (!data?.length) throw new Error('Комментарий недоступен');
          if (!available()) return;
          updateCount(-1); await load();
        } catch (error) { if (available()) $('.post-error', form).textContent = errorText(error); }
        finally { button.disabled = false; }
      });
      form.addEventListener('input', () => { submit.disabled = form.dataset.sending === 'true' || !form.elements.body.value.trim(); });
      load();
      $('#post-comment-form', sheet).onsubmit = async (e) => {
        e.preventDefault(); const body = form.elements.body.value.trim(); if (!body || form.dataset.sending === 'true' || !available()) return;
        form.dataset.sending = 'true'; submit.disabled = true; submit.textContent = 'Отправляем…'; $('.post-error', form).textContent = '';
        try {
          const { error } = await sb().from('post_comments').insert({ post_id: post.id, author: userId, body });
          if (error) throw error;
          if (!available()) return;
          form.reset(); updateCount(1); await load();
        } catch (error) { if (available()) $('.post-error', form).textContent = errorText(error); }
        finally { form.dataset.sending = 'false'; submit.disabled = !form.elements.body.value.trim(); submit.textContent = 'Отправить'; }
      };
    });
  }

  function init() {
    document.addEventListener('click', async (e) => {
      try {
      const home = e.target.closest('[data-home]'); if (home) { if (home.dataset.home === 'posts') { route = { author: null, filter: 'all' }; return show(); } return openTab(home.dataset.home); }
      const profile = e.target.closest('[data-author-posts]'); if (profile) { route = { author: profile.dataset.authorPosts, filter: 'all' }; return show(); }
      if (e.target.closest('[data-post-profile-back]')) return openTab('profile');
      if (e.target.closest('[data-post-login]')) return openTab('profile');
      if (e.target.closest('[data-post-retry]')) return render();
      if (e.target.closest('[data-post-more]')) return loadPage();
      if (e.target.closest('[data-post-new]')) {
        const draft = store.get(draftKey(), null);
        if (draft?.verse && draft.body?.trim()) {
          postSheet('<h2>У вас есть черновик</h2><p class="sheet-text">Продолжить начатую мысль?</p><div class="sheet-actions"><button class="primary" data-resume-post>Продолжить</button><button class="wide" data-fresh-post>Начать новый пост</button></div>', (sheet) => {
            $('[data-resume-post]', sheet).onclick = () => compose(draft.verse, draft);
            $('[data-fresh-post]', sheet).onclick = () => chooseVerse(emptyDraft());
          }); return;
        }
        return chooseVerse(emptyDraft());
      }
      const filter = e.target.closest('[data-post-filter]');
      if (filter) { route = { author: null, filter: filter.dataset.postFilter }; return render(); }
      const button = e.target.closest('[data-post-action]'); if (!button) return;
      if (button.disabled || !ready()) return;
      const post = items.get(button.closest('[data-post]').dataset.post); if (!post) return;
      const action = button.dataset.postAction;
      if (action === 'profile') { resume = { user: Social.me.id, route: JSON.stringify(route) }; return Social.viewProfile(post.author); }
      if (action === 'chapter') { openTab('bible'); return openChapter(post.verse.b, post.verse.c, post.verse.v); }
      if (action === 'comments') return comments(post);
      if (action === 'share') return Social.sendVerse({ ...post.verse, art: ART_BY_ID.get(post.art_id) }, post.body);
      if (action === 'save') {
        button.disabled = true; const saved = button.getAttribute('aria-pressed') === 'true';
        const userId = Social.me.id;
        try {
          const { error } = saved ? await sb().from('post_saves').delete().eq('user_id', userId).eq('post_id', post.id) : await sb().from('post_saves').upsert({ user_id: userId, post_id: post.id }, { onConflict: 'user_id,post_id', ignoreDuplicates: true });
          if (error) throw error;
          if (Social.me?.id !== userId) return;
          if (saved) savedIds.delete(post.id); else savedIds.add(post.id);
          button.setAttribute('aria-pressed', String(!saved)); button.setAttribute('aria-label', saved ? 'Сохранить пост' : 'Убрать из сохранённых'); $('span', button).textContent = saved ? 'Сохранить' : 'Сохранён';
          if (saved && route.filter === 'saved') { button.closest('[data-post]').remove(); items.delete(post.id); offset = Math.max(0, offset - 1); if (!items.size) $('#post-list').innerHTML = emptyHTML(); }
        } finally { button.disabled = false; }
      }
      if (action === 'delete' && post.author === Social.me.id) {
        postSheet('<h2>Удалить публикацию?</h2><p class="sheet-text">Публикация и комментарии будут удалены. Вернуть их не получится.</p><div class="sheet-actions"><button class="danger" data-post-confirm>Удалить пост</button><button class="wide" data-post-cancel>Отмена</button></div><p class="post-error" role="status"></p>', (sheet) => {
          $('[data-post-cancel]', sheet).onclick = closeSheet;
          $('[data-post-confirm]', sheet).onclick = async () => {
            const confirm = $('[data-post-confirm]', sheet); if (confirm.disabled) return; confirm.disabled = true;
            try {
              const { data, error } = await sb().from('posts').delete().eq('id', post.id).eq('author', Social.me.id).select('id');
              if (error) throw error;
              if (!data.length) throw new Error('Публикация уже удалена или недоступна');
              closeSheet(); render(); toast('Пост удалён');
            } catch (error) { $('.post-error', sheet).textContent = errorText(error); confirm.disabled = false; }
          };
        });
      }
      } catch (error) { toast(errorText(error)); }
    });
  }
  return { init, render, compose };
})();
