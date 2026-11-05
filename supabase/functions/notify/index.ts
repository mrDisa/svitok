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
type Verse = { x: string; r: string; id: string };
let feed: Verse[] | null = null;
async function getFeed() {
  if (!feed) feed = await (await fetch(new URL('data/feed.json', APP_URL))).json();
  return feed!;
}
function localParts(tz: number) {
  const d = new Date(Date.now() + tz * 60_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours() };
}
async function verseFor(tz: number) {
  const f = await getFeed();
  const p = localParts(tz);
  const day = Math.floor(Date.UTC(p.y, p.m, p.d) / 864e5);
  return f[(day * 7919) % f.length];
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
async function sendTelegram(row: { user_id: string; tg_id: number; tz_offset: number }) {
  const v = await verseFor(row.tz_offset);
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: row.tg_id,
      text: `☀️ Слово дня\n\n«${v.x}»\n— ${v.r}`,
      reply_markup: { inline_keyboard: [[{ text: 'Открыть «Свиток»', web_app: { url: APP_URL } }]] },
    }),
  });
  if (r.status === 403) { await admin.from('tg_daily').delete().eq('user_id', row.user_id); return 'blocked'; }
  return r.ok ? 'ok' : 'error';
}

async function run() {
  const stats = { push: 0, tg: 0, skipped: 0, errors: 0 };
  const [{ data: subs }, { data: tgs }] = await Promise.all([
    admin.from('push_subs').select('endpoint, sub, hour, tz_offset, last_sent'),
    admin.from('tg_daily').select('user_id, tg_id, hour, tz_offset, last_sent'),
  ]);
  for (const s of subs ?? []) {
    const key = dateKey(s.tz_offset);
    if (localParts(s.tz_offset).h !== s.hour || s.last_sent === key) { stats.skipped++; continue; }
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
    return json(await run());
  }

  if (action === 'subscribe') {
    const sub = body.sub;
    const ok = sub && typeof sub.endpoint === 'string' && /^https:\/\//.test(sub.endpoint) && sub.keys?.p256dh && sub.keys?.auth;
    if (!ok) return json({ error: 'bad_subscription' }, 400);
    const user = await userFrom(req);
    const { error } = await admin.from('push_subs').upsert({
      endpoint: sub.endpoint, sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
      hour: clampHour(body.hour), tz_offset: clampTz(body.tz), user_id: user?.id ?? null,
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
