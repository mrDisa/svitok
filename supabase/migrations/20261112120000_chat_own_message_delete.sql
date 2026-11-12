-- Удалить сообщение для всех может только его автор.
-- Администраторы чатов не получают доступ к личной переписке участников.
drop policy if exists messages_delete_for_all on public.chat_messages;
drop policy if exists messages_delete_own on public.chat_messages;

create policy messages_delete_own on public.chat_messages
for update to authenticated
using (sender = auth.uid())
with check (sender = auth.uid() and deleted_at is not null and body = '');
