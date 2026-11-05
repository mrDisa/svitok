-- Свиток: ежедневные напоминания «Слово дня».
-- Пуш-уведомления (iPhone с экрана «Домой», Android, компьютер) и сообщения от Telegram-бота.
-- Клиенты не ходят в эти таблицы напрямую — только через функцию notify (service role).

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table if not exists public.push_subs (
  endpoint   text primary key check (char_length(endpoint) < 1000),
  sub        jsonb not null,
  user_id    uuid references auth.users (id) on delete cascade,
  hour       smallint not null default 8 check (hour between 0 and 23),
  tz_offset  smallint not null default 180 check (tz_offset between -720 and 840), -- минуты к востоку от UTC
  last_sent  date,
  created_at timestamptz not null default now()
);

create table if not exists public.tg_daily (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  tg_id      bigint not null,
  hour       smallint not null default 8 check (hour between 0 and 23),
  tz_offset  smallint not null default 180 check (tz_offset between -720 and 840),
  last_sent  date,
  created_at timestamptz not null default now()
);

alter table public.push_subs enable row level security;
alter table public.tg_daily  enable row level security;
-- политик нет намеренно: читать и писать может только серверная функция

-- Расписание (запуск функции notify каждые 15 минут) создаётся отдельно, вне репозитория,
-- потому что содержит секрет: см. README → «Напоминания».
