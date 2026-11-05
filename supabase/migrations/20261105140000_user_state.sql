-- Свиток: синхронизация прогресса между устройствами.
-- Одна запись на пользователя: избранное, лайки, цель, серия, планы, место чтения (jsonb).

create table if not exists public.user_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- защита от раздувания записи (~0,5 МБ на человека более чем достаточно)
alter table public.user_state drop constraint if exists user_state_size;
alter table public.user_state add constraint user_state_size check (pg_column_size(data) < 524288);

-- время изменения ставит сервер, а не клиент
create or replace function public.touch_user_state()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists user_state_touch on public.user_state;
create trigger user_state_touch before insert or update on public.user_state
  for each row execute function public.touch_user_state();

alter table public.user_state enable row level security;

drop policy if exists us_select on public.user_state;
create policy us_select on public.user_state for select to authenticated
  using (user_id = auth.uid());
drop policy if exists us_insert on public.user_state;
create policy us_insert on public.user_state for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists us_update on public.user_state;
create policy us_update on public.user_state for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
