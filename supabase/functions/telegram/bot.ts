// «Разговорная» часть бота: приветствие, команды, кнопки, стих по ссылке в чате и inline-поиск.
// Данные (подборка стихов, картины, текст Библии) берём с сайта и держим в памяти функции.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

type Ctx = { tg: (m: string, b: Record<string, unknown>) => Promise<unknown>; admin: SupabaseClient; bot: string; app: string };
type Verse = { id: string; t: string; r: string; b: number; c: number; v: [number, number]; x: string };
type Painting = { id: string; src: string; title: string; artist: string; t: string[] };
type Book = { n: string; s: string; r: string; c: number; nt: boolean };

const TOPICS: [string, string][] = [
  ['hope', 'Надежда'], ['anxiety', 'При тревоге'], ['peace', 'Мир и покой'], ['love', 'Любовь'],
  ['strength', 'Сила'], ['comfort', 'Утешение'], ['faith', 'Вера'], ['thanks', 'Благодарность'],
  ['wisdom', 'Мудрость'], ['forgiveness', 'Прощение'], ['prayer', 'Молитва'], ['jesus', 'Слова Христа'],
];
const TOPIC_NAME = Object.fromEntries(TOPICS);

/* ---------- данные с сайта ---------- */
const cache: Record<string, unknown> = {};
async function get<T>(path: string, app: string): Promise<T> {
  if (!cache[path]) cache[path] = await (await fetch(new URL(path, app))).json();
  return cache[path] as T;
}
const feed = (app: string) => get<Verse[]>('data/feed.json', app);
const paintings = (app: string) => get<Painting[]>('data/paintings.json', app);
const books = (app: string) => get<Book[]>('data/books.json', app);
let bibleText: { b: number; c: number; v: number; t: string; n: string }[] | null = null;

/* ---------- те же формулы, что в приложении ---------- */
const hashStr = (s: string) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
async function artFor(id: string, topic: string | null, app: string) {
  const all = await paintings(app);
  const pool = (topic && all.filter((p) => p.t.includes(topic))) || [];
  const list = pool.length ? pool : all;
  return list[hashStr(id) % list.length];
}
function moscowDay() {
  const d = new Date(Date.now() + 180 * 60_000);
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 864e5);
}
export async function verseOfDay(app: string, day = moscowDay()) {
  const f = await feed(app);
  const v = f[(day * 7919) % f.length];
  return { v, art: await artFor('day-' + day, v.t, app) };
}

/* ---------- оформление ---------- */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const credit = (p: Painting) => `${p.artist} · «${p.title.replace(/^«|»$/g, '')}»`;
const deepLink = (bot: string, b: number, c: number, v: number) => `https://t.me/${bot}/app?startapp=v_${b}_${c}_${v}`;
function verseCaption(v: { x: string; r: string }, head?: string, art?: Painting) {
  const top = head ? `<b>${esc(head)}</b>\n\n` : '';
  const foot = art ? `\n\n<i>🖼 ${esc(credit(art))}</i>` : '';
  return `${top}«${esc(v.x)}»\n<i>— ${esc(v.r)}</i>${foot}`;
}
const kbApp = (app: string, extra: unknown[][] = []) => ({ inline_keyboard: [[{ text: 'Открыть «Свиток»', web_app: { url: app } }], ...extra] });

