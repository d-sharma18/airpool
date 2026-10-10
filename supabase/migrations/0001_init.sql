-- Airpool schema. Run this once in Supabase → SQL Editor (or `supabase db push`).

create extension if not exists pgcrypto;

-- ───────────────────────── Profiles ─────────────────────────
-- Fields other pool members may see.
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text,
  email text,
  gender text check (gender in ('M', 'F', 'T')),
  birth_year int,
  aadhaar_verified boolean not null default false,
  aadhaar_signature_ok boolean not null default false,
  face_match_score real,
  verified_at timestamptz,
  avatar_path text,
  upi_id text,
  created_at timestamptz not null default now()
);

-- Fields only the owner may see. Phones are revealed to co-riders via get_pool_contacts().
create table public.profile_private (
  user_id uuid primary key references public.profiles on delete cascade,
  phone text,
  phone_verified boolean not null default false,
  aadhaar_hash text unique,
  aadhaar_last4 text
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'), new.email);
  insert into public.profile_private (user_id) values (new.id);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Editing your phone yourself drops the "matches Aadhaar" badge.
create or replace function public.reset_phone_verified()
returns trigger language plpgsql as $$
begin
  if new.phone is distinct from old.phone and coalesce(auth.role(), '') <> 'service_role' then
    new.phone_verified := false;
  end if;
  return new;
end $$;

create trigger profile_private_phone_changed
  before update on public.profile_private
  for each row execute function public.reset_phone_verified();

-- ───────────────────────── Pools ─────────────────────────
create table public.pools (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles,
  airport_iata text not null,
  zone text not null,
  women_only boolean not null default false,
  max_pax int not null default 4 check (max_pax between 2 and 7),
  status text not null default 'open' check (status in ('open', 'locked', 'completed', 'cancelled')),
  plan jsonb,
  created_at timestamptz not null default now()
);
create index pools_open_idx on public.pools (airport_iata, status);

create table public.pool_members (
  pool_id uuid not null references public.pools on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  flight_iata text,
  arrival_at timestamptz not null,
  dest_label text not null,
  dest_lat double precision not null,
  dest_lng double precision not null,
  dest_zone text not null,
  pax int not null default 1 check (pax between 1 and 4),
  cabin_bags int not null default 1 check (cabin_bags between 0 and 8),
  checked_bags int not null default 0 check (checked_bags between 0 and 8),
  paid boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (pool_id, user_id)
);
create index pool_members_user_idx on public.pool_members (user_id);

create table public.messages (
  id bigint generated always as identity primary key,
  pool_id uuid not null references public.pools on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index messages_pool_idx on public.messages (pool_id, created_at);

-- Server-only cache so we stay inside Aviationstack's 100 req/month free quota.
create table public.flight_cache (
  key text primary key,
  data jsonb not null,
  fetched_at timestamptz not null default now()
);

-- ───────────────────────── Helpers ─────────────────────────
create or replace function public.is_pool_member(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from pool_members where pool_id = p and user_id = auth.uid());
$$;

create or replace function public.shares_pool(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select other = auth.uid() or exists (
    select 1 from pool_members a join pool_members b using (pool_id)
    where a.user_id = auth.uid() and b.user_id = other
  );
$$;

create or replace function public.km_between(lat1 float8, lng1 float8, lat2 float8, lng2 float8)
returns float8 language sql immutable as $$
  select 6371 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

-- ───────────────────────── RLS ─────────────────────────
alter table public.profiles enable row level security;
alter table public.profile_private enable row level security;
alter table public.pools enable row level security;
alter table public.pool_members enable row level security;
alter table public.messages enable row level security;
alter table public.flight_cache enable row level security; -- no policies: service role only

create policy "see self and co-riders" on public.profiles
  for select to authenticated using (public.shares_pool(id));
create policy "edit self" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
-- Verification fields are written only by the server (service role).
revoke update on public.profiles from authenticated, anon;
-- full_name comes from Aadhaar, so users can't edit it.
grant update (upi_id) on public.profiles to authenticated;

create policy "see own private" on public.profile_private
  for select to authenticated using (user_id = auth.uid());
create policy "edit own private" on public.profile_private
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.profile_private from authenticated, anon;
grant update (phone) on public.profile_private to authenticated;

-- Pools and members are only readable by members. Discovery goes through find_pools(),
-- which returns aggregates without anyone's exact address.
create policy "members read pool" on public.pools
  for select to authenticated using (public.is_pool_member(id));
create policy "members read members" on public.pool_members
  for select to authenticated using (public.is_pool_member(pool_id));
create policy "members read chat" on public.messages
  for select to authenticated using (public.is_pool_member(pool_id));
create policy "members write chat" on public.messages
  for insert to authenticated with check (user_id = auth.uid() and public.is_pool_member(pool_id));

-- ───────────────────────── RPCs ─────────────────────────
create or replace function public.assert_can_ride(p_women_only boolean)
returns void language plpgsql stable security definer set search_path = public as $$
declare me profiles;
begin
  select * into me from profiles where id = auth.uid();
  if me is null or not me.aadhaar_verified then
    raise exception 'Verify your Aadhaar before joining a pool';
  end if;
  if p_women_only and me.gender is distinct from 'F' then
    raise exception 'This pool is for verified women only';
  end if;
end $$;

create or replace function public.find_pools(
  p_airport text, p_zones text[], p_arrival timestamptz,
  p_lat float8, p_lng float8, p_pax int, p_flight text, p_max_wait_min int default 60
) returns table (
  pool_id uuid, creator_first_name text, member_count int, pax_used int, max_pax int,
  women_only boolean, earliest timestamptz, latest timestamptz, same_flight boolean, nearest_km float8
) language sql stable security definer set search_path = public as $$
  select p.id,
         split_part(coalesce(c.full_name, 'Rider'), ' ', 1),
         count(m.*)::int,
         sum(m.pax)::int,
         p.max_pax,
         p.women_only,
         min(m.arrival_at),
         max(m.arrival_at),
         coalesce(bool_or(m.flight_iata = upper(p_flight)), false),
         round(min(km_between(p_lat, p_lng, m.dest_lat, m.dest_lng))::numeric, 1)::float8
  from pools p
  join pool_members m on m.pool_id = p.id
  join profiles c on c.id = p.created_by
  where p.status = 'open'
    and p.airport_iata = upper(p_airport)
    and (not p.women_only or (select gender from profiles where id = auth.uid()) = 'F')
    and not exists (select 1 from pool_members x where x.pool_id = p.id and x.user_id = auth.uid())
  group by p.id, c.full_name
  having bool_or(m.dest_zone = any (p_zones))
     and max(m.arrival_at) - make_interval(mins => p_max_wait_min) <= p_arrival
     and min(m.arrival_at) + make_interval(mins => p_max_wait_min) >= p_arrival
     and sum(m.pax) + p_pax <= p.max_pax
  order by 9 desc, 10 asc
  limit 20;
$$;

create or replace function public.create_pool(
  p_airport text, p_zone text, p_flight text, p_arrival timestamptz,
  p_dest_label text, p_lat float8, p_lng float8,
  p_pax int, p_cabin int, p_checked int, p_women_only boolean, p_max_pax int default 4
) returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  perform assert_can_ride(p_women_only);
  insert into pools (created_by, airport_iata, zone, women_only, max_pax)
  values (auth.uid(), upper(p_airport), p_zone, p_women_only, greatest(p_max_pax, p_pax + 1))
  returning id into new_id;
  insert into pool_members (pool_id, user_id, flight_iata, arrival_at, dest_label, dest_lat, dest_lng, dest_zone, pax, cabin_bags, checked_bags)
  values (new_id, auth.uid(), upper(nullif(p_flight, '')), p_arrival, p_dest_label, p_lat, p_lng, p_zone, p_pax, p_cabin, p_checked);
  return new_id;
end $$;

create or replace function public.join_pool(
  p_pool uuid, p_flight text, p_arrival timestamptz,
  p_dest_label text, p_lat float8, p_lng float8, p_zone text,
  p_pax int, p_cabin int, p_checked int
) returns void language plpgsql security definer set search_path = public as $$
declare p pools; used int;
begin
  select * into p from pools where id = p_pool for update;
  if p is null or p.status <> 'open' then raise exception 'Pool is no longer open'; end if;
  perform assert_can_ride(p.women_only);
  select coalesce(sum(pax), 0) into used from pool_members where pool_id = p_pool;
  if used + p_pax > p.max_pax then raise exception 'Not enough seats left'; end if;
  insert into pool_members (pool_id, user_id, flight_iata, arrival_at, dest_label, dest_lat, dest_lng, dest_zone, pax, cabin_bags, checked_bags)
  values (p_pool, auth.uid(), upper(nullif(p_flight, '')), p_arrival, p_dest_label, p_lat, p_lng, p_zone, p_pax, p_cabin, p_checked);
  update pools set plan = null where id = p_pool;
end $$;

create or replace function public.leave_pool(p_pool uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p pools; heir uuid;
begin
  select * into p from pools where id = p_pool for update;
  if p is null then return; end if;
  if p.status in ('completed', 'cancelled') then raise exception 'This ride is already closed'; end if;
  delete from pool_members where pool_id = p_pool and user_id = auth.uid();
  select user_id into heir from pool_members where pool_id = p_pool order by joined_at limit 1;
  if heir is null then
    delete from pools where id = p_pool;
  else
    update pools
       set created_by = case when created_by = auth.uid() then heir else created_by end,
           status = 'open',
           plan = null
     where id = p_pool;
  end if;
end $$;

create or replace function public.set_pool_status(p_pool uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare p pools;
begin
  select * into p from pools where id = p_pool for update;
  if p is null or p.created_by <> auth.uid() then raise exception 'Only the pool host can do that'; end if;
  if p_status = 'locked' and (select count(*) from pool_members where pool_id = p_pool) < 2 then
    raise exception 'Wait for at least one more rider before locking';
  end if;
  if not (p.status, p_status) in (('open', 'locked'), ('locked', 'open'), ('locked', 'completed'), ('open', 'cancelled')) then
    raise exception 'Cannot move a % pool to %', p.status, p_status;
  end if;
  update pools set status = p_status where id = p_pool;
end $$;

create or replace function public.set_max_pax(p_pool uuid, p_max int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from pools where id = p_pool and created_by = auth.uid() and status = 'open') then
    raise exception 'Only the host of an open pool can change seats';
  end if;
  if p_max < (select sum(pax) from pool_members where pool_id = p_pool) then
    raise exception 'More riders than seats';
  end if;
  update pools set max_pax = p_max, plan = null where id = p_pool;
end $$;

create or replace function public.set_member_paid(p_pool uuid, p_user uuid, p_paid boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from pools where id = p_pool and created_by = auth.uid()) then
    raise exception 'Only the host can mark payments';
  end if;
  update pool_members set paid = p_paid where pool_id = p_pool and user_id = p_user;
end $$;

-- Phone numbers unlock only after the host locks the group.
create or replace function public.get_pool_contacts(p_pool uuid)
returns table (user_id uuid, full_name text, phone text, phone_verified boolean)
language sql stable security definer set search_path = public as $$
  select m.user_id, pr.full_name, pp.phone, pp.phone_verified
  from pool_members m
  join pools p on p.id = m.pool_id
  join profiles pr on pr.id = m.user_id
  join profile_private pp on pp.user_id = m.user_id
  where m.pool_id = p_pool
    and p.status in ('locked', 'completed')
    and public.is_pool_member(p_pool);
$$;

revoke execute on function public.assert_can_ride(boolean) from public, anon;
grant execute on function
  public.find_pools(text, text[], timestamptz, float8, float8, int, text, int),
  public.create_pool(text, text, text, timestamptz, text, float8, float8, int, int, int, boolean, int),
  public.join_pool(uuid, text, timestamptz, text, float8, float8, text, int, int, int),
  public.leave_pool(uuid),
  public.set_pool_status(uuid, text),
  public.set_max_pax(uuid, int),
  public.set_member_paid(uuid, uuid, boolean),
  public.get_pool_contacts(uuid)
to authenticated;

-- ───────────────────────── Realtime ─────────────────────────
alter publication supabase_realtime add table public.messages, public.pool_members, public.pools;

-- ───────────────────────── Storage: verified selfies ─────────────────────────
insert into storage.buckets (id, name, public) values ('selfies', 'selfies', false)
on conflict (id) do nothing;

create policy "upload own selfie" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'selfies' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "replace own selfie" on storage.objects
  for update to authenticated
  using (bucket_id = 'selfies' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "co-riders see selfie" on storage.objects
  for select to authenticated
  using (bucket_id = 'selfies' and public.shares_pool(((storage.foldername(name))[1])::uuid));
