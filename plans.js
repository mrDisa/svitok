'use strict';

/* ======================================================================
   Планы чтения Библии.
   Темп свободный: «сегодня» — первый непрочитанный день плана, без привязки
   к календарю, поэтому пропуск дня ничего не ломает. Прогресс — на телефоне.
   Использует общие помощники из app.js: $, $$, esc, store, toast, BOOKS,
   bibleEl, bibleRoute, openChapter, renderBooks, chLabel, plural, I.
   ====================================================================== */
const Plans = (() => {
  const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
  // индексы книг в порядке Синодального издания (data/books.json)
  const DEFS = [
    { id: 'john21', title: 'Евангелие от Иоанна', days: 21, art: 'rembrandt-head',
      desc: 'Жизнь и слова Христа глазами любимого ученика. По главе в день.', books: () => [42] },
    { id: 'proverbs31', title: 'Притчи за месяц', days: 31, art: 'friedrich-wanderer',
      desc: 'Глава мудрости на каждый день месяца — короткое и очень практичное чтение.', books: () => [19] },
    { id: 'psalms30', title: 'Псалтирь за 30 дней', days: 30, art: 'levitan-bells',
      desc: 'Пять псалмов в день: молитвы на радость, скорбь, тревогу и благодарность.', books: () => [18] },
    { id: 'gospels40', title: 'Четыре Евангелия', days: 40, art: 'bloch-sermon',
      desc: 'Матфей, Марк, Лука и Иоанн подряд — около двух глав в день.', books: () => [39, 40, 41, 42] },
    { id: 'nt90', title: 'Новый Завет за 90 дней', days: 90, art: 'raphael-transfiguration',
      desc: 'Евангелия, Деяния, послания и Откровение — около трёх глав в день.', books: () => range(39, 66) },
    { id: 'bible365', title: 'Библия за год', days: 365, art: 'rublev-trinity',
      desc: 'Вся Библия от Бытия до Откровения — три-четыре главы в день.', books: () => range(0, 66) },
  ];
  const byId = (id) => DEFS.find((d) => d.id === id);
  const artSrc = (d) => `img/art/${d.art}.jpg`;

  /* ---------- данные ---------- */
  const cache = {};
  function days(d) {
    if (cache[d.id]) return cache[d.id];
    const seq = [];
    d.books().forEach((b) => { for (let c = 1; c <= BOOKS[b].c; c++) seq.push([b, c]); });
    const L = seq.length, N = d.days, out = [];
    for (let i = 0; i < N; i++) out.push(seq.slice(Math.round((i * L) / N), Math.round(((i + 1) * L) / N)));
    return (cache[d.id] = out);
  }
  // «Ин 3», «Пс 1–5», «Мф 27–28, Мк 1»
  function label(list) {
    const groups = [];
    list.forEach(([b, c]) => {
      const g = groups[groups.length - 1];
      if (g && g.b === b && g.to === c - 1) g.to = c; else groups.push({ b, from: c, to: c });
    });
    return groups.map((g) => (BOOKS[g.b].c === 1 ? BOOKS[g.b].s : `${BOOKS[g.b].s} ${g.from}${g.to > g.from ? '–' + g.to : ''}`)).join(', ');
  }
  const all = () => store.get('plans', {});
  function progress(d) {
    const p = all()[d.id];
    const done = new Set(p ? p.done : []);
    let next = 0;
    while (done.has(next) && next < d.days) next++;
    return { started: !!p, done, count: done.size, next: next >= d.days ? -1 : next, pct: Math.round((done.size / d.days) * 100) };
  }
  function setDone(d, day, on) {
    const s = all();
    const p = s[d.id] || { started: Date.now(), done: [] };
    const set = new Set(p.done);
    if (on) set.add(day); else set.delete(day);
    p.done = [...set].sort((a, b) => a - b);
    s[d.id] = p;
    store.set('plans', s);
  }
  function start(d) { const s = all(); if (!s[d.id]) { s[d.id] = { started: Date.now(), done: [] }; store.set('plans', s); } }
  function reset(d) { const s = all(); s[d.id] = { started: Date.now(), done: [] }; store.set('plans', s); }
  function stop(d) { const s = all(); delete s[d.id]; store.set('plans', s); }
  const daysWord = (n) => `${n} ${plural(n, 'день', 'дня', 'дней')}`;

  /* ---------- блок на главной вкладки «Библия» ---------- */
  function sectionHTML() {
    const active = DEFS.map((d) => ({ d, p: progress(d) })).filter(({ p }) => p.started && p.next >= 0);
    const today = active.map(({ d, p }) => `
      <button class="plan-today" data-plan-read="${d.id}" style="--img:url('${artSrc(d)}')">
        <div class="pt-body">
          <small>Сегодня по плану</small>
          <b>${esc(d.title)}</b>
          <span>День ${p.next + 1} из ${d.days} · ${esc(label(days(d)[p.next]))}</span>
          <i class="pbar"><i style="width:${p.pct}%"></i></i>
        </div>${I.next}
      </button>`).join('');
    const cards = DEFS.map((d) => {
      const p = progress(d);
      const meta = p.started ? (p.next < 0 ? 'Пройден ✓' : `${p.pct}% · день ${p.next + 1}`) : daysWord(d.days);
      return `<button class="plan-card" data-plan="${d.id}" style="--img:url('${artSrc(d)}')"><b>${esc(d.title)}</b><span>${meta}</span></button>`;
    }).join('');
    return `${today}<div class="sec-title">Планы чтения</div><div class="plan-strip">${cards}</div>`;
  }

  /* ---------- экран плана ---------- */
  let ctx = null; // { id, day, list, i } — читаем день плана

  function renderPlan(id) {
    const d = byId(id);
    if (!d) return;
    bibleRoute = { view: 'plan', id };
    const p = progress(d);
    const list = days(d);
    const el = bibleEl();
    el.innerHTML = `
      <div class="sub-head"><button class="icon-btn" data-nav="books" aria-label="Назад">${I.back}</button><h1>${esc(d.title)}</h1></div>
      <div class="plan-hero" style="--img:url('${artSrc(d)}')">
        <div class="ph-body">
          <span>${daysWord(d.days)}</span>
          <h2>${esc(d.title)}</h2>
          <p>${esc(d.desc)}</p>
        </div>
      </div>
      ${p.started ? `<div class="plan-prog"><div><b>${p.count}</b> из ${d.days} дней</div><i class="pbar"><i style="width:${p.pct}%"></i></i></div>` : ''}
      <div class="plan-cta">
        ${p.next < 0 ? '<div class="hint-card">План пройден полностью. Слава Богу!</div>'
        : `<button class="as-btn" data-plan-day="${p.next}" data-plan-id="${d.id}">${p.started ? `Читать день ${p.next + 1}` : 'Начать план'}</button>`}
        ${p.started ? `<div class="plan-manage">
          <button data-plan-reset="${d.id}">Начать заново</button>
          <button class="danger" data-plan-stop="${d.id}">Прекратить план</button>
        </div>` : ''}
      </div>
      <div class="sec-title">Дни</div>
      ${p.started ? '<p class="plan-tip">Нажмите на кружок, чтобы отметить день или снять отметку.</p>' : ''}
      <div class="plan-days">${list.map((ch, i) => `
        <div class="pd${p.done.has(i) ? ' done' : ''}${i === p.next ? ' next' : ''}">
          <button class="pd-n" data-plan-toggle="${i}" data-plan-id="${d.id}" aria-label="${p.done.has(i) ? 'Снять отметку' : 'Отметить прочитанным'}">${p.done.has(i) ? '✓' : i + 1}</button>
          <button class="pd-main" data-plan-day="${i}" data-plan-id="${d.id}">
            <span class="pd-t"><b>День ${i + 1}</b><small>${esc(label(ch))}</small></span>
            ${i === p.next ? '<em>сегодня</em>' : ''}
          </button>
        </div>`).join('')}</div>`;
    el.scrollTop = 0;
    if (p.next > 4) requestAnimationFrame(() => { const n = $('.pd.next', el); if (n) el.scrollTop = Math.max(0, n.offsetTop - el.clientHeight * 0.4); });
  }

  function readDay(id, day) {
    const d = byId(id);
    start(d);
    ctx = { id, day, list: days(d)[day], i: 0 };
    openChapter(...ctx.list[0]);
  }

  /* панель внизу главы, когда читаем день плана */
  function readerBar(b, c) {
    if (!ctx) return '';
    const i = ctx.list.findIndex(([x, y]) => x === b && y === c);
    if (i < 0) return '';
    ctx.i = i;
    const d = byId(ctx.id);
    const last = i === ctx.list.length - 1;
    return `<div class="plan-bar">
      <div><small>${esc(d.title)} · день ${ctx.day + 1}</small><b>${BOOKS[b].r === 'Псалтирь' ? 'Псалом' : 'Глава'} ${i + 1} из ${ctx.list.length}</b></div>
      <button data-plan-next>${last ? 'Завершить день ✓' : `Дальше: ${esc(chLabel(ctx.list[i + 1]))}`}</button>
    </div>`;
  }
  const inPlan = (b, c) => !!ctx && ctx.list.some(([x, y]) => x === b && y === c);

  function next() {
    if (!ctx) return;
    if (ctx.i < ctx.list.length - 1) { ctx.i += 1; openChapter(...ctx.list[ctx.i]); return; }
    const d = byId(ctx.id);
    setDone(d, ctx.day, true);
    const p = progress(d);
    const id = ctx.id;
    ctx = null;
    toast(p.next < 0 ? 'План пройден полностью!' : `День отмечен · ${p.count} из ${d.days}`);
    renderPlan(id);
  }

  /* клики во вкладке «Библия»; true — если обработали */
  function onClick(e) {
    const t = e.target;
    let m;
    if ((m = t.closest('[data-plan]'))) { renderPlan(m.dataset.plan); return true; }
    if ((m = t.closest('[data-plan-read]'))) { const d = byId(m.dataset.planRead); readDay(d.id, progress(d).next); return true; }
    if ((m = t.closest('[data-plan-day]'))) { readDay(m.dataset.planId, +m.dataset.planDay); return true; }
    if (t.closest('[data-plan-next]')) { next(); return true; }
    if ((m = t.closest('[data-plan-toggle]'))) {
      const d = byId(m.dataset.planId), day = +m.dataset.planToggle;
      const on = !progress(d).done.has(day);
      setDone(d, day, on);
      const el = bibleEl(), top = el.scrollTop;
      renderPlan(d.id);
      el.scrollTop = top;
      toast(on ? `День ${day + 1} отмечен` : `Отметка дня ${day + 1} снята`);
      return true;
    }
    if ((m = t.closest('[data-plan-reset]'))) {
      if (confirm('Сбросить прогресс и начать план с первого дня?')) { reset(byId(m.dataset.planReset)); renderPlan(m.dataset.planReset); toast('План начат заново'); }
      return true;
    }
    if ((m = t.closest('[data-plan-stop]'))) {
      const d = byId(m.dataset.planStop);
      if (confirm(`Прекратить план «${d.title}»? Прогресс будет удалён.`)) {
        stop(d);
        if (ctx && ctx.id === d.id) ctx = null;
        renderBooks();
        toast('План прекращён');
      }
      return true;
    }
    if ((m = t.closest('[data-nav="plan"]'))) { const id = ctx?.id; ctx = null; if (id) renderPlan(id); else renderBooks(); return true; }
    return false;
  }

  return { sectionHTML, renderPlan, readerBar, inPlan, onClick, DEFS };
})();
