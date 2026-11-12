-- Удаление чата очищает историю только для удаляющего пользователя.
-- Переписка собеседника и новые сообщения сохраняются.
begin;
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
