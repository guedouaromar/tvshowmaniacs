-- TVShowManiacs — database schema for Supabase (PostgreSQL)
-- Paste this whole file into Supabase → SQL Editor → New query → Run. It is safe to re-run.

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text unique not null check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name  text,
  avatar_url    text,
  is_public     boolean not null default true,
  region        text not null default 'FR',
  lang          text not null default 'en-US',
  dismissed     jsonb not null default '[]',   -- hidden TV suggestions (tmdb ids)
  dismissed_m   jsonb not null default '[]',   -- hidden movie suggestions
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Create a profile automatically when someone signs up (username from the e-mail, made unique)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare base text; candidate text; n int := 0;
begin
  base := lower(regexp_replace(split_part(coalesce(new.email, 'user'), '@', 1), '[^a-z0-9_]', '', 'g'));
  if length(base) < 3 then base := 'user' || base; end if;
  base := left(base, 20);
  candidate := base;
  while exists (select 1 from public.profiles where username = candidate) loop
    n := n + 1; candidate := base || n::text;
  end loop;
  insert into public.profiles (id, username, display_name, avatar_url)
  values (new.id, candidate, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', base), new.raw_user_meta_data->>'avatar_url');
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

-- streaming services the user pays for (provider names as TMDB spells them)
alter table public.profiles add column if not exists subscriptions jsonb not null default '[]';

-- ---------------------------------------------------------------- lists
create table if not exists public.user_shows (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  show_id     integer not null,                 -- TMDB id
  data        jsonb not null,                   -- cached show record (name, poster, episodes, providers…)
  archived    boolean not null default false,
  added_at    timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, show_id)
);
create index if not exists user_shows_show_idx on public.user_shows (show_id);

create table if not exists public.watched_episodes (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  show_id     integer not null,
  season      integer not null,
  episode     integer not null,
  watched_at  timestamptz not null default now(),
  primary key (user_id, show_id, season, episode)
);
create index if not exists watched_episodes_user_time_idx on public.watched_episodes (user_id, watched_at desc);

create table if not exists public.user_movies (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  movie_id    integer not null,
  data        jsonb not null,
  list        text not null check (list in ('want', 'seen')),
  watched_at  timestamptz,
  added_at    timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, movie_id)
);

create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followee_id uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index if not exists follows_followee_idx on public.follows (followee_id);

-- keep updated_at fresh
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'user_shows_touch') then
    create trigger user_shows_touch before update on public.user_shows for each row execute procedure public.touch_updated_at(); end if;
  if not exists (select 1 from pg_trigger where tgname = 'user_movies_touch') then
    create trigger user_movies_touch before update on public.user_movies for each row execute procedure public.touch_updated_at(); end if;
  if not exists (select 1 from pg_trigger where tgname = 'profiles_touch') then
    create trigger profiles_touch before update on public.profiles for each row execute procedure public.touch_updated_at(); end if;
end $$;

-- ---------------------------------------------------------------- row-level security
alter table public.profiles         enable row level security;
alter table public.user_shows       enable row level security;
alter table public.watched_episodes enable row level security;
alter table public.user_movies      enable row level security;
alter table public.follows          enable row level security;

