# Airpool

Share a cab from the airport with verified people on your flight going your way. Mobile-first, dark everywhere, and it costs ₹0 to run.

| Piece | Service (free, no card) |
| --- | --- |
| App | Next.js 15 (App Router), TypeScript, Tailwind v4 |
| Auth, DB, storage, realtime | Supabase free tier |
| Maps | Leaflet + OpenStreetMap, CARTO dark tiles |
| Address search | Photon (komoot) |
| Routes + drop order | Public OSRM server (`/trip` service) |
| AI | Google Gemini Flash, with Groq as backup |
| Flights | Aviationstack free plan (cached in Supabase) |
| Face match | face-api.js (`@vladmandic/face-api`) in the browser |
| Hosting | Vercel Hobby |

## How it works

1. **Sign in** with email/password or Google.
2. **Verify once.** The user downloads the Aadhaar Paperless Offline eKYC ZIP from UIDAI. The browser decrypts it with the share code and takes a live selfie, and face-api.js compares the selfie with the Aadhaar photo on the device. The server then checks UIDAI's XML signature, rejects files older than 30 days and under-18s, and checks whether the phone number matches the Aadhaar-linked mobile hash. It stores only name, gender, birth year, last 4 digits and a peppered hash, which blocks duplicate accounts. Address, photo and DOB are never stored.
3. **Plan a trip.** Enter a flight number and Aviationstack fills in the airport and arrival time. Pick a destination with Photon and add riders and bags.
4. **Match.** `find_pools()` returns open pools at the same airport where everyone lands within 60 minutes of you, a drop is in your ~5 km geohash zone or one of its 8 neighbours, and there are enough seats. Pools with someone on your flight come first. Only aggregate data is returned, never other riders' addresses.
5. **Women-only pools** can be created and seen only by riders whose Aadhaar says female. The database enforces this.
6. **Ride plan.** OSRM works out the best drop order. Gemini (or Groq if Gemini fails) picks the car class for the riders and luggage, and the result is checked against seat limits. It also estimates the fare, which is checked against a rate card. The fare is split **leg by leg**: each stretch is shared by whoever is still in the cab. The host can enter the actual fare to re-split.
7. **Book and pay.** The host gets Uber and Ola deep links (airport → final drop, with the other stops listed in order). Riders get a `upi://pay` link with their share pre-filled.
8. **Safety.** Phone numbers are unlocked only after the host **locks** the group, through the `get_pool_contacts()` RPC. They show a "matches Aadhaar" tick when they match. Every pool also has realtime group chat and a 112 button.

## Setup (about 15 minutes)

### 1. Supabase
1. Create a project at [supabase.com](https://supabase.com) (free, no card).
2. **SQL Editor** → paste and run [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql). This creates the tables, RLS, RPCs, realtime and the private `selfies` bucket.
3. **Authentication → Providers**
   - Email: on. For hackathon demos, turn **off** "Confirm email". The built-in mailer only sends a few emails per hour.
   - Google: on. Create an OAuth client in Google Cloud Console (free) → APIs & Services → Credentials → OAuth client ID (Web). Set the authorized redirect URI to `https://<project>.supabase.co/auth/v1/callback`, then paste the client ID and secret into Supabase.
4. **Authentication → URL Configuration**: set Site URL to your Vercel URL. Add `http://localhost:3000/**` and `https://<your-app>.vercel.app/**` to Redirect URLs.

### 2. Keys
```bash
cp .env.example .env.local
```
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`: Supabase → Project Settings → API.
- `GEMINI_API_KEY`: [aistudio.google.com](https://aistudio.google.com/apikey).
- `GROQ_API_KEY`: [console.groq.com](https://console.groq.com).
- `AVIATIONSTACK_KEY`: [aviationstack.com](https://aviationstack.com) free plan (100 calls/month; results are cached for 6 h).
- `UIDAI_CERT_PEM`: UIDAI's public certificate for offline eKYC, from the "Aadhaar Paperless Offline e-KYC" section on uidai.gov.in. Paste the PEM on one line with `\n` for line breaks.
- `AADHAAR_HASH_PEPPER`: any long random string. **Don't change it after launch**, or duplicate-account detection resets.

If you don't have the UIDAI cert yet, set `ALLOW_UNSIGNED_AADHAAR=true` for a local demo. Profiles verified this way show a "Demo mode" badge instead of "UIDAI signature ✓".

### 3. Run
```bash
npm install
npm run dev
```
Open http://localhost:3000. The camera needs `localhost` or HTTPS.

### 4. Deploy to Vercel (Hobby)
Import the repo on vercel.com, add the same env vars, and deploy. Then add the Vercel URL to Supabase redirect URLs (step 1.4).

## Project map
```
supabase/migrations/0001_init.sql   schema, RLS, RPCs, realtime, storage
src/middleware.ts                   session refresh + route protection
src/lib/aadhaar-client.ts           unzip + parse eKYC in the browser (zip.js)
src/lib/aadhaar-server.ts           UIDAI XML signature check, mobile hash, identity hash
src/lib/face.ts                     face-api.js selfie ↔ Aadhaar photo match
src/lib/ai.ts                       Gemini → Groq fallback, JSON mode
src/lib/fare.ts                     vehicle rules, rate card, leg-based fare split
src/lib/osrm.ts                     drop order (OSRM trip) with fallbacks
src/lib/geohash.ts                  zones + neighbours
src/lib/deeplinks.ts                Uber, Ola, UPI links
src/app/api/flight                  Aviationstack lookup + cache
src/app/api/aadhaar/verify          verification endpoint
src/app/api/pool-plan               route + AI vehicle + fare split, saved on the pool
src/app/(app)/…                     dashboard, verify, trip/new, pool/[id], profile
```

## Known limits
- The face match runs in the browser, so a determined attacker could fake the score. The UIDAI signature, the one-Aadhaar-one-account hash and the server-side checks are the real trust anchors. There's no liveness check yet.
- The public OSRM, Photon and CARTO tile servers are fair-use services. They're fine for a hackathon. For real traffic, self-host or move to a paid tier.
- Aviationstack's free plan is HTTP-only and real-time only (no future schedules), so riders can always enter the airport and time manually.
- The Uber and Ola links pre-fill pickup and the final drop. Intermediate stops have to be added in their apps.
