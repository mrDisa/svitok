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

  async function api(action, body = {}, token) {
    const r = await fetch(`${CFG.supabaseUrl}/functions/v1/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseKey, Authorization: `Bearer ${token || CFG.supabaseKey}` },
      body: JSON.stringify({ action, ...body }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || r.status);
    return data;
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
  async function currentSub() {
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }
  async function enablePush(st) {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Уведомления не разрешены'); return false; }
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription())
      || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(CFG.vapidPublicKey) });
    await api('subscribe', { sub: sub.toJSON(), hour: st.hour, tz: tz() }, await Social.accessToken());
    return true;
  }
  async function disablePush() {
    const sub = await currentSub().catch(() => null);
    if (sub) { await api('unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
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

  function label() {
    const st = state();
    const ways = [st.push && 'уведомление', st.tg && 'Telegram'].filter(Boolean);
    return ways.length ? `Каждый день в ${st.hour}:00 · ${ways.join(' и ')}` : 'Выключено';
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
        <div class="row"><div class="grow">Уведомление на телефон<small>${ps.ok ? 'Придёт, даже если приложение закрыто' : esc(ps.why)}</small></div>${sw(st.push && ps.ok, 'data-rpush', !ps.ok)}</div>
        <div class="row"><div class="grow">Сообщение в Telegram<small>${tgUser ? 'Бот пришлёт стих с кнопкой «Открыть»' : 'Войдите через Telegram в «Профиле», чтобы включить'}</small></div>${sw(st.tg && tgUser, 'data-rtg', !tgUser)}</div>
      </div>
      ${st.push && ps.ok ? '<button class="pill-btn" data-rtest style="display:block;margin:6px auto 0">Прислать пробное уведомление</button>' : ''}`;
  }
  function open() {
    closeSheet();
    openSheet(sheetHTML(), (sheet) => {
      const redraw = () => { sheet.innerHTML = '<div class="grab"></div>' + sheetHTML(); };
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
            if (st.push) { await disablePush(); st.push = false; toast('Уведомление выключено'); }
            else if (await enablePush(st)) { st.push = true; toast(`Готово! Напомню в ${st.hour}:00`); }
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

  return { open, label };
})();
