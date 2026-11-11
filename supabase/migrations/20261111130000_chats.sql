-- Чаты: личные только между друзьями, групповые с ролями, сообщения и прочтение.
create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct', 'group')),
  title text check (char_length(title) between 1 and 80),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'group' and title is not null) or (kind = 'direct' and title is null))
);
create table if not exists public.chat_members (
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  primary key (chat_id, user_id)
);
create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  chat_id uuid not null references public.chats(id) on delete cascade,
  sender uuid not null references public.profiles(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 2000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (char_length(body) > 0 or deleted_at is not null)
);
create index if not exists chat_members_user on public.chat_members(user_id, chat_id);
create index if not exists chat_messages_chat on public.chat_messages(chat_id, created_at);

create or replace function public.is_chat_member(cid uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.chat_members where chat_id = cid and user_id = uid);
$$;
create or replace function public.is_chat_admin(cid uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.chat_members where chat_id = cid and user_id = uid and role in ('owner','admin'));
$$;
create or replace function public.chat_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin update public.chats set updated_at = now() where id = new.chat_id; return new; end;
$$;
drop trigger if exists chat_message_touch on public.chat_messages;
create trigger chat_message_touch after insert on public.chat_messages for each row execute function public.chat_touch();

alter table public.chats enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists chats_read on public.chats;
create policy chats_read on public.chats for select to authenticated using (public.is_chat_member(id, auth.uid()));
drop policy if exists chats_create on public.chats;
create policy chats_create on public.chats for insert to authenticated with check (created_by = auth.uid());
drop policy if exists chats_update on public.chats;
create policy chats_update on public.chats for update to authenticated using (public.is_chat_admin(id, auth.uid())) with check (public.is_chat_admin(id, auth.uid()));
drop policy if exists members_read on public.chat_members;
create policy members_read on public.chat_members for select to authenticated using (public.is_chat_member(chat_id, auth.uid()));
-- Создатель добавляет себя первым; в личный чат допускается только подтверждённый друг.
drop policy if exists members_add on public.chat_members;
create policy members_add on public.chat_members for insert to authenticated with check (
  (user_id = auth.uid() and exists(select 1 from public.chats c where c.id = chat_id and c.created_by = auth.uid()))
  or (public.is_chat_admin(chat_id, auth.uid()) and (
    exists(select 1 from public.chats c where c.id = chat_id and c.kind = 'group')
    or public.are_friends(auth.uid(), user_id)
  ))
);
drop policy if exists members_update_read on public.chat_members;
create policy members_update_read on public.chat_members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists members_remove on public.chat_members;
create policy members_remove on public.chat_members for delete to authenticated using (user_id = auth.uid() or public.is_chat_admin(chat_id, auth.uid()));
drop policy if exists messages_read on public.chat_messages;
create policy messages_read on public.chat_messages for select to authenticated using (public.is_chat_member(chat_id, auth.uid()));
drop policy if exists messages_send on public.chat_messages;
create policy messages_send on public.chat_messages for insert to authenticated with check (sender = auth.uid() and public.is_chat_member(chat_id, auth.uid()));
drop policy if exists messages_delete_for_all on public.chat_messages;
create policy messages_delete_for_all on public.chat_messages for update to authenticated using (sender = auth.uid() or public.is_chat_admin(chat_id, auth.uid())) with check (deleted_at is not null);
revoke update on public.chat_messages from authenticated;
grant update (body, deleted_at) on public.chat_messages to authenticated;
