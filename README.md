# ReachInbox Email Scheduler

A persistent, restart-safe email scheduler with per-sender rate limiting, built on BullMQ + Redis + PostgreSQL. Ships with a Next.js dashboard that matches the provided Figma designs.

---

## Architecture Overview

```
┌──────────────────┐        REST + session cookie
│  Next.js 14       │ ─────────────────────────────►  Express API  (port 4000)
│  (port 3000)      │ ◄─────────────────────────────  ├── /auth/google*
│  Tailwind + TS    │                                  ├── /api/me
└──────────────────┘                                  ├── /api/senders
                                                      ├── /api/config/defaults
                                                      ├── /api/leads/parse
                                                      ├── /api/campaigns
                                                      └── /api/emails/{scheduled,sent,counts}
                                                              │
                                              ┌───────────────┼──────────────────┐
                                              ▼               ▼                  ▼
                                         PostgreSQL        Redis            BullMQ Worker
                                         (Prisma ORM)   (queue + RL)    (separate process)
                                                                        reconcile → process → Nodemailer → Ethereal SMTP
```

The API and worker run as **separate processes** — `npm run dev` for the API, `npm run worker` for the worker. This is intentional: the worker can be killed and restarted independently, which is exactly how the restart-survival requirement is tested.

### Email status lifecycle

```
PENDING → PROCESSING → SENT
                      → FAILED  (retries exhausted)
PENDING → PENDING     (hourly cap hit → re-delayed to next window)
PENDING → CANCELLED   (user cancels via UI)
```

---

## Rate-Limiting Design

Two layers work in concert, matching the two different throttling concerns:

### Layer 1 — Global queue throughput (`MIN_DELAY_BETWEEN_EMAILS_MS`)

BullMQ's built-in `limiter: { max, duration }` is applied to the **whole worker**, capping how fast jobs are dequeued regardless of how many concurrent workers are running. This is the right tool because BullMQ's limiter is enforced centrally in Redis — even with `WORKER_CONCURRENCY=10` and multiple worker processes, the queue-level cap holds.

**Chosen delay:** `MIN_DELAY_BETWEEN_EMAILS_MS=2000` (2 seconds between sends) — this mimics a real provider's per-second throttle without burning through Ethereal test quota. The value is intentionally short for local development; a production deployment would use something like 5–10 seconds.

### Layer 2 — Per-sender hourly cap (`MAX_EMAILS_PER_HOUR_PER_SENDER`)

BullMQ's open-source per-group rate limiting was removed in v3.0 (it's a paid BullMQ Pro feature). Instead, a custom Redis counter is used: for each sender + clock-hour bucket, the worker atomically `INCR`s a key before sending. If the post-increment count exceeds the cap, the slot is released (`DECR`) and the job is re-delayed to the next hour boundary with `job.moveToDelayed(nextHourBoundary, token)` + `throw new DelayedError()`.

This is **race-safe across multiple worker processes**: `INCR` is atomic in Redis, so even with `WORKER_CONCURRENCY=10` spread across multiple machines, no two workers can claim the same slot simultaneously.

### Idempotency — three layers

1. **`jobId = EmailMessage.id`**: BullMQ dedupes `add()` calls for an existing job ID — re-adding during reconciliation is a safe no-op.
2. **`moveToDelayed` (not a new job)**: When the hourly cap is hit, the *same* job is re-delayed (not replaced), so there's never a duplicate job ID.
3. **DB status guard**: `UPDATE email_messages SET status='PROCESSING' WHERE id=? AND status='PENDING'` immediately before the SMTP call. BullMQ can hand a stalled job to a second worker — this guarded update is the only thing preventing a double send, because Nodemailer/SMTP has no dedupe of its own.

### Trade-offs

| Concern | Approach | Trade-off |
|---|---|---|
| Per-sender cap | Custom Redis INCR per clock-hour bucket | Simpler than BullMQ Pro groups; bucket boundary creates a minor burst at the hour mark |
| Clock-hour vs. rolling window | Fixed clock-hour (e.g. `2026-08-04T14:00Z`) | Matches the spec's suggested key shape; rolling 60-minute windows would be more accurate but harder to reason about |
| Rate counter TTL | `EXPIRE key 7200` (safety only) | Counter naturally expires when the next hour starts; the 2-hour TTL is a safeguard against a crash leaving stale counters |

---

## Setup

### Prerequisites

- Docker Desktop (for Postgres + Redis)
- Node.js 20+
- A Google Cloud Console project with an OAuth 2.0 client

### 1. Clone & install

```bash
git clone <repo>
cd ReachInbox
npm install --prefix backend
npm install --prefix frontend
```

### 2. Start infrastructure

```bash
docker compose up -d
# Postgres on :5432, Redis on :6379 (AOF persistence enabled)
```

### 3. Google OAuth credentials

