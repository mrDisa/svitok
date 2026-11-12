-- Обновление постов, профилей и чатов. Допускает повторный запуск.
-- Выполнить в Supabase SQL Editor после миграций до 20261111160000 включительно.
-- Не удаляет сообщения собеседников или существующие публикации.
begin;


-- ===== 20261112120000_chat_own_message_delete.sql =====
-- Удалить сообщение для всех может только его автор.
-- Администраторы чатов не получают доступ к личной переписке участников.
drop policy if exists messages_delete_for_all on public.chat_messages;
drop policy if exists messages_delete_own on public.chat_messages;

create policy messages_delete_own on public.chat_messages
for update to authenticated
using (sender = auth.uid())
with check (sender = auth.uid() and deleted_at is not null and body = '');


-- ===== 20261112130000_hide_chats.sql =====
-- «Удалить чат» скрывает его только у текущего пользователя, не стирая
-- переписку и не затрагивая остальных участников.
alter table public.chat_members add column if not exists hidden_at timestamptz;
create index if not exists chat_members_visible_idx on public.chat_members(user_id, hidden_at, chat_id);

create or replace function public.hide_chat(cid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.chat_members set hidden_at = now()
  where chat_id = cid and user_id = auth.uid();
  if not found then raise exception 'Чат не найден'; end if;
end;
$$;

create or replace function public.chat_restore_hidden()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.chat_members set hidden_at = null where chat_id = new.chat_id and hidden_at is not null;
  return new;
end;
$$;
drop trigger if exists chat_restore_hidden on public.chat_messages;
create trigger chat_restore_hidden after insert on public.chat_messages for each row execute function public.chat_restore_hidden();

create or replace function public.list_my_chats()
returns table (
  id uuid, kind text, title text, created_by uuid, updated_at timestamptz,
  last_read_at timestamptz, last_body text, last_at timestamptz, last_sender uuid,
  unread_count bigint, members jsonb
) language sql stable security definer set search_path = public as $$
  select c.id, c.kind, c.title, c.created_by, c.updated_at, mine.last_read_at,
    last.body, last.created_at, last.sender,
    (select count(*) from public.chat_messages u where u.chat_id = c.id and u.deleted_at is null and u.sender <> auth.uid() and (mine.last_read_at is null or u.created_at > mine.last_read_at)),
    (select jsonb_agg(jsonb_build_object('user_id', cm.user_id, 'role', cm.role, 'p', jsonb_build_object('id', p.id, 'display_name', p.display_name, 'username', p.username, 'avatar_color', p.avatar_color, 'avatar_url', p.avatar_url))) from public.chat_members cm join public.profiles p on p.id = cm.user_id where cm.chat_id = c.id)
  from public.chat_members mine join public.chats c on c.id = mine.chat_id
  left join lateral (select body, created_at, sender from public.chat_messages where chat_id = c.id and deleted_at is null order by created_at desc limit 1) last on true
  where mine.user_id = auth.uid() and mine.hidden_at is null
  order by coalesce(last.created_at, c.updated_at) desc;
$$;

revoke all on function public.hide_chat(uuid) from public;
grant execute on function public.hide_chat(uuid) to authenticated;


-- ===== 20261112140000_posts.sql =====
-- После social.sql и comments.sql. Публикации видят автор и его друзья.
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  visibility text not null check (visibility in ('friends','private')),
  verse jsonb not null check (jsonb_typeof(verse) = 'object' and verse ?& array['id','b','c','v','r','x']),
  art_id text not null check (char_length(art_id) between 1 and 80),
  created_at timestamptz not null default now()
);
create index if not exists posts_feed on public.posts(created_at desc);
create index if not exists posts_author on public.posts(author,created_at desc);
alter table public.posts enable row level security;
drop policy if exists posts_read on public.posts;
create policy posts_read on public.posts for select to authenticated using
 (author=auth.uid() or (visibility='friends' and public.are_friends(auth.uid(),author)));
drop policy if exists posts_write on public.posts;
create policy posts_write on public.posts for insert to authenticated with check(author=auth.uid());
drop policy if exists posts_delete on public.posts;
create policy posts_delete on public.posts for delete to authenticated using(author=auth.uid());

