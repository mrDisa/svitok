-- Свиток: обсуждения под стихами — комментарии и ответы.
-- Запускать один раз в Supabase → SQL Editor (или через Management API), после 20261105120000_social.sql.
--
-- Как устроено:
--   * стих определяется ключом verse_key = «книга.глава.стих», книга с единицы («43.3.16» — Иоанна 3:16);
--   * читают все, в том числе без входа: гости смотрят обсуждение через view verse_comments;
--   * пишут только вошедшие; ответы — один уровень вложенности;
--   * своё можно удалить, на чужое — пожаловаться (три жалобы скрывают комментарий до разбора);
--   * мат и слишком частая отправка отсекаются триггером на сервере, а не в приложении,
--     поэтому обойти их правкой кода на телефоне нельзя.

-- ---------- комментарии ----------
create table if not exists public.comments (
  id         bigint generated always as identity primary key,
  verse_key  text not null check (verse_key ~ '^[0-9]{1,2}\.[0-9]{1,3}\.[0-9]{1,3}$'),
  book       smallint not null check (book between 1 and 66),
  chapter    smallint not null check (chapter between 1 and 200),
  verse      smallint not null check (verse between 1 and 200),
  parent_id  bigint references public.comments (id) on delete cascade,
  author     uuid not null references public.profiles (id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  hidden     boolean not null default false
);
create index if not exists comments_key        on public.comments (verse_key, created_at);
create index if not exists comments_chapter    on public.comments (book, chapter);
create index if not exists comments_parent     on public.comments (parent_id);
create index if not exists comments_author     on public.comments (author, created_at desc);

-- ---------- жалобы на комментарии ----------
create table if not exists public.comment_reports (
  id         bigint generated always as identity primary key,
  comment_id bigint not null references public.comments (id) on delete cascade,
  reporter   uuid not null references public.profiles (id) on delete cascade,
  reason     text check (char_length(reason) <= 300),
  created_at timestamptz not null default now(),
  unique (comment_id, reporter)
);

-- ---------- «вам ответили» (уведомления внутри приложения) ----------
create table if not exists public.comment_notices (
  id         bigint generated always as identity primary key,
  recipient  uuid not null references public.profiles (id) on delete cascade,
  comment_id bigint not null references public.comments (id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index if not exists comment_notices_recipient on public.comment_notices (recipient, created_at desc);

-- ---------- фильтр грубых слов ----------
-- Простая проверка по корням: «Херувим», «Херсонес», «себя», «веб», «мандарин», «бляха»,
-- «сукно», «хулиган» проходят, а мат и грубые оскорбления — нет. «Херня» при этом
-- считается грубым словом — это осознанно. Список намеренно короткий и с «\m» (начало
-- слова), чтобы не цеплять обычные слова.
-- Замаскированное («на##й») и разбитое пробелами («х у й») написание не ловится: гоняться
-- за всеми способами искажения бессмысленно, для таких случаев есть жалобы.
create or replace function public.has_bad_words(t text)
returns boolean language sql immutable as $fn$
  -- склейку шаблона обязательно берём в скобки: у «||» и «~» в Postgres одинаковый
  -- приоритет, и без скобок выражение превращается в склейку текста с true/false
  select regexp_replace(lower(coalesce(t, '')), '[^а-яёa-z0-9]+', ' ', 'g') ~ (
      '\m(?:(?:на|по|о|а|ни|не|за|у|при|про|вы|до|от|под|раз|съ|объ|об|в)?х[уy][йяеёюи]'
      || '|хул[ияеь](?![гн])'
      || '|хер(?:ня|ов|ово|а|у|е|ом|ы|и)?(?=[^а-яё]|$)'
      || '|пизд'
      || '|бля(?![хш])'
      || '|(?:за|на|по|вы|про|отъ|от|при|пере|до|у|недо|не|подъ|объ|съ|взъ|изъ|разъ)?(?:е|ё)б'
      || '|долбо(?:е|ё)б|муд(?:ак|ил)|гандон|гондон|пид(?:ор|ар)|педер|шлюх'
      || '|сук[аи]|сучк|сучон|мандав|дроч|ублюд|курв|шалав'
      -- две закрывающие скобки: своя у перечисления и общая у «\m(?:» в начале шаблона
      || '|(?:huy|hui|pizd|blya|blyad|ebal|eban|nahuy|nahui|pidor|pidar|mudak|gandon|gondon|suka|shluha'
      || '|fuck|shit|bitch|asshole|cunt))'
    );
$fn$;

-- ---------- проверка перед записью ----------
create or replace function public.comment_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p_author uuid;
  p_parent bigint;
  p_key    text;
  recent   int;
begin
  new.body := btrim(new.body);
  new.body := regexp_replace(new.body, '\n{3,}', E'\n\n', 'g');
  -- управляющие символы (кроме перевода строки и табуляции) в базе не нужны
  if new.body ~ E'[\x01-\x08\x0b\x0c\x0e-\x1f]' then raise exception 'bad_text'; end if;
  if char_length(new.body) < 1 then raise exception 'empty'; end if;
  if public.has_bad_words(new.body) then raise exception 'bad_words'; end if;

  select count(*) into recent from comments
   where author = new.author and created_at > now() - interval '1 hour';
  if recent >= 10 then raise exception 'rate_limit'; end if;

  if new.parent_id is not null then
    select author, parent_id, verse_key into p_author, p_parent, p_key from comments where id = new.parent_id;
    if p_author is null then raise exception 'no_parent'; end if;
    if p_key <> new.verse_key then raise exception 'wrong_verse'; end if;
    if p_parent is not null then raise exception 'too_deep'; end if;  -- ответы — один уровень
  end if;
  return new;
end;
$$;
drop trigger if exists comments_before_insert on public.comments;
create trigger comments_before_insert before insert on public.comments
  for each row execute function public.comment_before_insert();

-- ---------- «вам ответили»: строку пишет сервер, не клиент ----------
create or replace function public.comment_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p_author uuid;
begin
  if new.parent_id is not null then
    select author into p_author from comments where id = new.parent_id;
    if p_author is not null and p_author <> new.author then
      insert into comment_notices (recipient, comment_id) values (p_author, new.id);
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists comments_after_insert on public.comments;
create trigger comments_after_insert after insert on public.comments
  for each row execute function public.comment_after_insert();

-- ---------- три жалобы — комментарий скрывается до разбора ----------
create or replace function public.comment_report_added()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from comment_reports where comment_id = new.comment_id) >= 3 then
    update comments set hidden = true where id = new.comment_id;
  end if;
  return new;
end;
$$;
drop trigger if exists comment_reports_after_insert on public.comment_reports;
create trigger comment_reports_after_insert after insert on public.comment_reports
  for each row execute function public.comment_report_added();

-- ---------- чтение обсуждения вместе с именем автора ----------
-- Гости не могут читать таблицу profiles, поэтому отдаём обсуждение через view:
-- видны только имя, ник, цвет и аватарка тех, кто писал комментарии.
create or replace view public.verse_comments with (security_invoker = false) as
  select c.id, c.verse_key, c.book, c.chapter, c.verse, c.parent_id, c.body, c.created_at, c.hidden,
         c.author, p.display_name, p.username, p.avatar_color, p.avatar_url
    from public.comments c
    join public.profiles p on p.id = c.author
   where not c.hidden or c.author = auth.uid();
grant select on public.verse_comments to anon, authenticated;

-- ---------- сколько комментариев у стихов (для отметок в ленте и в главе) ----------
create or replace function public.comment_counts(keys text[])
returns table (verse_key text, n bigint)
language sql stable security definer set search_path = public as $$
  select c.verse_key, count(*) from comments c
   where not c.hidden and c.verse_key = any(keys)
   group by c.verse_key;
$$;
-- числа принимаем как integer, а не smallint: вызывающий присылает обычные числа
-- (PostgREST и psql), а такой вызов к smallint не подбирается — «функция не найдена»
drop function if exists public.chapter_comment_counts(smallint, smallint);
create or replace function public.chapter_comment_counts(p_book integer, p_chapter integer)
returns table (verse smallint, n bigint)
language sql stable security definer set search_path = public as $$
  select c.verse, count(*) from comments c
   where not c.hidden and c.book = p_book and c.chapter = p_chapter
   group by c.verse;
$$;
grant execute on function public.comment_counts(text[]) to anon, authenticated;
grant execute on function public.chapter_comment_counts(integer, integer) to anon, authenticated;

-- ---------- защита данных (RLS) ----------
alter table public.comments         enable row level security;
alter table public.comment_reports  enable row level security;
alter table public.comment_notices  enable row level security;

-- комментарии: читают и пишут вошедшие (своё — видно даже скрытым), гость — только через view
drop policy if exists cm_read on public.comments;
create policy cm_read on public.comments for select to authenticated
  using (not hidden or author = auth.uid());
drop policy if exists cm_insert on public.comments;
create policy cm_insert on public.comments for insert to authenticated
  with check (author = auth.uid() and not hidden);
drop policy if exists cm_delete on public.comments;
create policy cm_delete on public.comments for delete to authenticated
  using (author = auth.uid());
-- правки комментариев нет намеренно: сказанное можно удалить, но не переписать задним числом

-- жалобы: пишет и видит только автор жалобы
drop policy if exists cr_insert on public.comment_reports;
create policy cr_insert on public.comment_reports for insert to authenticated
  with check (reporter = auth.uid());
drop policy if exists cr_read on public.comment_reports;
create policy cr_read on public.comment_reports for select to authenticated
  using (reporter = auth.uid());

-- «вам ответили»: видит и отмечает прочитанным только получатель
drop policy if exists cn_read on public.comment_notices;
create policy cn_read on public.comment_notices for select to authenticated
  using (recipient = auth.uid());
drop policy if exists cn_update on public.comment_notices;
create policy cn_update on public.comment_notices for update to authenticated
  using (recipient = auth.uid()) with check (recipient = auth.uid());

-- ---------- права ----------
-- в comment_notices клиент только читает и ставит отметку; строки пишет триггер
revoke insert, update, delete on public.comment_notices from anon, authenticated;
grant select on public.comment_notices to authenticated;
grant update (read_at) on public.comment_notices to authenticated;

revoke update on public.comments from anon, authenticated;
grant select, insert, delete on public.comments to authenticated;

revoke update, delete on public.comment_reports from anon, authenticated;
grant select, insert on public.comment_reports to authenticated;

-- PostgREST кэширует схему: просим перечитать её сразу, чтобы таблицы и представление
-- стали видны приложению без ожидания.
notify pgrst, 'reload schema';
