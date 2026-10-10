// npm run test:db
// Runs supabase/migrations/0001_init.sql on PGlite (real Postgres compiled to WASM) with
// minimal stand-ins for Supabase's auth/storage/realtime, then checks the safety rules:
// RLS, verification-only columns, women-only groups, 45 min / 7 km limits and the 6-seat cap.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const migrationPath = new URL("../migrations/0001_init.sql", import.meta.url);

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
  grant usage on schema auth to anon, authenticated, service_role;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
  create publication supabase_realtime;
  -- Supabase's default grants on the public schema
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`);

try {
  await db.exec(readFileSync(migrationPath, "utf8"));
} catch (e) {
  console.error("✗ migration failed:", e.message);
  process.exit(1);
}
console.log("✓ migration ran cleanly");

let pass = 0, fail = 0;
const ok = (name) => (pass++, console.log("  ✓", name));
const bad = (name, e) => (fail++, console.log("  ✗", name, "→", e));
const check = (cond, name, detail) => (cond ? ok(name) : bad(name, detail));

async function as(uid, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
  if (uid) await db.exec("set role authenticated;");
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role;");
  }
}
async function expectOk(name, uid, sql, params) {
  try { const r = await as(uid, sql, params); ok(name); return r; } catch (e) { bad(name, e.message); }
}
async function expectErr(name, uid, sql, params, match) {
  try { await as(uid, sql, params); bad(name, "no error"); }
  catch (e) { check(!match || e.message.includes(match), `${name}  [${e.message}]`, e.message); }
}

// Users: Asha (verified F), Bea (verified F), Carl (verified M), Dia (unverified F)
const U = { asha: "00000000-0000-0000-0000-00000000000a", bea: "00000000-0000-0000-0000-00000000000b", carl: "00000000-0000-0000-0000-00000000000c", dia: "00000000-0000-0000-0000-00000000000d" };
for (const [name, id] of Object.entries(U)) {
  await db.query(`insert into auth.users values ($1, $2, $3)`, [id, `${name}@x.in`, { full_name: name, phone: "9876543210", upi_id: `${name}@okaxis` }]);
}
const prof = await db.query(`select full_name, phone, upi_id from profiles where id = $1`, [U.asha]);
check(JSON.stringify(prof.rows[0]) === '{"full_name":"asha","phone":"9876543210","upi_id":"asha@okaxis"}', "sign-up trigger copies name/phone/UPI", prof.rows[0]);
await db.exec(`update profiles set verified = true, verified_gender = 'F' where id in ('${U.asha}','${U.bea}');
               update profiles set verified = true, verified_gender = 'M' where id = '${U.carl}';`);

console.log("\nProfiles");
await expectErr("user can't set verified", U.dia, `update profiles set verified = true where id = $1`, [U.dia], "permission denied");
await expectOk("user can edit own UPI", U.dia, `update profiles set upi_id = 'dia@ybl' where id = $1`, [U.dia]);
const others = await as(U.carl, `select * from profiles`);
check(others.rows.length === 1, "user reads only their own profile", others.rows.length);

const LANDS = "2026-10-12T14:00:00+05:30";
const trip = (over = {}) => ({ flight_iata: "6E2134", arrival_date: "2026-10-12", arrival_at: LANDS, airport_iata: "JAI",
  dest_label: "Mansarovar", dest_lat: 26.8686, dest_lng: 75.757, zone: "jai-mansarovar", pax: 1, women_only: false, ...over });
const insertTrip = (uid, t) => as(uid, `insert into trip_requests (flight_iata, arrival_date, arrival_at, airport_iata, dest_label, dest_lat, dest_lng, zone, pax, women_only)
  values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`, Object.values(t)).then((r) => r.rows[0].id);

console.log("\nTrip requests");
await expectErr("unverified rider can't save a trip", U.dia, `insert into trip_requests (flight_iata, arrival_date, arrival_at, airport_iata, dest_label, dest_lat, dest_lng, zone)
  values ('6E2134','2026-10-12',$1,'JAI','x',26.86,75.75,'other')`, [LANDS], "row-level security");
await expectErr("a man can't save a women-only trip", U.carl, `insert into trip_requests (flight_iata, arrival_date, arrival_at, airport_iata, dest_label, dest_lat, dest_lng, zone, women_only)
  values ('6E2134','2026-10-12',$1,'JAI','x',26.86,75.75,'other',true)`, [LANDS], "row-level security");
await expectErr("bad flight number rejected", U.carl, `insert into trip_requests (flight_iata, arrival_date, arrival_at, airport_iata, dest_label, dest_lat, dest_lng, zone)
  values ('682134','2026-10-12',$1,'JAI','x',26.86,75.75,'other')`, [LANDS], "check constraint");

const ashaTrip = await insertTrip(U.asha, trip({ women_only: true }));
ok("verified woman saves a women-only trip");
const poolId = (await expectOk("she starts a women-only group", U.asha, `select create_pool($1) as id`, [ashaTrip])).rows[0].id;
const st = await as(U.asha, `select status, pool_id from trip_requests where id = $1`, [ashaTrip]);
check(st.rows[0].status === "matched" && st.rows[0].pool_id === poolId, "her request is now 'matched'", st.rows[0]);

console.log("\nWomen-only rules");
const carlTrip = await insertTrip(U.carl, trip({ dest_lat: 26.875, dest_lng: 75.76 }));
await expectErr("a man can't join a women-only group", U.carl, `select join_pool($1, $2)`, [poolId, carlTrip], "women");
await expectErr("nobody can insert members directly", U.carl,
  `insert into pool_members (pool_id, user_id, arrival_at, dest_label, dest_lat, dest_lng, dest_zone) values ($1,$2,$3,'x',26.87,75.76,'other')`, [poolId, U.carl, LANDS], "");
await expectErr("trigger blocks a man even via a direct server insert", null,
  `insert into pool_members (pool_id, user_id, arrival_at, dest_label, dest_lat, dest_lng, dest_zone) values ('${poolId}','${U.carl}','${LANDS}','x',26.87,75.76,'other')`, [], "Women-only groups accept verified women only");

console.log("\nMatch limits (45 min, 7 km)");
const beaFar = await insertTrip(U.bea, trip({ dest_lat: 26.827, dest_lng: 75.859, zone: "jai-jagatpura" }));
await expectErr("drop >7 km away can't join", U.bea, `select join_pool($1, $2)`, [poolId, beaFar], "isn't a match");
await as(U.bea, `update trip_requests set status = 'cancelled' where id = $1`, [beaFar]);
const beaLate = await insertTrip(U.bea, trip({ arrival_at: "2026-10-12T15:00:00+05:30", dest_lat: 26.875, dest_lng: 75.76 }));
await expectErr("landing 60 min apart can't join", U.bea, `select join_pool($1, $2)`, [poolId, beaLate], "isn't a match");
await as(U.bea, `update trip_requests set status = 'cancelled' where id = $1`, [beaLate]);
const beaOk = await insertTrip(U.bea, trip({ arrival_at: "2026-10-12T14:30:00+05:30", dest_lat: 26.875, dest_lng: 75.76, pax: 1 }));
await expectOk("a verified woman nearby, 30 min apart, joins", U.bea, `select join_pool($1, $2)`, [poolId, beaOk]);

console.log("\n15-minute choice");
await expectErr("can't open to everyone once another woman joined", U.asha, `select women_pool_choice($1, 'open')`, [poolId], "stays women-only");
await expectErr("trigger also blocks flipping women_only directly", null, `update pools set women_only = false where id = '${poolId}'`, [], "stays women-only");
await expectOk("'keep waiting' works", U.asha, `select women_pool_choice($1, 'wait')`, [poolId]);
await expectOk("'notify me' works", U.asha, `select women_pool_choice($1, 'notify')`, [poolId]);
const n = await as(U.asha, `select notify_on_match from trip_requests where id = $1`, [ashaTrip]);
check(n.rows[0].notify_on_match, "notify flag saved on her request", n.rows[0]);
await expectErr("only the host can choose", U.bea, `select women_pool_choice($1, 'wait')`, [poolId], "Only the group host");

console.log("\nLeaving and opening up");
await expectOk("Bea leaves", U.bea, `select leave_pool($1)`, [poolId]);
const back = await as(U.bea, `select status, pool_id from trip_requests where id = $1`, [beaOk]);
check(back.rows[0].status === "searching" && back.rows[0].pool_id === null, "her request goes back to 'searching'", back.rows[0]);
await expectOk("alone again, Asha opens the group to everyone", U.asha, `select women_pool_choice($1, 'open')`, [poolId]);
await expectOk("now Carl can join", U.carl, `select join_pool($1, $2)`, [poolId, carlTrip]);

console.log("\nSeats (largest car = 6)");
await expectErr("max_pax above 6 is rejected", null, `update pools set max_pax = 7 where id = '${poolId}'`, [], "check constraint");
await db.exec(`update pools set max_pax = 6 where id = '${poolId}'`);
const big = await insertTrip(U.bea, trip({ arrival_at: "2026-10-12T14:10:00+05:30", dest_lat: 26.875, dest_lng: 75.76, pax: 4, women_only: false }));
await as(U.bea, `update trip_requests set status = 'cancelled' where id = $1`, [beaOk]);
await expectOk("2 + 4 = 6 seats fits", U.bea, `select join_pool($1, $2)`, [poolId, big]);
await expectErr("signed-in users have no write access to members", U.carl,
  `insert into pool_members (pool_id, user_id, arrival_at, dest_label, dest_lat, dest_lng, dest_zone) values ($1,$2,$3,'x',26.87,75.76,'other')`, [poolId, U.dia, LANDS], "permission denied");
await db.exec(`update profiles set verified = true, verified_gender = 'F' where id = '${U.dia}'`);
await expectErr("a 7th seat never fits, even via a direct insert", null,
  `insert into pool_members (pool_id, user_id, arrival_at, dest_label, dest_lat, dest_lng, dest_zone) values ('${poolId}','${U.dia}','${LANDS}','x',26.87,75.76,'other')`, [], "This group is full");

console.log("\nAccept, auto-lock and contacts");
const V = { eve: "00000000-0000-0000-0000-00000000000e", fay: "00000000-0000-0000-0000-00000000000f", gia: "00000000-0000-0000-0000-000000000010" };
for (const [name, id] of Object.entries(V)) {
  await db.query(`insert into auth.users values ($1, $2, $3)`, [id, `${name}@x.in`, { full_name: name, phone: "9123456780", upi_id: `${name}@ybl` }]);
  await db.query(`update profiles set verified = true, verified_gender = 'F', verified_name = $2 where id = $1`, [id, `${name[0].toUpperCase()}${name.slice(1)} Verma`]);
}
const near = { arrival_at: "2026-10-13T10:00:00+05:30", arrival_date: "2026-10-13", dest_lat: 26.853, dest_lng: 75.815, zone: "jai-malviya-nagar" };
const eveTrip = await insertTrip(V.eve, trip(near));
const g1 = (await as(V.eve, `select create_pool($1, 4) as id`, [eveTrip])).rows[0].id;
const fayTrip = await insertTrip(V.fay, trip({ ...near, dest_lat: 26.847, dest_lng: 75.803 }));
await expectOk("Fay joins Eve's group", V.fay, `select join_pool($1, $2)`, [g1, fayTrip]);
let c = await as(V.fay, `select * from get_pool_contacts($1)`, [g1]);
check(c.rows.length === 0, "before locking, no phone numbers are visible", c.rows);
await expectErr("a non-member can't accept", V.gia, `select accept_pool($1)`, [g1], "not in this group");
let r = await as(V.fay, `select accept_pool($1) as locked`, [g1]);
check(r.rows[0].locked === false, "Fay accepts; still waiting for Eve", r.rows[0]);
r = await as(V.eve, `select accept_pool($1) as locked`, [g1]);
check(r.rows[0].locked === true, "Eve accepts; everyone has, so the group locks", r.rows[0]);
c = await as(V.fay, `select name, phone from get_pool_contacts($1) order by name`, [g1]);
check(c.rows.length === 2 && c.rows[0].name === "Eve Verma" && c.rows[0].phone === "9123456780",
  "after locking, members see full verified names and phones", c.rows);
c = await as(V.gia, `select * from get_pool_contacts($1)`, [g1]);
check(c.rows.length === 0, "outsiders never see phones, even after lock", c.rows);
await expectErr("host can't lock or reopen by hand anymore", V.eve, `select set_pool_status($1, 'open')`, [g1], "Cannot move");

console.log("\nMeeting point");
await expectOk("a member sets the meeting point", V.fay, `select set_meeting_point($1, 'arrival_gate', 'Gate 2, near Costa')`, [g1]);
const mp = await as(V.eve, `select meeting_point, meeting_note from pools where id = $1`, [g1]);
check(mp.rows[0].meeting_point === "arrival_gate" && mp.rows[0].meeting_note === "Gate 2, near Costa", "everyone sees it", mp.rows[0]);
await expectErr("outsiders can't set it", V.gia, `select set_meeting_point($1, 'parking')`, [g1], "not in this group");
await expectErr("unknown options are rejected", V.fay, `select set_meeting_point($1, 'rooftop')`, [g1], "Unknown meeting point");

console.log("\nLeaving reopens; a full car locks by itself");
await expectOk("Fay leaves the locked group", V.fay, `select leave_pool($1)`, [g1]);
const after = await as(V.eve, `select p.status, m.accepted from pools p join pool_members m on m.pool_id = p.id where p.id = $1`, [g1]);
check(after.rows[0].status === "open" && after.rows[0].accepted === false, "group reopens and Eve must accept again", after.rows[0]);
const giaTrip = await insertTrip(V.gia, trip({ ...near, pax: 3 }));
r = await as(V.gia, `select join_pool($1, $2)`, [g1, giaTrip]);
const st2 = await as(V.eve, `select status from pools where id = $1`, [g1]);
check(st2.rows[0].status === "locked", "Gia (3 people) fills the 4-seat car, so it locks without waiting", st2.rows[0]);

console.log("\nBooking and payments");
// g1 is locked with Eve (host) and Gia.
await expectErr("nobody can mark paid before the booking is saved", V.gia, `select claim_paid($1)`, [g1], "Payments open once");
await expectOk("Gia volunteers to book", V.gia, `select volunteer_booker($1)`, [g1]);
await expectErr("first volunteer wins", V.eve, `select volunteer_booker($1)`, [g1], "already volunteered");
await expectOk("Gia steps back", V.gia, `select withdraw_booker($1)`, [g1]);
await expectOk("now Eve can volunteer", V.eve, `select volunteer_booker($1)`, [g1]);
await expectErr("bad number plates are rejected", null, `update pools set car_number = 'HELLO' where id = '${g1}'`, [], "check constraint");
// What /api/booking does with the service role after checking the caller is the booker:
await db.query(`update pools set driver_name = 'Ramesh', car_number = 'RJ14CD1234', car_model = 'White Ertiga', booked_at = now() where id = $1`, [g1]);
const seen = await as(V.gia, `select driver_name, car_number from pools where id = $1`, [g1]);
check(seen.rows[0]?.driver_name === "Ramesh" && seen.rows[0]?.car_number === "RJ14CD1234", "members see the driver details", seen.rows);
const outsider = await as(V.fay, `select driver_name from pools where id = $1`, [g1]);
check(outsider.rows.length === 0, "people outside the group can't see them", outsider.rows);
await expectErr("can't switch booker after booking", V.gia, `select volunteer_booker($1)`, [g1], "already booked");
await expectOk("Gia taps \"I've paid\"", V.gia, `select claim_paid($1)`, [g1]);
const claim = await as(V.gia, `select paid, paid_claimed_at from pool_members where pool_id = $1 and user_id = $2`, [g1, V.gia]);
check(claim.rows[0].paid === false && claim.rows[0].paid_claimed_at !== null, "it shows as claimed, not yet confirmed", claim.rows[0]);
await expectErr("riders can't confirm payments", V.gia, `select set_member_paid($1, $2, true)`, [g1, V.gia], "Only the booker");
await expectOk("the booker confirms it", V.eve, `select set_member_paid($1, $2, true)`, [g1, V.gia]);
const conf = await as(V.eve, `select paid from pool_members where pool_id = $1 and user_id = $2`, [g1, V.gia]);
check(conf.rows[0].paid === true, "Gia now shows as paid for everyone", conf.rows[0]);
await expectErr("the booker doesn't owe anyone", V.eve, `select claim_paid($1)`, [g1], "You're the booker");
await expectOk("Gia leaves", V.gia, `select leave_pool($1)`, [g1]);
const reset = await as(V.eve, `select status, booker_id, driver_name, booked_at from pools where id = $1`, [g1]);
check(reset.rows[0].status === "open" && reset.rows[0].booker_id === null && reset.rows[0].driver_name === null && reset.rows[0].booked_at === null,
  "leaving reopens the group and clears the booking", reset.rows[0]);

console.log("\nReports and women-only safety");
const W = { hana: "00000000-0000-0000-0000-000000000011", isha: "00000000-0000-0000-0000-000000000012", jaya: "00000000-0000-0000-0000-000000000013" };
for (const [name, id] of Object.entries(W)) {
  await db.query(`insert into auth.users values ($1, $2, $3)`, [id, `${name}@x.in`, { full_name: name, phone: "9000000000", upi_id: `${name}@ybl` }]);
  await db.query(`update profiles set verified = true, verified_gender = 'F' where id = $1`, [id]);
}
const wTrip = { arrival_at: "2026-10-14T09:00:00+05:30", arrival_date: "2026-10-14", dest_lat: 26.8686, dest_lng: 75.757, zone: "jai-mansarovar", women_only: true };
const hanaTrip = await insertTrip(W.hana, trip(wTrip));
const wg = (await as(W.hana, `select create_pool($1, 4) as id`, [hanaTrip])).rows[0].id;
const ishaTrip = await insertTrip(W.isha, trip({ ...wTrip, dest_lat: 26.875, dest_lng: 75.76 }));
await as(W.isha, `select join_pool($1, $2)`, [wg, ishaTrip]);
await expectErr("can't report before the group locks", W.hana, `select report_rider($1, $2, 'not_a_woman')`, [wg, W.isha], "once the group is locked");
await as(W.hana, `select accept_pool($1)`, [wg]);
await as(W.isha, `select accept_pool($1)`, [wg]);
await expectErr("can't report yourself", W.hana, `select report_rider($1, $2, 'other')`, [wg, W.hana], "yourself");
await expectErr("can't report someone outside the group", W.hana, `select report_rider($1, $2, 'other')`, [wg, W.jaya], "isn't in this group");
await expectErr("unknown reasons are rejected", W.hana, `select report_rider($1, $2, 'rude')`, [wg, W.isha], "check constraint");
await expectOk("Hana reports Isha after the women-only ride", W.hana, `select report_rider($1, $2, 'not_a_woman', 'Voice and ID did not match')`, [wg, W.isha]);
const flag = await db.query(`select women_only_blocked, flagged_at from profiles where id = $1`, [W.isha]);
check(flag.rows[0].women_only_blocked === true && flag.rows[0].flagged_at !== null, "Isha loses women-only access and is flagged for review", flag.rows[0]);
await expectErr("Isha can't flip that flag back herself", W.isha, `update profiles set women_only_blocked = false where id = $1`, [W.isha], "permission denied");
await expectErr("Isha can no longer save a women-only trip", W.isha, `insert into trip_requests (flight_iata, arrival_date, arrival_at, airport_iata, dest_label, dest_lat, dest_lng, zone, women_only)
  values ('6E2134','2026-10-15','2026-10-15T09:00:00+05:30','JAI','x',26.86,75.75,'other',true)`, [], "row-level security");
const reports = await as(W.hana, `select reason, note, women_only_ride from reports`);
check(reports.rows.length === 1 && reports.rows[0].women_only_ride === true, "Hana can see her own report", reports.rows);
const theirs = await as(W.isha, `select * from reports`);
check(theirs.rows.length === 0, "the reported person can't see who reported them", theirs.rows);
await expectOk("Hana confirms the ride wasn't all women", W.hana, `select confirm_ride($1, false)`, [wg]);
await expectErr("confirmation only exists for women-only rides", V.eve, `select confirm_ride($1, true)`, [g1], "Nothing to confirm");

console.log("\nBlocking and rate limits");
await db.query(`update profiles set blocked = true where id = $1`, [W.jaya]);
await expectErr("a blocked user can't save trips", W.jaya, `insert into trip_requests (flight_iata, arrival_date, arrival_at, airport_iata, dest_label, dest_lat, dest_lng, zone)
  values ('6E2134','2026-10-15','2026-10-15T09:00:00+05:30','JAI','x',26.86,75.75,'other')`, [], "row-level security");
const hits = [];
for (let i = 0; i < 4; i++) hits.push((await db.query(`select hit_rate_limit('test:user', 3, 3600) as ok`)).rows[0].ok);
check(JSON.stringify(hits) === "[true,true,true,false]", "rate limit allows 3 then blocks the 4th", hits);
await expectErr("signed-in users can't touch rate limits", W.hana, `select hit_rate_limit('x', 1, 60)`, [], "permission denied");
await db.query(`insert into sos_shares (token, pool_id, user_id, lat, lng) values ('secret-token', $1, $2, 26.9, 75.8)`, [wg, W.isha]);
const sos = await as(W.hana, `select * from sos_shares`);
check(sos.rows.length === 0, "SOS links are invisible to signed-in users (server reads them by token)", sos.rows);

console.log("\nOSRM throttle");
const slots = [];
for (let i = 0; i < 3; i++) slots.push(new Date((await db.query(`select osrm_slot() as at`)).rows[0].at).getTime());
check(slots[1] - slots[0] === 1000 && slots[2] - slots[1] === 1000, "back-to-back calls get slots 1 second apart", slots);
await expectErr("signed-in users can't take OSRM slots", U.asha, `select osrm_slot()`, [], "permission denied");
await expectErr("signed-in users can't write to the route cache", U.asha, `insert into route_cache values ('k', '{}')`, [], "");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
