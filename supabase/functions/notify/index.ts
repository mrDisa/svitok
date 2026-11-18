// Ежедневное «Слово дня»: пуш-уведомления и сообщения от Telegram-бота.
//
// Действия (POST JSON { action, ... }):
//   subscribe    { sub, hour, tz }  — подписка на пуши (можно без входа)
//   unsubscribe  { endpoint }
//   test         { endpoint }        — прислать уведомление прямо сейчас
//   tg-subscribe { hour, tz }        — «Слово дня» в Telegram (нужен вход: Authorization: Bearer <токен>)
//   tg-unsubscribe / tg-status
//   run                              — рассылка; вызывается расписанием с заголовком x-cron-secret
//
// Секреты: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, CRON_SECRET, TELEGRAM_BOT_TOKEN, APP_URL.

import { comeback } from './comeback.ts';
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const APP_URL = Deno.env.get('APP_URL') ?? 'https://mrdisa.github.io/svitok/';
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
webpush.setVapidDetails(APP_URL, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/* ---------- стих дня (та же формула, что в приложении) ---------- */
type Verse = { x: string; r: string; id: string; t: string };
type Painting = { id: string; src: string; title: string; artist: string; t: string[] };
let feed: Verse[] | null = null;
let paintings: Painting[] | null = null;
async function getFeed() {
  if (!feed) feed = await (await fetch(new URL('data/feed.json', APP_URL))).json();
  return feed!;
}
// картина дня — как artForId('day-<день>', тема) в приложении
async function artForDay(day: number, topic: string) {
  if (!paintings) paintings = await (await fetch(new URL('data/paintings.json', APP_URL))).json();
  const byTopic = paintings!.filter((p) => p.t.includes(topic));
  const pool = byTopic.length ? byTopic : paintings!;
  let h = 0;
  for (const ch of 'day-' + day) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return pool[h % pool.length];
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function localParts(tz: number) {
  const d = new Date(Date.now() + tz * 60_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours() };
}
const dayFor = (tz: number) => { const p = localParts(tz); return Math.floor(Date.UTC(p.y, p.m, p.d) / 864e5); };
async function verseFor(tz: number) {
  const f = await getFeed();
  return f[(dayFor(tz) * 7919) % f.length];
}
const dateKey = (tz: number) => { const p = localParts(tz); return `${p.y}-${String(p.m + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; };
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

/* ---------- отправка ---------- */
async function sendPush(row: { endpoint: string; sub: webpush.PushSubscription; tz_offset: number }) {
  const v = await verseFor(row.tz_offset);
  const payload = JSON.stringify({ title: 'Слово дня', body: `${clip(v.x, 170)} — ${v.r}`, url: `${APP_URL}?pwa=1`, tag: 'daily' });
  try {
    await webpush.sendNotification(row.sub, payload, { TTL: 6 * 3600, urgency: 'normal' });
    return 'ok';
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410) { await admin.from('push_subs').delete().eq('endpoint', row.endpoint); return 'gone'; }
    return 'error';
  }
}
async function sendChatPush(row: { endpoint: string; sub: webpush.PushSubscription }, sender: string, body: string, chatId: string) {
  const payload = JSON.stringify({ title: sender, body: clip(body, 150), url: `${APP_URL}?pwa=1&chat=${encodeURIComponent(chatId)}#chats`, tag: `chat-${chatId}` });
  try { await webpush.sendNotification(row.sub, payload, { TTL: 24 * 3600, urgency: 'high' }); return 'ok'; }
  catch (e) { const code = (e as { statusCode?: number }).statusCode; if (code === 404 || code === 410) await admin.from('push_subs').delete().eq('endpoint', row.endpoint); return 'error'; }
}
async function sendTelegram(row: { user_id: string; tg_id: number; tz_offset: number }) {
  const v = await verseFor(row.tz_offset);
  const art = await artForDay(dayFor(row.tz_offset), v.t).catch(() => null);
  const reply_markup = { inline_keyboard: [[{ text: 'Открыть «Свиток»', web_app: { url: APP_URL } }], [{ text: '📖 Ещё стих', callback_data: 'topics' }]] };
  const caption = `<b>☀️ Слово дня</b>\n\n«${esc(v.x)}»\n<i>— ${esc(v.r)}</i>` + (art ? `\n\n<i>🖼 ${esc(art.artist)} · «${esc(art.title.replace(/^«|»$/g, ''))}»</i>` : '');
  const call = (method: string, body: Record<string, unknown>) => fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: row.tg_id, parse_mode: 'HTML', reply_markup, ...body }),
  });
  let r = art ? await call('sendPhoto', { photo: new URL(art.src, APP_URL).toString(), caption }) : null;
  if (!r || (!r.ok && r.status !== 403)) r = await call('sendMessage', { text: caption }); // картина не загрузилась — шлём текстом
  if (r.status === 403) { await admin.from('tg_daily').delete().eq('user_id', row.user_id); return 'blocked'; }
  return r.ok ? 'ok' : 'error';
}

