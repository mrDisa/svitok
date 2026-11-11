-- Карточки местописаний и ответы на конкретные сообщения.
alter table public.chat_messages add column if not exists attachment jsonb;
alter table public.chat_messages add column if not exists reply_to bigint references public.chat_messages(id) on delete set null;
create index if not exists chat_messages_reply_idx on public.chat_messages(reply_to) where reply_to is not null;
