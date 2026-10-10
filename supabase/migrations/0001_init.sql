-- Airpool schema. Run this once in Supabase → SQL Editor (or `supabase db push`).

create extension if not exists pgcrypto;

-- ───────────────────────── Profiles ─────────────────────────
-- One row per auth user. Only the owner can read it (RLS below). Co-riders see a
-- safe subset through get_pool_people() and phones through get_pool_contacts().
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  -- Editable by the user
  full_name text check (char_length(full_name) between 2 and 100),
  phone text check (phone ~ '^[6-9][0-9]{9}$'),
  upi_id text check (upi_id ~ '^[a-zA-Z0-9._-]{2,255}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$'),
  -- Set only by the server after Aadhaar eKYC
  verified boolean not null default false,
  verified_name text,
  verified_gender text check (verified_gender in ('M', 'F', 'T')),
  aadhaar_last4 text check (aadhaar_last4 ~ '^[0-9]{4}$'),
  verified_at timestamptz,
  phone_verified boolean not null default false,
  birth_year int,
  aadhaar_signature_ok boolean not null default false,
  face_match_score real,
  aadhaar_hash text unique,
  avatar_path text,
  -- Safety (server/admin only). A report on a women-only ride removes women-only access.
  women_only_blocked boolean not null default false,
  flagged_at timestamptz,
  blocked boolean not null default false,
  -- Seeded demo accounts (scripts/seed-demo.ts): "verified" without a real Aadhaar file.
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

