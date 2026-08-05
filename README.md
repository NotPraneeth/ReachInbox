# ReachInbox — Email Scheduler

A persistent, restart-safe email scheduler with per-sender rate limiting, built on **BullMQ + Redis + PostgreSQL + Next.js**.

🌐 **Live demo:** [https://reachinbox.duckdns.org](https://reachinbox.duckdns.org)

---

## Features Implemented

### Backend

| Feature | Component | Details |
|---|---|---|
| **Scheduler** | `services/scheduler.service.ts`, `lib/computeSchedule.ts` | On campaign submit, `computeSchedule()` distributes all recipients across time slots (respecting delay + hourly limit), bulk-inserts all `EmailMessage` rows in one DB round-trip, and bulk-enqueues all BullMQ delayed jobs at once. |
| **Persistence on restart** | `services/reconcile.ts`, `worker.ts` | On every worker boot, `reconcilePendingMessages()` re-enqueues any `PENDING` rows missing from Redis and resets stuck `PROCESSING` rows. No scheduled email is ever lost, even after a full Redis flush. |
| **Rate limiting** | `services/rateLimiter.service.ts`, `services/queue.ts` | Two-layer: a BullMQ `limiter` caps global queue throughput (ms between sends), and a per-sender Redis `INCR` counter enforces an hourly cap. When the cap is hit, the same job is re-delayed to the next clock-hour window via `job.moveToDelayed()`. |
| **Concurrency & idempotency** | `services/processor.ts` | `WORKER_CONCURRENCY` (default 5) controls parallel job slots. A DB `UPDATE WHERE status='PENDING'` guard immediately before each SMTP call ensures that even if BullMQ hands a stalled job to two workers, only one sends. |
| **Google OAuth + sessions** | `auth.ts`, `routes/auth.ts` | Passport.js + Redis-backed sessions (`connect-redis`). New users get two Ethereal test senders auto-provisioned on first login. |
| **CSV / plain-text lead parsing** | `lib/parseLeads.ts`, `routes/leads.ts` | Upload `.csv` or `.txt` to extract and validate recipient emails; invalid rows are counted and reported. |
| **Email cancellation** | `routes/emails.ts` | `DELETE /api/emails/:id` removes the BullMQ job and marks the DB row `CANCELLED`. Only `PENDING` rows can be cancelled. |
| **Ethereal preview links** | `services/email.service.ts`, `services/processor.ts` | `nodemailer.getTestMessageUrl()` is stored in the `EmailMessage` row and returned by the API so the frontend can link directly to the Ethereal preview. |

### Frontend

| Feature | Component | Details |
|---|---|---|
| **Login page** | `app/login/page.tsx`, `components/auth/GoogleSignIn.tsx` | Google Sign-In button. Email/password fields are rendered for visual fidelity but intentionally disabled. |
| **Dashboard layout** | `app/dashboard/layout.tsx`, `components/layout/Sidebar.tsx` | Sidebar navigation with live badge counts for scheduled and sent emails, user avatar, and sign-out. |
| **Compose** | `app/dashboard/compose/page.tsx`, `components/compose/` | Rich text editor (Tiptap), recipient chips (paste/type), CSV/TXT uploader, sender dropdown, per-sender delay and hourly-limit inputs, and a "Send Later" date-time popover. |
| **Scheduled table** | `app/dashboard/scheduled/page.tsx`, `components/emails/EmailListView.tsx` | Paginated, searchable list of `PENDING`/`PROCESSING` emails. Each row has a cancel button that removes the job and refreshes the list. |
| **Sent table** | `app/dashboard/sent/page.tsx`, `components/emails/EmailRow.tsx` | Paginated, searchable list of `SENT`/`FAILED` emails. `SENT` rows show an ↗ icon that opens the Ethereal preview in a new tab. |
| **Status badges** | `components/emails/StatusBadge.tsx` | Colour-coded `PENDING`, `PROCESSING`, `SENT`, `FAILED`, `CANCELLED` badges. |
| **API client** | `lib/apiClient.ts` | Typed fetch wrapper with `ApiError` for structured error handling; all requests use `credentials: "include"` for cookie auth. |

---

## Architecture Overview

```mermaid
flowchart LR
    subgraph Client
        FE["Next.js Dashboard\n(React + Tailwind + TS)"]
    end

    subgraph API["Express API"]
        AUTHR["/auth/google*"]
        CAMPR["/api/campaigns\n/api/emails/*"]
        SCHED["Scheduler Service\n(batch precompute)"]
    end

    subgraph Data
        PG[("PostgreSQL\nsource of truth")]
        REDIS[("Redis\nqueue + rate counters")]
    end

    subgraph WorkerProc["Worker process (separate from API)"]
        BULLW["BullMQ Worker\n(concurrency + limiter)"]
        RL["Rate Limiter Service\n(Redis INCR per hour-window)"]
        MAILER["Nodemailer"]
        RECON["Startup Reconciliation\n(runs once on boot)"]
    end

    ETHEREAL[["Ethereal SMTP\n(fake, for testing)"]]
    GOOGLE[["Google OAuth"]]

    FE -- "REST + session cookie" --> AUTHR
    FE -- "REST + session cookie" --> CAMPR
    AUTHR --> GOOGLE
    CAMPR --> SCHED
    SCHED -- "createMany" --> PG
    SCHED -- "addBulk (delayed jobs)" --> REDIS
    REDIS --> BULLW
    BULLW <--> RL
    RL <--> REDIS
    BULLW -- "status transitions" --> PG
    BULLW --> MAILER --> ETHEREAL
    RECON -- "reconcile vs DB" --> PG
    RECON --> REDIS
```

The **API** and **Worker** run as separate processes. This is intentional — the worker can be killed and restarted without affecting the API, and reconciliation fires on every worker boot.

### Email status lifecycle

```mermaid
stateDiagram-v2
    [*] --> PENDING: campaign created (scheduledAt precomputed)
    PENDING --> PROCESSING: worker claims job, passes rate check
    PROCESSING --> SENT: SMTP accepted
    PROCESSING --> FAILED: SMTP error, retries exhausted
    PENDING --> PENDING: hourly cap hit → moveToDelayed to next window
    PENDING --> CANCELLED: user cancels via UI
    SENT --> [*]
    FAILED --> [*]
    CANCELLED --> [*]
```

---

## How Scheduling Works

### Batch precomputation (on campaign submit)

When you submit the compose form, `POST /api/campaigns` calls `createScheduledCampaign()`:

1. **`computeSchedule()`** distributes recipients across time slots, respecting `delayBetweenEmailsSec` and `hourlyLimit`. Overflow past the hourly cap spills into the next hour window automatically.
2. A single `Campaign` row is created, then all `EmailMessage` rows are **bulk-inserted** in one DB round-trip.
3. All jobs are **bulk-enqueued** to BullMQ with `delay = scheduledAt - now` and `jobId = EmailMessage.id`.

```
computeSchedule(recipients, startTime, delaySec, hourlyLimit):
    bucketCounts = {}
    cursor = startTime
    for recipient in recipients:
        candidate = max(cursor, startTime)
        bucket = floorToHour(candidate)
        while bucketCounts[bucket] >= hourlyLimit:
            bucket = bucket + 1 hour       # spill into next window
            candidate = bucket.start
        bucketCounts[bucket] += 1
        emit { recipient, scheduledAt: candidate }
        cursor = candidate + delaySec
```

**Example:** 1,000 recipients, `delaySec=2`, `hourlyLimit=200` → first 200 land ~2 s apart inside hour-window 1, recipient #201 rolls to hour-window 2, and so on. Fully drained in 5 windows.

### Authoritative rate check at send time (in the worker)

The precomputed `scheduledAt` is a plan, not a guarantee — multiple campaigns can share a sender in the same window. The worker re-checks atomically before every send:

```
processor(job, token):
    message = db.find(job.data.messageId)
    if message.status != PENDING: return           # idempotency guard #1

    count = redis.incr("rl:hour:<window>:<senderId>")
    if count == 1: redis.expire(key, 7200)         # safety TTL

    if count > hourlyLimit:
        redis.decr(key)                            # release the slot
        db.update(message.id, { scheduledAt: nextHourBoundary })
        job.moveToDelayed(nextHourBoundary, token) # re-delay the SAME job
        throw DelayedError()                       # BullMQ won't complete/fail it

    claimed = db.updateMany({                      # idempotency guard #2
        where: { id: message.id, status: 'PENDING' },
        data:  { status: 'PROCESSING' }
    })
    if claimed.count == 0: return                  # another worker beat us

    result = sendViaNodemailer(message)
    db.update(message.id, { status: 'SENT', testMessageUrl: result.url })
```

`redis.incr` is atomic — race-safe across all concurrent worker processes. The DB `UPDATE WHERE status='PENDING'` guard is the final backstop against double-sends.

### Persistence on restart

On every worker boot, `reconcilePendingMessages()` runs **once**:

```
on worker startup:
    for m in db.findMany({ status: 'PENDING' }):
        if queue.getJob(m.id) is null:             # Redis lost the job
            queue.add({ jobId: m.id, delay: max(0, m.scheduledAt - now) })
                                                   # safe no-op if job exists (deduped by jobId)

    for m in db.findMany({ status: 'PROCESSING', updatedAt < now - 5min }):
        if m.attemptCount < MAX_RECONCILE_ATTEMPTS:
            db.update(m.id, { status: 'PENDING', attemptCount: +1 })
            queue.add({ jobId: m.id, delay: 0 })
        else:
            db.update(m.id, { status: 'FAILED', failReason: 'stuck after restart' })
```

### Rate limiting & concurrency

**Layer 1 — Global throughput:** BullMQ `Worker` `limiter: { max, duration }` is set from `MIN_DELAY_BETWEEN_EMAILS_MS`. Enforced centrally in Redis — holds across any number of concurrent worker processes.

**Layer 2 — Per-sender hourly cap:** Redis key `rl:hour:<windowStart>:<senderId>` is atomically `INCR`'d before each send. Over-cap jobs are re-delayed to the next clock-hour window via `job.moveToDelayed()` (same job, no duplicate ID).

| Concern | Mechanism | Trade-off |
|---|---|---|
| Global throughput | BullMQ `limiter` | Enforced in Redis — holds across processes/machines |
| Per-sender hourly cap | Custom Redis `INCR` | BullMQ Pro's per-group rate limiting was removed from open-source BullMQ v3; custom INCR is free and race-safe |
| Clock-hour vs. rolling window | Fixed clock-hour bucket | Simpler to reason about; minor burst possible at the hour boundary |

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
