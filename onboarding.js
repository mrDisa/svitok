'use strict';

/* ======================================================================
   Первый запуск (знакомство) и цель на день.
   Использует общие помощники из app.js: $, $$, esc, store, S, persist,
   TOPICS, resetFeed, toast, openSheet, closeSheet, Scenes, I.
   ====================================================================== */

/* ---------------- цель на день ---------------- */
const Goal = (() => {
  const OPTIONS = [
    { min: '2 минуты', n: 5, note: 'Пара стихов — коротко, но каждый день' },
    { min: '5 минут', n: 10, note: 'Спокойное начало или конец дня' },
    { min: '10 минут', n: 20, note: 'Время подумать над каждым стихом' },
    { min: '15+ минут', n: 30, note: 'Для тех, кто хочет глубже' },
  ];
  const DWELL = 2.5; // сек на стихе, чтобы он засчитался

  const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  const yesterday = () => { const d = new Date(Date.now() - 864e5); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

  // настройки читаем при первом обращении: этот файл загружается раньше app.js
  let goal, day, streak, loaded = false;
  function load() {
    if (loaded) return;
    loaded = true;
    goal = store.get('goal', 10);
    day = store.get('day', { d: '', n: 0, done: false });
    streak = store.get('streak', { last: '', count: 0 });
  }

  function fresh() {
    load();
    if (day.d !== today()) { day = { d: today(), n: 0, done: false }; store.set('day', day); }
    // серия прерывается, если вчера цель не выполнена
    if (streak.last && streak.last !== today() && streak.last !== yesterday() && streak.count) {
      streak = { last: streak.last, count: 0 }; store.set('streak', streak);
    }
  }
  const option = (n) => OPTIONS.find((o) => o.n === n) || OPTIONS[1];
  const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; };
  const daysWord = (n) => `${n} ${plural(n, 'день', 'дня', 'дней')}`;
  const versesWord = (n) => `${n} ${plural(n, 'стих', 'стиха', 'стихов')}`;

  function ringSVG(n, total, size = 34, stroke = 3) {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r, pct = Math.min(1, n / total);
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="ring-svg">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="${stroke}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--gold-2)" stroke-width="${stroke}" stroke-linecap="round"
        stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - pct)).toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`;
  }

  function renderRing() {
    const el = $('#goal-ring');
    if (!el) return;
    fresh();
    el.classList.toggle('done', day.done);
    el.innerHTML = ringSVG(day.n, goal) + `<span>${day.done ? '✓' : Math.min(day.n, goal)}</span>`;
    el.setAttribute('aria-label', `Цель на сегодня: ${Math.min(day.n, goal)} из ${goal}`);
  }

  function count() {
    fresh();
    day.n += 1;
    if (!day.done && day.n >= goal) {
      day.done = true;
      if (streak.last !== today()) {
        streak = { last: today(), count: streak.last === yesterday() ? streak.count + 1 : 1 };
        store.set('streak', streak);
      }
      celebrate();
    }
    store.set('day', day);
    renderRing();
  }

  function celebrate() {
    const el = $('#goal-ring');
    if (el) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
    toast(streak.count > 1 ? `Цель выполнена · серия ${daysWord(streak.count)}` : 'Цель на сегодня выполнена');
  }

  function setGoal(n) { load(); goal = n; store.set('goal', n); fresh(); if (!day.done && day.n >= goal) { day.done = true; store.set('day', day); } renderRing(); }

  function optionsHTML(sel) {
    return `<div class="goal-opts">${OPTIONS.map((o) => `<button type="button" class="goal-opt${o.n === sel ? ' on' : ''}" data-goal="${o.n}">
      <b>${o.min}</b><span>${versesWord(o.n)} в день</span><small>${o.note}</small></button>`).join('')}</div>`;
  }

  function openSheet() {
    fresh();
    const left = Math.max(0, goal - day.n);
    window.openSheet(`
      <h2>Сегодня</h2>
      <div class="goal-big">${ringSVG(day.n, goal, 120, 8)}<div><b>${Math.min(day.n, goal)}</b><span>из ${goal}</span></div></div>
      <p class="sheet-text">${day.done ? 'Цель на сегодня выполнена. Можно остановиться — или читать дальше.' : `Осталось ${versesWord(left)}. Засчитывается стих, на котором вы задержались хотя бы пару секунд.`}</p>
      <p class="goal-streak">${streak.count ? `Серия: <b>${daysWord(streak.count)}</b> подряд` : 'Выполните цель сегодня, чтобы начать серию'}</p>
      <div class="sec-title">Сколько времени в день</div>
      ${optionsHTML(goal)}`, (sheet) => {
      sheet.addEventListener('click', (e) => {
        const b = e.target.closest('[data-goal]');
        if (!b) return;
        setGoal(+b.dataset.goal);
        closeSheet();
        openSheet();
        if ($('[data-view=more]').classList.contains('on')) renderMore();
      });
    });
  }

  function label() { fresh(); return `${versesWord(goal)} в день${streak.count ? ` · серия ${daysWord(streak.count)}` : ''}`; }

  function init() {
    const el = $('#goal-ring');
    if (el) el.addEventListener('click', openSheet);
    renderRing();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) renderRing(); });
  }

  return { init, count, setGoal, openSheet, label, optionsHTML, OPTIONS, DWELL, get goal() { load(); return goal; }, versesWord };
})();

/* ---------------- знакомство при первом запуске ---------------- */
const Onboarding = (() => {
  const SCENES_BY_STEP = ['dove', 'walkwater', 'candles', 'shepherd', 'bethlehem'];
  let step = 0;
  let chosenGoal = 10;
  const chosenTopics = new Set();

  const el = () => $('#onb');

  const STEPS = [
    () => `
      <div class="onb-hero"><img src="icons/icon-192.png" alt="" width="84" height="84"></div>
      <h1>Добро пожаловать в «Свиток»</h1>
      <p>Библия в формате ленты: каждый экран — один стих. Давайте за минуту настроим всё под вас.</p>
      <button class="onb-btn" data-next>Начать</button>
      <button class="onb-skip" data-skip>Пропустить</button>`,
    () => `
      <h1>Как это работает</h1>
      <div class="onb-demo">
        <div class="demo-row"><div class="demo-ico demo-swipe"><i></i><i></i></div><div><b>Листайте вверх</b><span>Каждый новый экран — новый стих</span></div></div>
        <div class="demo-row"><div class="demo-ico demo-heart">${I.heartFill}</div><div><b>Дважды коснитесь</b><span>Это «нравится» — лента запомнит, что вам близко</span></div></div>
        <div class="demo-row"><div class="demo-ico">${I.book}</div><div><b>«Глава»</b><span>Откроет стих в контексте — всю главу целиком</span></div></div>
        <div class="demo-row"><div class="demo-ico">${I.share}</div><div><b>«Поделиться»</b><span>Картинка для сторис или стих другу в «Свитке»</span></div></div>
      </div>
      <button class="onb-btn" data-next>Понятно</button>`,
    () => `
      <h1>Сколько времени в день?</h1>
      <p>Поставим небольшую цель. Её всегда можно поменять.</p>
      ${Goal.optionsHTML(chosenGoal)}
      <button class="onb-btn" data-next>Дальше</button>`,
    () => `
      <h1>Что вам сейчас ближе?</h1>
      <p>Выберите несколько тем — лента будет чаще показывать именно их.</p>
      <div class="onb-topics">${TOPICS.slice(1).map(([k, n]) => `<button type="button" class="onb-topic${chosenTopics.has(k) ? ' on' : ''}" data-topic-pick="${k}">${n}</button>`).join('')}</div>
      <button class="onb-btn" data-next>${chosenTopics.size ? 'Дальше' : 'Пропустить'}</button>`,
    () => `
      <div class="onb-hero onb-check">✓</div>
      <h1>Всё готово</h1>
      <p>Ваша цель — <b>${Goal.versesWord(chosenGoal)} в день</b>. Прогресс виден в кружке слева вверху ленты: нажмите на него, чтобы посмотреть серию дней.</p>
      <button class="onb-btn" data-finish>Открыть ленту</button>`,
  ];

  function render() {
    const root = el();
    root.innerHTML = `
      <div class="onb-bg">${Scenes.svg('onb' + step, { scene: SCENES_BY_STEP[step] })}</div>
      <div class="onb-shade"></div>
      <div class="onb-panel">
        <div class="onb-dots">${STEPS.map((_, i) => `<i class="${i === step ? 'on' : i < step ? 'past' : ''}"></i>`).join('')}</div>
        <div class="onb-body" key="${step}">${STEPS[step]()}</div>
        ${step > 0 && step < STEPS.length - 1 ? '<button class="onb-back" data-back aria-label="Назад">←</button>' : ''}
      </div>`;
    root.querySelector('.onb-body').classList.add('enter');
  }

  function finish(skipped) {
    store.set('onboarded', true);
    if (!skipped) {
      Goal.setGoal(chosenGoal);
      if (chosenTopics.size) {
        chosenTopics.forEach((t) => { S.weights[t] = Math.max(S.weights[t] ?? 1, 4); });
        persist.weights();
        if (typeof resetFeed === 'function') resetFeed();
      }
    }
    const root = el();
    root.classList.add('leave');
    setTimeout(() => { root.hidden = true; root.classList.remove('leave'); root.innerHTML = ''; }, 350);
  }

  function onClick(e) {
    const t = e.target;
    let m;
    if (t.closest('[data-next]')) { step = Math.min(step + 1, STEPS.length - 1); render(); }
    else if (t.closest('[data-back]')) { step = Math.max(0, step - 1); render(); }
    else if (t.closest('[data-skip]')) finish(true);
    else if (t.closest('[data-finish]')) finish(false);
    else if ((m = t.closest('[data-goal]'))) {
      chosenGoal = +m.dataset.goal;
      $$('[data-goal]', el()).forEach((b) => b.classList.toggle('on', b === m));
    } else if ((m = t.closest('[data-topic-pick]'))) {
      const k = m.dataset.topicPick;
      if (chosenTopics.has(k)) chosenTopics.delete(k); else chosenTopics.add(k);
      m.classList.toggle('on', chosenTopics.has(k));
      const btn = $('[data-next]', el());
      if (btn) btn.textContent = chosenTopics.size ? 'Дальше' : 'Пропустить';
    }
  }

  function start(force) {
    if (!force && store.get('onboarded', false)) return;
    step = 0;
    chosenGoal = Goal.goal;
    chosenTopics.clear();
    const root = el();
    root.hidden = false;
    render();
  }

  function init() {
    el().addEventListener('click', onClick);
    start(false);
  }

  return { init, start };
})();
