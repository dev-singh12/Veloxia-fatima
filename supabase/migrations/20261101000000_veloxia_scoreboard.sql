-- =====================================================================
-- Fatima Veloxia 2K26 scoreboard: Supabase setup (events table, admin login, realtime)
-- Apply with `npx supabase db push`, or paste into Supabase > SQL Editor > Run.
-- Safe to run more than once.
-- =====================================================================

-- 1. Events table ------------------------------------------------------
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) between 1 and 120),
  fatima      numeric(7,1) not null default 0 check (fatima    >= 0),
  carmel      numeric(7,1) not null default 0 check (carmel    >= 0),
  lourdes     numeric(7,1) not null default 0 check (lourdes   >= 0),
  velankani   numeric(7,1) not null default 0 check (velankani >= 0),
  created_at  timestamptz not null default now()
);

-- Event names like "ONE TEAM, ONE DREAM - 4×100 RELAY RACE BOYS (SUB JUNIOR)" need room.
alter table public.events drop constraint if exists events_name_check;
alter table public.events add constraint events_name_check check (char_length(trim(name)) between 1 and 120);

-- 2. Admin list: only these logins can change scores --------------------
create table if not exists public.admins (
  email text primary key check (email = lower(email))
);
alter table public.admins enable row level security;     -- no policies: the website can't read or change this list
revoke all on public.admins from anon, authenticated;

insert into public.admins (email) values ('ptadmin@fatimaschool.in')   -- >>> must match the login you create in Authentication > Users
on conflict do nothing;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admins a
    where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
grant execute on function public.is_admin() to anon, authenticated;

-- 3. Row level security: everyone reads, only admins write --------------
alter table public.events enable row level security;

drop policy if exists "Scores are public to read" on public.events;
drop policy if exists "Admins can add events"     on public.events;
drop policy if exists "Admins can change events"  on public.events;
drop policy if exists "Admins can delete events"  on public.events;

create policy "Scores are public to read" on public.events
  for select using (true);
create policy "Admins can add events" on public.events
  for insert to authenticated with check (public.is_admin());
create policy "Admins can change events" on public.events
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins can delete events" on public.events
  for delete to authenticated using (public.is_admin());

grant select on public.events to anon, authenticated;
revoke insert, update, delete on public.events from anon;
grant insert, update, delete on public.events to authenticated;

-- 4. Live updates on every screen ----------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.events;
exception when duplicate_object then null; end $$;

-- To add another admin later: create the login in Authentication > Users, then run
-- insert into public.admins (email) values ('teacher@example.com');
-- To remove one:
-- delete from public.admins where email = 'teacher@example.com';
