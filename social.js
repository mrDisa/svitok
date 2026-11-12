'use strict';

/* ======================================================================
   Друзья: вход (Telegram / почта), профиль, друзья, отправка стихов.
   Сервер — Supabase. Без входа приложение работает как раньше.
   Использует общие помощники из app.js: $, $$, esc, toast, openSheet,
   closeSheet, openTab, openChapter, copyText, appUrl, I.
   ====================================================================== */
const Social = (() => {
  const CFG = window.SVITOK_CONFIG || {};
  const enabled = !!(CFG.supabaseUrl && CFG.supabaseKey && window.supabase);
  const COLORS = ['#e9bb6f', '#ff7a7a', '#7ad0ff', '#9be38f', '#c99bff', '#ff9fd2', '#6fe0c8', '#ffb36b'];
  let sb = null;
  let me = null;          // профиль
  let user = null;        // auth user
  let friends = [];       // [{f: friendship, p: другой профиль}]
  let incoming = [];      // заявки мне
  let outgoing = [];      // мои заявки
  let inbox = [];         // стихи мне
  let pendingAdd = null;  // ник из ссылки-приглашения
  let pollTimer = null;
  let publicProfile = null;
  let friendsPage = null;
  const profileHistory = [];
  let friendsRequest = 0;
  let profileRequest = 0;

  const ICON = {
    people: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14c2.3.2 4 1.7 4.5 4.5"/></svg>',
    send: '<svg viewBox="0 0 24 24"><path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    tg: '<svg viewBox="0 0 24 24"><path d="M21 4L3 11l6 2 2 6 3-4 5 4z" fill="currentColor" stroke="none"/></svg>',
    mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
    person: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20.5c1-4 4.3-6.5 8-6.5s7 2.5 8 6.5"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
    menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  };

  const el = () => $('#profile');
  const AVATAR_PREFIX = `${CFG.supabaseUrl}/storage/v1/object/public/avatars/`;
  const avatar = (p, size = 44) => {
    const c = COLORS[(p?.avatar_color ?? 0) % COLORS.length];
    const letter = esc((p?.display_name || '?').trim().charAt(0).toUpperCase());
    const img = p?.avatar_url && p.avatar_url.startsWith(AVATAR_PREFIX)
      ? `<img src="${esc(p.avatar_url)}" alt="" loading="lazy" decoding="async">` : '';
    return `<span class="ava${img ? ' has-img' : ''}" style="--c:${c};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px">${img || letter}</span>`;
  };

  /* Фото → квадрат 320×320 (обрезка по центру) → JPEG ~30–60 КБ */
  async function squareJpeg(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      const cv = document.createElement('canvas');
      cv.width = cv.height = 320;
      cv.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 320, 320);
      return await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.85));
    } finally { URL.revokeObjectURL(url); }
  }
  const storagePath = (u) => (u && u.startsWith(AVATAR_PREFIX) ? decodeURIComponent(u.slice(AVATAR_PREFIX.length)) : null);
  async function setAvatar(file) {
    const blob = await squareJpeg(file);
    if (!blob) throw new Error('decode');
    const path = `${me.id}/${Date.now()}.jpg`;
    const up = await sb.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
    if (up.error) throw up.error;
    const url = sb.storage.from('avatars').getPublicUrl(path).data.publicUrl;
    const old = storagePath(me.avatar_url);
    const { error } = await sb.from('profiles').update({ avatar_url: url }).eq('id', me.id);
    if (error) { await sb.storage.from('avatars').remove([path]); throw error; }
    me.avatar_url = url;
    if (old) sb.storage.from('avatars').remove([old]);
  }
  async function removeAvatar() {
    const old = storagePath(me.avatar_url);
    const { error } = await sb.from('profiles').update({ avatar_url: null }).eq('id', me.id);
    if (error) throw error;
    me.avatar_url = null;
    if (old) sb.storage.from('avatars').remove([old]);
  }
  const ago = (iso) => {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    const rtf = new Intl.RelativeTimeFormat('ru', { numeric: 'auto' });
    if (s < 60) return 'только что';
    if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
    if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
    if (s < 86400 * 7) return rtf.format(-Math.round(s / 86400), 'day');
    return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  };
  const nonce = () => {
    const b = new Uint8Array(32);
    crypto.getRandomValues(b);
    return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  /* ---------------- данные ---------------- */
  async function loadMe() {
    const { data } = await sb.auth.getUser();
    user = data.user || null;
    if (!user) { me = null; store.set('profileCache', null); return; }
    const r = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    me = r.data || null;
    if (me) store.set('profileCache', me);
  }
  async function loadAll() {
    if (!me) return;
    const P = 'id, username, display_name, avatar_color, avatar_url';
    const [fr] = await Promise.all([
      sb.from('friendships').select(`*, rq:profiles!friendships_requester_fkey(${P}), ad:profiles!friendships_addressee_fkey(${P})`),
    ]);
    const rows = fr.data || [];
    friends = rows.filter((f) => f.status === 'accepted').map((f) => ({ f, p: f.requester === me.id ? f.ad : f.rq }))
      .sort((a, b) => a.p.display_name.localeCompare(b.p.display_name));
    incoming = rows.filter((f) => f.status === 'pending' && f.addressee === me.id).map((f) => ({ f, p: f.rq }));
    outgoing = rows.filter((f) => f.status === 'pending' && f.requester === me.id).map((f) => ({ f, p: f.ad }));
    inbox = [];
    updateBadge();
    if (typeof Comments !== 'undefined') Comments.load();
  }
  function badgeCount() {
    return incoming.length + inbox.filter((s) => !s.read_at).length
      + (typeof Comments !== 'undefined' ? Comments.unread() : 0);
  }
  function updateBadge() {
    const b = $('#tabbar [data-tab=profile]');
    if (!b) return;
    let dot = $('.badge', b);
    const n = badgeCount();
    if (!n) { dot?.remove(); return; }
    if (!dot) { dot = document.createElement('i'); dot.className = 'badge'; b.appendChild(dot); }
    dot.textContent = n > 9 ? '9+' : n;
  }
  async function refresh() {
    if (!sb) return;
    await loadMe();
    await loadAll();
    if (me) await pull().catch(() => {});
    if ($('[data-view=profile]').classList.contains('on')) render();
    if ($('[data-view=posts]')?.classList.contains('on')) Posts.render();
  }

  /* ---------------- синхронизация прогресса с аккаунтом ---------------- */
  const SYNC_KEYS = ['saved', 'likes', 'weights', 'goal', 'day', 'streak', 'plans', 'last', 'privacy'];
  let rawSet = null;          // исходный store.set (без отметки «есть изменения»)
  let dirty = false;
  let syncTimer = null;
  let applying = false;

  function collect() {
    return {
      v: 1, saved: store.get('saved', []), likes: store.get('likes', []), weights: store.get('weights', {}),
      goal: store.get('goal', null), day: store.get('day', null), streak: store.get('streak', null),
      plans: store.get('plans', {}), last: store.get('last', null), privacy: store.get('privacy', { saved: true, likes: true, comments: true }),
    };
  }
  const ymd = (s) => { const [y, m, d] = String(s || '').split('-').map(Number); return y ? new Date(y, m - 1, d).getTime() : 0; };
  function mergeState(l, r) {
    if (!r) return l;
    const savedMap = new Map();
    [...(r.saved || []), ...(l.saved || [])].forEach((s) => {
      const p = savedMap.get(s.id);
      if (!p || (s.ts || 0) > (p.ts || 0)) savedMap.set(s.id, s);
    });
    const day = !l.day ? r.day : !r.day ? l.day : l.day.d === r.day.d
      ? { d: l.day.d, n: Math.max(l.day.n, r.day.n), done: !!(l.day.done || r.day.done) }
      : (ymd(l.day.d) > ymd(r.day.d) ? l.day : r.day);
    const streak = !l.streak ? r.streak : !r.streak ? l.streak
      : ymd(l.streak.last) === ymd(r.streak.last) ? { last: l.streak.last, count: Math.max(l.streak.count, r.streak.count) }
      : (ymd(l.streak.last) > ymd(r.streak.last) ? l.streak : r.streak);
    const plans = { ...(r.plans || {}) };
    Object.entries(l.plans || {}).forEach(([id, p]) => {
      const q = plans[id];
      plans[id] = q ? { started: Math.min(p.started || Date.now(), q.started || Date.now()), done: [...new Set([...(p.done || []), ...(q.done || [])])].sort((a, b) => a - b) } : p;
    });
    return {
      v: 1,
      saved: [...savedMap.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)),
      likes: [...new Set([...(r.likes || []), ...(l.likes || [])])],
      weights: { ...(r.weights || {}), ...(l.weights || {}) },
      goal: l.goal ?? r.goal, day, streak, plans, last: l.last || r.last, privacy: { saved: true, likes: true, comments: true, ...(r.privacy || {}), ...(l.privacy || {}) },
    };
  }
  function apply(st) {
    applying = true;
    const set = rawSet || store.set;
    SYNC_KEYS.forEach((k) => { if (st[k] !== undefined && st[k] !== null) set(k, st[k]); });
    applying = false;
    S.saved = st.saved || [];
    S.likes = new Set(st.likes || []);
    S.weights = st.weights || {};
    S.last = st.last || null;
    if (typeof Goal !== 'undefined' && Goal.reload) Goal.reload();
    if ($('[data-view=saved]').classList.contains('on') && typeof renderSaved === 'function') renderSaved();
    if ($('[data-view=bible]').classList.contains('on') && bibleRoute.view === 'books' && !$('#bsearch')?.value) renderBooks();
  }
  async function push(state) {
    if (!me) return;
    const { data, error } = await sb.from('user_state').upsert({ user_id: me.id, data: state || collect() }).select('updated_at').single();
    if (error) return;
    dirty = false;
    (rawSet || store.set)('syncAt', data.updated_at);
    (rawSet || store.set)('syncUser', me.id);
    if ($('[data-view=profile]').classList.contains('on')) { const n = $('.sync-note'); if (n) n.textContent = '✓ Прогресс сохранён в аккаунте'; }
  }
  async function pull() {
    if (!me) return;
    const { data, error } = await sb.from('user_state').select('data, updated_at').eq('user_id', me.id).maybeSingle();
    if (error) return;
    const local = collect();
    // впервые на этом устройстве (или другой аккаунт) — объединяем, чтобы ничего не потерять
    const firstHere = store.get('syncUser', null) !== me.id || !store.get('syncAt', null);
    if (!data) { await push(local); return; }
    const remoteNewer = new Date(data.updated_at) > new Date(store.get('syncAt', 0));
    let result = local;
    if (firstHere || (dirty && remoteNewer)) result = mergeState(local, data.data);
    else if (remoteNewer) result = data.data;
    if (result !== local) apply(result);
    (rawSet || store.set)('syncAt', data.updated_at);
    (rawSet || store.set)('syncUser', me.id);
    if (JSON.stringify(result) !== JSON.stringify(data.data)) await push(result);
    else dirty = false;
  }
  function schedule() {
    dirty = true;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { push().catch(() => {}); }, 3000);
  }
  function hookStore() {
    if (rawSet) return;
    rawSet = store.set.bind(store);
    store.set = (k, v) => { rawSet(k, v); if (!applying && me && SYNC_KEYS.includes(k)) schedule(); };
    document.addEventListener('visibilitychange', () => {
      if (!me) return;
      if (document.hidden) { if (dirty) { clearTimeout(syncTimer); push().catch(() => {}); } }
      else pull().catch(() => {});
    });
  }

  /* ---------------- экран «Друзья» ---------------- */
  const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; };
  function statsHTML() {
    const g = typeof Goal !== 'undefined' ? Goal.stats() : { n: 0, goal: 10, streak: 0 };
    return `<div class="p-stats">
      <button class="p-stat" data-f="goal"><b>${g.streak}</b><span>${plural(g.streak, 'день', 'дня', 'дней')} подряд</span></button>
      <button class="p-stat" data-f="goal"><b>${Math.min(g.n, g.goal)}<i>/${g.goal}</i></b><span>стихов сегодня</span></button>
      <button class="p-stat" data-f="saved"><b>${S.saved.length}</b><span>сохранено</span></button>
    </div>`;
  }

  function render() {
    if (!me) { friendsPage = null; publicProfile = null; profileHistory.length = 0; }
    if (friendsPage) { renderFriends(); return; }
    if (publicProfile) { renderPublicProfile(); return; }
    if (!enabled || !me) { renderSignedOut(); return; }
    el().innerHTML = `
      <div class="page-head profile-page-title">${profileHistory.length ? `<button class="icon-btn" data-f="public-back" aria-label="Назад">${I.back}</button>` : ''}<h1>Профиль</h1></div>
      <div class="p-head profile-hero">
        <button class="profile-menu" data-f="settings" aria-label="Настройки">${ICON.menu}</button>
        ${avatar(me, 92)}
        <h1>${esc(me.display_name)}</h1>
        <p>@${esc(me.username)}</p>
        <button class="pill-btn" data-f="edit">${ICON.edit}Изменить профиль</button>
      </div>
      ${friendsLink(me.id, friends.length, incoming.length)}
      ${statsHTML()}
      <p class="sync-note">✓ Прогресс сохраняется в аккаунте</p>
      <button class="post-profile-link" data-author-posts="${me.id}">${I.text}Мои публикации${I.next}</button>
      <div class="profile-library">
        <button data-f="saved">${I.bookmark}<span>Избранное</span><b>${S.saved.length}</b></button>
        <button data-f="liked">${I.heart}<span>Лайки</span><b>${S.likes.size}</b></button>
        <button data-f="comments">${I.talk}<span>Комментарии</span></button>
      </div>
      ${typeof Comments !== 'undefined' ? `<div class="cm-notices">${Comments.profileHTML()}</div>` : ''}
      `;
  }
  function friendsLink(id, count, pending = 0) {
    return `<button class="profile-friends-link" data-f="friends" data-id="${esc(id)}"><span class="friends-symbol">${ICON.people}</span><span class="grow"><b>${count == null ? 'Друзья' : count + ' ' + plural(count, 'друг', 'друга', 'друзей')}</b><small>${pending ? `${pending} ${plural(pending, 'новая заявка', 'новые заявки', 'новых заявок')}` : 'Посмотреть всех друзей'}</small></span>${I.next}</button>`;
  }
  function renderOwnFriends() {
    return `
      <div class="f-actions">
        <button data-f="add">${ICON.plus}Добавить друга</button>
        <button data-f="invite">${ICON.link}Пригласить</button>
      </div>
      ${incoming.length ? `<div class="sec-title">Заявки в друзья · ${incoming.length}</div>
        <div class="group">${incoming.map(({ f, p }) => `<div class="row person">${avatar(p)}<div class="grow">${esc(p.display_name)}<small>@${esc(p.username)}</small></div>
          <button class="pill-btn gold" data-f="accept" data-id="${f.id}">Принять</button><button class="pill-btn" data-f="remove" data-id="${f.id}" aria-label="Отклонить">✕</button></div>`).join('')}</div>` : ''}
      ${friends.length ? `<div class="group friends-directory">${friends.map(({ f, p }) => `<div class="row person" data-friend-name="${esc((p.display_name + ' ' + p.username).toLowerCase())}"><button class="friend-open" data-f="friend-profile" data-id="${p.id}">${avatar(p)}<span class="grow">${esc(p.display_name)}<small>@${esc(p.username)}</small></span></button>
          <button class="pill-btn" data-f="unfriend" data-id="${f.id}" data-name="${esc(p.display_name)}">Удалить</button></div>`).join('')}</div>`
        : '<div class="hint-card">Пока никого. Нажмите «Добавить друга» или отправьте ссылку-приглашение.</div>'}
      ${outgoing.length ? `<div class="sec-title">Ждут ответа</div><div class="group">${outgoing.map(({ f, p }) => `<div class="row person">${avatar(p, 36)}<div class="grow">${esc(p.display_name)}<small>@${esc(p.username)}</small></div>
          <button class="pill-btn" data-f="remove" data-id="${f.id}">Отменить</button></div>`).join('')}</div>` : ''}
      `;
  }
  function rememberProfileRoute() {
    profileHistory.push({ publicProfile, friendsPage, scroll: el().scrollTop });
  }
  function profileBack() {
    ++profileRequest;
    const previous = profileHistory.pop();
    if (previous) {
      publicProfile = previous.publicProfile; friendsPage = previous.friendsPage;
      render(); el().scrollTop = previous.scroll;
    } else {
      const back = publicProfile?.back || 'profile'; publicProfile = null; friendsPage = null;
      openTab(back); if (back === 'profile') render();
    }
  }
  function renderFriends() {
    const page = friendsPage;
    const own = page.id === me.id;
    el().innerHTML = `<div class="page-head subpage-head"><button class="icon-btn" data-f="friends-back" aria-label="Назад в профиль">${I.back}</button><div><h1>Друзья</h1><p>${own ? 'Ваши друзья и заявки' : esc(page.name || 'Список друзей')}</p></div></div>
      <label class="friends-search"><input type="search" placeholder="Имя или @ник" maxlength="100" value="${esc(page.query || '')}" aria-label="Поиск друзей"></label>
      <div id="friends-content">${own ? renderOwnFriends() : '<p class="sheet-text" role="status">Загружаем друзей…</p>'}</div>`;
    const input = $('.friends-search input', el());
    let timer;
    input.oninput = () => {
      page.query = input.value;
      if (own) {
        let count = 0;
        $$('[data-friend-name]', el()).forEach(row => { row.hidden = !row.dataset.friendName.includes(page.query.trim().replace(/^@/, '').toLowerCase()); if (!row.hidden) count++; });
        $('#friends-no-results')?.remove();
        if (!count && friends.length) $('#friends-content').insertAdjacentHTML('beforeend', '<p id="friends-no-results" class="sheet-text" role="status">Друзья не найдены. Попробуйте другое имя.</p>');
      } else {
        ++friendsRequest; clearTimeout(timer); timer = setTimeout(() => loadFriendDirectory(page), 250);
      }
    };
    if (own) input.oninput(); else loadFriendDirectory(page);
  }
  async function loadFriendDirectory(page, append = false) {
    const ticket = ++friendsRequest;
    const content = $('#friends-content');
    const offset = append ? page.offset : 0;
    try {
      const { data, error } = await sb.rpc('profile_friends', { p_profile: page.id, p_offset: offset, p_search: (page.query || '').trim().replace(/^@/, ''), p_limit: 51 });
      if (friendsPage !== page || ticket !== friendsRequest || !content.isConnected) return;
      if (error) throw error;
      if (!data.visible) { content.innerHTML = '<div class="hint-card">Пользователь скрыл свой список друзей.</div>'; return; }
      const rows = data.friends.slice(0, 50);
      const html = rows.map(p => `<div class="row person"><button class="friend-open" data-f="friend-profile" data-id="${p.id}">${avatar(p)}<span class="grow">${esc(p.display_name)}<small>@${esc(p.username)}</small></span>${I.next}</button></div>`).join('');
      if (append) { $('#friends-more')?.remove(); $('.friends-directory', content).insertAdjacentHTML('beforeend', html); }
      else content.innerHTML = rows.length ? `<div class="group friends-directory">${html}</div>` : `<div class="hint-card">${page.query ? 'Никого не нашли. Попробуйте другое имя.' : 'Здесь пока нет друзей.'}</div>`;
      page.offset = offset + rows.length;
      if (data.friends.length > 50) content.insertAdjacentHTML('beforeend', '<button class="pill-btn friends-more" id="friends-more" data-f="friends-more">Показать ещё</button>');
    } catch (error) {
      if (friendsPage !== page || ticket !== friendsRequest || !content.isConnected) return;
      if (!append) content.innerHTML = '<div class="hint-card">Не удалось загрузить друзей. Проверьте соединение.<button class="pill-btn" data-f="friends-retry">Повторить</button></div>';
      else { const button = $('#friends-more'); if (button) button.disabled = false; toast('Не удалось загрузить друзей'); }
    }
  }
  async function setFriendsVisible(visible) {
    if (!me) { toast('Войдите, чтобы изменить конфиденциальность'); return false; }
    const id = me.id;
    try {
      const { data, error } = await sb.from('profiles').update({ friends_visible: visible }).eq('id', id).select('id').single();
      if (error || !data) throw error || new Error('missing_profile');
      if (me?.id === id) { me.friends_visible = visible; store.set('profileCache', me); }
      return true;
    } catch { toast('Не удалось сохранить настройку. Проверьте подключение и обновление базы.'); return false; }
  }
  function shareHTML(s) {
    const [g1, g2] = gradFor(s.verse_id);
    const art = typeof artForId === 'function' ? artForId(s.verse_id) : null;
    return `<div class="inbox-item${s.read_at ? '' : ' new'}" role="button" data-f="open" data-id="${s.id}" style="--g1:${g1};--g2:${g2}${art ? `;--img:url('${art.src}')` : ''}">
      <div class="from">${avatar(s.s, 28)}<b>${esc(s.s?.display_name || 'Друг')}</b><span>${esc(ago(s.created_at))}</span></div>
      ${s.note ? `<div class="note">${esc(s.note)}</div>` : ''}
      <p>${esc(s.body)}</p><small>${esc(s.ref)}</small>
    </div>`;
  }
  async function viewProfile(id) {
    if (!sb) return;
    const ticket = ++profileRequest;
    const origin = $('.view.on')?.dataset.view || 'profile';
    const saveRoute = () => { if (origin === 'profile' && (friendsPage || publicProfile)) rememberProfileRoute(); else if (origin !== 'profile') profileHistory.length = 0; };
    if (id === me?.id) { saveRoute(); friendsPage = null; publicProfile = null; closeSheet(); openTab('profile'); render(); return; }
    let p;
    try {
      const result = await sb.from('profiles').select('id,username,display_name,avatar_color,avatar_url').eq('id', id).maybeSingle();
      if (result.error) throw result.error;
      p = result.data;
    } catch { if (ticket === profileRequest) toast('Не удалось загрузить профиль. Попробуйте ещё раз.'); return; }
    if (ticket !== profileRequest || $('.view.on')?.dataset.view !== origin) return;
    if (!p) return toast('Профиль недоступен');
    saveRoute();
    friendsPage = null;
    publicProfile = { p, back: origin };
    closeSheet(); openTab('profile'); render();
  }
  function renderPublicProfile() {
    const { p, back } = publicProfile; const friend = friends.find((x) => x.p.id === p.id);
    el().innerHTML = `<div class="page-head subpage-head"><button class="icon-btn" data-f="public-back" aria-label="Назад">${I.back}</button><div><h1>Профиль</h1><p>Пользователь «Свитка»</p></div></div><div class="p-head public-profile full-profile">${avatar(p,96)}<h1>${esc(p.display_name)}</h1><p>@${esc(p.username)}</p></div><p class="sheet-text">Читайте публикации автора и продолжайте разговор в чате.</p>${friend ? `<div class="sheet-actions"><button class="primary" data-f="public-chat" data-id="${p.id}">${ICON.send}Написать</button></div>` : ''}`;
    el().dataset.profileBack = back;
    el().insertAdjacentHTML('beforeend', `<button class="post-profile-link" data-author-posts="${p.id}">${I.text}Публикации${I.next}</button>`);
    $('.full-profile', el()).insertAdjacentHTML('afterend', '<div class="profile-friends-summary" role="status"><p class="sheet-text">Загружаем сведения о друзьях…</p></div>');
    const summary = $('.profile-friends-summary', el());
    const route = publicProfile;
    sb.rpc('profile_friends', { p_profile: p.id, p_limit: 0 }).then(({ data, error }) => {
      if (publicProfile !== route || friendsPage || !summary.isConnected) return;
      summary.innerHTML = error || !data ? '<p class="sheet-text">Список друзей временно недоступен.</p>' : data.visible ? friendsLink(p.id, data.count) : '<p class="sheet-text">Список друзей скрыт пользователем</p>';
    }).catch(() => { if (summary.isConnected) summary.textContent = 'Список друзей временно недоступен.'; });
  }
  function renderSignedOut() {
    el().innerHTML = `
      <div class="p-head">
        <span class="ava guest" style="width:92px;height:92px">${ICON.person}</span>
        <h1>Гость</h1>
        <p>Прогресс и избранное хранятся на этом телефоне</p>
      </div>
      ${statsHTML()}
      <div class="p-card">
        <div class="auth-ico">${ICON.people}</div>
        <h2>Друзья</h2>
        ${enabled ? `<p>Войдите, чтобы добавлять друзей, отправлять им стихи и сохранять прогресс в аккаунте — избранное, планы и серия не потеряются при смене телефона.</p>
        <button class="btn-auth tg" data-f="login-tg">${ICON.tg}Войти через Telegram</button>
        ${CFG.emailLogin ? `<button class="btn-auth" data-f="login-mail">${ICON.mail}Войти по почте</button>` : ''}`
        : '<p>Скоро здесь можно будет добавлять друзей и отправлять им стихи.</p>'}
      </div>`;
  }

  /* ---------------- вход через Telegram ---------------- */
  async function callTg(body) {
    const r = await fetch(`${CFG.supabaseUrl}/functions/v1/telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseKey, Authorization: `Bearer ${CFG.supabaseKey}` },
      body: JSON.stringify(body),
    });
    return r.json();
  }
  async function loginTelegram() {
    const n = nonce();
    let res;
    try { res = await callTg({ action: 'start', nonce: n }); } catch { res = null; }
    if (!res?.link) { toast('Не удалось связаться с сервером'); return; }
    const appLink = `tg://resolve?domain=${encodeURIComponent(CFG.telegramBot)}&start=login_${n}`;
    closeSheet();
    openSheet(`
      <h2>Вход через Telegram</h2>
      <p class="sheet-text">Откройте Telegram, нажмите <b>«Старт»</b> в чате с ботом и вернитесь сюда — вход выполнится сам.</p>
      <div class="sheet-actions">
        <a class="primary as-btn" href="${appLink}">${ICON.tg}Открыть Telegram</a>
      </div>
      <p class="sheet-text small">Нет приложения Telegram? <a href="${esc(res.link)}" target="_blank" rel="noopener">Открыть в браузере</a></p>
      <p class="sheet-text small wait" id="tg-wait">Ждём подтверждения…</p>`, null, () => stopPoll());
    startPoll(n);
  }
  function stopPoll() { clearTimeout(pollTimer); pollTimer = null; document.removeEventListener('visibilitychange', onVisible); }
  let pollNonce = null, pollUntil = 0;
  function onVisible() { if (!document.hidden && pollNonce) { clearTimeout(pollTimer); poll(); } }
  function startPoll(n) {
    pollNonce = n; pollUntil = Date.now() + 10 * 60 * 1000;
    document.addEventListener('visibilitychange', onVisible);
    pollTimer = setTimeout(poll, 2000);
  }
  async function poll() {
    if (!pollNonce) return;
    if (Date.now() > pollUntil) { stopPoll(); setWait('Время вышло. Попробуйте ещё раз.'); return; }
    let r = null;
    try { r = await callTg({ action: 'poll', nonce: pollNonce }); } catch { /* сеть */ }
    if (r?.status === 'ok' && r.token_hash) {
      const n = pollNonce; pollNonce = null; stopPoll();
      const { error } = await sb.auth.verifyOtp({ token_hash: r.token_hash, type: 'magiclink' });
      if (error) { setWait('Не получилось войти: ' + error.message); return; }
      void n;
      await afterLogin();
      return;
    }
    if (r?.status === 'expired') { stopPoll(); pollNonce = null; setWait('Ссылка устарела. Нажмите «Войти через Telegram» ещё раз.'); return; }
    pollTimer = setTimeout(poll, document.hidden ? 4000 : 2000);
  }
  function setWait(t) { const w = $('#tg-wait'); if (w) w.textContent = t; }

  /* ---------------- вход по почте (код из письма) ---------------- */
  function loginMail() {
    closeSheet();
    openSheet(`
      <h2>Вход по почте</h2>
      <form class="auth-form" id="mail-form">
        <label>Электронная почта<input type="email" name="email" autocomplete="email" inputmode="email" required placeholder="you@example.com"></label>
        <button class="primary as-btn" type="submit">Получить код</button>
      </form>
      <form class="auth-form" id="code-form" hidden>
        <p class="sheet-text">Мы отправили код на <b id="mail-to"></b>. Письмо может прийти в «Спам».</p>
        <label>Код из письма<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" required placeholder="123456"></label>
        <button class="primary as-btn" type="submit">Войти</button>
      </form>`, (sheet) => {
      let email = '';
      $('#mail-form', sheet).addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = $('#mail-form button', sheet);
        email = new FormData(e.target).get('email').trim().toLowerCase();
        btn.disabled = true; btn.textContent = 'Отправляем…';
        const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
        btn.disabled = false; btn.textContent = 'Получить код';
        if (error) { toast(/rate|limit|seconds/i.test(error.message) ? 'Слишком часто, подождите минуту' : 'Ошибка: ' + error.message); return; }
        $('#mail-to', sheet).textContent = email;
        $('#mail-form', sheet).hidden = true;
        $('#code-form', sheet).hidden = false;
        $('#code-form input', sheet).focus();
      });
      $('#code-form', sheet).addEventListener('submit', async (e) => {
        e.preventDefault();
        const token = new FormData(e.target).get('code').trim();
        const btn = $('#code-form button', sheet);
        btn.disabled = true;
        const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
        btn.disabled = false;
        if (error) { toast('Неверный или устаревший код'); return; }
        await afterLogin();
      });
    });
  }

  async function afterLogin() {
    closeSheet();
    await refresh();
    if (!me) { toast('Профиль не найден, попробуйте ещё раз'); return; }
    toast(`Добро пожаловать, ${me.display_name}!`);
    openTab('profile');
    render();
    if (pendingAdd) { const u = pendingAdd; pendingAdd = null; addByUsername(u); }
  }

  /* ---------------- профиль ---------------- */
  function editProfile() {
    closeSheet();
    openSheet(`
      <h2>Профиль</h2>
      <div class="ava-edit">
        <div class="ava-big">${avatar(me, 96)}</div>
        <div class="ava-btns">
          <label class="pill-btn gold">Загрузить фото<input type="file" accept="image/*" hidden id="ava-file"></label>
          <button type="button" class="pill-btn" data-f="ava-remove"${me.avatar_url ? '' : ' hidden'}>Убрать</button>
        </div>
      </div>
      <form class="auth-form" id="prof-form">
        <div class="form-hint" style="text-align:center;margin:0">Цвет, если фото нет</div>
        <div class="ava-pick">${COLORS.map((c, i) => `<button type="button" data-color="${i}" class="${i === me.avatar_color ? 'on' : ''}" style="--c:${c}" aria-label="Цвет ${i + 1}"></button>`).join('')}</div>
        <label>Имя<input name="name" maxlength="40" required value="${esc(me.display_name)}"></label>
        <label>Ник (по нему вас найдут друзья)<input name="username" maxlength="24" required pattern="[a-z0-9_]{3,24}" value="${esc(me.username)}" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
        <small class="form-hint">Латиница в нижнем регистре, цифры и «_», от 3 до 24 символов.</small>
        <button class="primary as-btn" type="submit">Сохранить</button>
      </form>
      <button class="danger-link" data-f="logout">Выйти из аккаунта</button>`, (sheet) => {
      let color = me.avatar_color;
      sheet.addEventListener('click', async (e) => {
        const c = e.target.closest('[data-color]');
        if (c) { color = +c.dataset.color; $$('[data-color]', sheet).forEach((b) => b.classList.toggle('on', b === c)); }
        if (e.target.closest('[data-f=ava-remove]')) {
          try { await removeAvatar(); refreshAva(); render(); toast('Фото убрано'); } catch { toast('Не получилось'); }
        }
        if (e.target.closest('[data-f=logout]')) {
          await sb.auth.signOut();
          me = null; user = null; friends = []; incoming = []; outgoing = []; inbox = [];
          updateBadge(); closeSheet(); render(); toast('Вы вышли');
        }
      });
      const refreshAva = () => {
        $('.ava-big', sheet).innerHTML = avatar({ ...me, avatar_color: color }, 96);
        $('[data-f=ava-remove]', sheet).hidden = !me.avatar_url;
      };
      $('#ava-file', sheet).addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        $('.ava-big', sheet).classList.add('loading');
        try { await setAvatar(file); refreshAva(); render(); toast('Фото обновлено'); }
        catch (err) { toast(/size|large|413/i.test(String(err?.message || err?.statusCode)) ? 'Слишком большой файл' : 'Не удалось загрузить фото'); }
        finally { $('.ava-big', sheet).classList.remove('loading'); }
      });
      const uname = $('[name=username]', sheet);
      uname.addEventListener('input', () => { uname.value = uname.value.toLowerCase().replace(/[^a-z0-9_]/g, ''); });
      $('#prof-form', sheet).addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const patch = { display_name: fd.get('name').trim(), username: fd.get('username').trim(), avatar_color: color };
        const { error } = await sb.from('profiles').update(patch).eq('id', me.id);
        if (error) { toast(error.code === '23505' ? 'Этот ник уже занят' : 'Не удалось сохранить'); return; }
        Object.assign(me, patch);
        closeSheet(); render(); toast('Сохранено');
      });
    });
  }

  /* ---------------- поиск и добавление друзей ---------------- */
  function addFriendSheet() {
    closeSheet();
    openSheet(`
      <h2>Добавить друга</h2>
      <form class="auth-form" id="find-form">
        <label>Ник или имя<input name="q" required minlength="2" placeholder="например, ivan" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
      </form>
      <div id="find-res" class="find-res"></div>`, (sheet) => {
      const input = $('[name=q]', sheet);
      let t;
      const search = async () => {
        const q = input.value.trim().replace(/^@/, '').replace(/[^\p{L}\p{N}_ ]/gu, '');
        const box = $('#find-res', sheet);
        if (q.length < 2) { box.innerHTML = ''; return; }
        const { data } = await sb.from('profiles').select('id, username, display_name, avatar_color, avatar_url')
          .or(`username.ilike.${q.toLowerCase()}%,display_name.ilike.%${q}%`).neq('id', me.id).limit(12);
        const known = new Map([...friends, ...incoming, ...outgoing].map(({ p }) => [p.id, true]));
        box.innerHTML = (data || []).length ? `<div class="group">${data.map((p) => `<div class="row person">${avatar(p, 40)}<div class="grow">${esc(p.display_name)}<small>@${esc(p.username)}</small></div>
          ${known.has(p.id) ? '<span class="val">уже в списке</span>' : `<button class="pill-btn gold" data-f="request" data-uid="${p.id}">Добавить</button>`}</div>`).join('')}</div>`
          : '<div class="hint-card">Никого не нашли. Проверьте ник или отправьте другу ссылку-приглашение.</div>';
      };
      input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(search, 300); });
      $('#find-form', sheet).addEventListener('submit', (e) => { e.preventDefault(); search(); });
      sheet.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-f=request]');
        if (!b) return;
        b.disabled = true;
        await sendRequest(b.dataset.uid);
        b.outerHTML = '<span class="val">заявка отправлена</span>';
      });
      setTimeout(() => input.focus(), 250);
    });
  }
  async function sendRequest(uid) {
    const { error } = await sb.from('friendships').insert({ requester: me.id, addressee: uid });
    if (error && error.code === '23505') {
      // встречная заявка уже есть — просто принимаем её
      const back = incoming.find(({ p }) => p.id === uid);
      if (back) { await sb.from('friendships').update({ status: 'accepted' }).eq('id', back.f.id); toast('Вы теперь друзья'); }
      else toast('Заявка уже отправлена');
    } else if (error) { toast('Не удалось отправить заявку'); return; }
    else toast('Заявка отправлена');
    await loadAll(); render();
  }
  async function addByUsername(username) {
    const { data } = await sb.from('profiles').select('id, username, display_name, avatar_color, avatar_url').eq('username', username).maybeSingle();
    if (!data) { toast('Пользователь не найден'); return; }
    if (data.id === me.id) { toast('Это ваша ссылка-приглашение'); return; }
    if ([...friends, ...outgoing].some(({ p }) => p.id === data.id)) { toast(`${data.display_name} уже в списке`); return; }
    closeSheet();
    openSheet(`<h2>Добавить в друзья?</h2>
      <div class="confirm-person">${avatar(data, 64)}<b>${esc(data.display_name)}</b><small>@${esc(data.username)}</small></div>
      <div class="sheet-actions"><button class="primary" data-ok>Добавить</button></div>`, (sheet) => {
      $('[data-ok]', sheet).addEventListener('click', async () => { closeSheet(); await sendRequest(data.id); });
    });
  }
  async function invite() {
    const url = `${appUrl()}?add=${encodeURIComponent(me.username)}#app`;
    const data = { title: 'Свиток', text: `Добавь меня в друзья в «Свитке» — будем делиться стихами из Библии. Мой ник: @${me.username}`, url };
    try {
      if (navigator.share) await navigator.share(data);
      else { await copyText(url); toast('Ссылка скопирована'); }
    } catch { /* отмена */ }
  }

  /* ---------------- отправить стих другу ---------------- */
  async function sendVerse(it, initialNote = '') {
    if (!enabled) { toast('Скоро'); return; }
    if (!me) {
      closeSheet();
      openTab('profile');
      toast('Войдите, чтобы отправлять стихи друзьям');
      return;
    }
    if (!friends.length) await loadAll();
    closeSheet();
    openSheet(`
      <h2>Отправить в чат</h2>
      <div class="send-verse"><p>${esc(it.x)}</p><small>${esc(it.r)}</small></div>
      ${friends.length ? `
        <div class="friend-pick">${friends.map(({ p }) => `<button data-uid="${p.id}">${avatar(p, 52)}<span>${esc(p.display_name.split(' ')[0])}</span></button>`).join('')}</div>
        <form class="auth-form" id="send-form">
          <label>Комментарий к местописанию<input name="note" maxlength="2000" value="${esc(initialNote)}" placeholder="Подумал о тебе…"></label>
          <button class="primary as-btn" type="submit" disabled>${ICON.send}Отправить в чат</button>
        </form>`
        : `<div class="hint-card">У вас пока нет друзей в «Свитке».</div>
        <div class="sheet-actions"><button class="primary" data-f="add">${ICON.plus}Добавить друга</button></div>`}`, (sheet) => {
      const chosen = new Set();
      sheet.addEventListener('click', (e) => {
        if (e.target.closest('[data-f=add]')) { addFriendSheet(); return; }
        const b = e.target.closest('.friend-pick [data-uid]');
        if (!b) return;
        const id = b.dataset.uid;
        if (chosen.has(id)) chosen.delete(id); else chosen.add(id);
        b.classList.toggle('on', chosen.has(id));
        $('#send-form button', sheet).disabled = !chosen.size;
      });
      $('#send-form', sheet)?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const note = new FormData(e.target).get('note').trim() || null;
        const btn = $('#send-form button', sheet);
        btn.disabled = true;
        const error = await Chats.sendVerse(it, [...chosen], note);
        if (error) { btn.disabled = false; toast('Не удалось отправить в чат'); return; }
        closeSheet();
        toast(chosen.size > 1 ? `Отправлено в ${chosen.size} чатов` : 'Отправлено в чат');
      });
    });
  }

  /* ---------------- клики на экране ---------------- */
  function onClick(e) {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    const f = b.dataset.f;
    if (f === 'public-back' || f === 'friends-back') profileBack();
    else if (f === 'friends') { rememberProfileRoute(); friendsPage = { id: b.dataset.id, name: publicProfile?.p.display_name, query: '' }; render(); el().scrollTop = 0; }
    else if (f === 'friend-profile') viewProfile(b.dataset.id);
    else if (f === 'friends-retry') loadFriendDirectory(friendsPage);
    else if (f === 'friends-more') { b.disabled = true; loadFriendDirectory(friendsPage, true); }
    else if (f === 'public-chat') { const id = b.dataset.id; publicProfile = null; friendsPage = null; profileHistory.length = 0; openTab('chats'); Chats.createDirect(id); }
    else if (f === 'login-tg') loginTelegram();
    else if (f === 'goal') { if (typeof Goal !== 'undefined') Goal.openSheet(); }
    else if (f === 'saved') { savedTab = 'saved'; openTab('saved'); }
    else if (f === 'liked') { savedTab = 'liked'; openTab('saved'); }
    else if (f === 'comments') { toast('Ваши комментарии появятся здесь после первой публикации'); }
    else if (f === 'settings') openTab('more');
    else if (f === 'login-mail') loginMail();
    else if (f === 'edit') editProfile();
    else if (f === 'add') addFriendSheet();
    else if (f === 'invite') invite();
    else if (f === 'accept') {
      sb.from('friendships').update({ status: 'accepted' }).eq('id', b.dataset.id)
        .then(({ error }) => { if (error) toast('Не получилось'); else toast('Вы теперь друзья'); return loadAll(); }).then(render);
    } else if (f === 'remove') {
      sb.from('friendships').delete().eq('id', b.dataset.id).then(({ error }) => { if (error) toast('Не удалось отменить заявку'); return loadAll(); }).then(render);
    } else if (f === 'unfriend') {
      if (!confirm(`Удалить ${b.dataset.name} из друзей?`)) return;
      sb.from('friendships').delete().eq('id', b.dataset.id).then(({ error }) => { if (error) toast('Не удалось удалить друга'); return loadAll(); }).then(render);
    } else if (f === 'open') {
      const s = inbox.find((x) => String(x.id) === b.dataset.id);
      if (s && s.book != null) { openTab('bible'); openChapter(s.book, s.chapter, [s.v1, s.v2]); }
    }
  }

  async function init() {
    const params = new URLSearchParams(location.search);
    if (params.get('add')) {
      pendingAdd = params.get('add').toLowerCase().replace(/[^a-z0-9_]/g, '');
      history.replaceState(null, '', location.pathname + location.hash);
    }
    el().addEventListener('click', onClick);
    if (!enabled) { render(); return; }
    hookStore();
    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'svitok-auth' },
    });
    const { data: sessionData } = await sb.auth.getSession();
    user = sessionData.session?.user || null;
    const cached = store.get('profileCache', null);
    if (user && cached?.id === user.id) { me = cached; render(); }
    await refresh().catch(() => {});
    // в мини-аппе Telegram входим сами по подписанным данным Telegram
    if (!me && Tg.inTg) {
      const wa = await Tg.ready();
      if (wa && wa.initData) {
        try {
          const r = await callTg({ action: 'webapp', initData: wa.initData });
          if (r?.token_hash) {
            const { error } = await sb.auth.verifyOtp({ token_hash: r.token_hash, type: 'magiclink' });
            if (!error) { await refresh().catch(() => {}); if (me) toast(`Вы вошли через Telegram, ${me.display_name}`); }
          }
        } catch { /* остаёмся гостем */ }
      }
    }
    render();
    if (pendingAdd) {
      if (me) { const u = pendingAdd; pendingAdd = null; openTab('profile'); addByUsername(u); }
      else { openTab('profile'); toast('Войдите, чтобы добавить друга'); }
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden && me) loadAll().then(() => { if ($('[data-view=profile]').classList.contains('on')) render(); }); });
    setInterval(() => { if (!document.hidden && me) loadAll(); }, 90_000);
  }

  async function accessToken() { if (!sb) return null; const { data } = await sb.auth.getSession(); return data.session?.access_token || null; }
  async function signOut() {
    if (!sb) return;
    const { error } = await sb.auth.signOut();
    if (error) { toast('Не удалось выйти'); return; }
    me = null; user = null; friends = []; incoming = []; outgoing = []; inbox = [];
    updateBadge(); openTab('profile'); render(); toast('Вы вышли из аккаунта');
  }
  const isTelegram = () => !!user?.user_metadata?.tg_id;

  return {
    init, render, sendVerse, viewProfile, accessToken, signOut, isTelegram, avatar, ago, updateBadge, setFriendsVisible,
    get friends() { return friends.map((x) => x.p); },
    get enabled() { return enabled; }, get sb() { return sb; }, get me() { return me; },
  };
})();