/* ---------- поиск: ссылки и слова (как во вкладке «Библия») ---------- */
const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const nameKey = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/^от\s+/, '').replace(/(\d)\s*-?\s*(е|я|ое|ая)(?=[\s\p{L}])/u, '$1').replace(/[\s.\-]/g, '');
async function parseRef(q: string, app: string) {
  const bk = await books(app);
  const m = q.trim().match(/^(.*?\p{L}[\p{L}.\s-]*?)\s*(\d+)(?:\s*[:.,]\s*(\d+)(?:\s*[-–—]\s*(\d+))?)?$/u);
  if (!m) return null;
  const nk = nameKey(m[1]);
  if (nk.length < 2) return null;
  const keys = bk.map((b, i) => {
    const k = new Set([nameKey(b.n), nameKey(b.s), nameKey(b.r)]);
    if (b.r === 'Псалтирь') ['псалом', 'псалмы', 'пс'].forEach((x) => k.add(x));
    if (i === 42) k.add('иоанн');
    return [...k];
  });
  let b = keys.findIndex((k) => k.includes(nk));
  if (b < 0) b = keys.findIndex((k) => k.some((x) => x.startsWith(nk)));
  if (b < 0) return null;
  const c = +m[2];
  if (c < 1 || c > bk[b].c) return null;
  const data = await get<{ c: string[][] }>(`data/bible/${String(b + 1).padStart(2, '0')}.json`, app);
  const verses = data.c[c - 1];
  let v1 = m[3] ? +m[3] : 1, v2 = m[4] ? +m[4] : (m[3] ? v1 : Math.min(verses.length, 3));
  v1 = Math.max(1, Math.min(v1, verses.length)); v2 = Math.max(v1, Math.min(v2, verses.length, v1 + 9));
  const x = verses.slice(v1 - 1, v2).join(' ');
  const r = `${bk[b].r} ${c}:${v1}${v2 > v1 ? '–' + v2 : ''}`;
  return { b, c, v1, v2, x: x.charAt(0).toUpperCase() + x.slice(1), r, topic: null as string | null };
}
async function textSearch(q: string, app: string, limit = 20) {
  if (!bibleText) {
    const bk = await books(app);
    const out: typeof bibleText = [];
    await Promise.all(bk.map(async (_, b) => {
      const d = await get<{ c: string[][] }>(`data/bible/${String(b + 1).padStart(2, '0')}.json`, app);
      d.c.forEach((vs, ci) => vs.forEach((t, vi) => out!.push({ b, c: ci + 1, v: vi + 1, t, n: ` ${norm(t)} ` })));
    }));
    out.sort((x, y) => x.b - y.b || x.c - y.c || x.v - y.v);
    bibleText = out;
  }
  const words = norm(q).split(' ').filter((w) => w.length >= 2);
  if (!words.length) return [];
  const phrase = ` ${words.join(' ')}`;
  const has = (p: string, w: string) => (w.length <= 3 ? p.includes(` ${w} `) : p.includes(` ${w}`));
  const exact = [], rest = [];
  for (const e of bibleText) {
    if (!words.every((w) => has(e.n, w))) continue;
    (words.length > 1 && e.n.includes(phrase) ? exact : rest).push(e);
    if (exact.length >= limit) break;
  }
  const bk = await books(app);
  return exact.concat(rest).slice(0, limit).map((e) => ({ b: e.b, c: e.c, v1: e.v, v2: e.v, x: e.t, r: `${bk[e.b].r} ${e.c}:${e.v}`, topic: null as string | null }));
}

/* ---------- напоминание: нужен пользователь Supabase для этого Telegram-аккаунта ---------- */
async function userIdFor(admin: SupabaseClient, from: { id: number; first_name?: string; last_name?: string; username?: string }) {
  const email = `tg${from.id}@telegram.local`;
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ').slice(0, 40) || 'Друг';
  await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { name, tg_username: from.username ?? null, tg_id: from.id } });
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  return link.data?.user?.id ?? null;
}
const HOURS = [6, 7, 8, 9, 10, 12, 18, 20, 21, 22];
function remindKb(on: boolean, hour: number) {
  const rows: unknown[][] = [];
  for (let i = 0; i < HOURS.length; i += 5) rows.push(HOURS.slice(i, i + 5).map((h) => ({ text: `${h === hour && on ? '✓ ' : ''}${h}:00`, callback_data: `rh:${h}` })));
  if (on) rows.push([{ text: 'Выключить напоминание', callback_data: 'roff' }]);
  return { inline_keyboard: rows };
}
async function remindText(admin: SupabaseClient, uid: string | null) {
  const { data } = uid ? await admin.from('tg_daily').select('hour, tz_offset').eq('user_id', uid).maybeSingle() : { data: null };
  const tzNote = !data || data.tz_offset === 180 ? ' (по московскому времени)' : ' (по вашему времени)';
  return {
    on: !!data, hour: data?.hour ?? 8,
    text: data ? `⏰ Каждый день в <b>${data.hour}:00</b>${tzNote} я присылаю «Слово дня».\n\nВыберите другое время или выключите:` : '⏰ Присылать «Слово дня» каждый день?\n\nВыберите время' + tzNote + ':',
  };
}

