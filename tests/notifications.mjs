import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { comeback, reminderDue, reminderMinute } from '../supabase/functions/notify/comeback.ts';

const now = Date.parse('2026-11-18T17:00:00Z'); // 20:00 Москва
const completed = { goal: 10, day: { d: '2026-11-18', n: 10, done: true } };
test('выполненная цель без долга по плану не требует напоминания', () => {
  assert.equal(comeback(completed, 180, now), null);
  assert.equal(comeback({ ...completed, day: { d: '2026-11-18', n: 10 } }, 180, now), null);
});
test('вчерашняя выполненная цель не скрывает сегодняшнее напоминание', () => {
  assert.ok(comeback({ goal: 10, day: { d: '2026-11-17', done: true }, streak: { last: '2026-11-17', count: 3 } }, 180, now));
});
test('даты прогресса без нулей и часовые пояса учитываются', () => {
  assert.equal(comeback({ goal: 10, day: { d: '2026-1-2', done: true } }, 180, Date.parse('2026-01-01T22:00:00Z')), null);
  assert.ok(comeback({ goal: 10, day: { d: '2026-1-2', done: true } }, 180, Date.parse('2026-01-02T22:00:00Z')));
});
test('план требует напоминания даже после выполнения дневной цели', () => {
  assert.equal(comeback({ ...completed, plans: { john21: { started: now, done: [] } } }, 180, now).hash, '#bible');
  assert.equal(comeback({ ...completed, plans: { john21: { started: now, done: [0] } } }, 180, now), null);
});
test('пропущенный день плана и завершённый план различаются', () => {
  assert.ok(comeback({ ...completed, plans: { john21: { started: now - 864e5, done: [1] } } }, 180, now));
  assert.equal(comeback({ ...completed, plans: { john21: { started: now - 40 * 864e5, done: Array.from({ length: 21 }, (_, i) => i) } } }, 180, now), null);
});
test('неизвестные планы и пустой прогресс не создают уведомлений', () => {
  assert.equal(comeback({}, 180, now), null);
  assert.equal(comeback({ ...completed, plans: { unknown: { started: now, done: [] } } }, 180, now), null);
});

function client(options = {}) {
  const data = new Map(); const calls = [];
  const sub = { toJSON: () => ({ endpoint: 'https://push.example/sub', keys: {} }) };
  const reg = { active: options.pendingWorker ? null : {}, pushManager: { getSubscription: async () => sub } };
  const ctx = vm.createContext({
    window: { SVITOK_CONFIG: {}, PushManager: true, Notification: true },
    navigator: { serviceWorker: { getRegistration: async () => { if (options.workerError) throw new Error('worker unavailable'); return reg; }, ready: options.pendingWorker ? new Promise(() => {}) : Promise.resolve(reg) } },
    Notification: { permission: 'granted' }, IS_IOS: false, STANDALONE: true, Tg: { inTg: false },
    Social: { accessToken: async () => 'test-token' },
    store: { get: (k, d) => data.get(k) ?? d, set: (k, v) => data.set(k, v) },
    fetch: async (url, init) => { calls.push(JSON.parse(init.body)); if (options.serverError) throw new Error('offline'); return { ok: true, json: async () => ({ ok: true }) }; },
    toast() {}, AbortController, setTimeout: options.fastTimeout ? (fn => setTimeout(fn, 1)) : setTimeout, clearTimeout,
  });
  vm.runInContext(fs.readFileSync(new URL('../reminders.js', import.meta.url), 'utf8') + '\nthis.reminders = Reminders;', ctx);
  return { data, calls, reminders: ctx.reminders };
}
test('сообщения и возврат включены по умолчанию; переключатели независимы', async () => {
  const c = client();
  await c.reminders.toggle('messages');
  assert.equal(c.calls[0].preferences.messages, false);
  assert.equal(c.calls[0].preferences.comeback, true);
  assert.equal(c.calls[0].preferences.daily, true);
  await c.reminders.toggle('comeback');
  assert.equal(c.calls[1].preferences.comeback, false);
  assert.equal(c.calls[1].preferences.messages, false);
  await c.reminders.init();
  assert.equal(c.calls[2].preferences.messages, false);
  assert.equal(c.calls[2].preferences.comeback, false);
});

