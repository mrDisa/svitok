// Вход в «Свиток» через Telegram-бота.
//
// Схема (работает и в приложении с экрана «Домой», где всплывающие окна не дружат с iOS):
//  1. Приложение создаёт случайный nonce → action:"start" → получает ссылку t.me/<бот>?start=login_<nonce>
//  2. Человек открывает Telegram и жмёт «Старт». Telegram присылает это сообщение сюда (webhook).
//     Мы записываем, какой Telegram-аккаунт подтвердил этот nonce.
//  3. Приложение опрашивает action:"poll". Как только nonce подтверждён — создаём (или находим)
//     пользователя Supabase и отдаём одноразовый token_hash, который приложение обменивает на сессию.
//
// Секреты (Supabase → Edge Functions → Secrets): TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET.
// Деплой без проверки JWT: Telegram не умеет его присылать.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handleUpdate } from './bot.ts';

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const HOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? '';
const BOT_NAME = Deno.env.get('TELEGRAM_BOT_USERNAME') ?? 'svitok_bible_bot';
const APP_URL = Deno.env.get('APP_URL') ?? 'https://mrdisa.github.io/svitok/';
const TTL_MS = 10 * 60 * 1000;
const NONCE_RE = /^[A-Za-z0-9_-]{32,64}$/;

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

async function tg(method: string, body: Record<string, unknown>) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
async function telegramAvatar(tgId: number, profileId: string, photoUrl?: string | null) {
  // Telegram не передаёт фото в Login/WebApp-данных, поэтому берём последнюю
  // фотографию профиля через Bot API при каждом подтверждённом входе.
  try {
    let image: Blob | null = null;
    // photo_url приходит в подписанных initData Mini App, поэтому его можно доверенно использовать.
    if (photoUrl && /^https:\/\//.test(photoUrl)) {
      const res = await fetch(photoUrl);
      if (res.ok) image = await res.blob();
    }
    if (!image) {
      const photos = await (await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUserProfilePhotos`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: tgId, limit: 1 }),
      })).json();
      const fileId = photos?.result?.photos?.[0]?.at(-1)?.file_id;
      if (!fileId) return;
      const file = await (await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_id: fileId }),
      })).json();
      const path = file?.result?.file_path;
      if (!path) return;
      image = await (await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${path}`)).blob();
    }
    if (!image) return;
    const storagePath = `${profileId}/telegram-${Date.now()}.jpg`;
    const upload = await admin.storage.from('avatars').upload(storagePath, image, { contentType: image.type || 'image/jpeg', upsert: false, cacheControl: '31536000' });
    if (upload.error) return;
    const url = admin.storage.from('avatars').getPublicUrl(storagePath).data.publicUrl;
    await admin.from('profiles').update({ avatar_url: url }).eq('id', profileId);
  } catch (e) { console.error('telegram avatar', e); }
}
// кнопка открывает «Свиток» как мини-апп прямо в Telegram
const openApp = { inline_keyboard: [[{ text: 'Открыть «Свиток»', web_app: { url: APP_URL } }]] };
const fresh = (createdAt: string) => Date.now() - new Date(createdAt).getTime() < TTL_MS;

async function handleTelegram(req: Request) {
  if (!HOOK_SECRET || req.headers.get('x-telegram-bot-api-secret-token') !== HOOK_SECRET) {
    return new Response('forbidden', { status: 403 });
  }
  const update = await req.json().catch(() => ({}));
  const msg = update.message;
  const m = msg?.text && msg.from && !msg.from.is_bot ? String(msg.text).match(/^\/start\s+login_([A-Za-z0-9_-]{32,64})/) : null;
  if (!m) {
    // всё остальное — приветствие, команды, кнопки, поиск стихов, inline-режим
    try { await handleUpdate(update, { tg, admin, bot: BOT_NAME, app: APP_URL }); }
    catch (e) { console.error('bot', e); }
    return new Response('ok');
  }

  const nonce = m[1];
  const name = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ').slice(0, 40);
  const { data } = await admin.from('tg_logins').select('tg_id, used, created_at').eq('nonce', nonce).maybeSingle();
  if (data && !data.used && !data.tg_id && fresh(data.created_at)) {
    await admin.from('tg_logins')
      .update({ tg_id: msg.from.id, tg_username: msg.from.username ?? null, tg_name: name || 'Друг' })
      .eq('nonce', nonce).is('tg_id', null);
    await tg('sendMessage', {
      chat_id: msg.chat.id,
      text: `Готово, ${msg.from.first_name ?? 'друг'}! Вернитесь в «Свиток» — вход выполнится сам.`,
      reply_markup: openApp,
    });
  } else {
    await tg('sendMessage', { chat_id: msg.chat.id, text: 'Ссылка для входа устарела. Нажмите «Войти через Telegram» в приложении ещё раз.' });
  }
  return new Response('ok');
}

