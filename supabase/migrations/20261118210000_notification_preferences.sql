-- Предпочтения и прогресс привязаны к подписке конкретного устройства.
alter table public.push_subs
  add column if not exists messages_enabled boolean not null default true,
  add column if not exists comeback_enabled boolean not null default true,
  add column if not exists daily_enabled boolean not null default true,
  add column if not exists progress jsonb not null default '{}'::jsonb,
  add column if not exists comeback_sent date;

-- Очередь создаётся сервером в той же транзакции, что и сообщение.
create table public.chat_push_queue (
  message_id bigint not null references public.chat_messages(id) on delete cascade,
  endpoint text not null references public.push_subs(endpoint) on delete cascade,
  created_at timestamptz not null default now(),
  locked_until timestamptz,
  attempts smallint not null default 0,
  primary key (message_id, endpoint)
);
alter table public.chat_push_queue enable row level security;

create or replace function public.enqueue_chat_push()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.chat_push_queue(message_id, endpoint)
  select new.id, s.endpoint from public.chat_members m
  join public.push_subs s on s.user_id = m.user_id and s.messages_enabled
  where m.chat_id = new.chat_id and m.user_id <> new.sender;
  return new;
end;
$$;
revoke all on function public.enqueue_chat_push() from public, anon, authenticated;
create trigger chat_message_push after insert on public.chat_messages
for each row execute function public.enqueue_chat_push();

-- Аренда исключает одновременную отправку из клиента и планировщика.
create or replace function public.claim_chat_push(mid bigint default null)
returns setof public.chat_push_queue language sql security definer set search_path = public as $$
  update public.chat_push_queue q set locked_until = now() + interval '2 minutes', attempts = attempts + 1
  where (q.message_id, q.endpoint) in (
    select x.message_id, x.endpoint from public.chat_push_queue x
    where (mid is null or x.message_id = mid) and x.attempts < 5
      and (x.locked_until is null or x.locked_until < now())
      and x.created_at > now() - interval '1 day'
    order by x.created_at limit 100 for update skip locked
  ) returning q.*;
$$;
revoke all on function public.claim_chat_push(bigint) from public, anon, authenticated;
grant execute on function public.claim_chat_push(bigint) to service_role;
