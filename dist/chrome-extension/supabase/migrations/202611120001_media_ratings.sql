-- Ratings for episode and whole-title discussions. Stripe marks active members
-- in the user's Auth app_metadata.plan; the browser cannot set this field.

create table if not exists public.media_ratings (
  user_id uuid not null references auth.users(id) on delete cascade,
  anime_slug text not null check (char_length(trim(anime_slug)) between 1 and 120),
  scope text not null check (scope in ('episode', 'show', 'movie', 'video')),
  season text not null default '',
  episode text not null default '',
  rating smallint not null check (rating between 1 and 10),
  updated_at timestamptz not null default now(),
  primary key (user_id, anime_slug, scope, season, episode),
  check (scope <> 'episode' or char_length(trim(episode)) > 0)
);

create index if not exists media_ratings_subject_idx
  on public.media_ratings (anime_slug, scope, season, episode);

alter table public.media_ratings enable row level security;
revoke all on public.media_ratings from anon, authenticated;
grant select (anime_slug, scope, season, episode, rating) on public.media_ratings to anon, authenticated;
drop policy if exists "Media ratings are public to read" on public.media_ratings;
create policy "Media ratings are public to read" on public.media_ratings
  for select to anon, authenticated using (true);

create or replace function public.rate_fandomroom_media(
  p_anime_slug text,
  p_scope text,
  p_season text,
  p_episode text,
  p_rating integer
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null or (select auth.jwt() ->> 'is_anonymous') = 'true' then
    raise exception 'Sign in with your Fandom Room account to rate.' using errcode = '28000';
  end if;
  if coalesce((select auth.jwt() -> 'app_metadata' ->> 'plan'), '') <> 'premium' then
    raise exception 'Premium is required to rate.' using errcode = '42501';
  end if;
  if p_scope not in ('episode', 'show', 'movie', 'video') or p_rating not between 1 and 10
    or nullif(trim(coalesce(p_anime_slug, '')), '') is null
    or char_length(trim(p_anime_slug)) > 120
    or (p_scope = 'episode' and nullif(trim(coalesce(p_episode, '')), '') is null) then
    raise exception 'Enter a valid title, episode, and rating from 1 to 10.' using errcode = '22023';
  end if;
  insert into public.media_ratings (user_id, anime_slug, scope, season, episode, rating, updated_at)
  values (v_user, trim(p_anime_slug), p_scope, coalesce(trim(p_season), ''), coalesce(trim(p_episode), ''), p_rating, now())
  on conflict (user_id, anime_slug, scope, season, episode)
  do update set rating = excluded.rating, updated_at = now();
end;
$$;
revoke all on function public.rate_fandomroom_media(text, text, text, text, integer) from public, anon;
grant execute on function public.rate_fandomroom_media(text, text, text, text, integer) to authenticated;

create or replace function public.get_my_fandomroom_rating(
  p_anime_slug text,
  p_scope text,
  p_season text,
  p_episode text
) returns smallint
language sql stable security definer set search_path = '' as $$
  select r.rating from public.media_ratings r
  where r.user_id = (select auth.uid())
    and r.anime_slug = p_anime_slug and r.scope = p_scope
    and r.season = coalesce(p_season, '') and r.episode = coalesce(p_episode, '')
  limit 1;
$$;
revoke all on function public.get_my_fandomroom_rating(text, text, text, text) from public, anon;
grant execute on function public.get_my_fandomroom_rating(text, text, text, text) to authenticated;
