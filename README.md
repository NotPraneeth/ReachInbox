# ReachInbox — Email Scheduler

A persistent, restart-safe email scheduler with per-sender rate limiting, built on **BullMQ + Redis + PostgreSQL + Next.js**.

🌐 **Live demo:** [https://reachinbox.duckdns.org](https://reachinbox.duckdns.org)

---

## Features

### Backend
| Feature | Details |
|---|---|
| **Scheduling** | Campaigns are broken into per-recipient `EmailMessage` rows with precomputed `scheduledAt` times. BullMQ delayed jobs fire each message at the right moment. |
| **Persistence on restart** | Boot-time reconciliation re-enqueues any `PENDING` rows missing from Redis, and resets stuck `PROCESSING` rows. No scheduled email is ever lost. |
| **Rate limiting** | Two-layer system: a BullMQ queue-level `limiter` caps global throughput (ms between sends), and a per-sender Redis `INCR` counter enforces an hourly cap. Both layers are race-safe across multiple worker processes. |
| **Concurrency** | Configurable `WORKER_CONCURRENCY` (default 5). Idempotency is guaranteed by a DB `UPDATE WHERE status='PENDING'` guard before each SMTP call — prevents double-sends even when BullMQ re-assigns a stalled job. |
| **Google OAuth** | Passport.js + Redis-backed sessions. New users get two Ethereal test senders auto-provisioned on first login. |
| **CSV / plain-text lead parsing** | Upload a `.csv` or `.txt` file to extract and validate recipient emails. |
| **Email cancellation** | Cancel any `PENDING` email from the UI; removes the job from BullMQ and marks the DB row `CANCELLED`. |
| **Ethereal preview links** | The Nodemailer test preview URL is stored in the DB and surfaced on each sent email row — click to open the email in Ethereal without digging through logs. |

### Frontend
| Feature | Details |
|---|---|
| **Login page** | Google Sign-In button; email/password fields rendered for visual fidelity but intentionally disabled. |
| **Dashboard** | Sidebar navigation with live badge counts for scheduled and sent emails. |
| **Compose** | Rich text editor (Tiptap), recipient chips, CSV/TXT uploader, sender dropdown, delay & hourly-limit inputs, and a "Send Later" date-time popover. |
| **Scheduled table** | Paginated, searchable list of `PENDING`/`PROCESSING` emails with cancel button per row. |
| **Sent table** | Paginated, searchable list of `SENT`/`FAILED` emails. SENT rows show an **↗ Ethereal preview link** to view the email in a browser tab. |
| **Status badges** | Colour-coded `PENDING`, `PROCESSING`, `SENT`, `FAILED`, `CANCELLED` badges. |

---

## Architecture Overview

```
Browser
  │  REST + session cookie (credentials: "include")
  ▼
Next.js 14  (port 3000)
  │  server-side proxy: /api/* and /auth/* → api:4000
  ▼
Express API  (port 4000)
  ├─ /auth/google*              Google OAuth via Passport
  ├─ /api/me                    Current user
  ├─ /api/senders               Sender list
  ├─ /api/config/defaults       Scheduling bounds
  ├─ /api/leads/parse           CSV/TXT → email list
  ├─ /api/campaigns             POST: create & schedule campaign
  └─ /api/emails/{scheduled,sent,counts,/:id}
          │
          ├──────────────────────────────────────┐
          ▼                                      ▼
     PostgreSQL (Prisma)                  Redis (ioredis)
     User, Sender, Campaign,              BullMQ queue state
     EmailMessage (with scheduledAt,      Rate-limit counters (INCR)
     status, testMessageUrl …)            Session store
          │                                      │
          └──────────────────┬───────────────────┘
                             ▼
                       BullMQ Worker  (separate process)
                       reconcile() → processMessage()
                             │
                             ▼
                       Nodemailer → Ethereal SMTP
                       (testMessageUrl stored in DB)
```

The **API** and **Worker** run as separate processes. This is intentional — the worker can be killed and restarted without affecting the API, and reconciliation fires on every worker boot.

### Email status lifecycle

```
PENDING ──► PROCESSING ──► SENT
                       └──► FAILED   (retries exhausted)
PENDING ──► PENDING          (hourly cap hit → re-delayed to next hour window)
PENDING ──► CANCELLED        (user cancels via UI)
```

---

## How Scheduling Works

When you submit the compose form, `POST /api/campaigns` calls `createScheduledCampaign()`:

1. **`computeSchedule()`** distributes recipients across time slots, respecting `delayBetweenEmailsSec` and `hourlyLimit`. If more emails are requested than the hourly limit allows, the overflow spills into the next hour window, and so on.
2. A single `Campaign` row is created, then all `EmailMessage` rows are bulk-inserted (`createManyAndReturn`) in one DB round-trip.
3. All jobs are **bulk-enqueued** to BullMQ with `delay = scheduledAt - now` and `jobId = EmailMessage.id`.

When a job's delay expires, the worker's `processMessage()` runs:
- Checks the DB row is still `PENDING` (idempotency guard #1).
- Atomically increments the per-sender hourly Redis counter. If over the cap, releases the slot and calls `job.moveToDelayed(nextHourBoundary)` + throws `DelayedError` — the **same job** is re-delayed, not replaced.
- Claims the row with `UPDATE WHERE status='PENDING'` → `PROCESSING` (idempotency guard #2 — prevents double-sends across concurrent workers).
- Sends via Nodemailer/Ethereal and stores `testMessageUrl`.
- Marks the row `SENT` or `FAILED`.

### Persistence on restart

On every worker boot, `reconcilePendingMessages()` runs **once**:

1. **Missing jobs:** Any `PENDING` row with no corresponding BullMQ job (e.g. Redis was flushed) is re-enqueued with its original `scheduledAt`. Because `jobId = EmailMessage.id`, a safe no-op if the job already exists.
2. **Stuck PROCESSING rows:** Any row that has been `PROCESSING` for more than 5 minutes (crashed mid-send) is reset to `PENDING` and retried, or permanently marked `FAILED` after `MAX_RECONCILE_ATTEMPTS`.

### Rate limiting & concurrency

**Layer 1 — Global throughput:** BullMQ `Worker` `limiter: { max, duration }` is set from `MIN_DELAY_BETWEEN_EMAILS_MS`. This is enforced in Redis, so it holds across any number of concurrent worker processes.

**Layer 2 — Per-sender hourly cap:** A Redis key `rl:hour:<windowStart>:<senderId>` is atomically `INCR`'d before each send. If the count exceeds `MAX_EMAILS_PER_HOUR_PER_SENDER`, the slot is `DECR`'d back and the job is re-delayed to the start of the next clock-hour window. The key expires automatically after 2 hours (safety TTL).

**Concurrency safety:** `INCR` in Redis is atomic — no two workers can claim the same slot simultaneously. The DB `UPDATE WHERE status='PENDING'` guard is the final backstop against double-sends from stalled job re-assignment.

---

## Running Locally

### Prerequisites

- **Node.js 20+**
- **Docker Desktop** (for Postgres + Redis)
- A **Google Cloud Console** project with an OAuth 2.0 Web client

### 1. Clone & install

```bash
git clone https://github.com/NotPraneeth/ReachInbox.git
cd ReachInbox
npm install --prefix backend
npm install --prefix frontend
```

### 2. Start Postgres + Redis

```bash
docker compose up -d postgres redis
# Postgres → localhost:5432
# Redis    → localhost:6379 (AOF persistence on)
```

### 3. Create Google OAuth credentials

1. Open [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)
2. **Create credentials → OAuth 2.0 Client ID** (type: Web application)
3. Add `http://localhost:4000/auth/google/callback` to **Authorized redirect URIs**
4. Note your **Client ID** and **Client Secret**

### 4. Set up the backend environment

```bash
cp backend/.env.example backend/.env
```

Open `backend/.env` and fill in at minimum:

```env
GOOGLE_CLIENT_ID=<your-client-id>
GOOGLE_CLIENT_SECRET=<your-client-secret>
SESSION_SECRET=any-random-string-here
```

Full variable reference:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4000` | Express listen port |
| `FRONTEND_URL` | `http://localhost:3000` | CORS origin for the API |
| `DATABASE_URL` | `postgresql://reachinbox:reachinbox@localhost:5432/reachinbox` | Postgres connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `SESSION_SECRET` | `change-me` | Cookie session signing key |
| `GOOGLE_CLIENT_ID` | — | **Required** for OAuth |
| `GOOGLE_CLIENT_SECRET` | — | **Required** for OAuth |
| `GOOGLE_CALLBACK_URL` | `http://localhost:4000/auth/google/callback` | OAuth redirect URI |
| `WORKER_CONCURRENCY` | `5` | Parallel BullMQ job slots |
| `MIN_DELAY_BETWEEN_EMAILS_MS` | `2000` | Queue-level throttle (ms) |
| `RATE_LIMIT_MODE` | `per_sender` | `global` or `per_sender` |
| `MAX_EMAILS_PER_HOUR` | `200` | Global hourly cap (when `RATE_LIMIT_MODE=global`) |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | `150` | Per-sender hourly cap |
| `ETHEREAL_AUTO_CREATE` | `true` | Auto-provision Ethereal senders on first login |

### 5. Run database migrations

```bash
cd backend
npx prisma migrate dev
```

### 6. Start the API server

```bash
# From /backend
npm run dev
# → [server] API listening on http://localhost:4000
```

### 7. Start the BullMQ worker

```bash
# From /backend (new terminal)
npm run worker
# → [worker] reconciliation complete, starting queue worker...
```

### 8. Start the frontend

```bash
# From /frontend
npm run dev
# → Ready at http://localhost:3000
```

Open [http://localhost:3000](http://localhost:3000) → **Sign in with Google** → land on the dashboard.

---

## Ethereal Email Setup

[Ethereal](https://ethereal.email/) is a fake SMTP service — emails are captured and never delivered to real inboxes. It's perfect for development and demos.

**Automatic (default — `ETHEREAL_AUTO_CREATE=true`):**  
On first login, the backend calls `nodemailer.createTestAccount()` twice and stores two Ethereal sender accounts in the database automatically. No configuration needed.

**Manual (if you want to re-use specific credentials):**  
Set `ETHEREAL_AUTO_CREATE=false` and create an account at [https://ethereal.email/create](https://ethereal.email/create). Then run the seed script with your credentials in `.env`:

```env
ETHEREAL_USER=your.ethereal@ethereal.email
ETHEREAL_PASS=yourpassword
```

```bash
cd backend
npm run seed
```

**Viewing sent emails:**  
After a campaign sends, go to the **Sent** tab. Each successfully sent row has an **↗ external link** icon — clicking it opens the Ethereal preview for that exact email in a new browser tab. No log-digging required.

---

## Running Tests

```bash
cd backend
npm test                   # 8 unit tests for computeSchedule (Vitest)
npm run simulate-burst     # enqueue 1 000 synthetic jobs, print per-hour distribution
```

The burst simulation uses a no-op stub and doesn't create real Ethereal traffic. The output shows emails distributed across hour windows per the hourly cap.

---

## Deployment (Docker Compose)

The repo ships with a full `docker-compose.yml` that runs the entire stack on a single host behind Caddy (automatic HTTPS). The live site runs on an **Oracle Cloud Always Free** VM.

```
Internet ──[443]── Caddy (HTTPS, auto Let's Encrypt)
                     │
                     ├─► web     (Next.js standalone, :3000)
                     └─► rewrites /api & /auth → api:4000
                           │
                           ├─ api        (Express, :4000)
                           ├─ worker     (BullMQ, separate process)
                           ├─ db-migrate (one-shot: prisma migrate deploy)
                           ├─ postgres   (16, pgdata volume)
                           └─ redis      (7, AOF, redisdata volume)
```

Only Caddy is exposed publicly. The frontend proxies the backend server-side, so all requests are same-origin — session cookies just work with no CORS.

### Deploy steps

```bash
# 1. On the VM: install Docker + Compose plugin, open TCP 22/80/443.

# 2. Add https://<DOMAIN>/auth/google/callback to Google Console
#    Authorized redirect URIs.

# 3. Clone and configure
git clone https://github.com/NotPraneeth/ReachInbox.git && cd ReachInbox
cp .env.example .env
#   edit .env: set DOMAIN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_SECRET

# 4. Build and start
docker compose up -d --build

# 5. One-time seed (creates dev user + Ethereal senders; idempotent)
docker compose run --rm api npm run seed
```

Migrations run automatically via the `db-migrate` one-shot service on every `up`. The worker re-runs `reconcilePendingMessages()` on boot, so no emails are lost across restarts or redeployments.

---

## Project Structure

```
ReachInbox/
├── backend/
│   ├── src/
│   │   ├── index.ts               API entry point (Express)
│   │   ├── worker.ts              Worker process entry point
│   │   ├── auth.ts                Passport + Redis session + Ethereal auto-provision
│   │   ├── config.ts              Env var parsing with typed defaults
│   │   ├── routes/
│   │   │   ├── auth.ts            Google OAuth routes
│   │   │   ├── me.ts              Current user
│   │   │   ├── senders.ts         Sender list
│   │   │   ├── config.ts          Scheduling bounds
│   │   │   ├── leads.ts           CSV/TXT → email list
│   │   │   ├── campaigns.ts       POST /api/campaigns
│   │   │   └── emails.ts          Scheduled / sent / counts / cancel
│   │   ├── services/
│   │   │   ├── queue.ts           BullMQ queue + worker factory (limiter config)
│   │   │   ├── processor.ts       Rate-limited, idempotent job handler
│   │   │   ├── rateLimiter.service.ts  Redis INCR per-hour-window counter
│   │   │   ├── reconcile.ts       Boot-time reconciliation
│   │   │   ├── scheduler.service.ts   computeSchedule → createMany → addBulk
│   │   │   └── email.service.ts   Nodemailer transport + Ethereal preview URL
│   │   └── lib/
│   │       ├── computeSchedule.ts  Pure scheduling algorithm (fully unit-tested)
│   │       ├── parseLeads.ts       CSV / plain-text email extractor
│   │       └── configDefaults.ts   Compose form min/max/default bounds
│   ├── prisma/
│   │   ├── schema.prisma          User, Sender, Campaign, EmailMessage
│   │   ├── seed.ts                Dev user + Ethereal senders
│   │   └── migrations/
│   └── tests/
│       └── computeSchedule.test.ts   8 Vitest unit tests
├── frontend/
│   ├── app/
│   │   ├── login/                 Google OAuth login page
│   │   └── dashboard/
│   │       ├── page.tsx           Dashboard home (counts redirect)
│   │       ├── compose/           Compose campaign page
│   │       ├── scheduled/         Scheduled emails table
│   │       └── sent/              Sent/failed emails table (with Ethereal links)
│   ├── components/
│   │   ├── layout/                Sidebar, UserMenu
│   │   ├── compose/               ComposeForm, RecipientChips, CsvUploader,
│   │   │                          RichTextEditor, SendLaterPopover
│   │   ├── emails/                EmailListView, EmailRow, StatusBadge
│   │   └── ui/                    Button, Input, Avatar, Badge
│   └── lib/
│       ├── apiClient.ts           Typed fetch wrapper + ApiError
│       ├── types.ts               Shared TypeScript interfaces
│       ├── format.ts              Date formatting helpers
│       └── hooks/                 useAuth, useEmails, useCounts, useApi
├── docker-compose.yml             Full production stack
└── .gitignore                     Excludes node_modules, .env, .playwright-mcp, build outputs
```

---

## Assumptions & Trade-offs

| Area | Decision | Rationale / Trade-off |
|---|---|---|
| **Auth** | Google OAuth only | Email/password login is rendered for visual fidelity but intentionally disabled — half-built auth is worse than honestly-disabled auth. |
| **Email sending** | Ethereal (fake SMTP) | No real provider credentials needed; Ethereal captures emails for preview. The stored `testMessageUrl` lets you inspect sends from the UI. |
| **Rate limit counter** | Fixed clock-hour bucket (`rl:hour:<epoch>`) | Simpler than a rolling 60-minute window. The downside is a brief burst window at the hour boundary — acceptable for a scheduler demo. |
| **BullMQ Pro** | Not used | Per-group rate limiting was removed from open-source BullMQ in v3. A custom Redis `INCR` achieves the same guarantee without a paid plan. |
| **Job ID = EmailMessage ID** | Deliberate | Makes `queue.add` idempotent (safe no-op if job exists) and ties every queued job directly to its DB row — no separate ID mapping needed. |
| **Worker as a separate process** | Deliberate | The worker can be killed/restarted independently of the API. This makes restart-survival testing trivial: `Ctrl+C` the worker, restart it, observe reconciliation. |
| **Sender model separate from User** | Deliberate | Cold-email tools distinguish "who is logged in" from "which mailbox sends." Multiple senders per user is a natural extension. |
| **`computeSchedule` is pure** | Deliberate | A pure function is trivially unit-tested and has no side effects — scheduling logic bugs are caught before they ever reach the queue. |
| **No cron** | Deliberate | BullMQ delayed jobs replace cron entirely. A job delayed by 24 hours survives a Redis restart (AOF) without any scheduler process staying alive. |
| **Compose as a page, not a modal** | Deliberate | The back-arrow in the design implies page navigation, not a modal close. |