create table if not exists public.post_comments (
 id uuid primary key default gen_random_uuid(),
 post_id uuid not null references public.posts(id) on delete cascade,
 author uuid not null references public.profiles(id) on delete cascade,
 body text not null check(char_length(btrim(body)) between 1 and 1000),
 created_at timestamptz not null default now()
);
create index if not exists post_comments_post on public.post_comments(post_id,created_at);
alter table public.post_comments enable row level security;
drop policy if exists pc_read on public.post_comments;
create policy pc_read on public.post_comments for select to authenticated using(exists(select 1 from public.posts where id=post_id));
drop policy if exists pc_write on public.post_comments;
create policy pc_write on public.post_comments for insert to authenticated with check(author=auth.uid() and exists(select 1 from public.posts where id=post_id));
drop policy if exists pc_delete on public.post_comments;
create policy pc_delete on public.post_comments for delete to authenticated using(author=auth.uid());

create table if not exists public.post_saves (
 user_id uuid not null references public.profiles(id) on delete cascade,
 post_id uuid not null references public.posts(id) on delete cascade,
 primary key(user_id,post_id)
);
alter table public.post_saves enable row level security;
drop policy if exists ps_read on public.post_saves;
create policy ps_read on public.post_saves for select to authenticated using(user_id=auth.uid());
drop policy if exists ps_write on public.post_saves;
create policy ps_write on public.post_saves for insert to authenticated with check(user_id=auth.uid() and exists(select 1 from public.posts where id=post_id));
drop policy if exists ps_delete on public.post_saves;
create policy ps_delete on public.post_saves for delete to authenticated using(user_id=auth.uid());

create or replace function public.check_post_text() returns trigger language plpgsql set search_path=public as $$
declare recent integer;
begin
 new.created_at:=now();
 new.body:=btrim(new.body);
 if public.has_bad_words(new.body) then raise exception 'bad_words'; end if;
 -- Сериализуем публикации автора: лимит нельзя обойти параллельными запросами.
 perform pg_advisory_xact_lock(hashtextextended(new.author::text,0));
 if TG_TABLE_NAME='posts' then
  select count(*) into recent from public.posts where author=new.author and created_at>now()-interval '1 hour';
 else
  select count(*) into recent from public.post_comments where author=new.author and created_at>now()-interval '1 hour';
 end if;
 if recent>=20 then raise exception 'rate_limit'; end if;
 return new;
end;
$$;
drop trigger if exists post_text on public.posts;
create trigger post_text before insert on public.posts for each row execute function public.check_post_text();
drop trigger if exists post_comment_text on public.post_comments;
create trigger post_comment_text before insert on public.post_comments for each row execute function public.check_post_text();
grant select,insert,delete on public.posts,public.post_comments,public.post_saves to authenticated;


-- ===== 20261112170000_profile_friends.sql =====
-- Список друзей доступен через RPC с проверкой настроек владельца.

alter table public.profiles add column if not exists friends_visible boolean not null default true;
grant update (friends_visible) on public.profiles to authenticated;
create index if not exists friendships_requester_accepted on public.friendships(requester) where status = 'accepted';
create index if not exists friendships_addressee_accepted on public.friendships(addressee) where status = 'accepted';

create or replace function public.profile_friends(p_profile uuid, p_offset integer default 0, p_search text default '', p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare allowed boolean; total bigint; entries jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select (id = auth.uid() or friends_visible) into allowed from profiles where id = p_profile;
  if allowed is distinct from true then
    return jsonb_build_object('visible', false, 'count', null, 'friends', '[]'::jsonb);
  end if;
  select count(*) into total from friendships where status = 'accepted' and p_profile in (requester, addressee);
  select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) into entries from (
    select p.id, p.username, p.display_name, p.avatar_color, p.avatar_url
    from friendships f join profiles p on p.id = case when f.requester = p_profile then f.addressee else f.requester end
    where f.status = 'accepted' and p_profile in (f.requester, f.addressee)
      and (position(lower(left(coalesce(p_search, ''), 100)) in lower(p.display_name || ' ' || p.username)) > 0)
    order by lower(p.display_name), p.id
    limit least(greatest(p_limit, 0), 51) offset greatest(p_offset, 0)
  ) q;
  return jsonb_build_object('visible', true, 'count', total, 'friends', entries);
end;
$$;
revoke all on function public.profile_friends(uuid, integer, text, integer) from public, anon;
grant execute on function public.profile_friends(uuid, integer, text, integer) to authenticated;