/* ---------- ответы ---------- */
async function sendWelcome(ctx: Ctx, chat: number, name?: string) {
  await ctx.tg('sendPhoto', {
    chat_id: chat,
    photo: new URL('img/art/rembrandt-head.jpg', ctx.app).toString(),
    caption: `<b>${name ? `Здравствуйте, ${esc(name)}!` : 'Здравствуйте!'}</b>\n\n«Свиток» — Библия, которую хочется листать: стихи Синодального перевода на фоне картин великих мастеров, вся Библия, планы чтения и «Слово дня».\n\nБесплатно и без рекламы.`,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Открыть «Свиток»', web_app: { url: ctx.app } }],
        [{ text: '☀️ Слово дня', callback_data: 'day' }, { text: '📖 Стих по теме', callback_data: 'topics' }],
        [{ text: '⏰ Напоминание', callback_data: 'remind' }, { text: '↗️ Поделиться', url: `https://t.me/share/url?url=${encodeURIComponent(`https://t.me/${ctx.bot}/app`)}&text=${encodeURIComponent('«Свиток» — Библия, которую хочется листать. Бесплатно, без рекламы.')}` }],
      ],
    },
  });
}
async function sendDay(ctx: Ctx, chat: number) {
  const { v, art } = await verseOfDay(ctx.app);
  await ctx.tg('sendPhoto', {
    chat_id: chat, photo: new URL(art.src, ctx.app).toString(), parse_mode: 'HTML',
    caption: verseCaption(v, '☀️ Слово дня', art),
    reply_markup: kbApp(ctx.app, [[{ text: '📖 Ещё стих', callback_data: 'topics' }]]),
  });
}
async function sendTopics(ctx: Ctx, chat: number) {
  const rows: unknown[][] = [];
  for (let i = 0; i < TOPICS.length; i += 3) rows.push(TOPICS.slice(i, i + 3).map(([k, n]) => ({ text: n, callback_data: `v:${k}` })));
  await ctx.tg('sendMessage', { chat_id: chat, text: 'Что вам сейчас ближе?', reply_markup: { inline_keyboard: rows } });
}
async function sendTopicVerse(ctx: Ctx, chat: number, topic: string) {
  const list = (await feed(ctx.app)).filter((v) => v.t === topic);
  if (!list.length) return;
  const v = list[Math.floor(Math.random() * list.length)];
  const art = await artFor(v.id + ':' + Date.now(), topic, ctx.app);
  await ctx.tg('sendPhoto', {
    chat_id: chat, photo: new URL(art.src, ctx.app).toString(), parse_mode: 'HTML',
    caption: verseCaption(v, TOPIC_NAME[topic], art),
    reply_markup: kbApp(ctx.app, [[{ text: '🔄 Ещё по теме', callback_data: `v:${topic}` }, { text: '📖 Другая тема', callback_data: 'topics' }]]),
  });
}
async function sendRemind(ctx: Ctx, chat: number, from: Record<string, unknown>, editId?: number) {
  const uid = await userIdFor(ctx.admin, from as { id: number });
  const r = await remindText(ctx.admin, uid);
  const body = { chat_id: chat, text: r.text, parse_mode: 'HTML', reply_markup: remindKb(r.on, r.hour) };
  await ctx.tg(editId ? 'editMessageText' : 'sendMessage', editId ? { ...body, message_id: editId } : body);
}
const HELP = `<b>Что я умею</b>

/day — «Слово дня»
/verse — стих по теме: надежда, тревога, мир…
/remind — присылать «Слово дня» каждый день
/start — открыть «Свиток»

Напишите мне ссылку, например <code>Ин 3:16</code> или <code>Псалом 22</code>, — пришлю стих.

В <b>любом чате</b> напишите <code>@{bot} не бойся</code> или <code>@{bot} Рим 8:28</code> и выберите стих — отправлю его другу.`;