async function drainChats(messageId: string | null = null) {
  const { data: jobs, error } = await admin.rpc('claim_chat_push', { mid: messageId });
  if (error) throw error;
  let sent = 0;
  for (const job of jobs || []) {
    const [{ data: message, error: messageError }, { data: sub, error: subError }] = await Promise.all([
      admin.from('chat_messages').select('chat_id,sender,body,attachment,deleted_at,created_at').eq('id', job.message_id).maybeSingle(),
      admin.from('push_subs').select('endpoint,sub,user_id,messages_enabled').eq('endpoint', job.endpoint).maybeSingle(),
    ]);
    if (messageError || subError) continue;
    let discard = !message || message.deleted_at || !sub?.messages_enabled || !sub?.user_id;
    if (!discard) {
      const { data: member, error: memberError } = await admin.from('chat_members').select('last_read_at').eq('chat_id', message!.chat_id).eq('user_id', sub!.user_id).maybeSingle();
      if (memberError) continue;
      discard = !member || (member.last_read_at && member.last_read_at >= message!.created_at) || sub!.user_id === message!.sender;
    }
    if (!discard) {
      const { data: profile } = await admin.from('profiles').select('display_name').eq('id', message!.sender).maybeSingle();
      const result = await sendChatPush(sub!, profile?.display_name || 'Новое сообщение', message!.attachment?.type === 'verse' ? `📖 ${message!.attachment.ref}${message!.body && message!.body !== message!.attachment.ref ? ' · ' + message!.body : ''}` : message!.body, message!.chat_id);
      if (result === 'ok') { sent++; discard = true; }
    }
    if (discard) await admin.from('chat_push_queue').delete().eq('message_id', job.message_id).eq('endpoint', job.endpoint);
  }
  await admin.from('chat_push_queue').delete().lt('created_at', new Date(Date.now() - 864e5).toISOString());
  return sent;
}

