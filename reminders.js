'use strict';

/* ======================================================================
   Напоминание «Слово дня»: пуш-уведомление и/или сообщение от Telegram-бота.
   Сервер — функция notify в Supabase (рассылка по расписанию каждые 15 минут).
   Использует: $, $$, esc, store, toast, openSheet, closeSheet, renderMore,
   IS_IOS, STANDALONE, Tg, Social, I.
   ====================================================================== */
const Reminders = (() => {
  const CFG = window.SVITOK_CONFIG || {};
  const HOURS = Array.from({ length: 17 }, (_, i) => i + 6); // 6:00 … 22:00
  const tz = () => -new Date().getTimezoneOffset();
  const state = () => ({ hour: 8, push: false, tg: false, ...store.get('remind', {}) });
  const save = (st) => store.set('remind', st);
  let setupPromise = null;
  const setupMessages = { registration: 'Подготавливаем приложение…', subscription: 'Подключаем устройство…', server: 'Сохраняем подключение…', ready: 'Уведомления подключены на этом устройстве' };
  function setupStatus(phase, error) {
    store.set('pushSetup', { phase, failed: !!error, error: error ? String(error.name || 'Error') : null });
    if (typeof document !== 'undefined') {
      document.querySelectorAll('[data-push-status]').forEach(hint => { hint.textContent = setupLabel(); });
    }
  }
  function setupLabel() {
    const st = store.get('pushSetup', {});
    if (st.failed) return ({ registration: 'Не удалось подготовить приложение. Проверьте интернет и повторите.', subscription: 'Разрешение получено, но устройство не подключилось. Нажмите, чтобы повторить.', server: 'Устройство готово, но подключение не сохранено. Проверьте интернет и повторите.' })[st.phase] || 'Не удалось подключить уведомления. Попробуйте ещё раз.';
    return setupPromise ? setupMessages[st.phase] || 'Подключаем уведомления…' : 'Разрешите доставку на это устройство';
  }
  function timed(promise, ms, name) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => { const error = new Error(name); error.name = name; reject(error); }, ms); })]).finally(() => clearTimeout(timer));
  }
  const preferences = () => ({ messages: true, comeback: true, daily: true, ...store.get('notificationPrefs', {}) });
  function progress() {
    return { day: store.get('day', null), streak: store.get('streak', null), goal: store.get('goal', 10), plans: store.get('plans', {}) };
  }
  function settingsHTML() {
    const prefs = preferences();
    const support = pushSupport();
    const ready = state().delivery;
    return [['messages', 'Сообщения', 'Новые сообщения в личных и групповых чатах'], ['comeback', 'Серия и план', 'В 20:00, если дневная цель или план ещё не выполнены']].map(([key, title, hint]) => `<div class="row"><div class="grow">${title}<small>${hint}</small></div><button class="switch${prefs[key] ? ' on' : ''}" data-notify-kind="${key}" role="switch" aria-checked="${prefs[key]}" aria-label="${title}"><i></i></button></div>`).join('') + (!ready ? `<button class="row" data-notify-activate${support.ok && !setupPromise ? '' : ' disabled'}><div class="grow">${setupPromise ? 'Подключаем уведомления…' : 'Разрешить push-уведомления'}<small data-push-status role="status">${esc(support.ok ? setupLabel() : support.why)}</small></div>${I.next}</button>` : '');
  }
  async function syncPreferences() {
    if (!pushSupport().ok) return;
    const sub = await currentSub();
    if (!sub) return;
    await api('subscribe', { sub: sub.toJSON(), hour: state().hour, tz: tz(), preferences: preferences(), progress: progress() }, await Social.accessToken());
  }
  async function toggle(key) {
    if (!['messages', 'comeback'].includes(key)) return;
    const prev = preferences();
    store.set('notificationPrefs', { ...prev, [key]: !prev[key] });
    try { await syncPreferences(); }
    catch { store.set('notificationPrefs', prev); toast('Не удалось сохранить. Проверьте подключение'); }
  }
  async function activate() {
    if (!pushSupport().ok) return;
    try {
      if (await enablePush(state())) { save({ ...state(), push: preferences().daily, delivery: true }); toast('Готово! Уведомления подключены на этом устройстве'); return true; }
    } catch { toast(setupLabel()); }
    return false;
  }
  async function acknowledge(messageId) {
    if (!pushSupport().ok) return;
    const sub = await currentSub();
    const token = await Social.accessToken();
    if (sub && token) await api('chat-received', { messageId, endpoint: sub.endpoint }, token);
  }
  let progressTimer;
  function scheduleSync() {
    clearTimeout(progressTimer);
    progressTimer = setTimeout(() => syncPreferences().catch(() => {}), 1500);
  }
  async function init() {
    // Уже выданное разрешение используем без повторного запроса браузеру.
    if (pushSupport().ok && Notification.permission === 'granted') {
      try { if (await enablePush(state())) save({ ...state(), push: preferences().daily, delivery: true }); } catch { /* повтор при следующем входе */ }
    }
  }


  async function api(action, body = {}, token) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const r = await fetch(`${CFG.supabaseUrl}/functions/v1/notify`, {
        signal: controller.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseKey, Authorization: `Bearer ${token || CFG.supabaseKey}` },
        body: JSON.stringify({ action, ...body }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || r.status);
      return data;
    } finally { clearTimeout(timer); }
  }

  /* можно ли включить пуши здесь и если нет — почему */
  function pushSupport() {
    if (Tg.inTg) return { ok: false, why: 'Внутри Telegram уведомления браузера не работают — включите «Сообщение в Telegram».' };
    if (IS_IOS && !STANDALONE) return { ok: false, why: 'На iPhone напоминания работают в приложении с экрана «Домой». Установите «Свиток» и включите здесь.' };
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return { ok: false, why: 'Этот браузер не поддерживает уведомления.' };
    if (Notification.permission === 'denied') return { ok: false, why: 'Уведомления запрещены в настройках. Разрешите их для «Свитка» и вернитесь сюда.' };
    return { ok: true };
  }

  const b64ToBytes = (b64) => {
    const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(s, (ch) => ch.charCodeAt(0));
  };
  async function pushWorker() {
    let reg = await timed(navigator.serviceWorker.getRegistration(), 5000, 'WorkerLookupTimeout');
    if (!reg) reg = await timed(navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }), 15000, 'WorkerRegistrationTimeout');
    if (reg.active) return reg;
    return timed(navigator.serviceWorker.ready, 20000, 'WorkerActivationTimeout');
  }
  async function currentSub() {
    const reg = await pushWorker();
    return timed(reg.pushManager.getSubscription(), 5000, 'SubscriptionLookupTimeout');
  }
  function enablePush(st) {
    if (setupPromise) return setupPromise;
    // requestPermission вызывается сразу в обработчике нажатия, до подготовки worker.
    setupPromise = (async () => {
      let phase = 'registration';
      try {
        const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
        if (perm !== 'granted') { toast('Уведомления не разрешены'); return false; }
        setupStatus(phase);
        const reg = await pushWorker();
        phase = 'subscription'; setupStatus(phase);
        const sub = await timed(reg.pushManager.getSubscription(), 5000, 'SubscriptionLookupTimeout')
          || await timed(reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(CFG.vapidPublicKey) }), 20000, 'PushSubscriptionTimeout');
        phase = 'server'; setupStatus(phase);
        const token = await timed(Social.accessToken(), 8000, 'AccountTimeout');
        await api('subscribe', { sub: sub.toJSON(), hour: st.hour, tz: tz(), preferences: preferences(), progress: progress() }, token);
        setupStatus('ready');
        return true;
      } catch (error) { setupStatus(phase, error); throw error; }
    })().finally(() => { setupPromise = null; });
    return setupPromise;
  }
  async function enableTg(st) {
    const token = await Social.accessToken();
    if (!token) throw new Error('auth');
    await api('tg-subscribe', { hour: st.hour, tz: tz() }, token);
  }
  async function disableTg() {
    const token = await Social.accessToken();
    if (token) await api('tg-unsubscribe', {}, token).catch(() => {});
  }

  /* Источник правды: Telegram — сервер (общий для аккаунта), пуш — подписка этого устройства.
     Память устройства (store 'remind') — только кэш для мгновенного показа. true — если что-то изменилось. */
  async function refresh() {
    const st = state();
    let endpoint = '';
    if (pushSupport().ok) endpoint = (await currentSub().catch(() => null))?.endpoint || '';
    let r;
    try { r = await api('status', { endpoint }, await Social.accessToken()); } catch { return false; }
    const next = { hour: r.tg?.hour ?? r.push?.hour ?? st.hour, push: !!(endpoint && r.push && r.push.daily_enabled), delivery: !!(endpoint && r.push), tg: !!r.tg };
    const prefs = preferences();
    const changed = (r.push && (r.push.messages_enabled !== prefs.messages || r.push.comeback_enabled !== prefs.comeback)) || next.hour !== st.hour || next.push !== st.push || next.tg !== st.tg || next.delivery !== st.delivery;
    if (r.push) store.set('notificationPrefs', { messages: r.push.messages_enabled, comeback: r.push.comeback_enabled, daily: r.push.daily_enabled });
    if (changed) save(next);
    return changed;
  }

  function label() {
    const st = state();
    const ways = [st.push && 'уведомление', st.tg && 'Telegram'].filter(Boolean);
    return ways.length ? `Каждый день в ${st.hour}:00 · ${ways.join(' и ')}` : preferences().daily ? 'Включено · разрешите push на устройстве' : 'Выключено';
  }

  /* ---------- шторка ---------- */
  function sheetHTML() {
    const st = state();
    const ps = pushSupport();
    const tgUser = Social.isTelegram();
    const sw = (on, attr, disabled) => `<button class="switch${on ? ' on' : ''}" ${attr} role="switch" aria-checked="${on}"${disabled ? ' disabled' : ''}><i></i></button>`;
    return `
      <h2>Напоминание</h2>
      <p class="sheet-text">Каждый день — «Слово дня»: стих и картина, чтобы начать день со Слова.</p>
      <div class="sec-title" style="margin-top:0">Время</div>
      <div class="rm-hours">${HOURS.map((h) => `<button class="${h === st.hour ? 'on' : ''}" data-rhour="${h}">${h}:00</button>`).join('')}</div>
      <div class="group" style="margin-top:14px">
        <div class="row"><div class="grow">Уведомление на этом устройстве<small>${ps.ok ? 'Придёт, даже если приложение закрыто. На другом телефоне включается отдельно' : esc(ps.why)}</small></div>${sw(preferences().daily, 'data-rpush', !ps.ok)}</div>
        <div class="row"><div class="grow">Сообщение в Telegram<small>${tgUser ? 'Бот пришлёт стих с кнопкой «Открыть». Общее для всех ваших устройств' : 'Войдите через Telegram в «Профиле», чтобы включить'}</small></div>${sw(st.tg && tgUser, 'data-rtg', !tgUser)}</div>
      </div>
      ${st.push && ps.ok ? '<button class="pill-btn" data-rtest style="display:block;margin:6px auto 0">Прислать пробное уведомление</button>' : ''}`;
  }
  function open() {
    closeSheet();
    openSheet(sheetHTML(), (sheet) => {
      const redraw = () => { sheet.innerHTML = '<div class="grab"></div>' + sheetHTML(); };
      // показываем сразу из кэша, затем сверяемся с сервером и устройством
      refresh().then((changed) => { if (changed && sheet.isConnected) redraw(); if (changed && $('[data-view=more]').classList.contains('on')) renderMore(); });
      sheet.addEventListener('click', async (e) => {
        const st = state();
        let m;
        try {
          if ((m = e.target.closest('[data-rhour]'))) {
            st.hour = +m.dataset.rhour;
            save(st);
            if (st.push && pushSupport().ok) await enablePush(st).catch(() => {});
            if (st.tg) await enableTg(st).catch(() => {});
            redraw();
            if (st.push || st.tg) toast(`Напомню в ${st.hour}:00`);
          } else if ((m = e.target.closest('[data-rpush]')) && !m.disabled) {
            m.disabled = true;
            const prev = preferences();
            store.set('notificationPrefs', { ...prev, daily: !prev.daily });
            try {
              if (prev.daily) { await syncPreferences(); st.push = false; toast('Слово дня выключено'); }
              else if (await enablePush(st)) { st.push = true; st.delivery = true; toast(`Готово! Напомню в ${st.hour}:00`); }
              else store.set('notificationPrefs', prev);
            } catch (error) { store.set('notificationPrefs', prev); throw error; }
            save(st); redraw();
          } else if ((m = e.target.closest('[data-rtg]')) && !m.disabled) {
            m.disabled = true;
            if (st.tg) { await disableTg(); st.tg = false; toast('Сообщения выключены'); }
            else { await enableTg(st); st.tg = true; toast(`Бот пришлёт стих в ${st.hour}:00`); }
            save(st); redraw();
          } else if (e.target.closest('[data-rtest]')) {
            const sub = await currentSub();
            if (!sub) { toast('Подписка не найдена — включите заново'); return; }
            await api('test', { endpoint: sub.endpoint });
            toast('Отправлено — проверьте уведомления');
          }
        } catch (err) {
          toast(String(err.message) === 'auth' ? 'Сначала войдите через Telegram' : 'Не получилось, попробуйте ещё раз');
          redraw();
        }
        if ($('[data-view=more]').classList.contains('on')) renderMore();
      });
    });
  }

  return { open, label, refresh, settingsHTML, toggle, activate, init, scheduleSync, acknowledge, messagesOn: () => preferences().messages !== false, onboardingState: () => ({ ...pushSupport(), connected: state().delivery === true && typeof Notification !== 'undefined' && Notification.permission === 'granted', install: IS_IOS && !STANDALONE && !Tg.inTg, hint: setupLabel() }) };
})();