1. Go to [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)
2. Create an OAuth 2.0 Client ID (Web application)
3. Add `http://localhost:4000/auth/google/callback` to **Authorized redirect URIs**
4. Copy the Client ID and Client Secret

### 4. Backend environment

```bash
cp backend/.env.example backend/.env
# Fill in GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
# SESSION_SECRET should be a random string in production
```

Key variables (see `.env.example` for the full list):

| Variable | Default | Description |
|---|---|---|
| `GOOGLE_CLIENT_ID` | — | Required for OAuth |
| `GOOGLE_CLIENT_SECRET` | — | Required for OAuth |
| `WORKER_CONCURRENCY` | `5` | Parallel job processor slots |
| `MIN_DELAY_BETWEEN_EMAILS_MS` | `2000` | Queue-level throttle (ms between sends) |
| `RATE_LIMIT_MODE` | `per_sender` | `global` or `per_sender` |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | `50` | Hourly cap per sender |
| `ETHEREAL_AUTO_CREATE` | `true` | Auto-generate Ethereal SMTP test accounts on seed |

### 5. Run migrations & seed

```bash
cd backend
npx prisma migrate dev   # creates schema in Postgres
npm run seed             # creates dev user + 3 Ethereal senders
```

### 6. Start the API

```bash
# From /backend
npm run dev
# → [server] API listening on http://localhost:4000
```

### 7. Start the worker

```bash
# From /backend (separate terminal)
npm run worker
# → [worker] reconciliation complete, starting queue worker...
```

### 8. Start the frontend

```bash
# From /frontend
npm run dev
# → Ready at http://localhost:3000
```

Open http://localhost:3000 → click **Sign in with Google** → land on the dashboard.

---

## Running Tests

```bash
cd backend
npm test                  # 8 unit tests for computeSchedule
npm run simulate-burst    # enqueue 1,000 synthetic jobs, print per-hour distribution
```

The burst simulation uses a no-op sender stub so it doesn't create real Ethereal traffic. The output should show 5 windows × 200 emails (matching the worked example in Section 6.2 of `implementation.md`).

---

## Restart Survival Test (Stage 7 Runbook)

### Scenario A — Worker process killed mid-batch

```bash
# Schedule 10 emails 1 minute from now
npm run test-reconcile   # creates 10 PENDING messages via the API

# Kill the worker
# (Ctrl+C in the worker terminal, or kill -9 the PID)

# Restart the worker
npm run worker
# → [worker] reconciliation: reenqueued=10 ...
# All 10 emails will still fire at their original scheduledAt
```

### Scenario B — Redis flushed (worst case)

```bash
# With PENDING messages in the DB and jobs missing from Redis:
redis-cli FLUSHALL

# Restart the worker
npm run worker
# → [worker] reconciliation: reenqueued=N ...
# All PENDING rows are re-enqueued; no messages lost or duplicated
```

The reconciliation is idempotent: if the job already exists in Redis, `queue.add({ jobId: message.id })` is a safe no-op (BullMQ dedupes by job ID).

---

## Free Hosting / Deployment

The repo ships with everything needed to run the full stack on a single free
Docker host behind Caddy (automatic HTTPS). The recommended target is an
**Oracle Cloud Always Free** `VM.Standard.A1.Flex` (2 OCPU / 12 GB RAM) running
Docker, which keeps the BullMQ worker alive 24/7 so scheduled emails fire on
time. Signup requires a card for identity verification only; Always Free usage
is never billed.

### What you get

```
Internet ──<443>── caddy (HTTPS, auto Let's Encrypt)
                         │  -> web (Next.js standalone, :3000)
                         │        rewrites /api & /auth -> api:4000
                         └─ compose network
                              ├─ db-migrate (one-shot: `prisma migrate deploy`)
                              ├─ api   (Express, :4000)
                              ├─ worker(BullMQ, separate process)
                              ├─ postgres (16, AOF via pgdata volume)
                              └─ redis    (7, AOF)
```

Only Caddy publishes ports to the internet; the app services stay internal to
the compose network. Because the frontend proxies the backend server-side, the
browser only ever talks to the frontend origin, so session cookies stay
first-party with no CORS setup.

### Files added

| File | Purpose |
|---|---|
| `backend/Dockerfile` | Multi-stage build (prisma generate → tsc → slim runtime) |
| `frontend/Dockerfile` | Next.js `standalone` build (copies `.next/static`) |
| `Caddyfile` | HTTPS reverse proxy; site name from the `DOMAIN` env var |
| `docker-compose.yml` | Adds `db-migrate`, `api`, `worker`, `web`, `caddy` alongside Postgres + Redis |
| `.env.example` | Production env template (copied to `.env`) |
| `frontend/next.config.mjs` | Backend proxy target is now `BACKEND_URL`-driven + `output: "standalone"` |

### Deploy steps