// Маршрут отправки проверяется с поддельным JWT-пользователем и хранилищем.
const { stripTypeScriptTypes } = await import('node:module');
const serverSource = stripTypeScriptTypes(fs.readFileSync(new URL('../supabase/functions/notify/index.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, ''));
function server(overrides = {}) {
  let handler;
  const sent = [];
  const message = { id: '1', sender: 'alice', chat_id: 'chat', body: 'Настоящее сообщение', created_at: '2026-11-18T16:00:00Z', ...overrides.message };
  const subscription = { endpoint: 'https://push.example/sub', user_id: 'bob', messages_enabled: true, sub: {}, ...overrides.subscription };
  let queued = true;
  const admin = {
    auth: { getUser: async () => ({ data: { user: { id: overrides.caller || 'alice' } } }) },
    rpc: async () => { const jobs = queued ? [{ message_id: '1', endpoint: subscription.endpoint }] : []; return { data: jobs }; },
    from: table => {
      let op = 'select'; let byDate = false; const filters = [];
      const q = {
        select() { return q; }, eq(key, value) { filters.push([key, value]); return q; }, lt() { byDate = true; return q; },
        delete() { op = 'delete'; return q; },
        maybeSingle: async () => {
          const row = table === 'chat_messages' ? message : table === 'push_subs' ? subscription : table === 'chat_members' ? (overrides.member === null ? null : { chat_id: 'chat', user_id: 'bob', last_read_at: null, ...overrides.member }) : { id: 'alice', display_name: 'Алиса' };
          return { data: row && filters.every(([key, value]) => String(row[key]) === String(value)) ? row : null };
        },
        then(resolve) { if (op === 'delete' && !byDate) queued = false; resolve({ data: null }); },
      };
      return q;
    },
  };
  const ctx = vm.createContext({
    Deno: { env: { get: () => 'https://example.com/' }, serve: fn => { handler = fn; } },
    webpush: { setVapidDetails() {}, sendNotification: async (sub, payload) => sent.push(JSON.parse(payload)) },
    createClient: () => admin, comeback, reminderDue, Response, Date, URL, setTimeout: fn => { fn(); },
  });
  vm.runInContext(serverSource, ctx);
  return {
    sent,
    request: (body = {}, headers = {}) => handler(new Request('https://example.com/notify', { method: 'POST', headers: { authorization: 'Bearer test', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ action: 'chat', messageId: '1', body: 'Подменённый текст', ...body }) })),
  };
}
test('нельзя отправить push от чужого имени', async () => {
  const s = server({ caller: 'mallory' });
  assert.equal((await s.request()).status, 403);
  assert.equal(s.sent.length, 0);
});
test('push использует сохранённый текст и очередь отправляется один раз', async () => {
  const s = server();
  assert.equal((await s.request()).status, 200);
  await s.request();
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].body, 'Настоящее сообщение');
  assert.equal(s.sent[0].tag, 'chat-chat');
});
test('отключённые, прочитанные, удалённые сообщения и вышедшие участники не получают push', async () => {
  for (const overrides of [
    { subscription: { messages_enabled: false } },
    { member: { last_read_at: '2026-11-18T17:00:00Z' } },
    { member: null },
    { message: { deleted_at: '2026-11-18T17:00:00Z' } },
    { subscription: { user_id: 'alice' } },
  ]) {
    const s = server(overrides);
    await s.request();
    assert.equal(s.sent.length, 0);
  }
});

