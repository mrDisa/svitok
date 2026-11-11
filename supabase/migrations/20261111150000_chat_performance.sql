-- Быстрый список чатов: один вызов вместо запроса участников для каждого чата.
create index if not exists chat_messages_preview_idx
  on public.chat_messages (chat_id, created_at desc) include (body, sender, deleted_at);

create or replace function public.list_my_chats()
returns table (
  id uuid, kind text, title text, created_by uuid, updated_at timestamptz,
  last_read_at timestamptz, last_body text, last_at timestamptz, last_sender uuid,
  unread_count bigint, members jsonb
) language sql stable security definer set search_path = public as $$
  select c.id, c.kind, c.title, c.created_by, c.updated_at, mine.last_read_at,
    last.body, last.created_at, last.sender,
    (select count(*) from public.chat_messages u
      where u.chat_id = c.id and u.deleted_at is null and u.sender <> auth.uid()
      and (mine.last_read_at is null or u.created_at > mine.last_read_at)),
    (select jsonb_agg(jsonb_build_object('user_id', cm.user_id, 'role', cm.role,
      'p', jsonb_build_object('id', p.id, 'display_name', p.display_name, 'username', p.username,
      'avatar_color', p.avatar_color, 'avatar_url', p.avatar_url)))
     from public.chat_members cm join public.profiles p on p.id = cm.user_id where cm.chat_id = c.id)
  from public.chat_members mine
  join public.chats c on c.id = mine.chat_id
  left join lateral (
    select body, created_at, sender from public.chat_messages
    where chat_id = c.id and deleted_at is null order by created_at desc limit 1
  ) last on true
  where mine.user_id = auth.uid()
  order by coalesce(last.created_at, c.updated_at) desc;
$$;
revoke all on function public.list_my_chats() from public;
grant execute on function public.list_my_chats() to authenticated;

-- Realtime для новых сообщений в открытом чате.
do $$ begin
  alter publication supabase_realtime add table public.chat_messages;
exception when duplicate_object then null;
end $$;
