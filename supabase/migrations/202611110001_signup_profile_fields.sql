-- Save chosen email/Google signup usernames into the public profile record.
-- Country stays in auth.users.raw_user_meta_data and is not publicly exposed.
create unique index if not exists profiles_username_case_insensitive_unique
  on public.profiles (lower(username));

create or replace function public.create_talkanime_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := pg_catalog.lower(pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'username', '')));
begin
  if new.is_anonymous is not true and v_username <> '' and v_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'Choose a username with 3 to 24 letters, numbers, or underscores.' using errcode = '23514';
  end if;

  if v_username = '' then
    v_username := 'fan_' || pg_catalog.substr(pg_catalog.replace(new.id::text, '-', ''), 1, 12);
  end if;

  insert into public.profiles (id, username)
  values (new.id, v_username)
  on conflict (id) do nothing;
  return new;
end;
$$;