/* ---------- общий выпуск входа: пользователь Supabase + одноразовый token_hash ---------- */
async function issueLogin(tg: { id: number; username?: string | null; name: string; photoUrl?: string | null }) {
  const email = `tg${tg.id}@telegram.local`;
  const meta = { name: tg.name, tg_username: tg.username ?? null, tg_id: tg.id };
  const created = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: meta });
  if (created.error && !/already|registered|exists/i.test(created.error.message)) throw new Error(created.error.message);
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (link.error) throw new Error(link.error.message);
  const profileId = (link.data.user as { id?: string } | undefined)?.id;
  if (profileId) await telegramAvatar(tg.id, profileId, tg.photoUrl);
  return link.data.properties.hashed_token;
}

/* ---------- мини-апп: проверка initData (подпись Telegram) ---------- */
async function hmac(key: Uint8Array, data: string) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data)));
}
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
async function verifyInitData(initData: string) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !BOT_TOKEN) return null;
  params.delete('hash');
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = await hmac(new TextEncoder().encode('WebAppData'), BOT_TOKEN);
  if (hex(await hmac(secret, check)) !== hash) return null;
  if (Date.now() / 1000 - Number(params.get('auth_date') || 0) > 86400) return null;
  try { return JSON.parse(params.get('user') || 'null'); } catch { return null; }
}

async function handleClient(req: Request) {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const body = await req.json().catch(() => ({}));
  const { action, nonce } = body;

  if (action === 'webapp') {
    const u = typeof body.initData === 'string' ? await verifyInitData(body.initData) : null;
    if (!u?.id) return json({ error: 'bad_init_data' }, 401);
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ').slice(0, 40) || 'Друг';
    try { return json({ status: 'ok', token_hash: await issueLogin({ id: u.id, username: u.username, name, photoUrl: u.photo_url }) }); }
    catch (e) { return json({ error: (e as Error).message }, 500); }
  }

  if (typeof nonce !== 'string' || !NONCE_RE.test(nonce)) return json({ error: 'bad_nonce' }, 400);

  if (action === 'start') {
    await admin.from('tg_logins').delete().lt('created_at', new Date(Date.now() - 3600_000).toISOString());
    const { error } = await admin.from('tg_logins').insert({ nonce });
    if (error) return json({ error: 'exists' }, 409);
    return json({ link: `https://t.me/${BOT_NAME}?start=login_${nonce}` });
  }

  if (action === 'poll') {
    const { data } = await admin.from('tg_logins').select('*').eq('nonce', nonce).maybeSingle();
    if (!data || data.used || !fresh(data.created_at)) return json({ status: 'expired' });
    if (!data.tg_id) return json({ status: 'pending' });

    // заявку можно использовать ровно один раз
    const { data: claimed } = await admin.from('tg_logins').update({ used: true })
      .eq('nonce', nonce).eq('used', false).select('nonce');
    if (!claimed?.length) return json({ status: 'expired' });

    // технический адрес tg<id>@telegram.local: писем на него не отправляем, он нужен только как логин в Supabase
    try { return json({ status: 'ok', token_hash: await issueLogin({ id: data.tg_id, username: data.tg_username, name: data.tg_name }) }); }
    catch (e) { return json({ error: (e as Error).message }, 500); }
  }

  return json({ error: 'action' }, 400);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.headers.has('x-telegram-bot-api-secret-token')) return handleTelegram(req);
  return handleClient(req);
});