function foreground() {
  let callback, uid = 'bob', notices = [], acknowledges = [];
  const app = { dataset: { tab: 'feed' } };
  const children = () => new Map(['small', 'b', '.message-notice-open', '.message-notice-close', '.message-notice-avatar'].map(key => [key, {}]));
  const doc = {
    hidden: false, documentElement: { classList: { contains: () => true } },
    createElement: () => { const el = { isConnected: true, nodes: children(), setAttribute() {}, remove() { el.isConnected = false; } }; return el; },
    querySelector: () => notices.findLast(el => el.isConnected),
    body: { appendChild: el => notices.push(el) },
  };
  const social = {
    enabled: true, get me() { return uid ? { id: uid } : null; }, avatar: () => '<span>А</span>',
    sb: { removeChannel() {}, channel: () => ({ on(event, filters, fn) { callback = fn; return this; }, subscribe() { return this; } }), from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { id: 'alice', display_name: 'Алиса' } }) }) },
  };
  let enabled = true;
  const ctx = vm.createContext({
    Social: social, Reminders: { messagesOn: () => enabled, acknowledge: async id => acknowledges.push(id) },
    document: doc, I: { talk: '<svg></svg>', next: '', close: '' }, esc: s => String(s),
    $: (selector, parent) => selector === '#app' ? app : parent?.nodes?.get(selector),
    setTimeout: () => 1, clearTimeout() {},
  });
  vm.runInContext(fs.readFileSync(new URL('../chats.js', import.meta.url), 'utf8') + '\nthis.chats = Chats;', ctx);
  ctx.chats.connect();
  return {
    doc, notices, acknowledges,
    setEnabled(value) { enabled = value; }, signOut() { uid = null; ctx.chats.connect(); },
    async receive(message = {}) { callback({ new: { id: '1', sender: 'alice', chat_id: 'chat', body: 'Привет!', ...message } }); for (let i = 0; i < 8; i++) await Promise.resolve(); },
  };
}
test('открытая лента показывает имя и сообщение и подтверждает доставку', async () => {
  const f = foreground();
  await f.receive();
  assert.equal(f.notices.length, 1);
  assert.equal(f.notices[0].nodes.get('small').textContent, 'Привет!');
  assert.equal(f.notices[0].nodes.get('b').textContent, 'Алиса');
  assert.deepEqual(f.acknowledges, ['1']);
  await f.receive();
  assert.equal(f.notices.length, 1);
});
test('стих показывает местописание и комментарий отправителя', async () => {
  const f = foreground();
  await f.receive({ attachment: { type: 'verse', ref: 'Иоанна 3:16' }, body: 'Для тебя' });
  assert.equal(f.notices[0].nodes.get('small').textContent, '📖 Иоанна 3:16 · Для тебя');
});
test('свёрнутое приложение не подтверждает показ: остаётся системный push', async () => {
  const f = foreground(); f.doc.hidden = true;
  await f.receive();
  assert.equal(f.notices.length, 0);
  assert.equal(f.acknowledges.length, 0);
});
test('выключенные уведомления и собственные сообщения не создают баннер', async () => {
  const f = foreground(); f.setEnabled(false);
  await f.receive();
  f.setEnabled(true); await f.receive({ sender: 'bob' });
  assert.equal(f.notices.length, 0);
  assert.equal(f.acknowledges.length, 0);
});
test('выход скрывает баннер и отбрасывает запоздавшие события', async () => {
  const f = foreground(); await f.receive(); f.signOut();
  assert.equal(f.notices[0].isConnected, false);
  await f.receive({ id: '2' });
  assert.equal(f.notices.length, 1);
});

test('подтверждение показа отменяет push только для своей подписки участника', async () => {
  const s = server({ caller: 'bob' });
  assert.equal((await s.request({ action: 'chat-received', endpoint: 'https://push.example/sub' })).status, 200);
  const stranger = server({ caller: 'mallory' });
  assert.equal((await stranger.request({ action: 'chat-received', endpoint: 'https://push.example/sub' })).status, 403);
  const outsider = server({ caller: 'bob', member: null });
  assert.equal((await outsider.request({ action: 'chat-received', endpoint: 'https://push.example/sub' })).status, 403);
});

test('push открывает получившую его установку, сохраняя ссылку на чат', async () => {
  for (const scope of ['https://preview.trycloudflare.com/', 'https://mrdisa.github.io/svitok/']) {
    const handlers = {}; let shown; let done;
    const ctx = vm.createContext({ URL, self: { registration: { scope, showNotification: async (title, data) => { shown = data; } }, addEventListener: (event, fn) => { handlers[event] = fn; } } });
    vm.runInContext(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), ctx);
    handlers.push({ data: { json: () => ({ title: 'Сообщение', url: 'https://mrdisa.github.io/svitok/?pwa=1&chat=123#chats' }) }, waitUntil: p => { done = p; } });
    await done;
    assert.equal(shown.data.url, scope + '?pwa=1&chat=123#chats');
  }
});

test('атрибут фона на html не перехватывает нажатие кнопки разрешения push', async () => {
  const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const source = app.slice(app.indexOf('function initMore()'), app.indexOf('/* ---------- офлайн через Service Worker'));
  let click, activated = 0, openedBackground = 0, rendered = 0;
  const ctx = vm.createContext({
    $: () => ({ addEventListener: (event, fn) => { click = fn; } }),
    Reminders: { activate: async () => { activated++; } },
    renderMore: () => { rendered++; }, openFeedBackground: () => { openedBackground++; },
  });
  vm.runInContext(source + '\ninitMore();', ctx);
  const html = { dataset: { feedBackground: 'art' } };
  const button = {};
  await click({ target: { closest: selector => selector === '[data-feed-background]' ? html : selector === '[data-notify-activate]' ? button : null } });
  assert.equal(activated, 1);
  assert.equal(openedBackground, 0);
  assert.equal(rendered, 1);
});

