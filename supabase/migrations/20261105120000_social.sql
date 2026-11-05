-- Свиток: профили, друзья, отправка стихов друзьям.
-- Запускать один раз в Supabase → SQL Editor (или через Management API).

-- ---------- профили ----------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text unique not null check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null check (char_length(display_name) between 1 and 40),
  tg_username  text,
  avatar_color smallint not null default 0,
  created_at   timestamptz not null default now()
);

-- ---------- дружба ----------
create table if not exists public.friendships (
  id         bigint generated always as identity primary key,
  requester  uuid not null references public.profiles (id) on delete cascade,
  addressee  uuid not null references public.profiles (id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  check (requester <> addressee)
);
-- одна связь на пару, в каком бы порядке её ни создали
create unique index if not exists friendships_pair
  on public.friendships (least(requester, addressee), greatest(requester, addressee));

-- ---------- отправленные стихи ----------
create table if not exists public.shares (
  id         bigint generated always as identity primary key,
  sender     uuid not null references public.profiles (id) on delete cascade,
  recipient  uuid not null references public.profiles (id) on delete cascade,
  verse_id   text not null,
  ref        text not null check (char_length(ref) <= 80),
  body       text not null check (char_length(body) <= 2000),
  book       smallint, chapter smallint, v1 smallint, v2 smallint,
  note       text check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index if not exists shares_recipient on public.shares (recipient, created_at desc);

-- ---------- вход через Telegram (одноразовые заявки) ----------
create table if not exists public.tg_logins (
  nonce      text primary key check (char_length(nonce) between 32 and 64),
  tg_id      bigint,
  tg_username text,
  tg_name    text,
  created_at timestamptz not null default now(),
  used       boolean not null default false
);
-- доступ только у серверной функции (service role), клиенты сюда не ходят

-- ---------- вспомогательные функции ----------
create or replace function public.are_friends(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from friendships
    where status = 'accepted'
      and least(requester, addressee) = least(a, b)
      and greatest(requester, addressee) = greatest(a, b)
  );
$$;

-- профиль создаётся автоматически при регистрации
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  base text;
  uname text;
  dname text;
  n int := 0;
begin
  dname := coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(coalesce(new.email, ''), '@', 1), 'Друг');
  if new.raw_user_meta_data ->> 'tg_username' is not null then
    base := lower(regexp_replace(new.raw_user_meta_data ->> 'tg_username', '[^a-zA-Z0-9_]', '', 'g'));
  else
    base := lower(regexp_replace(split_part(coalesce(new.email, ''), '@', 1), '[^a-zA-Z0-9_]', '', 'g'));
  end if;
  if char_length(base) < 3 then base := 'user'; end if;
  base := left(base, 18);
  uname := base;
  while exists (select 1 from profiles where username = uname) loop
    n := n + 1;
    uname := base || (floor(random() * 9000) + 1000)::int;
    exit when n > 20;
  end loop;
  insert into profiles (id, username, display_name, tg_username, avatar_color)
  values (new.id, uname, left(dname, 40), new.raw_user_meta_data ->> 'tg_username', floor(random() * 8)::int);
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- защита данных (RLS) ----------
alter table public.profiles    enable row level security;
alter table public.friendships enable row level security;
alter table public.shares      enable row level security;
alter table public.tg_logins   enable row level security;

-- профили видят все вошедшие (для поиска друзей), меняет только владелец
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (true);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- дружба: видят и меняют только участники
drop policy if exists fr_read on public.friendships;
create policy fr_read on public.friendships for select to authenticated
  using (auth.uid() in (requester, addressee));
drop policy if exists fr_insert on public.friendships;
create policy fr_insert on public.friendships for insert to authenticated
  with check (requester = auth.uid() and status = 'pending');
drop policy if exists fr_accept on public.friendships;
create policy fr_accept on public.friendships for update to authenticated
  using (addressee = auth.uid()) with check (addressee = auth.uid() and status = 'accepted');
drop policy if exists fr_delete on public.friendships;
create policy fr_delete on public.friendships for delete to authenticated
  using (auth.uid() in (requester, addressee));

-- стихи: отправлять можно только друзьям; видят отправитель и получатель
drop policy if exists sh_read on public.shares;
create policy sh_read on public.shares for select to authenticated
  using (auth.uid() in (sender, recipient));
drop policy if exists sh_insert on public.shares;
create policy sh_insert on public.shares for insert to authenticated
  with check (sender = auth.uid() and public.are_friends(sender, recipient) and read_at is null);
drop policy if exists sh_mark_read on public.shares;
create policy sh_mark_read on public.shares for update to authenticated
  using (recipient = auth.uid()) with check (recipient = auth.uid());
drop policy if exists sh_delete on public.shares;
create policy sh_delete on public.shares for delete to authenticated
  using (auth.uid() in (sender, recipient));

-- получатель может менять только отметку «прочитано»
revoke update on public.shares from authenticated;
grant update (read_at) on public.shares to authenticated;
-- в профиле можно менять только имя, ник и цвет
revoke update on public.profiles from authenticated;
grant update (username, display_name, avatar_color) on public.profiles to authenticated;