/* ---------- обработка обновлений ---------- */
export async function handleUpdate(update: Record<string, any>, ctx: Ctx) {
  // inline-режим: поиск стихов в любом чате
  if (update.inline_query) {
    const q = String(update.inline_query.query || '').trim();
    let found: Awaited<ReturnType<typeof textSearch>> = [];
    let dayArt: Painting | null = null;
    if (!q) {
      const { v, art } = await verseOfDay(ctx.app);
      dayArt = art;
      const f = await feed(ctx.app);
      const start = moscowDay() % f.length;
      found = [v, ...Array.from({ length: 14 }, (_, i) => f[(start + i * 13) % f.length])]
        .map((x) => ({ b: x.b, c: x.c, v1: x.v[0], v2: x.v[1], x: x.x, r: x.r, topic: x.t }));
    } else {
      const ref = await parseRef(q, ctx.app).catch(() => null);
      found = ref ? [ref] : await textSearch(q, ctx.app, 20).catch(() => []);
    }
    const results = await Promise.all(found.map(async (v, i) => {
      const art = i === 0 && dayArt ? dayArt : await artFor(`${v.b}.${v.c}.${v.v1}`, v.topic, ctx.app);
      return {
        type: 'article', id: `${v.b}_${v.c}_${v.v1}_${i}`.slice(0, 64),
        title: (i === 0 && !q ? '☀️ Слово дня · ' : '') + v.r,
        description: v.x.length > 120 ? v.x.slice(0, 119) + '…' : v.x,
        thumbnail_url: new URL(art.src, ctx.app).toString(),
        input_message_content: { message_text: verseCaption(v), parse_mode: 'HTML', link_preview_options: { is_disabled: true } },
        reply_markup: { inline_keyboard: [[{ text: 'Открыть в «Свитке»', url: deepLink(ctx.bot, v.b, v.c, v.v1) }]] },
      };
    }));
    await ctx.tg('answerInlineQuery', {
      inline_query_id: update.inline_query.id, results, cache_time: q ? 60 : 600,
      button: { text: 'Открыть «Свиток»', web_app: { url: ctx.app } },
    });
    return;
  }

  // нажатия на кнопки
  if (update.callback_query) {
    const cq = update.callback_query;
    const chat = cq.message?.chat?.id;
    const data = String(cq.data || '');
    await ctx.tg('answerCallbackQuery', { callback_query_id: cq.id });
    if (!chat) return;
    if (data === 'day') await sendDay(ctx, chat);
    else if (data === 'topics') await sendTopics(ctx, chat);
    else if (data.startsWith('v:')) await sendTopicVerse(ctx, chat, data.slice(2));
    else if (data === 'remind') await sendRemind(ctx, chat, cq.from);
    else if (data.startsWith('rh:') || data === 'roff') {
      const uid = await userIdFor(ctx.admin, cq.from);
      if (!uid) return;
      if (data === 'roff') await ctx.admin.from('tg_daily').delete().eq('user_id', uid);
      else {
        const hour = Math.min(23, Math.max(0, +data.slice(3) || 8));
        const { data: row } = await ctx.admin.from('tg_daily').select('tz_offset').eq('user_id', uid).maybeSingle();
        await ctx.admin.from('tg_daily').upsert({ user_id: uid, tg_id: cq.from.id, hour, tz_offset: row?.tz_offset ?? 180 });
      }
      await sendRemind(ctx, chat, cq.from, cq.message.message_id);
    }
    return;
  }

  // сообщения
  const msg = update.message;
  if (!msg?.text || !msg.from || msg.from.is_bot || msg.chat?.type !== 'private') return;
  const text = String(msg.text).trim();
  const chat = msg.chat.id;
  const cmd = text.match(/^\/(\w+)/)?.[1]?.toLowerCase();
  if (cmd === 'start') return sendWelcome(ctx, chat, msg.from.first_name);
  if (cmd === 'day') return sendDay(ctx, chat);
  if (cmd === 'verse') return sendTopics(ctx, chat);
  if (cmd === 'remind') return sendRemind(ctx, chat, msg.from);
  if (cmd === 'help') return void ctx.tg('sendMessage', { chat_id: chat, text: HELP.replaceAll('{bot}', ctx.bot), parse_mode: 'HTML', reply_markup: kbApp(ctx.app) });

  // ссылка или слова — ищем стих
  const ref = await parseRef(text, ctx.app).catch(() => null);
  if (ref) {
    await ctx.tg('sendMessage', {
      chat_id: chat, text: verseCaption(ref), parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: 'Открыть главу', web_app: { url: `${ctx.app}?v=${ref.b}_${ref.c}_${ref.v1}` } }]] },
    });
    return;
  }
  const hits = await textSearch(text, ctx.app, 5).catch(() => []);
  if (hits.length) {
    await ctx.tg('sendMessage', {
      chat_id: chat, parse_mode: 'HTML', link_preview_options: { is_disabled: true },
      text: hits.map((h) => `«${esc(h.x)}»\n<i>— ${esc(h.r)}</i>`).join('\n\n') + `\n\nВсе совпадения — в «Свитке», вкладка «Библия» → поиск.`,
      reply_markup: kbApp(ctx.app),
    });
  } else {
    await ctx.tg('sendMessage', { chat_id: chat, text: HELP.replaceAll('{bot}', ctx.bot), parse_mode: 'HTML', reply_markup: kbApp(ctx.app) });
  }
}