test('адресный повтор доставки требует секрет планировщика', async () => {
  const s = server();
  assert.equal((await s.request({action:'run',messageId:'1'})).status,403);
  assert.equal((await s.request({action:'run',messageId:'1'},{'x-cron-secret':'https://example.com/'})).status,200);
  assert.equal(s.sent.length,1);
});

test('успех подключения показывается только после сохранения подписки', async () => {
  const c = client();
  assert.equal(await c.reminders.activate(), true);
  assert.equal(c.data.get('remind').delivery, true);
  assert.equal(c.data.get('pushSetup').phase, 'ready');
  assert.equal(c.calls[0].action, 'subscribe');
});
test('ошибка фонового обработчика не выдаёт подключение за успешное', async () => {
  const c = client({workerError: true});
  assert.equal(await c.reminders.activate(), false);
  assert.equal(c.data.get('pushSetup').phase, 'registration');
  assert.equal(c.data.get('pushSetup').failed, true);
  assert.equal(c.data.get('remind')?.delivery, undefined);
  assert.equal(c.calls.length, 0);
});
test('ожидание активации обработчика завершается ошибкой по таймауту', async () => {
  const c = client({pendingWorker: true, fastTimeout: true});
  assert.equal(await c.reminders.activate(), false);
  assert.equal(c.data.get('pushSetup').error, 'WorkerActivationTimeout');
  assert.equal(c.calls.length, 0);
});
test('ошибка сервера сохраняет состояние неподключённого устройства', async () => {
  const c = client({serverError: true});
  assert.equal(await c.reminders.activate(), false);
  assert.equal(c.data.get('pushSetup').phase, 'server');
  assert.equal(c.data.get('pushSetup').failed, true);
  assert.equal(c.data.get('remind')?.delivery, undefined);
});
test('повторные нажатия выполняют только одно подключение', async () => {
  const c = client();
  await Promise.all([c.reminders.activate(), c.reminders.activate()]);
  assert.equal(c.calls.length, 1);
});
test('ошибка кэша шрифта не блокирует установку push-worker', async () => {
  const handlers = {}; let installed = false, completion;
  const cached = [];
  const ctx = vm.createContext({
    self: { addEventListener: (name, fn) => { handlers[name] = fn; }, skipWaiting: async () => { installed = true; } },
    caches: { open: async () => ({ put: async url => cached.push(url) }) },
    AbortController, setTimeout, clearTimeout,
    Request: class { constructor(url) { this.url = url; } },
    fetch: async req => { if (req.url.includes('fonts/')) throw new Error('font offline'); return {ok:true}; },
  });
  vm.runInContext(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), ctx);
  handlers.install({waitUntil: p => { completion = p; }});
  await completion;
  assert.equal(installed,true);
  assert.ok(cached.includes('app.js'));
});

test('напоминание выбирает стабильный дневной слот для устройства и даты', () => {
  const slots = new Set(Array.from({length: 50}, (_, i) => reminderMinute('endpoint-' + i, '2026-11-20')));
  assert.ok(slots.size > 10);
  for (const slot of slots) { assert.ok(slot >= 660 && slot <= 1245); assert.equal(slot % 15, 0); }
  const slot = reminderMinute('device', '2026-11-20');
  const midnight = Date.parse('2026-11-19T21:00:00Z');
  assert.equal(reminderDue('device', '2026-11-20', 180, midnight + (slot - 1) * 60000), false);
  assert.equal(reminderDue('device', '2026-11-20', 180, midnight + slot * 60000), true);
  assert.equal(reminderDue('device', '2026-11-20', 180, midnight + 1260 * 60000), false);
  assert.equal(reminderMinute('device', '2026-11-20'), slot);
});
test('продлённая сегодня серия не вызывает повторного напоминания', () => {
  assert.equal(comeback({streak:{last:'2026-11-18',count:4}}, 180, now), null);
  assert.match(comeback({streak:{last:'2026-11-17',count:4}}, 180, now).body, /серию/);
  assert.equal(comeback({streak:{last:'2026-11-10',count:4}}, 180, now), null);
  assert.match(comeback({streak:{last:'2026-11-17',count:4}, plans:{john21:{started:now,done:[]}}},180,now).title, /План и серия/);
});