```bash
# 1. Provision an Always Free VM (home region), open TCP 22/80/443, SSH in.

# 2. Add https://<DOMAIN>/auth/google/callback to your Google Console
#    Authorized redirect URIs.

# 3. On the VM, install Docker + compose plugin, then:
git clone <your-repo> ReachInbox && cd ReachInbox
cp .env.example .env
#   edit .env: set DOMAIN, GOOGLE_CLIENT_ID/SECRET, SESSION_SECRET

# 4. Build and start everything
docker compose up -d --build

# 5. One-time seed (dev user + Ethereal senders; idempotent)
docker compose run --rm api npm run seed

# 6. Open https://<DOMAIN>, sign in with Google, compose & schedule an email.
```

Migrations run automatically via the `db-migrate` one-shot service. On restart,
the worker re-runs `reconcilePendingMessages()` so no scheduled email is lost
even if Redis was flushed.

**Free-tier realities (2026):** always-on worker requires a persistent host
(Oracle Always Free / a free VM). PaaS free tiers (Render, Koyeb) scale to zero
on idle and would delay scheduled emails until woken; they're only suited to a
catch-up demo. Emails use Ethereal (a fake SMTP sink), so no real provider is
needed and nothing to pay for.

---

## Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Database | PostgreSQL | Row-locking / `UPDATE WHERE status='PENDING'` idempotency guard; Prisma for type-safe queries |
| Queue | BullMQ (no cron anywhere) | Delayed jobs satisfy "schedule to a specific time" without cron; Redis AOF covers restart survival |
| Auth | Google OAuth + Redis-backed sessions | Per spec; session cookie (not JWT) avoids XSS token theft |
| Email/password fields | Disabled in UI | Real password auth isn't in the text spec; honestly-disabled > half-built |
| Compose route | Dedicated `/dashboard/compose` page | Figma shows a back-arrow (page nav), not a modal close X |
| Sender model | Separate from User | Cold-email tools separate "who's logged in" from "which mailbox sends" |

---

## Known Limitations

- **Ethereal is a fake SMTP sink** — sent emails are viewable at the preview URL logged by the worker (`preview: https://ethereal.email/...`), but they never reach a real inbox.
- **Local-only** — no cloud deployment, CI/CD, or infra-as-code in scope.
- **Clock-hour rate limit buckets** — a campaign that finishes at 14:59 and another starts at 15:00 share a fresh bucket at 15:00, creating a brief burst window. A rolling-window counter would be more precise but harder to reason about.
- **Google OAuth only** — the email/password form is rendered for visual fidelity but is intentionally disabled.

---

## Project Structure

```
ReachInbox/
├── backend/
│   ├── src/
│   │   ├── index.ts          API entry point
│   │   ├── worker.ts         Worker process entry point
│   │   ├── auth.ts           Passport + session setup
│   │   ├── config.ts         Env var parsing
│   │   ├── routes/           Express routers (auth, me, senders, campaigns, emails, …)
│   │   ├── services/
│   │   │   ├── queue.ts          BullMQ queue + worker factory
│   │   │   ├── processor.ts      Rate-limited, idempotent job processor
│   │   │   ├── rateLimiter.service.ts  Redis INCR per-hour-window
│   │   │   ├── reconcile.ts      Boot-time reconciliation
│   │   │   ├── scheduler.service.ts   computeSchedule → createMany → addBulk
│   │   │   └── email.service.ts  Nodemailer + Ethereal transport
│   │   └── lib/
│   │       ├── computeSchedule.ts  Pure scheduling algorithm (fully unit-tested)
│   │       ├── parseLeads.ts       CSV / plain-text lead parser
│   │       └── configDefaults.ts   System default/min/max for compose form
│   ├── prisma/
│   │   ├── schema.prisma     User, Sender, Campaign, EmailMessage models
│   │   └── seed.ts           Dev user + 3 Ethereal senders
│   ├── tests/
│   │   └── computeSchedule.test.ts   8 unit tests (Vitest)
│   └── scripts/              Manual verification scripts (burst, rate-limit, reconcile)
├── frontend/
│   ├── app/
│   │   ├── login/            Login page (Google OAuth + disabled email/password)
│   │   └── dashboard/
│   │       ├── scheduled/    Scheduled emails list
│   │       ├── sent/         Sent/failed emails list
│   │       └── compose/      Compose new campaign
│   ├── components/
│   │   ├── layout/           Sidebar, UserMenu
│   │   ├── compose/          ComposeForm, RecipientChips, CsvUploader, RichTextEditor, SendLaterPopover
│   │   ├── emails/           EmailListView, EmailRow, StatusBadge
│   │   └── ui/               Button, Input, Avatar, Badge
│   └── lib/
│       ├── apiClient.ts      Typed fetch wrapper + ApiError
│       ├── types.ts          Shared TypeScript interfaces
│       ├── format.ts         Date formatting helpers
│       └── hooks/            useAuth, useEmails, useCounts, useApi
└── docker-compose.yml        Postgres 16 + Redis 7 (AOF enabled)
```
