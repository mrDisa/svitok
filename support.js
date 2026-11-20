'use strict';

/* Публичная ссылка на добровольный сбор. Платёж выполняется только на стороне банка. */
const Support = (() => {
  const URL = 'https://messenger.sbrf.ru/sl/PaICte6EsQj2AhmcD';
  const PAGE = 'https://mrdisa.github.io/svitok/?pwa=1#support';
  let origin = 'profile';
  const root = () => $('#support');
  function open() {
    SupportPrompt.markSeen();
    const current = $('.view.on')?.dataset.view;
    origin = ['more', 'profile'].includes(current) ? current : 'profile';
    openTab('support');
  }
  function render() {
    root().innerHTML = `
      <div class="page-head subpage-head"><button class="icon-btn" data-support-back aria-label="${origin === 'more' ? 'Назад в настройки' : 'Назад в профиль'}">${I.back}</button><div><h1>Поддержать Свиток</h1><p>Добровольный сбор на развитие</p></div></div>
      <div class="support-content">
        <div class="support-hero">
          <span class="support-kicker">Бесплатное чтение каждый день</span>
          <h2>Помочь «Свитку» расти</h2>
          <p>Если приложение помогает вам, можно поддержать его развитие любой удобной суммой.</p>
          <div class="support-goal"><small>Цель сбора</small><strong>15 000 ₽</strong></div>
          <a class="primary support-primary" href="${URL}" target="_blank" rel="noopener noreferrer">Открыть сбор в Сбере</a>
          <button class="support-copy" data-support-copy>${I.copy}Скопировать ссылку на сбор</button>
          <p class="support-live">Актуальная собранная сумма отображается в Сбере.</p>
        </div>
        <section class="support-section" aria-labelledby="support-purpose-title">
          <h2 id="support-purpose-title">На что пойдут деньги</h2>
          <ul class="support-purposes">
            <li><b>Домен</b><span>Собственный адрес сайта.</span></li>
            <li><b>VPS</b><span>Аренда сервера для работы проекта.</span></li>
            <li><b>Apple Developer Program</b><span>Годовое участие для подготовки версии приложения для iPhone.</span></li>
          </ul>
        </section>
        <section class="support-section support-qr-section" aria-labelledby="support-qr-title">
          <div><h2 id="support-qr-title">Открыть сбор с телефона</h2><p>Наведите камеру телефона на QR-код. Он ведёт на ту же страницу сбора в Сбере.</p><a class="support-download" href="img/support-qr.png" download="svitok-support-qr.png">Скачать QR-код</a></div>
          <img class="support-qr" src="img/support-qr.png" width="228" height="228" alt="QR-код ссылки на сбор «Свитка» в Сбере">
        </section>
        <aside class="support-ios"><b>Если Сбер не открывается на iPhone</b><p>Скопируйте ссылку на сбор, вставьте её в Safari и повторите переход. Приложение СберБанк Онлайн должно быть установлено.</p></aside>
        <div class="support-terms"><p>Организатор — Даниил Исавердов. Поддержка добровольная, не является покупкой и не предоставляет дополнительных функций. «Свиток» остаётся бесплатным.</p><p>О расходах расскажу после покупок. Выпуск в App Store зависит от прохождения проверки Apple.</p></div>
        <button class="support-share" data-support-share>${I.share}Рассказать о сборе</button>
      </div>`;
  }
  async function copy() {
    const ok = await copyText(URL);
    toast(ok ? 'Ссылка на сбор скопирована' : 'Не удалось скопировать. Нажмите и удерживайте ссылку на сбор.');
    return ok;
  }
  function init() {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && document.documentElement.classList.contains('mode-app')) { SupportPrompt.start(); SupportPrompt.maybeShow(); }
    });
    document.addEventListener('click', async e => {
      if (e.target.closest('[data-support-notice-close]')) { SupportPrompt.close(); return; }
      if (e.target.closest('[data-support-notice-open]')) { SupportPrompt.close(); open(); return; }
      if (e.target.closest('[data-open-support]')) { e.preventDefault(); open(); return; }
      if (e.target.closest('[data-support-back]')) { openTab(origin); return; }
      if (e.target.closest('[data-support-copy]')) { await copy(); return; }
      if (e.target.closest('[data-support-share]')) {
        const data = { title: 'Поддержать Свиток', text: 'Помогите развитию бесплатного приложения для чтения Библии.', url: PAGE };
        try {
          if (navigator.share) await navigator.share(data);
          else { const ok = await copyText(PAGE); toast(ok ? 'Ссылка на страницу поддержки скопирована' : 'Не удалось скопировать ссылку'); }
        } catch (error) { if (error.name !== 'AbortError') toast('Не удалось поделиться. Можно скопировать ссылку на сбор.'); }
      }
    });
  }
  return { init, open, render, url: URL, page: PAGE };
})();


/* Одно знакомство с поддержкой: только при запуске, после двух дней использования. */
const SupportPrompt = (() => {
  const WAIT = 48 * 60 * 60 * 1000;
  let attempted = false;
  const dialog = () => $('#support-notice');
  const dayKey = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  };
  function start() {
    attempted = false;
    if (document.hidden || store.get('supportNoticeSeen', false)) return;
    const previous = store.get('supportUsage', {});
    const first = Number(previous.firstUsedAt);
    const state = {
      firstUsedAt: Number.isFinite(first) && first > 0 && first <= Date.now() ? first : Date.now(),
      days: [...new Set([...(Array.isArray(previous.days) ? previous.days : []), dayKey()])].sort().slice(-3),
    };
    store.set('supportUsage', state);
  }
  function markSeen() {
    store.set('supportNoticeSeen', true);
    // Если браузер запретил сохранение, не показываем экран с риском повторения после запуска.
    return store.get('supportNoticeSeen', false) === true;
  }
  function close() { if (dialog()?.open) dialog().close(); }
  function maybeShow() {
    if (attempted) return false;
    attempted = true;
    const usage = store.get('supportUsage', {});
    if (document.hidden || store.get('supportNoticeSeen', false) || !store.get('onboarded', false)) return false;
    if (!Number.isFinite(usage.firstUsedAt) || Date.now() - usage.firstUsedAt < WAIT || (usage.days || []).length < 2) return false;
    if ($('#app').dataset.tab !== 'feed' || !$('#onb').hidden || !$('#dw').hidden || !$('#sheet').hidden) return false;
    const el = dialog();
    if (typeof el?.showModal !== 'function' || !markSeen()) return false;
    el.showModal();
    $('[data-support-notice-close]', el)?.focus({preventScroll:true});
    return true;
  }
  return { start, maybeShow, markSeen, close };
})();
