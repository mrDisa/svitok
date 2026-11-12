-- После social.sql и comments.sql. Публикации видят автор и его друзья.
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  visibility text not null check (visibility in ('friends','private')),
  verse jsonb not null check (jsonb_typeof(verse) = 'object' and verse ?& array['id','b','c','v','r','x']),
  art_id text not null check (char_length(art_id) between 1 and 80),
  created_at timestamptz not null default now()
);
create index if not exists posts_feed on public.posts(created_at desc);
create index if not exists posts_author on public.posts(author,created_at desc);
alter table public.posts enable row level security;
drop policy if exists posts_read on public.posts;
create policy posts_read on public.posts for select to authenticated using
 (author=auth.uid() or (visibility='friends' and public.are_friends(auth.uid(),author)));
drop policy if exists posts_write on public.posts;
create policy posts_write on public.posts for insert to authenticated with check(author=auth.uid());
drop policy if exists posts_delete on public.posts;
create policy posts_delete on public.posts for delete to authenticated using(author=auth.uid());

create table if not exists public.post_comments (
 id uuid primary key default gen_random_uuid(),
 post_id uuid not null references public.posts(id) on delete cascade,
 author uuid not null references public.profiles(id) on delete cascade,
 body text not null check(char_length(btrim(body)) between 1 and 1000),
 created_at timestamptz not null default now()
);
create index if not exists post_comments_post on public.post_comments(post_id,created_at);
alter table public.post_comments enable row level security;
drop policy if exists pc_read on public.post_comments;
create policy pc_read on public.post_comments for select to authenticated using(exists(select 1 from public.posts where id=post_id));
drop policy if exists pc_write on public.post_comments;
create policy pc_write on public.post_comments for insert to authenticated with check(author=auth.uid() and exists(select 1 from public.posts where id=post_id));
drop policy if exists pc_delete on public.post_comments;
create policy pc_delete on public.post_comments for delete to authenticated using(author=auth.uid());

create table if not exists public.post_saves (
 user_id uuid not null references public.profiles(id) on delete cascade,
 post_id uuid not null references public.posts(id) on delete cascade,
 primary key(user_id,post_id)
);
alter table public.post_saves enable row level security;
drop policy if exists ps_read on public.post_saves;
create policy ps_read on public.post_saves for select to authenticated using(user_id=auth.uid());
drop policy if exists ps_write on public.post_saves;
create policy ps_write on public.post_saves for insert to authenticated with check(user_id=auth.uid() and exists(select 1 from public.posts where id=post_id));
drop policy if exists ps_delete on public.post_saves;
create policy ps_delete on public.post_saves for delete to authenticated using(user_id=auth.uid());

create or replace function public.check_post_text() returns trigger language plpgsql set search_path=public as $$
declare recent integer;
begin
 new.created_at:=now();
 new.body:=btrim(new.body);
 if public.has_bad_words(new.body) then raise exception 'bad_words'; end if;
 -- Сериализуем публикации автора: лимит нельзя обойти параллельными запросами.
 perform pg_advisory_xact_lock(hashtextextended(new.author::text,0));
 if TG_TABLE_NAME='posts' then
  select count(*) into recent from public.posts where author=new.author and created_at>now()-interval '1 hour';
 else
  select count(*) into recent from public.post_comments where author=new.author and created_at>now()-interval '1 hour';
 end if;
 if recent>=20 then raise exception 'rate_limit'; end if;
 return new;
end;
$$;
drop trigger if exists post_text on public.posts;
create trigger post_text before insert on public.posts for each row execute function public.check_post_text();
drop trigger if exists post_comment_text on public.post_comments;
create trigger post_comment_text before insert on public.post_comments for each row execute function public.check_post_text();
grant select,insert,delete on public.posts,public.post_comments,public.post_saves to authenticated;
