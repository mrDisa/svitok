'use strict';

/* Личные и групповые чаты. Данные живут в Supabase, а доступ к ним
   ограничен RLS-политиками из migrations/20261111130000_chats.sql. */
const Chats = (() => {
  let active = null, chats = [], channel = null, replyTo = null, pendingOwnEvents = 0;
  const memberCache = new Map();
  const el = () => $('#chats');
  const icon = (d) => `<svg viewBox="0 0 24 24">${d}</svg>`;
  const plus = icon('<path d="M12 5v14M5 12h14"/>');
  const send = icon('<path d="M21 3 10 14m11-11-7 18-4-7-7-4z"/>');
  const back = icon('<path d="m15 5-7 7 7 7"/>');
  const fmt = (iso) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const day = (iso) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  const sb = () => Social.sb;
  const me = () => Social.me;
  const canUse = () => Social.enabled && !!sb() && !!me();

  async function load() {
    if (!canUse()) return [];
    const { data, error } = await sb().rpc('list_my_chats');
    if (error) throw error;
    chats = (data || []).map((c) => {
      const ms = c.members || []; memberCache.set(c.id, ms);
      return { ...c, last: c.last_at ? { body:c.last_body, created_at:c.last_at, sender:c.last_sender } : null };
    });
    store.set(`chatPreview:${me().id}`, chats);
    return chats;
  }
  async function members(chatId) {
    if (memberCache.has(chatId)) return memberCache.get(chatId);
    const { data } = await sb().from('chat_members').select('user_id,role,p:profiles!chat_members_user_id_fkey(id,display_name,username,avatar_color,avatar_url)').eq('chat_id', chatId);
    const result = data || []; memberCache.set(chatId, result); return result;
  }
  function title(c, ms) {
    if (c.kind === 'group') return c.title || 'Группа';
    return ms?.find((x) => x.user_id !== me().id)?.p?.display_name || 'Личный чат';
  }
  async function render() {
    if (!canUse()) {
      el().innerHTML = `<div class="page-head"><h1>Чаты</h1></div><div class="p-card"><div class="auth-ico">${I.talk}</div><h2>Общайтесь с друзьями</h2><p>Войдите в профиль, чтобы писать друзьям, создавать группы и получать уведомления о новых сообщениях.</p><button class="btn-auth tg" data-chat-login>Войти в профиль</button></div>`;
      return;
    }
    active = null;
    const cached = store.get(`chatPreview:${me().id}`, []);
    const cachedJSON = JSON.stringify(cached);
    if (cached.length) { chats = cached; chats.forEach((c) => { if (c.members) memberCache.set(c.id, c.members); }); drawList(); }
    else el().innerHTML = `<div class="page-head"><h1>Чаты</h1><p>Загружаем переписки…</p></div><div class="chat-loading"><i></i><i></i><i></i></div>`;
    try { await load(); if (JSON.stringify(chats) !== cachedJSON) await drawList(); } catch (e) { if (!cached.length) el().innerHTML = '<div class="empty">Не удалось загрузить чаты.<br>Проверьте интернет и попробуйте снова.</div>'; }
  }
  async function drawList() {
    const rows = await Promise.all(chats.map(async (c) => ({ c, ms: await members(c.id) })));
    el().innerHTML = `<div class="page-head"><h1>Чаты</h1><p>Только вы и ваши друзья</p></div><button class="chat-new" data-chat-new>${plus}Новый чат</button><div class="group">${rows.length ? rows.map(({c,ms}) => {
      const other = ms.find((x) => x.user_id !== me().id)?.p || me(); const unread = c.last && (!c.last_read_at || new Date(c.last.created_at) > new Date(c.last_read_at)) && c.last.sender !== me().id;
      return `<button class="chat-row" style="--i:${rows.findIndex((x) => x.c.id === c.id)}" data-chat-open="${c.id}">${Social.avatar(c.kind === 'group' ? me() : other, 46)}<span class="grow"><b>${esc(title(c,ms))}</b><small>${c.last ? esc(c.last.body || 'Сообщение удалено') : 'Пока нет сообщений'}</small></span><time>${c.last ? fmt(c.last.created_at) : ''}</time>${unread ? '<i class="unread">•</i>' : ''}</button>`;
    }).join('') : '<div class="hint-card">Здесь появятся ваши переписки. Начните диалог с другом.</div>'}</div>`;
  }
  async function open(id) {
    const c = chats.find((v) => v.id === id); if (!c) return;
    active = c; replyTo = null; el().innerHTML = `<div class="chat-loading"><i></i><i></i><i></i></div>`; const ms = await members(id); const name = title(c, ms);
    const { data } = await sb().from('chat_messages').select('*').eq('chat_id', id).order('created_at', { ascending:false }).limit(50);
    const list = (data || []).reverse();
    el().innerHTML = `<div class="chat-head"><button class="icon-btn" data-chat-back>${back}</button>${Social.avatar(c.kind === 'group' ? me() : ms.find((x) => x.user_id !== me().id)?.p, 40)}<button class="grow chat-title" data-chat-info><b>${esc(name)}</b><small>${c.kind === 'group' ? `${ms.length} участников` : 'в сети недавно'}</small></button></div>${c.kind === 'group' ? `<div class="chat-members">${ms.map((x) => esc(x.p.display_name)).join(', ')}</div>` : ''}<div class="chat-stream">${messagesHTML(list)}</div><form class="chat-compose" id="chat-compose"><div class="reply-bar" hidden></div><input maxlength="2000" autocomplete="off" placeholder="Сообщение" aria-label="Сообщение"><button aria-label="Отправить">${send}</button></form>`;
    await sb().from('chat_members').update({ last_read_at: new Date().toISOString() }).eq('chat_id', id).eq('user_id', me().id);
    const stream = $('.chat-stream', el()); stream.scrollTop = stream.scrollHeight;
    subscribe(id);
  }
  function subscribe(chatId) {
    if (channel?.chatId === chatId) return;
    if (channel) sb().removeChannel(channel);
    channel = sb().channel(`chat:${chatId}`).on('postgres_changes', { event:'INSERT', schema:'public', table:'chat_messages', filter:`chat_id=eq.${chatId}` }, (payload) => {
      const own = String(payload.new.sender) === String(me().id);
      if (own && pendingOwnEvents) { pendingOwnEvents--; return; }
      if (active?.id === chatId && !document.hidden && !own) open(chatId);
    }).subscribe();
    channel.chatId = chatId;
  }
  function messagesHTML(list) {
    let prev = ''; return list.map((m) => { const d = day(m.created_at); const sep = d === prev ? '' : `<div class="chat-day">${d}</div>`; prev = d;
      const mine = m.sender === me().id; const art = m.attachment?.verse_id && typeof artForId === 'function' ? artForId(m.attachment.verse_id) : null; const verse = m.attachment?.type === 'verse' ? `<div class="verse-share chat-verse-card"${art ? ` style="--verse-img:url('${art.src}')"` : ''}><p>${esc(m.attachment.text)}</p><b>${esc(m.attachment.ref)}</b></div>` : ''; const extra = m.attachment?.type === 'verse' && m.body === m.attachment.ref ? '' : m.body; const reply = m.reply_to ? `<div class="reply-quote">↩ Ответ на сообщение</div>` : '';
      return `${sep}<div class="bubble${mine ? ' mine' : ''}${m.attachment?.type === 'verse' ? ' verse-message' : ''}${m.deleted_at ? ' deleted' : ''}" data-message="${m.id}">${m.deleted_at ? 'Сообщение удалено' : `${reply}${verse}${extra ? `<div class="message-extra">${esc(extra)}</div>` : ''}`}${!m.deleted_at ? `<button class="del" data-chat-delete="${m.id}" aria-label="Удалить">×</button>` : ''}<span class="meta">${fmt(m.created_at)}${mine ? '<span class="read-ticks" aria-label="Прочитано"><i></i><i></i></span>' : ''}</span></div>`;
    }).join('');
  }
  async function newChat() {
    if (!canUse()) return;
    const { data: fr } = await sb().from('friendships').select('requester,addressee,rq:profiles!friendships_requester_fkey(*),ad:profiles!friendships_addressee_fkey(*)').eq('status', 'accepted');
    const friends = (fr || []).map((f) => f.requester === me().id ? f.ad : f.rq);
    openSheet(`<h2>Новый чат</h2><p class="sheet-text">Выберите друга или создайте группу. Писать могут только друзья.</p><button class="chat-new" data-chat-group>${plus}Создать группу</button><div class="group">${friends.map((p) => `<button class="row person" data-chat-direct="${p.id}">${Social.avatar(p)}<span class="grow"><b>${esc(p.display_name)}</b><small>@${esc(p.username)}</small></span></button>`).join('') || '<div class="hint-card">Сначала добавьте друзей в профиле.</div>'}</div>`, (sheet) => { sheet.onclick = (e) => { const direct = e.target.closest('[data-chat-direct]'); if (direct) createDirect(direct.dataset.chatDirect); if (e.target.closest('[data-chat-group]')) groupSheet(friends); }; });
  }
  async function createDirect(uid) {
    const { data: id, error } = await sb().rpc('create_direct_chat', { other_user: uid });
    if (error) { console.error('chat create', error); return toast(`Не удалось создать чат: ${error.message || error.code || 'проверьте вход'}`); }
    closeSheet(); await load(); open(id);
  }
  function groupSheet(friends) {
    openSheet(`<h2>Новая группа</h2><form id="group-form" class="auth-form"><label>Название<input name="title" maxlength="80" required placeholder="Например, Домашняя группа"></label><small class="form-hint">Вы уже в группе. Выберите ещё минимум двух друзей.</small><div class="friend-pick">${friends.map((p) => `<label class="member-pick"><input type="checkbox" name="members" value="${p.id}">${Social.avatar(p,42)}<span>${esc(p.display_name)}</span></label>`).join('')}</div><button class="primary as-btn">Создать группу</button></form>`, (sheet) => { $('#group-form',sheet).onsubmit=(e)=>{e.preventDefault();const data=new FormData(e.target);const people=data.getAll('members');if(people.length<2)return toast('Выберите ещё минимум двух друзей');createGroup(data.get('title').trim(),people);}; });
  }
  async function createGroup(name, people) {
    const { data:id,error } = await sb().rpc('create_group_chat', { chat_title:name, invited:people }); if(error) { console.error('group create', error); return toast(`Не удалось создать группу: ${error.message || error.code || 'проверьте вход'}`); } closeSheet(); await load(); open(id);
  }
  async function sendMessage(form) { const input=$('input',form), body=input.value.trim(); if(!body||!active)return; input.value=''; const tempId=`local-${Date.now()}`; const stream=$('.chat-stream',el()); stream?.insertAdjacentHTML('beforeend',`<div class="bubble mine" data-message="${tempId}"><div>${esc(body)}</div><span class="meta">${fmt(new Date().toISOString())}<span class="read-ticks"><i></i><i></i></span></span></div>`); stream?.scrollTo({top:stream.scrollHeight,behavior:'smooth'}); pendingOwnEvents++; const {data,error}=await sb().from('chat_messages').insert({chat_id:active.id,sender:me().id,body,reply_to:replyTo?.id || null}).select().single(); if(error){pendingOwnEvents=Math.max(0,pendingOwnEvents-1);$(`[data-message="${tempId}"]`,el())?.remove();toast('Не удалось отправить');return;} const bubble=$(`[data-message="${tempId}"]`,el());if(bubble)bubble.dataset.message=data.id;replyTo=null;updateReply(); }
  async function sendVerse(it, userIds, note) {
    try { for (const userId of userIds) { const { data:id, error } = await sb().rpc('create_direct_chat', { other_user:userId }); if (error) throw error; const r = await sb().from('chat_messages').insert({ chat_id:id, sender:me().id, body:note || it.r, attachment:{type:'verse',ref:it.r,text:it.x,verse_id:it.id} }); if (r.error) throw r.error; } return null; } catch (error) { console.error('share to chat', error); return error; }
  }
  async function info() { if (!active) return; const ms=await members(active.id); openSheet(`<h2>${esc(title(active,ms))}</h2><p class="sheet-text">${active.kind==='group' ? 'Участники группы' : 'Профиль собеседника'}</p><div class="group">${ms.map((m)=>`<button class="row person" data-chat-person="${m.user_id}">${Social.avatar(m.p,40)}<span class="grow"><b>${esc(m.p.display_name)}</b><small>${m.role==='owner'?'Создатель':m.role==='admin'?'Администратор':'Участник'}</small></span>${I.next}</button>`).join('')}</div>`, (sheet)=>sheet.onclick=(e)=>{const b=e.target.closest('[data-chat-person]');if(b) Social.viewProfile(b.dataset.chatPerson);}); }
  async function remove(id) { openSheet(`<h2>Удалить сообщение?</h2><p class="sheet-text">Оно исчезнет у всех участников чата.</p><div class="sheet-actions"><button class="primary" data-confirm-delete>Удалить у всех</button><button class="wide" data-close-sheet>Отмена</button></div>`, (sheet)=>sheet.onclick=async(e)=>{if(e.target.closest('[data-close-sheet]'))return closeSheet();if(e.target.closest('[data-confirm-delete]')){const {error}=await sb().from('chat_messages').update({deleted_at:new Date().toISOString(),body:''}).eq('id',id);if(error)toast('Не удалось удалить');closeSheet();open(active.id);}}); }
  function init() { el().addEventListener('click',(e)=>{if(e.target.closest('[data-chat-login]'))return openTab('profile');if(e.target.closest('[data-chat-new]'))return newChat();if(e.target.closest('[data-chat-back]')){active=null;return drawList();}if(e.target.closest('[data-chat-info]'))return info();if(e.target.closest('[data-reply-cancel]')){replyTo=null;return updateReply();}const b=e.target.closest('[data-chat-open]');if(b)return open(b.dataset.chatOpen);const d=e.target.closest('[data-chat-delete]');if(d)return remove(d.dataset.chatDelete);}); el().addEventListener('submit',(e)=>{if(e.target.id==='chat-compose'){e.preventDefault();sendMessage(e.target);}}); let start=null; el().addEventListener('touchstart',(e)=>{const b=e.target.closest('.bubble');start=b?{x:e.touches[0].clientX,b}:null;},{passive:true});el().addEventListener('touchend',(e)=>{if(start&&e.changedTouches[0].clientX-start.x>55){replyTo={id:start.b.dataset.message,text:start.b.innerText.slice(0,90)};updateReply();}start=null;}); document.addEventListener('visibilitychange',()=>{if(!document.hidden&&active) open(active.id);}); }
  function updateReply(){const bar=$('.reply-bar',el());if(!bar)return;bar.hidden=!replyTo;bar.innerHTML=replyTo?`<span>↩ ${esc(replyTo.text)}</span><button type="button" data-reply-cancel>×</button>`:'';}
  return { init, render, sendVerse, createDirect };
})();