async function run() {
  const stats = { push: 0, tg: 0, comeback: 0, chat: await drainChats(), skipped: 0, errors: 0 };
  const [{ data: subs }, { data: tgs }] = await Promise.all([
    admin.from('push_subs').select('endpoint, sub, hour, tz_offset, last_sent, daily_enabled, comeback_enabled, comeback_sent, progress, user_id'),
    admin.from('tg_daily').select('user_id, tg_id, hour, tz_offset, last_sent'),
  ]);
  for (const s of subs ?? []) {
    const key = dateKey(s.tz_offset);
    if (s.comeback_enabled && localParts(s.tz_offset).h === 20 && s.comeback_sent !== key) {
      let progress = s.progress;
      if (s.user_id) {
        const { data, error } = await admin.from('user_state').select('data').eq('user_id', s.user_id).maybeSingle();
        // При недоступном прогрессе не присылаем ошибочное напоминание.
        progress = error ? null : data?.data;
      }
      let reminder: ReturnType<typeof comeback> = null;
      try { reminder = progress && comeback(progress, s.tz_offset); } catch { stats.errors++; }
      if (reminder) {
        // Атомарно резервируем дату до отправки, чтобы пересекающиеся cron не дублировали push.
        const { data: claimed } = await admin.from('push_subs').update({ comeback_sent: key }).eq('endpoint', s.endpoint).or(`comeback_sent.is.null,comeback_sent.lt.${key}`).select('endpoint');
        if (claimed?.length) {
          try {
            await webpush.sendNotification(s.sub, JSON.stringify({ ...reminder, url: `${APP_URL}?pwa=1${reminder.hash}`, tag: 'comeback' }), { TTL: 3 * 3600 });
            stats.comeback++;
          } catch { stats.errors++; }
        }
      }
    }
    if (!s.daily_enabled || localParts(s.tz_offset).h !== s.hour || s.last_sent === key) { stats.skipped++; continue; }
    const res = await sendPush(s);
    if (res === 'ok') { stats.push++; await admin.from('push_subs').update({ last_sent: key }).eq('endpoint', s.endpoint); }
    else if (res === 'error') stats.errors++;
  }
  for (const t of tgs ?? []) {
    const key = dateKey(t.tz_offset);
    if (localParts(t.tz_offset).h !== t.hour || t.last_sent === key) { stats.skipped++; continue; }
    const res = await sendTelegram(t);
    if (res === 'ok') { stats.tg++; await admin.from('tg_daily').update({ last_sent: key }).eq('user_id', t.user_id); }
    else if (res === 'error') stats.errors++;
  }
  return stats;
}

/* ---------- запросы ---------- */
const clampHour = (h: unknown) => Math.min(23, Math.max(0, Math.round(Number(h) || 8)));
const clampTz = (t: unknown) => Math.min(840, Math.max(-720, Math.round(Number(t) || 180)));

