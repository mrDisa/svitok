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

  const ICON = {
    people: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14c2.3.2 4 1.7 4.5 4.5"/></svg>',
    send: '<svg viewBox="0 0 24 24"><path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    tg: '<svg viewBox="0 0 24 24"><path d="M21 4L3 11l6 2 2 6 3-4 5 4z" fill="currentColor" stroke="none"/></svg>',
    mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  };

  const el = () => $('#friends');
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
    if (!user) { me = null; return; }
    const r = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    me = r.data || null;
  }
  async function loadAll() {
    if (!me) return;
    const P = 'id, username, display_name, avatar_color, avatar_url';
    const [fr, sh] = await Promise.all([
      sb.from('friendships').select(`*, rq:profiles!friendships_requester_fkey(${P}), ad:profiles!friendships_addressee_fkey(${P})`),
      sb.from('shares').select(`*, s:profiles!shares_sender_fkey(${P})`).eq('recipient', me.id).order('created_at', { ascending: false }).limit(60),
    ]);
    const rows = fr.data || [];
    friends = rows.filter((f) => f.status === 'accepted').map((f) => ({ f, p: f.requester === me.id ? f.ad : f.rq }))
      .sort((a, b) => a.p.display_name.localeCompare(b.p.display_name));
    incoming = rows.filter((f) => f.status === 'pending' && f.addressee === me.id).map((f) => ({ f, p: f.rq }));
    outgoing = rows.filter((f) => f.status === 'pending' && f.requester === me.id).map((f) => ({ f, p: f.ad }));
    inbox = sh.data || [];
    updateBadge();
  }
  function badgeCount() { return incoming.length + inbox.filter((s) => !s.read_at).length; }
  function updateBadge() {
    const b = $('#tabbar [data-tab=friends]');
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
    if ($('[data-view=friends]').classList.contains('on')) render();
  }

  /* ---------------- экран «Друзья» ---------------- */
  function render() {
    if (!enabled) {
      el().innerHTML = `<div class="page-head"><h1>Друзья</h1></div>
        <div class="empty">${ICON.people}<br>Скоро здесь можно будет добавлять друзей и отправлять им стихи.</div>`;
      return;
    }
    if (!me) { renderSignedOut(); return; }
    const unread = inbox.filter((s) => !s.read_at).length;
    el().innerHTML = `
      <div class="page-head"><h1>Друзья</h1></div>
      <button class="profile-card" data-f="edit">
        ${avatar(me, 54)}
        <div class="grow"><b>${esc(me.display_name)}</b><small>@${esc(me.username)}</small></div>
        ${ICON.edit}
      </button>
      <div class="f-actions">
        <button data-f="add">${ICON.plus}Добавить друга</button>
        <button data-f="invite">${ICON.link}Пригласить</button>
      </div>
      ${incoming.length ? `<div class="sec-title">Заявки в друзья · ${incoming.length}</div>
        <div class="group">${incoming.map(({ f, p }) => `<div class="row person">${avatar(p)}<div class="grow">${esc(p.display_name)}<small>@${esc(p.username)}</small></div>
          <button class="pill-btn gold" data-f="accept" data-id="${f.id}">Принять</button><button class="pill-btn" data-f="remove" data-id="${f.id}" aria-label="Отклонить">✕</button></div>`).join('')}</div>` : ''}
      <div class="sec-title">Вам отправили${unread ? ` · ${unread} новых` : ''}</div>
      ${inbox.length ? inbox.map(shareHTML).join('') : '<div class="hint-card">Когда друг отправит вам стих, он появится здесь.</div>'}
      <div class="sec-title">Мои друзья · ${friends.length}</div>
      ${friends.length ? `<div class="group">${friends.map(({ f, p }) => `<div class="row person">${avatar(p)}<div class="grow">${esc(p.display_name)}<small>@${esc(p.username)}</small></div>
          <button class="pill-btn" data-f="unfriend" data-id="${f.id}" data-name="${esc(p.display_name)}">Удалить</button></div>`).join('')}</div>`
        : '<div class="hint-card">Пока никого. Нажмите «Добавить друга» или отправьте ссылку-приглашение.</div>'}
      ${outgoing.length ? `<div class="sec-title">Ждут ответа</div><div class="group">${outgoing.map(({ f, p }) => `<div class="row person">${avatar(p, 36)}<div class="grow">${esc(p.display_name)}<small>@${esc(p.username)}</small></div>
          <button class="pill-btn" data-f="remove" data-id="${f.id}">Отменить</button></div>`).join('')}</div>` : ''}`;
    // открыли экран — отмечаем стихи прочитанными
    if (unread) {
      sb.from('shares').update({ read_at: new Date().toISOString() }).eq('recipient', me.id).is('read_at', null)
        .then(() => { inbox.forEach((s) => { s.read_at ||= new Date().toISOString(); }); updateBadge(); });
    }
  }
  function shareHTML(s) {
    const [g1, g2] = gradFor(s.verse_id);
    return `<div class="inbox-item${s.read_at ? '' : ' new'}" role="button" data-f="open" data-id="${s.id}" style="--g1:${g1};--g2:${g2}">
      <div class="from">${avatar(s.s, 28)}<b>${esc(s.s?.display_name || 'Друг')}</b><span>${esc(ago(s.created_at))}</span></div>
      ${s.note ? `<div class="note">${esc(s.note)}</div>` : ''}
      <p>${esc(s.body)}</p><small>${esc(s.ref)}</small>
    </div>`;
  }
  function renderSignedOut() {
    el().innerHTML = `
      <div class="page-head"><h1>Друзья</h1></div>
      <div class="auth-hero">
        <div class="auth-ico">${ICON.people}</div>
        <h2>Делитесь Словом с близкими</h2>
        <p>Добавляйте друзей и отправляйте им стихи прямо в приложении. Вход нужен только для этого — лента и Библия работают и без него.</p>
        <button class="btn-auth tg" data-f="login-tg">${ICON.tg}Войти через Telegram</button>
        ${CFG.emailLogin ? `<button class="btn-auth" data-f="login-mail">${ICON.mail}Войти по почте</button>` : ''}
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
    openTab('friends');
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
  async function sendVerse(it) {
    if (!enabled) { toast('Скоро'); return; }
    if (!me) {
      closeSheet();
      openTab('friends');
      toast('Войдите, чтобы отправлять стихи друзьям');
      return;
    }
    if (!friends.length) await loadAll();
    closeSheet();
    openSheet(`
      <h2>Отправить другу</h2>
      <div class="send-verse"><p>${esc(it.x)}</p><small>${esc(it.r)}</small></div>
      ${friends.length ? `
        <div class="friend-pick">${friends.map(({ p }) => `<button data-uid="${p.id}">${avatar(p, 52)}<span>${esc(p.display_name.split(' ')[0])}</span></button>`).join('')}</div>
        <form class="auth-form" id="send-form">
          <label>Пара слов от себя (необязательно)<input name="note" maxlength="300" placeholder="Подумал о тебе…"></label>
          <button class="primary as-btn" type="submit" disabled>${ICON.send}Отправить</button>
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
        const rows = [...chosen].map((rid) => ({
          sender: me.id, recipient: rid, verse_id: it.id, ref: it.r, body: it.x,
          book: it.b, chapter: it.c, v1: it.v?.[0], v2: it.v?.[1], note,
        }));
        const btn = $('#send-form button', sheet);
        btn.disabled = true;
        const { error } = await sb.from('shares').insert(rows);
        if (error) { btn.disabled = false; toast('Не удалось отправить'); return; }
        closeSheet();
        toast(rows.length > 1 ? `Отправлено ${rows.length} друзьям` : 'Отправлено');
      });
    });
  }

  /* ---------------- клики на экране ---------------- */
  function onClick(e) {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    const f = b.dataset.f;
    if (f === 'login-tg') loginTelegram();
    else if (f === 'login-mail') loginMail();
    else if (f === 'edit') editProfile();
    else if (f === 'add') addFriendSheet();
    else if (f === 'invite') invite();
    else if (f === 'accept') {
      sb.from('friendships').update({ status: 'accepted' }).eq('id', b.dataset.id)
        .then(({ error }) => { if (error) toast('Не получилось'); else toast('Вы теперь друзья'); return loadAll(); }).then(render);
    } else if (f === 'remove') {
      sb.from('friendships').delete().eq('id', b.dataset.id).then(loadAll).then(render);
    } else if (f === 'unfriend') {
      if (!confirm(`Удалить ${b.dataset.name} из друзей?`)) return;
      sb.from('friendships').delete().eq('id', b.dataset.id).then(loadAll).then(render);
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
    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'svitok-auth' },
    });
    await refresh().catch(() => {});
    render();
    if (pendingAdd) {
      if (me) { const u = pendingAdd; pendingAdd = null; openTab('friends'); addByUsername(u); }
      else { openTab('friends'); toast('Войдите, чтобы добавить друга'); }
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden && me) loadAll().then(() => { if ($('[data-view=friends]').classList.contains('on')) render(); }); });
    setInterval(() => { if (!document.hidden && me) loadAll(); }, 90_000);
  }

  return { init, render, sendVerse, get enabled() { return enabled; } };
})();
