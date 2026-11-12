-- Список друзей доступен через RPC с проверкой настроек владельца.
begin;
alter table public.profiles add column if not exists friends_visible boolean not null default true;
grant update (friends_visible) on public.profiles to authenticated;
create index if not exists friendships_requester_accepted on public.friendships(requester) where status = 'accepted';
create index if not exists friendships_addressee_accepted on public.friendships(addressee) where status = 'accepted';

create or replace function public.profile_friends(p_profile uuid, p_offset integer default 0, p_search text default '', p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare allowed boolean; total bigint; entries jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select (id = auth.uid() or friends_visible) into allowed from profiles where id = p_profile;
  if allowed is distinct from true then
    return jsonb_build_object('visible', false, 'count', null, 'friends', '[]'::jsonb);
  end if;
  select count(*) into total from friendships where status = 'accepted' and p_profile in (requester, addressee);
  select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) into entries from (
    select p.id, p.username, p.display_name, p.avatar_color, p.avatar_url
    from friendships f join profiles p on p.id = case when f.requester = p_profile then f.addressee else f.requester end
    where f.status = 'accepted' and p_profile in (f.requester, f.addressee)
      and (position(lower(left(coalesce(p_search, ''), 100)) in lower(p.display_name || ' ' || p.username)) > 0)
    order by lower(p.display_name), p.id
    limit least(greatest(p_limit, 0), 51) offset greatest(p_offset, 0)
  ) q;
  return jsonb_build_object('visible', true, 'count', total, 'friends', entries);
end;
$$;
revoke all on function public.profile_friends(uuid, integer, text, integer) from public, anon;
grant execute on function public.profile_friends(uuid, integer, text, integer) to authenticated;
notify pgrst, 'reload schema';
commit;
