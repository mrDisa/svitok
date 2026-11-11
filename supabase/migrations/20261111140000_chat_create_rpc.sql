-- Создание чата выполняем на стороне БД: это убирает зависимость от порядка
-- RLS-проверок при двух последовательных вставках из браузера.
create or replace function public.create_direct_chat(other_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare mine uuid := auth.uid(); cid uuid;
begin
  if mine is null then raise exception 'Нужно войти в аккаунт'; end if;
  if mine = other_user or not public.are_friends(mine, other_user) then
    raise exception 'Писать можно только друзьям';
  end if;
  select c.id into cid from public.chats c
  where c.kind = 'direct'
    and exists (select 1 from public.chat_members a where a.chat_id = c.id and a.user_id = mine)
    and exists (select 1 from public.chat_members b where b.chat_id = c.id and b.user_id = other_user)
    and 2 = (select count(*) from public.chat_members x where x.chat_id = c.id)
  limit 1;
  if cid is not null then return cid; end if;
  insert into public.chats(kind, created_by) values ('direct', mine) returning id into cid;
  insert into public.chat_members(chat_id, user_id, role)
    values (cid, mine, 'owner'), (cid, other_user, 'member');
  return cid;
end;
$$;

create or replace function public.create_group_chat(chat_title text, invited uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare mine uuid := auth.uid(); cid uuid; uid uuid;
begin
  if mine is null then raise exception 'Нужно войти в аккаунт'; end if;
  if char_length(trim(chat_title)) not between 1 and 80 then raise exception 'Укажите название группы'; end if;
  if coalesce(array_length(invited, 1), 0) < 2 then raise exception 'Выберите ещё минимум двух друзей'; end if;
  foreach uid in array invited loop
    if uid = mine or not public.are_friends(mine, uid) then raise exception 'В группу можно приглашать только друзей'; end if;
  end loop;
  insert into public.chats(kind, title, created_by) values ('group', trim(chat_title), mine) returning id into cid;
  insert into public.chat_members(chat_id, user_id, role) values (cid, mine, 'owner');
  insert into public.chat_members(chat_id, user_id, role)
    select cid, u.user_id, 'member'
    from (select distinct unnest(invited) as user_id) u
    on conflict do nothing;
  return cid;
end;
$$;

revoke all on function public.create_direct_chat(uuid) from public;
revoke all on function public.create_group_chat(text, uuid[]) from public;
grant execute on function public.create_direct_chat(uuid) to authenticated;
grant execute on function public.create_group_chat(text, uuid[]) to authenticated;