-- helper: can the current user see this person's lists?
create or replace function public.can_view(owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select owner = auth.uid() or exists (select 1 from public.profiles p where p.id = owner and p.is_public);
$$;

drop policy if exists "profiles readable by members" on public.profiles;
create policy "profiles readable by members" on public.profiles for select to authenticated using (true);
drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own" on public.profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists "profiles editable by owner" on public.profiles;
create policy "profiles editable by owner" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "shows read" on public.user_shows;
create policy "shows read"   on public.user_shows for select to authenticated using (public.can_view(user_id));
drop policy if exists "shows write" on public.user_shows;
create policy "shows write"  on public.user_shows for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "watched read" on public.watched_episodes;
create policy "watched read"  on public.watched_episodes for select to authenticated using (public.can_view(user_id));
drop policy if exists "watched write" on public.watched_episodes;
create policy "watched write" on public.watched_episodes for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "movies read" on public.user_movies;
create policy "movies read"   on public.user_movies for select to authenticated using (public.can_view(user_id));
drop policy if exists "movies write" on public.user_movies;
create policy "movies write"  on public.user_movies for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "follows read" on public.follows;
create policy "follows read"  on public.follows for select to authenticated using (follower_id = auth.uid() or followee_id = auth.uid() or public.can_view(follower_id));
drop policy if exists "follows write" on public.follows;
create policy "follows write" on public.follows for all to authenticated using (follower_id = auth.uid()) with check (follower_id = auth.uid());

-- ---------------------------------------------------------------- social queries
-- Shows the people I follow are watching that I don't have. Ranked by number of friends and their progress.
create or replace function public.friends_watching(kind text default 'tv')
returns table (item_id integer, name text, poster text, year text, vote numeric, friend_count integer, friends text[])
language sql stable security invoker set search_path = public as $$
  with mine as (
    select show_id as id from public.user_shows where user_id = auth.uid() and 'tv' = kind
    union all select movie_id from public.user_movies where user_id = auth.uid() and 'movie' = kind
  ), theirs as (
    select us.show_id as id, us.data, p.username
      from public.follows f join public.user_shows us on us.user_id = f.followee_id join public.profiles p on p.id = us.user_id
     where f.follower_id = auth.uid() and not us.archived and 'tv' = kind
    union all
    select um.movie_id, um.data, p.username
      from public.follows f join public.user_movies um on um.user_id = f.followee_id join public.profiles p on p.id = um.user_id
     where f.follower_id = auth.uid() and 'movie' = kind
  )
  select t.id, max(t.data->>'name'), max(t.data->>'poster'), max(t.data->>'year'), max((t.data->>'vote')::numeric),
         count(distinct t.username)::int, array_agg(distinct t.username)
    from theirs t where t.id not in (select id from mine)
   group by t.id order by 6 desc, 5 desc nulls last limit 24;
$$;

-- Recent activity of people I follow (last 60 events)
create or replace function public.friends_activity()
returns table (username text, display_name text, avatar_url text, kind text, item_id integer, name text, poster text, season integer, episode integer, at timestamptz)
language sql stable security invoker set search_path = public as $$
  (select p.username, p.display_name, p.avatar_url, 'episode', w.show_id, us.data->>'name', us.data->>'poster', w.season, w.episode, w.watched_at
     from public.follows f join public.watched_episodes w on w.user_id = f.followee_id
     join public.user_shows us on us.user_id = w.user_id and us.show_id = w.show_id join public.profiles p on p.id = w.user_id
    where f.follower_id = auth.uid())
  union all
  (select p.username, p.display_name, p.avatar_url, 'movie', um.movie_id, um.data->>'name', um.data->>'poster', null, null, um.watched_at
     from public.follows f join public.user_movies um on um.user_id = f.followee_id join public.profiles p on p.id = um.user_id
    where f.follower_id = auth.uid() and um.list = 'seen' and um.watched_at is not null)
  order by 10 desc limit 60;
$$;

-- Public stats for a profile page (episodes, minutes, shows, movies)
create or replace function public.profile_stats(uid uuid)
returns table (episodes bigint, shows bigint, movies bigint, following bigint, followers bigint)
language sql stable security invoker set search_path = public as $$
  select (select count(*) from public.watched_episodes where user_id = uid),
         (select count(*) from public.user_shows where user_id = uid and not archived),
         (select count(*) from public.user_movies where user_id = uid and list = 'seen'),
         (select count(*) from public.follows where follower_id = uid),
         (select count(*) from public.follows where followee_id = uid);
$$;

-- Let a user delete their own account (and, by cascade, everything they stored)
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------- backfill
-- Users who signed up before this schema (and its trigger) existed get a profile now.
insert into public.profiles (id, username, display_name, avatar_url)
select u.id,
       left(lower(regexp_replace(split_part(coalesce(u.email, 'user'), '@', 1), '[^a-z0-9_]', '', 'g')), 20) || '_' || left(replace(u.id::text, '-', ''), 4),
       coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'), u.raw_user_meta_data->>'avatar_url'
  from auth.users u
 where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict do nothing;
