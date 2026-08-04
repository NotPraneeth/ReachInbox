# How to Run ReachInbox Locally

This guide walks you through every step from a fresh clone to a fully working local demo. Read it top to bottom the first time — the steps are order-dependent.

---

## What You'll Need

| Requirement | Why |
|---|---|
| **Docker Desktop** (running) | Starts Postgres and Redis via `docker compose` |
| **Node.js 20+** | Runs the backend and frontend |
| **npm** (bundled with Node.js) | Package manager |
| **A Google account** | Used to log in via Google OAuth |
| **5 minutes in Google Cloud Console** | To create OAuth credentials (one-time setup) |

---

## Step 1 — Google Cloud Console Setup

This is the only step that requires external setup. The backend OAuth code is already complete — you just need to supply the credentials.

### 1a. Create (or select) a Google Cloud project

1. Go to [https://console.cloud.google.com](https://console.cloud.google.com)
2. Click the project selector at the top → **New Project**
3. Name it anything (e.g. `ReachInbox Dev`) → **Create**

### 1b. Enable the Google People API

1. In the left menu → **APIs & Services → Library**
2. Search for **"Google People API"** → click it → **Enable**

> The People API provides the profile information (name, email, avatar) that the app requests during login.

### 1c. Configure the OAuth consent screen

1. Left menu → **APIs & Services → OAuth consent screen**
2. Choose **External** → **Create**
3. Fill in:
   - **App name**: `ReachInbox` (anything works)
   - **User support email**: your Google email
   - **Developer contact email**: your Google email
4. Click **Save and Continue** through the Scopes and Test Users screens (defaults are fine)
5. On the **Test Users** screen, click **Add users** and add your Google account email — Google requires this for apps in "Testing" mode

### 1d. Create OAuth 2.0 credentials

1. Left menu → **APIs & Services → Credentials**
2. Click **+ Create Credentials → OAuth 2.0 Client ID**
3. **Application type**: Web application
4. **Name**: `ReachInbox Local` (anything)
5. Under **Authorized redirect URIs**, click **Add URI** and enter exactly:
   ```
   http://localhost:4000/auth/google/callback
   ```
6. Click **Create**
7. A dialog shows your **Client ID** and **Client Secret** — copy both, you'll need them in the next step

---

## Step 2 — Clone and Install Dependencies

```bash
git clone <your-repo-url>
cd ReachInbox

npm install --prefix backend
npm install --prefix frontend
```

---

## Step 3 — Configure Backend Environment

```bash
cp backend/.env.example backend/.env
```

Open `backend/.env` and fill in the two required values from Step 1d:

```bash
GOOGLE_CLIENT_ID=your-client-id-from-google-console.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret-from-google-console
```

The rest of the defaults in `.env.example` work as-is for local development:

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `4000` | Backend API port |
| `FRONTEND_URL` | `http://localhost:3000` | Used for CORS and OAuth redirect |
| `SESSION_SECRET` | `change-me` | Change to a random string for any shared environment |
| `DATABASE_URL` | `postgresql://reachinbox:reachinbox@localhost:5432/reachinbox` | Matches docker-compose.yml |
| `REDIS_URL` | `redis://localhost:6379` | Matches docker-compose.yml |
| `GOOGLE_CALLBACK_URL` | `http://localhost:4000/auth/google/callback` | Must match Step 1d exactly |
| `WORKER_CONCURRENCY` | `5` | Parallel job slots |
| `MIN_DELAY_BETWEEN_EMAILS_MS` | `2000` | 2s between sends |
| `RATE_LIMIT_MODE` | `per_sender` | `global` or `per_sender` |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | `50` | Per-sender hourly cap |
| `ETHEREAL_AUTO_CREATE` | `true` | Auto-creates Ethereal test SMTP accounts on seed |

---

## Step 4 — Start the Infrastructure

```bash
docker compose up -d
```

This starts:
- **PostgreSQL 16** on port `5432`
- **Redis 7** on port `6379` (with AOF persistence enabled — survives restarts)

Verify both are healthy:

```bash
docker compose ps
```

You should see `healthy` for both services. If not, wait 10 seconds and check again.

---

## Step 5 — Database Migration

```bash
cd backend
npx prisma migrate dev
```

This creates all tables in Postgres (User, Sender, Campaign, EmailMessage). You'll be prompted for a migration name — anything works (e.g. `init`).

You only need to run this once. If the schema changes later, run it again.

---

## Step 6 — Seed the Database

```bash
# Still in /backend
npm run seed
```

This creates:
- A placeholder dev user (`dev@reachinbox.local`)
- 3 Ethereal SMTP test accounts (fetched live from Ethereal's API)

These Ethereal accounts are the **senders** shown in the Compose → From dropdown. Ethereal is a fake SMTP sink — emails sent through it are visible at a preview URL logged by the worker, but they never reach a real inbox.

> **Note:** Seeding only runs once per dev user. If you run it again, it will detect the existing user and skip.

---

## Step 7 — Start the Backend API

Open a terminal in `/backend` and run:

```bash
npm run dev
```

Expected output:
```
[server] API listening on http://localhost:4000
```

Verify it's working:
```bash
curl http://localhost:4000/api/health
# → {"ok":true}
```

---

## Step 8 — Start the Worker

Open a **second terminal** in `/backend` and run:

```bash
npm run worker
```

Expected output:
```
[worker] starting...
[worker] reconciliation complete, starting queue worker...
[worker] started (Stage 6 rate-limited processor)
```

> **Why a separate process?** The worker and API are intentionally decoupled — killing and restarting the worker is how the "survives server restarts" requirement is tested. They share the same Postgres/Redis backends but run independently.

---

## Step 9 — Start the Frontend

Open a **third terminal** in `/frontend` and run:

```bash
npm run dev
```

Expected output:
```
▲ Next.js 14
- Local:        http://localhost:3000
```

---

## Step 10 — Log In and Use the App

1. Open **http://localhost:3000** — you'll be redirected to the login page
2. Click **Sign in with Google**
3. Choose the Google account you added as a test user in Step 1c
4. You'll be redirected to the dashboard

From the dashboard you can:
- **Compose** a new campaign (click the Compose button in the sidebar)
  - Select a sender from the From dropdown (seeded Ethereal accounts)
  - Type recipients manually or upload a `.csv` / `.txt` file
  - Set subject, body, delay, hourly limit, and start time
  - Click **Send now** or pick a future time with **Send Later**
- **View Scheduled** emails (with status badges and a cancel button)
- **View Sent** emails (with sent timestamps and fail reasons)
- **Log out** from the user menu (chevron next to your name at the bottom of the sidebar)

When the worker processes a job, it logs the Ethereal preview URL:
```
[worker] sent recipient@example.com (uuid) preview: https://ethereal.email/message/...
```
Open that URL in your browser to see the rendered email.

---

## Running Tests

### Unit tests (no infrastructure required)

```bash
cd backend
npm test
```

8 tests covering `computeSchedule` edge cases — all should pass without Docker.

### Integration tests (requires Redis)

The integration tests test `reserveSlot` under concurrent load. They require Redis to be running and self-skip gracefully when it isn't:

```bash
# With docker compose up -d running:
npm test
```

The rate-limiter integration tests will run automatically alongside the unit tests.

### Manual scripts

These scripts require both Docker services and a seeded database (`npm run seed`):

```bash
# Simulates 1,000 recipients and prints the per-hour distribution.
# Should show 5 windows × 200 emails each.
npm run simulate-burst

# End-to-end rate-limit test: 300 jobs, cap=200.
# Verifies exactly 200 reach SENT and 100 roll to the next hour window.
npm run test-rate-limit

# Tests the restart-survival reconciliation logic.
npm run test-reconcile
```

---

## Troubleshooting

### "Sender not found" when composing

You haven't seeded the database, or the seed ran against a different database. Run:
```bash
cd backend && npm run seed
```

### Google OAuth redirect says "redirect_uri_mismatch"

The redirect URI in your Google Console doesn't match. Make sure it's exactly:
```
http://localhost:4000/auth/google/callback
```
No trailing slash. No `https`.

### "Access blocked: This app's request is invalid"

Your Google account wasn't added as a Test User. Go to Google Cloud Console → **OAuth consent screen → Test users** and add your email.

### Google sign-in works but you're immediately redirected back to `/login`

The session cookie isn't being set. Check that:
1. `SESSION_SECRET` is set in `backend/.env`
2. `FRONTEND_URL=http://localhost:3000` matches where the frontend is running
3. Both the API and frontend are running at the same time

### Worker logs "reconciliation: reenqueued=N" on startup

This is normal — it means some `PENDING` jobs were missing from Redis (e.g. Redis was restarted) and the worker re-enqueued them. The emails will still be sent at their original `scheduledAt` time.

### `prisma migrate dev` fails with "password authentication failed"

Docker Postgres hasn't started yet, or a previous container has stale data. Try:
```bash
docker compose down -v   # removes volumes — WARNING: deletes all data
docker compose up -d
```

---

## Full Reset (start from scratch)

```bash
docker compose down -v       # stop containers and delete all data
docker compose up -d         # fresh Postgres + Redis
cd backend
npx prisma migrate dev       # recreate schema
npm run seed                  # recreate dev user + senders
```

---

## What's Where

```
ReachInbox/
├── docker-compose.yml     Postgres + Redis (AOF)
├── backend/
│   ├── .env               Your local config (not committed)
│   ├── .env.example       Template
│   ├── src/index.ts       API server (npm run dev)
│   ├── src/worker.ts      Queue worker (npm run worker)
│   └── prisma/schema.prisma  Database schema
└── frontend/
    └── app/               Next.js pages
```