-- ===== 20261112180000_clear_chat_history.sql =====
-- Удаление чата очищает историю только для удаляющего пользователя.
-- Переписка собеседника и новые сообщения сохраняются.

alter table public.chat_members add column if not exists cleared_through bigint not null default 0;

-- Учитываем чаты, удалённые до появления границы истории.
update public.chat_members cm set cleared_through = greatest(cm.cleared_through,
  coalesce((select max(m.id) from public.chat_messages m where m.chat_id = cm.chat_id and m.created_at <= cm.hidden_at), 0))
where cm.hidden_at is not null;

create or replace function public.hide_chat(cid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.chat_members cm set hidden_at = now(),
    cleared_through = greatest(cm.cleared_through, coalesce((select max(m.id) from public.chat_messages m where m.chat_id = cid), 0)),
    last_read_at = now()
  where cm.chat_id = cid and cm.user_id = auth.uid();
  if not found then raise exception 'Чат не найден'; end if;
end;
$$;

-- Проверка действует и при прямых запросах, в том числе к исходникам reply.
create or replace function public.can_read_chat_message(cid uuid, mid bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.chat_members cm
    where cm.chat_id = cid and cm.user_id = auth.uid() and mid > cm.cleared_through);
$$;
drop policy if exists messages_read on public.chat_messages;
create policy messages_read on public.chat_messages for select to authenticated
  using (public.can_read_chat_message(chat_id, id));
revoke all on function public.can_read_chat_message(uuid, bigint) from public, anon;
grant execute on function public.can_read_chat_message(uuid, bigint) to authenticated;

create or replace function public.create_direct_chat(other_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare mine uuid := auth.uid(); cid uuid;
begin
  if mine is null then raise exception 'Нужно войти в аккаунт'; end if;
  if mine = other_user or not public.are_friends(mine, other_user) then raise exception 'Писать можно только друзьям'; end if;
  -- Повторные и встречные запросы не создают дубликаты личного диалога.
  perform pg_advisory_xact_lock(hashtextextended(least(mine, other_user)::text || ':' || greatest(mine, other_user)::text, 0));
  select c.id into cid from public.chats c
  where c.kind = 'direct'
    and exists(select 1 from public.chat_members a where a.chat_id = c.id and a.user_id = mine)
    and exists(select 1 from public.chat_members b where b.chat_id = c.id and b.user_id = other_user)
    and 2 = (select count(*) from public.chat_members x where x.chat_id = c.id)
  order by c.created_at, c.id limit 1;
  if cid is not null then
    update public.chat_members set hidden_at = null where chat_id = cid and user_id = mine;
    return cid;
  end if;
  insert into public.chats(kind, created_by) values ('direct', mine) returning id into cid;
  insert into public.chat_members(chat_id, user_id, role) values (cid, mine, 'owner'), (cid, other_user, 'member');
  return cid;
end;
$$;

create or replace function public.list_my_chats()
returns table (
  id uuid, kind text, title text, created_by uuid, updated_at timestamptz,
  last_read_at timestamptz, last_body text, last_at timestamptz, last_sender uuid,
  unread_count bigint, members jsonb
) language sql stable security definer set search_path = public as $$
  select c.id, c.kind, c.title, c.created_by, c.updated_at, mine.last_read_at,
    last.body, last.created_at, last.sender,
    (select count(*) from public.chat_messages u where u.chat_id = c.id and u.id > mine.cleared_through
      and u.deleted_at is null and u.sender <> auth.uid() and (mine.last_read_at is null or u.created_at > mine.last_read_at)),
    (select jsonb_agg(jsonb_build_object('user_id', cm.user_id, 'role', cm.role,
      'p', jsonb_build_object('id', p.id, 'display_name', p.display_name, 'username', p.username, 'avatar_color', p.avatar_color, 'avatar_url', p.avatar_url)))
      from public.chat_members cm join public.profiles p on p.id = cm.user_id where cm.chat_id = c.id)
  from public.chat_members mine join public.chats c on c.id = mine.chat_id
  left join lateral (select body, created_at, sender from public.chat_messages
    where chat_id = c.id and id > mine.cleared_through and deleted_at is null order by created_at desc, id desc limit 1) last on true
  where mine.user_id = auth.uid() and mine.hidden_at is null
  order by coalesce(last.created_at, c.updated_at) desc;
$$;



notify pgrst, 'reload schema';
commit;