async function userFrom(req: Request) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data } = await admin.auth.getUser(token);
  return data.user ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const body = await req.json().catch(() => ({}));
  const action = body.action;

  if (action === 'run') {
    if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) return json({ error: 'forbidden' }, 403);
    // Адресный повтор доставки без запуска остальных рассылок.
    if (body.messageId !== undefined) {
      if (!/^\d+$/.test(String(body.messageId))) return json({ error: 'bad_message' }, 400);
      return json({ chat: await drainChats(String(body.messageId)) });
    }
    return json(await run());
  }

  if (action === 'subscribe') {
    const sub = body.sub;
    const ok = sub && typeof sub.endpoint === 'string' && /^https:\/\//.test(sub.endpoint) && sub.keys?.p256dh && sub.keys?.auth;
    if (!ok) return json({ error: 'bad_subscription' }, 400);
    const user = await userFrom(req);
    if (JSON.stringify(body.progress || {}).length > 32768) return json({ error: 'progress_too_large' }, 400);
    const { error } = await admin.from('push_subs').upsert({
      endpoint: sub.endpoint, sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
      hour: clampHour(body.hour), tz_offset: clampTz(body.tz), user_id: user?.id ?? null,
      messages_enabled: body.preferences?.messages !== false,
      comeback_enabled: body.preferences?.comeback !== false,
      daily_enabled: body.preferences?.daily !== false,
      progress: body.progress && typeof body.progress === 'object' ? body.progress : {},
    });
    return error ? json({ error: error.message }, 500) : json({ ok: true });
  }
  if (action === 'unsubscribe') {
    if (typeof body.endpoint !== 'string') return json({ error: 'bad_endpoint' }, 400);
    await admin.from('push_subs').delete().eq('endpoint', body.endpoint);
    return json({ ok: true });
  }
  if (action === 'test') {
    const { data } = await admin.from('push_subs').select('endpoint, sub, tz_offset').eq('endpoint', body.endpoint).maybeSingle();
    if (!data) return json({ error: 'not_found' }, 404);
    return json({ result: await sendPush(data) });
  }

  // Текст и адресаты берутся из сохранённого сообщения, а не из тела запроса.
  if (action === 'chat') {
    const user = await userFrom(req);
    if (!user || !/^\d+$/.test(String(body.messageId || ''))) return json({ error: 'bad_message' }, 400);
    const { data: message } = await admin.from('chat_messages').select('sender,created_at').eq('id', body.messageId).maybeSingle();
    if (!message || message.sender !== user.id) return json({ error: 'forbidden' }, 403);
    // Realtime-клиент подтверждает показ внутри приложения, пока очередь ожидает push.
    await new Promise(resolve => setTimeout(resolve, 3200));
    return json({ ok: true, sent: await drainChats(String(body.messageId)) });
  }

  if (action === 'chat-received') {
    const user = await userFrom(req);
    if (!user || !/^\d+$/.test(String(body.messageId || '')) || typeof body.endpoint !== 'string') return json({ error: 'bad_receipt' }, 400);
    const [{ data: sub }, { data: message }] = await Promise.all([
      admin.from('push_subs').select('endpoint').eq('endpoint', body.endpoint).eq('user_id', user.id).maybeSingle(),
      admin.from('chat_messages').select('chat_id').eq('id', body.messageId).maybeSingle(),
    ]);
    if (!sub || !message) return json({ error: 'forbidden' }, 403);
    const { data: member } = await admin.from('chat_members').select('user_id').eq('chat_id', message.chat_id).eq('user_id', user.id).maybeSingle();
    if (!member) return json({ error: 'forbidden' }, 403);
    const { error } = await admin.from('chat_push_queue').delete().eq('message_id', body.messageId).eq('endpoint', body.endpoint);
    return error ? json({ error: 'receipt_failed' }, 500) : json({ ok: true });
  }

  // текущее состояние: Telegram — по аккаунту, пуш — по подписке этого устройства
  if (action === 'status') {
    const user = await userFrom(req);
    let push: { hour: number; messages_enabled: boolean; comeback_enabled: boolean; daily_enabled: boolean } | null = null;
    let tg: { hour: number } | null = null;
    if (typeof body.endpoint === 'string' && body.endpoint) {
      const { data } = await admin.from('push_subs').select('hour,messages_enabled,comeback_enabled,daily_enabled').eq('endpoint', body.endpoint).maybeSingle();
      if (data) push = data;
    }
    if (user) {
      const { data } = await admin.from('tg_daily').select('hour').eq('user_id', user.id).maybeSingle();
      if (data) tg = { hour: data.hour };
    }
    return json({ push, tg, telegram: !!user?.user_metadata?.tg_id });
  }

  if (action === 'tg-subscribe' || action === 'tg-unsubscribe' || action === 'tg-status') {
    const user = await userFrom(req);
    if (!user) return json({ error: 'auth' }, 401);
    if (action === 'tg-status') {
      const { data } = await admin.from('tg_daily').select('hour, tz_offset').eq('user_id', user.id).maybeSingle();
      return json({ on: !!data, hour: data?.hour ?? 8, telegram: !!user.user_metadata?.tg_id });
    }
    if (action === 'tg-unsubscribe') {
      await admin.from('tg_daily').delete().eq('user_id', user.id);
      return json({ ok: true });
    }
    const tgId = Number(user.user_metadata?.tg_id);
    if (!tgId) return json({ error: 'no_telegram' }, 400);
    const { error } = await admin.from('tg_daily').upsert({ user_id: user.id, tg_id: tgId, hour: clampHour(body.hour), tz_offset: clampTz(body.tz) });
    return error ? json({ error: error.message }, 500) : json({ ok: true });
  }

  return json({ error: 'action' }, 400);
});
