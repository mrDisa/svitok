-- Даём открытому приложению подтвердить показ баннера до отправки системного push.
create or replace function public.claim_chat_push(mid bigint default null)
returns setof public.chat_push_queue language sql security definer set search_path = public as $$
  update public.chat_push_queue q set locked_until = now() + interval '2 minutes', attempts = attempts + 1
  where (q.message_id, q.endpoint) in (
    select x.message_id, x.endpoint from public.chat_push_queue x
    where (mid is null or x.message_id = mid) and x.attempts < 5
      and (x.locked_until is null or x.locked_until < now())
      and x.created_at > now() - interval '1 day'
      and x.created_at <= now() - interval '3 seconds'
    order by x.created_at limit 100 for update skip locked
  ) returning q.*;
$$;
revoke all on function public.claim_chat_push(bigint) from public, anon, authenticated;
grant execute on function public.claim_chat_push(bigint) to service_role;

-- Все события доступны только участникам благодаря существующей RLS messages_read.
do $$
begin
  if not exists(select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages') then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;