-- Copies sign-up details (full_name, phone, upi_id from user metadata) into the profile.
-- Values that fail validation are dropped instead of failing the sign-up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  name text := nullif(trim(coalesce(meta->>'full_name', meta->>'name', '')), '');
begin
  insert into public.profiles (id, email, full_name, phone, upi_id)
  values (
    new.id,
    new.email,
    case when char_length(name) between 2 and 100 then name end,
    case when meta->>'phone' ~ '^[6-9][0-9]{9}$' then meta->>'phone' end,
    case when meta->>'upi_id' ~ '^[a-zA-Z0-9._-]{2,255}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$' then meta->>'upi_id' end
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Second lock on top of the column grants: signed-in users can never touch verification
-- fields, and the phone is frozen once it has been matched to Aadhaar.
create or replace function public.guard_profile()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then
    if (new.verified, new.verified_name, new.verified_gender, new.aadhaar_last4, new.verified_at,
        new.phone_verified, new.aadhaar_hash, new.aadhaar_signature_ok, new.face_match_score,
        new.birth_year, new.avatar_path, new.email, new.women_only_blocked, new.flagged_at, new.blocked, new.is_demo)
       is distinct from
       (old.verified, old.verified_name, old.verified_gender, old.aadhaar_last4, old.verified_at,
        old.phone_verified, old.aadhaar_hash, old.aadhaar_signature_ok, old.face_match_score,
        old.birth_year, old.avatar_path, old.email, old.women_only_blocked, old.flagged_at, old.blocked, old.is_demo) then
      raise exception 'Verification fields can only be changed by the server';
    end if;
    if old.verified and new.phone is distinct from old.phone then
      raise exception 'Your phone is locked to your verified Aadhaar';
    end if;
  end if;
  return new;
end $$;

create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.guard_profile();

-- ───────────────────────── Pools ─────────────────────────
create table public.pools (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles,
  airport_iata text not null,
  zone text not null,
  women_only boolean not null default false,
  -- 6 = the largest car we book (MATCH_RULES.MAX_GROUP_SEATS in src/config/matching.ts).
  max_pax int not null default 4 check (max_pax between 2 and 6),
  -- Women-only groups: when to next ask the host to keep waiting / get notified / open up.
  women_wait_until timestamptz,
  -- Where the group meets at arrivals. Any member can set it.
  meeting_point text check (meeting_point in ('arrival_gate', 'pickup_zone', 'parking', 'other')),
  meeting_note text check (char_length(meeting_note) <= 120),
  -- Booking (after lock). booker_id is set when a member volunteers, or by the server when
  -- the booking is saved (default: the rider going farthest).
  booker_id uuid references public.profiles,
  driver_name text check (char_length(driver_name) between 2 and 60),
  car_number text check (car_number ~ '^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$' or car_number ~ '^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$'),
  car_model text check (char_length(car_model) <= 40),
  booked_at timestamptz,
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
  -- Each rider taps Accept. The group locks when everyone has accepted or the car is full.
  accepted boolean not null default false,
  -- The rider says they've paid; the booker confirms by setting paid.
  paid_claimed_at timestamptz,
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

-- Every Aviationstack answer is kept forever (found or not), so a flight+date is never
-- looked up twice. The free plan allows only 100 requests a month. Server-only.
create table public.flights (
  flight_iata text not null,
  flight_date date not null,
  found boolean not null,
  info jsonb,
  fetched_at timestamptz not null default now(),
  primary key (flight_iata, flight_date)
);

-- OSRM routes are cached forever (same stops → same answer). Server-only.
create table public.route_cache (
  key text primary key,
  result jsonb not null,
  created_at timestamptz not null default now()
);

-- One row that hands out OSRM request slots, so all servers together stay at ≤ 1 request/second.
create table public.osrm_throttle (
  id int primary key default 1 check (id = 1),
  next_at timestamptz not null default now()
);
insert into public.osrm_throttle (id) values (1);

-- Books the next free second and returns when this caller may send its request.
create or replace function public.osrm_slot()
returns timestamptz language sql security definer set search_path = public as $$
  update osrm_throttle
     set next_at = greatest(now(), next_at) + interval '1 second'
   where id = 1
  returning next_at - interval '1 second';
$$;

-- Fixed-window rate limits for our endpoints and free API quotas. Server-only.
create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (key, window_start)
);

-- Counts one hit; returns false once `p_limit` hits happened in the current window.
create or replace function public.hit_rate_limit(p_key text, p_limit int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
declare w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
        n int;
begin
  insert into rate_limits (key, window_start, count) values (p_key, w, 1)
  on conflict (key, window_start) do update set count = rate_limits.count + 1
  returning count into n;
  -- Opportunistic cleanup of old windows.
  if random() < 0.01 then delete from rate_limits where window_start < now() - interval '40 days'; end if;
  return n <= p_limit;
end $$;

-- AI answers for identical prompts (same group load, same route…). Server-only.
create table public.ai_cache (
  key text primary key,
  source text not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

-- Live-location links created by the SOS button. Readable only through the server by token.
create table public.sos_shares (
  token text primary key,
  pool_id uuid not null references public.pools on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  lat double precision,
  lng double precision,
  accuracy_m real,
  updated_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '6 hours',
  stopped boolean not null default false
);

-- ───────────────────────── Trip requests ─────────────────────────
-- What a rider asked for. Stays 'searching' until it joins or starts a pool.
create table public.trip_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  flight_iata text not null check (flight_iata ~ '^([A-Z]{2}|[A-Z][0-9]|[0-9][A-Z])[0-9]{1,4}[A-Z]?$'),
  arrival_date date not null,
  arrival_at timestamptz not null,
  arrival_source text not null default 'manual' check (arrival_source in ('aviationstack', 'manual')),
  airport_iata text not null check (airport_iata ~ '^[A-Z]{3}$'),
  dest_label text not null check (char_length(dest_label) between 1 and 300),
  dest_lat double precision not null check (dest_lat between 6 and 37.5),
  dest_lng double precision not null check (dest_lng between 68 and 98),
  -- Named zone id from src/config/matching.ts (e.g. jai-mansarovar), or 'other'.
  zone text not null check (zone ~ '^[a-z0-9-]{1,64}$'),
  pax int not null default 1 check (pax between 1 and 4),
  checked_bags int not null default 0 check (checked_bags between 0 and 8),
  cabin_bags int not null default 0 check (cabin_bags between 0 and 8),
  preferred_car text not null default 'any' check (preferred_car in ('any', 'mini', 'sedan', 'suv')),
  women_only boolean not null default false,
  notify_on_match boolean not null default false,
  status text not null default 'searching' check (status in ('searching', 'matched', 'cancelled', 'completed')),
  pool_id uuid references public.pools on delete set null,
  created_at timestamptz not null default now()
);
create index trip_requests_user_idx on public.trip_requests (user_id, created_at desc);
create index trip_requests_searching_idx on public.trip_requests (airport_iata, arrival_date) where status = 'searching';

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
alter table public.pools enable row level security;
alter table public.pool_members enable row level security;
alter table public.messages enable row level security;
alter table public.flights enable row level security; -- no policies: service role only
alter table public.route_cache enable row level security; -- service role only
alter table public.osrm_throttle enable row level security; -- service role only
alter table public.rate_limits enable row level security; -- service role only
alter table public.ai_cache enable row level security; -- service role only
alter table public.sos_shares enable row level security; -- service role only
alter table public.trip_requests enable row level security;

create policy "read own profile" on public.profiles
  for select to authenticated using (id = auth.uid());
create policy "edit own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
-- Rows are created by the sign-up trigger; users may only edit these three columns.
revoke insert, update, delete on public.profiles from authenticated, anon;
grant update (full_name, phone, upi_id) on public.profiles to authenticated;

-- Riders see and create only their own requests. A women-only request needs a verified
-- woman, and any request needs a verified rider. Riders may only cancel a searching request;
-- matching and completion are done by the pool RPCs.
create policy "read own requests" on public.trip_requests
  for select to authenticated using (user_id = auth.uid());
create policy "create own request" on public.trip_requests
  for insert to authenticated with check (
    user_id = auth.uid()
    and status = 'searching'
    and pool_id is null
    and exists (
      select 1 from public.profiles me
      where me.id = auth.uid() and me.verified and not me.blocked
        and (not women_only or (me.verified_gender = 'F' and not me.women_only_blocked))
    )
  );
create policy "cancel own request" on public.trip_requests
  for update to authenticated
  using (user_id = auth.uid() and status = 'searching')
  with check (user_id = auth.uid() and status in ('searching', 'cancelled'));
revoke update, delete on public.trip_requests from authenticated, anon;
grant update (status) on public.trip_requests to authenticated;

-- Pools and members are only readable by members. Discovery goes through /api/matches,
-- which returns zone names and distances, never anyone's exact address.
create policy "members read pool" on public.pools
  for select to authenticated using (public.is_pool_member(id));
create policy "members read members" on public.pool_members
  for select to authenticated using (public.is_pool_member(pool_id));
-- Groups and members change only through the RPCs below (security definer).
revoke insert, update, delete on public.pools, public.pool_members from authenticated, anon;
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
  if me is null or not me.verified then
    raise exception 'Verify your Aadhaar before joining a pool';
  end if;
  if me.blocked then raise exception 'Your account is blocked. Contact support.'; end if;
  if p_women_only and (me.verified_gender is distinct from 'F' or me.women_only_blocked) then
    raise exception 'This pool is for verified women only';
  end if;
end $$;

-- Locks an open group of 2+ riders once everyone has accepted or the seats are full.
-- Locking reveals full names and phone numbers through get_pool_contacts().
create or replace function public.lock_if_ready(p_pool uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare p pools; n int; used int; waiting int;
begin
  select * into p from pools where id = p_pool for update;
  if p is null or p.status <> 'open' then return false; end if;
  select count(*), coalesce(sum(pax), 0), count(*) filter (where not accepted)
    into n, used, waiting
    from pool_members where pool_id = p_pool;
  if n >= 2 and (waiting = 0 or used >= least(p.max_pax, 6)) then
    update pools set status = 'locked' where id = p_pool;
    return true;
  end if;
  return false;
end $$;

-- A rider accepts the group. Returns true if that locked it.
create or replace function public.accept_pool(p_pool uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare st text;
begin
  if not public.is_pool_member(p_pool) then raise exception 'You''re not in this group'; end if;
  select status into st from pools where id = p_pool;
  if st <> 'open' then raise exception 'This group is already %', st; end if;
  update pool_members set accepted = true where pool_id = p_pool and user_id = auth.uid();
  return lock_if_ready(p_pool);
end $$;

create or replace function public.set_meeting_point(p_pool uuid, p_point text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_pool_member(p_pool) then raise exception 'You''re not in this group'; end if;
  if p_point not in ('arrival_gate', 'pickup_zone', 'parking', 'other') then raise exception 'Unknown meeting point'; end if;
  update pools
     set meeting_point = p_point, meeting_note = nullif(trim(left(coalesce(p_note, ''), 120)), '')
   where id = p_pool and status in ('open', 'locked');
end $$;

create or replace function public.my_searching_request(p_request uuid)
returns trip_requests language plpgsql stable security definer set search_path = public as $$
declare r trip_requests;
begin
  select * into r from trip_requests where id = p_request and user_id = auth.uid();
  if r is null then raise exception 'Trip request not found'; end if;
  if r.status <> 'searching' then raise exception 'This trip request is already %', r.status; end if;
  return r;
end $$;

-- Start a pool from a saved trip request. Seats default to 6 when the rider prefers an SUV.
create or replace function public.create_pool(p_request uuid, p_max_pax int default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare r trip_requests; new_id uuid;
begin
  r := my_searching_request(p_request);
  perform assert_can_ride(r.women_only);
  insert into pools (created_by, airport_iata, zone, women_only, max_pax)
  values (
    auth.uid(), r.airport_iata, r.zone, r.women_only,
    least(6, greatest(coalesce(p_max_pax, case when r.preferred_car = 'suv' then 6 else 4 end), r.pax + 1))
  )
  returning id into new_id;
  insert into pool_members (pool_id, user_id, flight_iata, arrival_at, dest_label, dest_lat, dest_lng, dest_zone, pax, cabin_bags, checked_bags)
  values (new_id, auth.uid(), r.flight_iata, r.arrival_at, r.dest_label, r.dest_lat, r.dest_lng, r.zone, r.pax, r.cabin_bags, r.checked_bags);
  update trip_requests set status = 'matched', pool_id = new_id where id = r.id;
  return new_id;
end $$;

-- Join an open pool with a saved trip request.
create or replace function public.join_pool(p_pool uuid, p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p pools; r trip_requests; used int;
begin
  r := my_searching_request(p_request);
  select * into p from pools where id = p_pool for update;
  if p is null or p.status <> 'open' then raise exception 'Pool is no longer open'; end if;
  if p.airport_iata <> r.airport_iata then raise exception 'That pool is at a different airport'; end if;
  if r.women_only and not p.women_only then raise exception 'You asked for a women-only ride'; end if;
  perform assert_can_ride(p.women_only);
  select coalesce(sum(pax), 0) into used from pool_members where pool_id = p_pool;
  if used + r.pax > least(p.max_pax, 6) then raise exception 'Not enough seats left'; end if;
  -- Same limits as src/lib/matching.ts: everyone lands within 45 min, drops within 7 km.
  if exists (
    select 1 from pool_members m
    where m.pool_id = p_pool
      and (abs(extract(epoch from m.arrival_at - r.arrival_at)) > 45 * 60
           or km_between(r.dest_lat, r.dest_lng, m.dest_lat, m.dest_lng) > 7)
  ) then
    raise exception 'This group isn''t a match for your trip';
  end if;
  insert into pool_members (pool_id, user_id, flight_iata, arrival_at, dest_label, dest_lat, dest_lng, dest_zone, pax, cabin_bags, checked_bags)
  values (p_pool, auth.uid(), r.flight_iata, r.arrival_at, r.dest_label, r.dest_lat, r.dest_lng, r.zone, r.pax, r.cabin_bags, r.checked_bags);
  -- The group changed (route, fare, car), so everyone confirms again.
  update pool_members set accepted = false where pool_id = p_pool and user_id <> auth.uid();
  update pools set plan = null where id = p_pool;
  update trip_requests set status = 'matched', pool_id = p_pool where id = r.id;
  perform lock_if_ready(p_pool);
end $$;

create or replace function public.leave_pool(p_pool uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p pools; heir uuid;
begin
  select * into p from pools where id = p_pool for update;
  if p is null then return; end if;
  if p.status in ('completed', 'cancelled') then raise exception 'This ride is already closed'; end if;
  delete from pool_members where pool_id = p_pool and user_id = auth.uid();
  update trip_requests set status = 'searching', pool_id = null where pool_id = p_pool and user_id = auth.uid();
  select user_id into heir from pool_members where pool_id = p_pool order by joined_at limit 1;
  if heir is null then
    delete from pools where id = p_pool;
  else
    update pools
       set created_by = case when created_by = auth.uid() then heir else created_by end,
           status = 'open',
           plan = null
     where id = p_pool;
    update pool_members set accepted = false, paid = false, paid_claimed_at = null where pool_id = p_pool;
    update pools
       set booker_id = null, driver_name = null, car_number = null, car_model = null, booked_at = null
     where id = p_pool;
  end if;
end $$;

create or replace function public.set_pool_status(p_pool uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare p pools;
begin
  select * into p from pools where id = p_pool for update;
  if p is null or p.created_by <> auth.uid() then raise exception 'Only the pool host can do that'; end if;
  -- Locking happens automatically (lock_if_ready); the host can only finish or cancel.
  if not (p.status, p_status) in (('locked', 'completed'), ('open', 'cancelled')) then
    raise exception 'Cannot move a % pool to %', p.status, p_status;
  end if;
  update pools set status = p_status where id = p_pool;
  if p_status = 'completed' then
    update trip_requests set status = 'completed' where pool_id = p_pool;
  elsif p_status = 'cancelled' then
    update trip_requests set status = 'searching', pool_id = null where pool_id = p_pool;
  end if;
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

-- The booker confirms a rider's payment arrived (or undoes it).
create or replace function public.set_member_paid(p_pool uuid, p_user uuid, p_paid boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from pools where id = p_pool and booker_id = auth.uid() and booked_at is not null) then
    raise exception 'Only the booker can confirm payments';
  end if;
  if p_user = auth.uid() then raise exception 'The booker paid the cab directly'; end if;
  update pool_members set paid = p_paid where pool_id = p_pool and user_id = p_user;
end $$;

-- A rider says "I've paid" after paying by UPI. Shows as pending until the booker confirms.
create or replace function public.claim_paid(p_pool uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from pools where id = p_pool and booked_at is not null and public.is_pool_member(p_pool)) then
    raise exception 'Payments open once the booker has entered the fare';
  end if;
  if exists (select 1 from pools where id = p_pool and booker_id = auth.uid()) then
    raise exception 'You''re the booker, so you don''t owe anyone';
  end if;
  update pool_members set paid_claimed_at = coalesce(paid_claimed_at, now())
   where pool_id = p_pool and user_id = auth.uid();
end $$;

-- Volunteer to book and pay for the cab. First volunteer wins; possible until the booking is saved.
create or replace function public.volunteer_booker(p_pool uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p pools;
begin
  select * into p from pools where id = p_pool for update;
  if p is null or not public.is_pool_member(p_pool) then raise exception 'You''re not in this group'; end if;
  if p.status <> 'locked' then raise exception 'Choose a booker once the group is locked'; end if;
  if p.booked_at is not null then raise exception 'The cab is already booked'; end if;
  if p.booker_id is not null and p.booker_id <> auth.uid() then raise exception 'Someone already volunteered to book'; end if;
  update pools set booker_id = auth.uid() where id = p_pool;
end $$;

-- Step back as volunteer (before booking). The farthest rider becomes the default again.
create or replace function public.withdraw_booker(p_pool uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update pools set booker_id = null
   where id = p_pool and booker_id = auth.uid() and booked_at is null;
end $$;

-- After 15 minutes alone in a women-only group, the host picks:
--   'wait'   → ask again in 15 minutes
--   'notify' → stop asking; tell her when a woman joins
--   'open'   → open the group to everyone (only while she's the sole member)
create or replace function public.women_pool_choice(p_pool uuid, p_choice text)
returns void language plpgsql security definer set search_path = public as $$
declare p pools;
begin
  select * into p from pools where id = p_pool for update;
  if p is null or p.created_by <> auth.uid() then raise exception 'Only the group host can choose'; end if;
  if not p.women_only then raise exception 'This group is already open to everyone'; end if;
  if p_choice = 'wait' then
    update pools set women_wait_until = now() + interval '15 minutes' where id = p_pool;
  elsif p_choice = 'notify' then
    update pools set women_wait_until = 'infinity' where id = p_pool;
    update trip_requests set notify_on_match = true where pool_id = p_pool and user_id = auth.uid();
  elsif p_choice = 'open' then
    if (select count(*) from pool_members where pool_id = p_pool) > 1 then
      raise exception 'Other women have joined, so this group stays women-only';
    end if;
    update pools set women_only = false, women_wait_until = null where id = p_pool;
    update trip_requests set women_only = false where pool_id = p_pool and user_id = auth.uid();
  else
    raise exception 'Unknown choice %', p_choice;
  end if;
end $$;

-- What co-riders may see about each other. Members only.
create or replace function public.get_pool_people(p_pool uuid)
returns table (id uuid, name text, gender text, verified boolean, signature_ok boolean, avatar_path text, upi_id text, is_demo boolean)
language sql stable security definer set search_path = public as $$
  select pr.id, coalesce(pr.verified_name, pr.full_name), pr.verified_gender, pr.verified,
         pr.aadhaar_signature_ok, pr.avatar_path, pr.upi_id, pr.is_demo
  from pool_members m
  join profiles pr on pr.id = m.user_id
  where m.pool_id = p_pool and public.is_pool_member(p_pool);
$$;

-- Phone numbers unlock only after the host locks the group.
create or replace function public.get_pool_contacts(p_pool uuid)
returns table (user_id uuid, name text, phone text, phone_verified boolean)
language sql stable security definer set search_path = public as $$
  select m.user_id, coalesce(pr.verified_name, pr.full_name), pr.phone, pr.phone_verified
  from pool_members m
  join pools p on p.id = m.pool_id
  join profiles pr on pr.id = m.user_id
  where m.pool_id = p_pool
    and p.status in ('locked', 'completed')
    and public.is_pool_member(p_pool);
$$;

revoke execute on function public.assert_can_ride(boolean) from public, anon;
revoke execute on function public.my_searching_request(uuid) from public, anon;
revoke execute on function public.lock_if_ready(uuid) from public, anon, authenticated;
revoke execute on function public.osrm_slot() from public, anon, authenticated;
revoke execute on function public.hit_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function
  public.create_pool(uuid, int),
  public.join_pool(uuid, uuid),
  public.leave_pool(uuid),
  public.set_pool_status(uuid, text),
  public.set_max_pax(uuid, int),
  public.set_member_paid(uuid, uuid, boolean),
  public.get_pool_people(uuid),
  public.women_pool_choice(uuid, text),
  public.accept_pool(uuid),
  public.claim_paid(uuid),
  public.volunteer_booker(uuid),
  public.withdraw_booker(uuid),
  public.set_meeting_point(uuid, text, text),
  public.get_pool_contacts(uuid)
to authenticated;

-- ───────────────────────── Reports ─────────────────────────
create table public.reports (
  id bigint generated always as identity primary key,
  pool_id uuid not null references public.pools on delete cascade,
  reporter_id uuid not null references public.profiles on delete cascade,
  reported_id uuid not null references public.profiles on delete cascade,
  reason text not null check (reason in ('not_a_woman', 'unsafe_behaviour', 'harassment', 'fake_profile', 'no_show', 'other')),
  note text check (char_length(note) <= 500),
  women_only_ride boolean not null,
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  admin_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (pool_id, reporter_id, reported_id)
);
create index reports_status_idx on public.reports (status, created_at desc);

-- After a women-only ride each rider confirms everyone was a woman.
create table public.ride_confirmations (
  pool_id uuid not null references public.pools on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  all_women boolean not null,
  created_at timestamptz not null default now(),
  primary key (pool_id, user_id)
);

alter table public.reports enable row level security;
alter table public.ride_confirmations enable row level security;
create policy "see my reports" on public.reports for select to authenticated using (reporter_id = auth.uid());
create policy "see my confirmations" on public.ride_confirmations for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.reports, public.ride_confirmations from authenticated, anon;

-- Report a co-rider after the group locked. On a women-only ride this removes the reported
-- person's women-only access for good and flags them for admin review.
create or replace function public.report_rider(p_pool uuid, p_reported uuid, p_reason text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare p pools;
begin
  select * into p from pools where id = p_pool;
  if p is null or not public.is_pool_member(p_pool) then raise exception 'You''re not in this group'; end if;
  if p.status not in ('locked', 'completed') then raise exception 'You can report a rider once the group is locked'; end if;
  if p_reported = auth.uid() then raise exception 'You can''t report yourself'; end if;
  if not exists (select 1 from pool_members where pool_id = p_pool and user_id = p_reported) then
    raise exception 'That person isn''t in this group';
  end if;
  insert into reports (pool_id, reporter_id, reported_id, reason, note, women_only_ride)
  values (p_pool, auth.uid(), p_reported, p_reason, nullif(trim(left(coalesce(p_note, ''), 500)), ''), p.women_only)
  on conflict (pool_id, reporter_id, reported_id) do update set reason = excluded.reason, note = excluded.note;
  update profiles
     set flagged_at = coalesce(flagged_at, now()),
         women_only_blocked = women_only_blocked or p.women_only
   where id = p_reported;
end $$;

-- "Was everyone in the cab a woman?" Answering no should be followed by report_rider.
create or replace function public.confirm_ride(p_pool uuid, p_all_women boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from pools where id = p_pool and women_only and status in ('locked', 'completed'))
     or not public.is_pool_member(p_pool) then
    raise exception 'Nothing to confirm for this group';
  end if;
  insert into ride_confirmations (pool_id, user_id, all_women) values (p_pool, auth.uid(), p_all_women)
  on conflict (pool_id, user_id) do update set all_women = excluded.all_women, created_at = now();
end $$;

grant execute on function public.report_rider(uuid, uuid, text, text), public.confirm_ride(uuid, boolean) to authenticated;

-- ───────────────────────── Hard guards ─────────────────────────
-- Enforced on every insert, whichever code path adds the member.
create or replace function public.guard_pool_member()
returns trigger language plpgsql security definer set search_path = public as $$
declare p pools; me profiles; used int;
begin
  select * into p from pools where id = new.pool_id for update;
  select * into me from profiles where id = new.user_id;
  if me is null or not me.verified then
    raise exception 'Only verified riders can be matched';
  end if;
  if me.blocked then raise exception 'This account is blocked'; end if;
  if p.women_only and (me.verified_gender is distinct from 'F' or me.women_only_blocked) then
    raise exception 'Women-only groups accept verified women only';
  end if;
  select coalesce(sum(pax), 0) into used from pool_members where pool_id = new.pool_id;
  if used + new.pax > least(p.max_pax, 6) then
    raise exception 'This group is full';
  end if;
  return new;
end $$;

create trigger pool_members_guard
  before insert on public.pool_members
  for each row execute function public.guard_pool_member();

-- A women-only group that other women have joined can never be opened to men.
create or replace function public.guard_pool_women_only()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.women_only and not new.women_only
     and (select count(*) from pool_members where pool_id = new.id) > 1 then
    raise exception 'A women-only group with other members stays women-only';
  end if;
  return new;
end $$;

create trigger pools_women_only_guard
  before update of women_only on public.pools
  for each row execute function public.guard_pool_women_only();

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
