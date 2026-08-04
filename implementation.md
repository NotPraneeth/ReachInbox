# ReachInbox Email Scheduler — Implementation Plan

## Table of Contents
1. [Purpose & How to Read This Document](#1-purpose--how-to-read-this-document)
2. [Assumptions, Interpretations & Open Questions](#2-assumptions-interpretations--open-questions)
3. [High-Level Architecture](#3-high-level-architecture)
4. [Tech Stack](#4-tech-stack)
5. [Data Model](#5-data-model)
6. [Scheduling & Rate-Limiting Design](#6-scheduling--rate-limiting-design)
7. [API Contract](#7-api-contract)
8. [Frontend Architecture](#8-frontend-architecture)
9. [Environment Variables](#9-environment-variables)
10. [Implementation Stages](#10-implementation-stages)
11. [Out of Scope / Non-Goals](#11-out-of-scope--non-goals)
12. [Appendix A — Requirements Traceability Matrix](#12-appendix-a--requirements-traceability-matrix)

---

## 1. Purpose & How to Read This Document

This is the implementation plan for the ReachInbox take-home: a persistent, restart-safe email scheduler (BullMQ + Redis, no cron) with throughput/rate-limiting controls, plus a dashboard matching the provided Figma screenshots. It contains no code. Its job is to (a) resolve the ambiguities in the brief before anything gets built, (b) lock in the architecture for the hardest part of the assignment — the scheduling and rate-limiting engine — and (c) break the build into ordered stages, each with a done-when and an explicit re-check against the original requirements.

Read Section 2 first. Several downstream decisions (schema shape, API surface, stage ordering) depend on the interpretations made there. If any of them don't match intent, the rest of the plan should be revisited before implementation starts.

---

## 2. Assumptions, Interpretations & Open Questions

The brief is thorough but leaves some product/UX calls open, and the Figma screenshots occasionally diverge from the written spec. Each ambiguity below states the decision this plan proceeds with and why — flag any row and the plan adjusts.

| # | Topic | What's ambiguous | Decision taken | Why |
|---|---|---|---|---|
| 1 | Project framing | No deployment target, timeline, or grading context given | Local-first, Docker-composed dev project. No cloud deploy, CI/CD, or infra-as-code in scope | Matches "Redis and DB can be run via Docker" and the take-home tone; keeps effort on the parts actually being evaluated |
| 2 | Database | Spec allows MySQL **or** PostgreSQL | PostgreSQL | Fits well with the row-locking/update-guard pattern used in the idempotency logic (Section 6.4); either engine would work |
| 3 | ORM | Not specified | Prisma | Type-safe queries, matches "TypeScript strongly preferred"; plain `pg`/Knex would also work |
| 4 | "Multiple senders" | Backend section requires per-sender rate limits and says "you will have to support multiple senders," but never defines what a sender *is* | Modeled as a first-class `Sender` entity (display name + email + Ethereal SMTP credentials), independent of the logged-in Google user. Google login identifies the *operator*; `Sender` is the "From" identity used for sending — matching the compose screen's **From** dropdown | Cold-email tools (which is what ReachInbox is) separate "who's logged in" from "which mailbox is sending," usually to spread volume across inboxes |
| 5 | Per-batch delay/hourly-limit fields vs. env config | Backend section requires these be configurable via env, not hardcoded; the compose screen (Images 5-7) has **per-request** "Delay between 2 emails" / "Hourly Limit" inputs | Env vars define system defaults *and* hard ceilings/floors. The compose form pre-fills from those defaults and lets the user override *within* bounds per batch; out-of-bounds values are rejected | Satisfies both "configurable via env" (operator control) and the Figma's per-send inputs (end-user control), without letting a request bypass system-level throttling |
| 6 | Login screen's email/password fields | Figma (Image 1) shows Email ID/Password inputs and a Login button; the written spec only requires Google OAuth ("no mock") | Rendered for visual fidelity, left disabled (Google sign-in only) | Real password auth (hashing, reset flows) isn't requested anywhere in the text spec; a half-built second auth system would be worse than an honestly-disabled one |
| 7 | Header placement | Text spec: "Show in the **top header**: name, email, avatar... provide a logout option." Figma: this lives in the **left sidebar**, with no visible logout button — just a chevron next to the name | Follow the Figma (sidebar, not a separate top bar); logout sits behind a small menu on that chevron | Figma is the pixel source of truth per "match the Figma as closely as possible"; the text requirement is functionally satisfied regardless of which container holds it |
| 8 | Image 4 (opened email thread, promotional content, addressed *to* Oliver rather than *from* him) | Doesn't match "Scheduled" or "Sent" (both are Oliver's outgoing mail); no inbox/received-mail or single-email-detail feature appears anywhere in the text spec | Out of scope for this build. Full HTML body is stored per message regardless, so a row-click detail view is a cheap add later if it turns out to be wanted | Nothing in the written requirements supports a received-mail feature; guessing it in adds scope not asked for anywhere else in the brief |
| 9 | Search / filter / refresh icons in the sidebar | Visible in Figma, not mentioned in text requirements | Built as light P2 polish (Stage 13), sequenced after the four required screens are solid | Keeps effort weighted toward what's explicitly graded (the scheduling engine, the required screens, rate limiting) |
| 10 | Attachment icon / image thumbnail in compose | Visible in Figma (Images 6-7); text spec's compose requirements list only Subject, Body, and lead upload | Stretch goal (Stage 16) | Ethereal is a fake SMTP sink for testing; attachment storage/encoding is real complexity for a feature the text spec never asks for |
| 11 | Lead file format | "Upload a CSV/text file of email leads" — exact format unspecified | Accept `.csv` (looks for a column named `email`/`Email Address`, case-insensitive, falling back to scanning all cells for email-shaped strings) and `.txt` (newline/comma/semicolon separated). Dedupe case-insensitively; report an invalid-line count alongside the valid count | Covers the realistic range of "a list exported from a spreadsheet or pasted from somewhere" |
| 12 | Rate-limit "hour window" | Spec's own hint: counters keyed by `hour_window` + sender | Fixed clock-hour buckets (e.g. `2026-08-04T14:00Z`), not a rolling 60-minute window | Directly matches the spec's own suggested key shape; simpler to reason about and test |
| 13 | Compose UI: modal vs. page | Spec allows either; Figma shows a back-**arrow** top-left, a page-navigation affordance, not a modal-close "X" | Dedicated route (`/dashboard/compose`), not a modal | Matches the back-arrow; also gives a shareable URL and natural browser-back behavior |
| 14 | Data scoping | Not stated whether Scheduled/Sent lists are global or per logged-in user | Scoped by authenticated `userId` | One FK, trivial to add; more production-grade default, easy to relax later if the intent was actually a shared view |
| 15 | Cancel/delete a scheduled email | Not in the written spec | Small stretch feature (Stage 16) — the data model supports it for free | High UX value, low cost, but not required, so sequenced after everything that is |

None of these block the plan below — it proceeds on the decisions above. Flagging any single row is enough to redirect that one piece without touching the rest.

---

## 3. High-Level Architecture

```mermaid
flowchart LR
    subgraph Client
        FE["Next.js Dashboard<br/>(React + Tailwind + TS)"]
    end

    subgraph API["Express API"]
        AUTHR["/auth/google*"]
        CAMPR["/api/campaigns<br/>/api/emails/*"]
        SCHED["Scheduler Service<br/>(batch precompute)"]
    end

    subgraph Data
        PG[("PostgreSQL<br/>source of truth")]
        REDIS[("Redis<br/>queue + rate counters")]
    end

    subgraph WorkerProc["Worker process (separate from API)"]
        BULLW["BullMQ Worker<br/>(concurrency + limiter)"]
        RL["Rate Limiter Service<br/>(Redis INCR per hour-window)"]
        MAILER["Nodemailer"]
        RECON["Startup Reconciliation<br/>(runs once on boot)"]
    end

    ETHEREAL[["Ethereal SMTP<br/>(fake, for testing)"]]
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

The API and the worker are **separate processes** sharing the same Postgres/Redis backends. The API turns a compose request into DB rows + queued jobs; the worker consumes the queue, enforces rate limits, sends mail, and runs reconciliation on its own boot. Running them separately means the worker can be killed and restarted independently of the API — which is exactly the scenario the "survives server restarts" requirement is testing.

**Status lifecycle for a single email:**

```mermaid
stateDiagram-v2
    [*] --> PENDING: campaign created (scheduledAt precomputed)
    PENDING --> PROCESSING: worker claims job, passes rate check
    PROCESSING --> SENT: SMTP accepted
    PROCESSING --> FAILED: SMTP error, retries exhausted
    PENDING --> PENDING: hourly cap hit -> moveToDelayed to next window
    PENDING --> CANCELLED: user cancels (stretch, Stage 16)
    SENT --> [*]
    FAILED --> [*]
    CANCELLED --> [*]
```

---

## 4. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Backend language/framework | TypeScript + Express | Per spec |
| Queue | BullMQ on Redis | Per spec — delayed jobs only, no cron anywhere in the codebase |
| Database | PostgreSQL | See Assumption #2 |
| ORM | Prisma | Migrations + typed client |
| Auth | Passport.js (`passport-google-oauth20`) or `google-auth-library` directly, plus `express-session` backed by Redis (`connect-redis`) | Session cookie, not JWT-in-localStorage — avoids XSS token theft |
| Mail | Nodemailer + Ethereal test accounts | Per spec |
| Validation | Zod | Request body/query validation |
| CSV/text parsing | `papaparse` (CSV) + a small regex line-parser (plain text) | |
| Frontend framework | Next.js (App Router) + TypeScript | Per spec |
| Styling | Tailwind CSS | Per spec |
| Rich text editor | TipTap | The Figma toolbar (bold/italic/underline/align/lists/indent/blockquote/strikethrough) maps directly onto TipTap StarterKit + a couple of extensions |
| Icons | `lucide-react` | Closest match to the thin line-icon style in the Figma |
| Toasts | `sonner` or `react-hot-toast` | For the required error/success messaging |
| Infra | Docker Compose (Postgres + Redis, Redis with AOF persistence enabled) | Recommended in spec |

Repo layout is two plain folders (`/backend`, `/frontend`), not a monorepo with shared-package tooling — the API surface is small enough that duplicating a `types.ts` on each side costs less than the tooling overhead of a shared workspace package.

---

## 5. Data Model

```prisma
model User {
  id         String     @id @default(uuid())
  googleId   String     @unique
  email      String     @unique
  name       String
  avatarUrl  String?
  createdAt  DateTime   @default(now())
  senders    Sender[]
  campaigns  Campaign[]
}

model Sender {
  id          String         @id @default(uuid())
  userId      String
  user        User           @relation(fields: [userId], references: [id])
  displayName String
  email       String
  smtpHost    String         @default("smtp.ethereal.email")
  smtpPort    Int            @default(587)
  smtpUser    String
  smtpPass    String
  createdAt   DateTime       @default(now())
  messages    EmailMessage[]

  @@index([userId])
}

model Campaign {
  id                    String         @id @default(uuid())
  userId                String
  user                  User           @relation(fields: [userId], references: [id])
  senderId              String
  subject               String
  bodyHtml              String         @db.Text
  startTime             DateTime
  delayBetweenEmailsSec Int
  hourlyLimit           Int
  totalRecipients       Int
  createdAt             DateTime       @default(now())
  messages              EmailMessage[]
}

enum MessageStatus {
  PENDING
  PROCESSING
  SENT
  FAILED
  CANCELLED
}

model EmailMessage {
  id             String        @id @default(uuid())
  campaignId     String
  campaign       Campaign      @relation(fields: [campaignId], references: [id])
  senderId       String
  sender         Sender        @relation(fields: [senderId], references: [id])
  recipientEmail String
  status         MessageStatus @default(PENDING)
  scheduledAt    DateTime
  sentAt         DateTime?
  failReason     String?
  attemptCount   Int           @default(0)
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  @@index([status, scheduledAt])
  @@index([senderId, scheduledAt])
  @@index([campaignId])
}
```

`EmailMessage` is the single source of truth the frontend reads from — one row per recipient, whether it came from a one-off send or a 1,000-row CSV upload. A few deliberate choices:

- **`subject`/`bodyHtml` live once, on `Campaign`**, not duplicated across every recipient row (all recipients in a batch share the same content). List queries include the campaign relation to display them.
- **`senderId` is denormalized onto `EmailMessage`** even though it's derivable via `campaign.senderId` — the rate limiter (Section 6.3) queries by sender on every single send, so a direct index here avoids a join on the busiest code path in the system.
- **No separate `bullJobId` column.** The BullMQ job ID is always the same UUID as `EmailMessage.id` — that equality is what the idempotency guarantee in Section 6.4 rests on, and it means one less field to keep in sync.

---

## 6. Scheduling & Rate-Limiting Design

This is the part of the assignment doing the actual grading-relevant work, so it gets its own section rather than living only inside a stage checklist. Stages 5–7 in Section 10 implement what's designed here.

### 6.1 Two enforcement layers, on purpose

| Requirement | Mechanism | Why this one |
|---|---|---|
| Minimum delay between sends | BullMQ's built-in `limiter: { max, duration }` on the **Worker** | This limiter is global to the queue by design — even with 10 concurrent workers, a `{max:10, duration:1000}` limiter still caps the *queue* at 10/sec combined. That's exactly the "mimic provider throttling" behavior asked for, and it's a config object, not custom code |
| Per-sender hourly cap | Custom Redis counters, keyed `rl:hour:<hour-window>[:<senderId>]` | BullMQ's per-group rate limiting (`groupKey`) was **removed from the open-source version in BullMQ 3.0** and is now a paid-tier-only feature (BullMQ Pro's `group` support). Free BullMQ can only rate-limit a whole queue, not "a queue per sender" — so the per-sender cap has to be custom, which is also the only way to get the specific "roll over into the next hour window, preserving order" behavior the spec asks for |

This split — and why — is written up explicitly in the README (Stage 15), since the spec asks for the rate-limiting approach and trade-offs to be documented.

### 6.2 Batch precomputation (runs once, when "Schedule" is clicked)

Every compose submission — 1 recipient or 5,000 — becomes a `Campaign` + N `EmailMessage` rows, each with a **precomputed** `scheduledAt`. This is what makes "1,000+ emails scheduled for the same time" a solved problem rather than something the worker has to figure out reactively.

```
function computeSchedule(recipients, startTime, delaySec, hourlyLimit):
    bucketCounts = {}                 # per-batch only, in memory
    cursor = startTime
    for recipient in recipients:
        candidate = max(cursor, startTime)
        bucket = floorToHour(candidate)
        while bucketCounts[bucket] >= hourlyLimit:
            bucket = bucket + 1 hour
            candidate = bucket.start
        bucketCounts[bucket] += 1
        emit { recipient, scheduledAt: candidate }
        cursor = candidate + delaySec
```

**Worked example** — 1,000 recipients, `startTime = now`, `delaySec = 2`, `hourlyLimit = 200`: the first 200 land ~2s apart inside hour-window 1 (200 × 2s ≈ 6.7 minutes — nowhere near the cap on *time*, but exactly at the cap on *count*), so recipient #201 rolls to the start of hour-window 2 and the 2-second spacing resumes from there. The batch fully drains after 1000 ÷ 200 = 5 hourly windows. This is the concrete scenario Stage 14's load test asserts against.

DB rows are written with `prisma.emailMessage.createMany(...)`, and jobs are queued with `queue.addBulk([...])` — one round trip for the whole batch, each entry carrying `opts: { jobId: message.id, delay: scheduledAt - now }` — rather than a loop of 1,000 sequential `.add()` calls.

### 6.3 Authoritative check at send time

The precomputed `scheduledAt` is a *plan*, not a guarantee — it can't know about other campaigns hitting the same sender in an overlapping window. So the worker re-checks for real, atomically, at the moment it's about to send:

```
async function processor(job, token):
    message = db.emailMessage.findUnique(job.data.messageId)
    if message.status != PENDING:
        return                                   # already handled — idempotency guard

    bucketKey = currentHourWindow()
    redisKey = "rl:hour:" + bucketKey + (perSenderMode ? ":" + message.senderId : "")
    count = redis.incr(redisKey)
    if count == 1: redis.expire(redisKey, 7200)   # safety TTL, not relied on for correctness

    if count > hourlyLimitFor(message.senderId):
        redis.decr(redisKey)                      # release the slot we just took
        nextWindow = nextHourBoundary()
        db.emailMessage.update(message.id, { scheduledAt: nextWindow })
        await job.moveToDelayed(nextWindow, token) # re-delay the SAME job — see 6.4
        throw new DelayedError()                   # required so BullMQ doesn't complete/fail it

    claimed = db.emailMessage.updateMany({
        where: { id: message.id, status: 'PENDING' },   # WHERE guard = the actual idempotency check
        data: { status: 'PROCESSING' }
    })
    if claimed.count == 0: return                 # lost a race to another worker — bail out safely

    try:
        sendViaNodemailer(message)
        db.emailMessage.update(message.id, { status: 'SENT', sentAt: now() })
    catch (err):
        db.emailMessage.update(message.id, { status: 'FAILED', failReason: err.message })
        throw err                                  # BullMQ's own attempts/backoff handles transient SMTP errors
```

`redis.incr` is atomic, so the "reserve a slot, and only proceed if *your own* post-increment count is within the cap" pattern is race-safe even with `WORKER_CONCURRENCY > 1`, and even across multiple worker **processes** — Redis is centralized, so this holds regardless of how many machines are running workers. That's the direct answer to "rate-limiting logic must be safe across multiple workers/instances."

### 6.4 Idempotency — three layers, because a sent email can't be unsent

1. **`jobId = EmailMessage.id`.** BullMQ dedupes `add()` calls for a jobId already present in the queue, so re-adding a job during reconciliation is always safe.
2. **`job.moveToDelayed(timestamp, token)` + `throw new DelayedError()`** on hourly-cap overflow — this re-delays the *same* job instead of creating a second one with a different ID, sidestepping any jobId-collision question entirely. (Requires the processor signature `(job, token) => {...}` to get the lock token BullMQ hands it.)
3. **The DB status guard** (`UPDATE ... WHERE status = 'PENDING'`) immediately before sending. This is the layer that actually matters for correctness: BullMQ can mark a job "stalled" and hand it to a second worker if the first worker's lock isn't renewed in time — a real, documented behavior, not a hypothetical. Nodemailer/SMTP has no dedupe of its own, so this guarded update is the only thing standing between a stalled-job retry and an actual duplicate send.

### 6.5 Restart survival & reconciliation

BullMQ jobs live in Redis, so the normal case is already covered by enabling Redis's AOF persistence in `docker-compose.yml`. The requirement goes further than "the normal case," though ("survives server restarts... future emails still sent at the correct time... not restarted from Day 1"), so the worker also runs a one-time reconciliation pass **on boot** — not on a timer, which would edge back toward cron-like behavior:

```
on worker startup:
    stalePending = db.emailMessage.findMany({ status: 'PENDING' })
    for m in stalePending:
        if queue.getJob(m.id) is null:                 # Redis lost the job (e.g. flushed)
            delay = max(0, m.scheduledAt - now())
            queue.add(..., { jobId: m.id, delay })      # safe no-op if it does exist, per 6.4

    stuckProcessing = db.emailMessage.findMany({
        status: 'PROCESSING', updatedAt: { lt: now() - 5min }
    })                                                  # crashed mid-send before the process died
    for m in stuckProcessing:
        if m.attemptCount < MAX_RECONCILE_ATTEMPTS:
            db.emailMessage.update(m.id, { status: 'PENDING', attemptCount: increment })
            queue.add(..., { jobId: m.id, delay: 0 })
        else:
            db.emailMessage.update(m.id, { status: 'FAILED', failReason: 'stuck after restart' })
```

This is what Stage 7 actually verifies: kill the worker process mid-batch, restart it, confirm nothing is lost or double-sent — including the harder case of simulating a Redis flush against a DB that still thinks messages are `PENDING`.

---

## 7. API Contract

| Method & Path | Purpose | Notes |
|---|---|---|
| `GET /auth/google` | Start OAuth flow | Redirects to Google |
| `GET /auth/google/callback` | OAuth callback | Creates session, redirects to `/dashboard` |
| `POST /auth/logout` | Destroy session | |
| `GET /api/me` | Current user (name, email, avatarUrl) | Powers the sidebar user card |
| `GET /api/senders` | List senders for the logged-in user | Powers the compose "From" dropdown |
| `GET /api/config/defaults` | System default/min/max for delay & hourly limit | Pre-fills + validates the compose form (Assumption #5) |
| `POST /api/leads/parse` | Upload a CSV/text file | Returns `{ validEmails: string[], invalidCount, totalDetected }` — powers the live "N email addresses detected" preview *before* submit |
| `POST /api/campaigns` | Create a scheduled batch | Body: `{ senderId, subject, bodyHtml, recipients[], startTime, delayBetweenEmailsSec, hourlyLimit }`. Runs `computeSchedule`, bulk-inserts, bulk-enqueues. Returns `{ campaignId, totalRecipients, firstScheduledAt, lastScheduledAt }` |
| `GET /api/emails/scheduled?page=&pageSize=` | Paginated list, `status IN (PENDING, PROCESSING)` | |
| `GET /api/emails/sent?page=&pageSize=` | Paginated list, `status IN (SENT, FAILED)` | |
| `GET /api/emails/counts` | `{ scheduledCount, sentCount }` | Powers the sidebar badges (the "12" / "785" in the Figma) |
| `DELETE /api/emails/:id` | Cancel a pending email | Stretch (Stage 16) |

All `/api/*` routes except `/auth/*` sit behind session-auth middleware.

---

## 8. Frontend Architecture

```
/frontend
  /app
    /login
    /dashboard
      /scheduled
      /sent
      /compose
  /components
    /ui           (Button, Input, Modal, Table, Badge, Toast, EmptyState, Spinner)
    /layout       (Sidebar, UserMenu)
    /compose      (ComposeForm, RecipientChips, RichTextEditor, SendLaterPopover, CsvUploader)
    /emails       (EmailRow, EmailList, StatusBadge)
  /lib
    apiClient.ts
    types.ts       (mirrors the API contract in Section 7)
    hooks/         (useAuth, useEmails, useSenders)
  /styles
```

Component notes tied to specific Figma behavior:
- `StatusBadge` renders differently by status: amber/clock for `PENDING`/`PROCESSING` with formatted time (Image 2), gray "Sent" pill (Image 3), red "Failed" pill.
- `RecipientChips` supports typing individual addresses (comma/enter commits a chip) *and* being populated from `CsvUploader`'s parsed result, with a `+N` overflow chip once more than ~3 are present (Image 7).
- `SendLaterPopover` mirrors Image 5: a date/time picker plus quick-pick buttons (computed relative to `new Date()`, not hardcoded strings) and Cancel/Done. Picking a time flips the submit button's label from "Send" to "Send Later" (Image 5 → Image 6).

---

## 9. Environment Variables

```bash
# Server
PORT=4000
FRONTEND_URL=http://localhost:3000
SESSION_SECRET=change-me

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/reachinbox

# Redis
REDIS_URL=redis://localhost:6379

# Google OAuth (from Google Cloud Console — see README setup steps)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:4000/auth/google/callback

# Scheduling / throughput
WORKER_CONCURRENCY=5
MIN_DELAY_BETWEEN_EMAILS_MS=2000
RATE_LIMIT_MODE=per_sender          # global | per_sender
MAX_EMAILS_PER_HOUR=200             # used when RATE_LIMIT_MODE=global
MAX_EMAILS_PER_HOUR_PER_SENDER=50   # used when RATE_LIMIT_MODE=per_sender
MAX_RECONCILE_ATTEMPTS=3

# Ethereal
ETHEREAL_AUTO_CREATE=true           # auto-generate test accounts on seed; set false to supply real Ethereal creds below
```

---

## 10. Implementation Stages

Each stage ends with an explicit **re-check** against the original brief before moving to the next — that gate is the point, not a formality.

### Stage 1 — Repo, Environment & Infra Bootstrap
**Tasks:** scaffold `/backend` (Express+TS, eslint, ts-node-dev) and `/frontend` (Next.js+TS+Tailwind); `docker-compose.yml` for Postgres + Redis (`--appendonly yes`); `.env.example` per Section 9; `GET /api/health`.
**Done when:** `docker compose up`, backend `npm run dev`, frontend `npm run dev` all boot; frontend can hit the health check.
**Re-check:** "Redis and DB can be run via Docker" ✅. Nothing else in scope yet.

### Stage 2 — Database Schema & ORM
**Tasks:** Prisma schema from Section 5; `prisma migrate dev`; seed script creating 2–3 `Sender` rows (via Ethereal's `createTestAccount()` if `ETHEREAL_AUTO_CREATE=true`) and a placeholder dev user.
**Done when:** schema migrated; seed data visible in Prisma Studio.
**Re-check:** "Store them in a relational DB" ✅. "Support multiple senders" — modeled ✅ (selection UI comes later).

### Stage 3 — Auth: Google OAuth + Sessions
**Tasks:** register a Google Cloud OAuth client (redirect URI = `GOOGLE_CALLBACK_URL`); Passport Google strategy; Redis-backed session store; `/api/me`; auth middleware on all `/api/*` except `/auth/*`; frontend login page wired to `/auth/google`; `useAuth()` hook redirecting unauthenticated users to `/login`.
**Done when:** a real Google account can log in, land on the dashboard with correct name/email/avatar, and log out cleanly.
**Re-check:** "Real Google OAuth login (no mock)" ✅. Name/email/avatar data available ✅ (wired into the sidebar in Stage 10). Logout ✅.

### Stage 4 — Queue Infrastructure & Worker Skeleton
**Tasks:** `email-queue` definition; separate `worker.ts` entry point (own process/script, deliberately not sharing a process with the API — see Section 3); `limiter` from `MIN_DELAY_BETWEEN_EMAILS_MS`; `concurrency` from `WORKER_CONCURRENCY`; processor is a logging stub for now.
**Done when:** a test delayed job added via a script is picked up and logged by the worker at the right time.
**Re-check:** "Configurable worker concurrency" ✅. "No cron jobs" ✅ — confirmed nothing in the codebase uses `setInterval`, `node-cron`, or OS cron, here or later. "Minimum delay via BullMQ limiter" ✅ (groundwork laid).

### Stage 5 — Batch Scheduling Algorithm
**Tasks:** implement `computeSchedule()` (Section 6.2) as a pure, unit-testable function; `scheduler.service.ts` wiring it to `createMany` + `addBulk`.
**Done when:** given 1,000 synthetic recipients, output `scheduledAt` values match the hand-computed distribution from Section 6.2, asserted in a unit test.
**Re-check:** "1,000+ emails scheduled for the same time" ✅ handled by design. "Preserving order as much as possible" ✅ (FIFO on recipient order).

### Stage 6 — Rate-Limited, Idempotent Worker Processor
**Tasks:** `rateLimiter.service.ts` (the reserve/release INCR pattern, Section 6.3); real processor logic including the `moveToDelayed`/`DelayedError` reschedule path and the DB status guard; sender-send stub (real SMTP arrives next stage).
**Done when:** enqueuing 300 jobs against `hourlyLimit=200` results in exactly 200 processed in the first window and 100 correctly rolled into the next, verified in the DB, with `WORKER_CONCURRENCY=10` and no duplicates.
**Re-check:** "Rate-limiting logic safe across multiple workers/instances" ✅. "Do not drop jobs — delay into next available hour window" ✅. "Maintain idempotency" ✅.

### Stage 7 — Restart Persistence & Reconciliation
**Tasks:** boot-time reconciliation (Section 6.5); enable Redis AOF in Compose; write a manual test runbook — (a) schedule N emails for +2 minutes, `kill -9` the worker process, restart, confirm all still fire correctly and once each; (b) `redis-cli FLUSHALL` with DB rows still `PENDING`, restart the worker, confirm reconciliation re-enqueues everything correctly.
**Done when:** both scenarios in the runbook pass with zero lost and zero duplicate sends.
**Re-check:** "Survives server restarts... not restarted from Day 1" ✅ — the most explicitly named requirement in the brief, closed out here with an actual verification method rather than just a claim.

### Stage 8 — Real Email Sending via Ethereal
**Tasks:** `email.service.ts`, per-sender `nodemailer.createTransport`; swap the Stage 6 stub for a real send; BullMQ job options `attempts: 3, backoff: { type: 'exponential', delay: 5000 }` for genuine SMTP failures (distinct from the rate-limit reschedule path — this is retry-on-failure, not throttling).
**Done when:** a scheduled test send is visible at its Ethereal preview URL (`nodemailer.getTestMessageUrl()`).
**Re-check:** "Sends emails using fake SMTP via Ethereal" ✅. "Multiple senders" ✅ fully realized.

### Stage 9 — Backend Public API
**Tasks:** implement every endpoint in Section 7; CSV/text parsing endpoint with the format handling from Assumption #11; Zod validation on all POST bodies, including delay/hourly-limit bounds-checking against `/api/config/defaults` (Assumption #5).
**Done when:** every endpoint is callable via curl/Postman with correct shapes and error codes.
**Re-check:** cross-check against every data point the frontend needs — the Section 7 table itself doubles as this check; all covered.

### Stage 10 — Frontend Foundations: Auth, Layout, Design Tokens
**Tasks:** Tailwind theme sampled from the screenshots (green accent for primary actions/active nav, amber for "scheduled" status, neutral grays for chrome — exact hex values should come from the real Figma file if/when available, since screenshots only give close approximations); `Button`/`Input`/`Avatar`/`Badge` primitives; `Sidebar` (logo, user card + chevron menu with logout, Compose CTA, nav items with live counts from `/api/emails/counts`); `Login` page matching Image 1, Google button wired, email/password fields present-but-disabled per Assumption #6.
**Done when:** logged-out state shows the Figma-matched login; post-auth state shows the sidebar shell with correct live user info.
**Re-check:** "Top header" info requirement ✅ (relocated to sidebar per Assumption #7, functionally complete). Logout ✅. Compose button ✅.

### Stage 11 — Scheduled & Sent List Views
**Tasks:** `EmailRow`/`EmailList` (recipient, subject + preview snippet, right-aligned `StatusBadge`); loading skeletons; empty states for both tabs (e.g. "No scheduled emails yet — compose one to get started"); pagination (simple page controls, not infinite-scroll, given hundreds of rows are expected per the Figma's "785 Sent"); tab switching preserving the Figma's nav-as-tabs pattern; live badge counts.
**Done when:** with seeded data, both tabs render correctly; an empty DB shows the correct empty state; a slow-network simulation shows the loading skeleton.
**Re-check:** Scheduled table (Email/Subject/Scheduled time/Status) ✅. Sent table (Email/Subject/Sent time/Status sent-or-failed) ✅. Loading states ✅. Empty states ✅.

### Stage 12 — Compose Flow
**Tasks:** dedicated `/dashboard/compose` route (Assumption #13); `From` dropdown from `/api/senders`; `To` field as recipient chips (manual entry + populated from CSV upload, `+N` overflow per Image 7); `Upload List` control → `/api/leads/parse` → chips + a visible "`N` email addresses detected" count; `Subject`; `Delay between 2 emails` / `Hourly Limit` numeric inputs, pre-filled from `/api/config/defaults`, inline-validated against system bounds; TipTap rich-text body matching the Figma toolbar; `SendLaterPopover` (Section 8) driving `startTime`; submit → `POST /api/campaigns` → success toast + navigate to Scheduled tab, or an inline error toast on failure.
**Done when:** composing to either a single typed recipient or an uploaded list of N leads, with a custom delay/hourly-limit and a future start time, produces a campaign visible in the Scheduled tab with correct per-recipient `scheduledAt` values.
**Re-check:** every bullet under the spec's "3️⃣ Compose New Email" — Subject ✅, Body ✅, CSV/text upload with detected-count display ✅, start time ✅, delay ✅, hourly limit ✅, Schedule → backend API ✅.

### Stage 13 — Cross-Cutting Polish & Error Handling
**Tasks:** global toast provider; centralized API-error → toast mapping in the API client; DRY pass confirming Scheduled/Sent/Compose aren't duplicating table/badge/button markup; P2 extras from the Figma that aren't in the text spec — search-by-subject/recipient, a status filter, a refresh icon that re-triggers the current fetch (Assumption #9).
**Done when:** killing the backend mid-session produces a graceful error toast everywhere, not a blank screen.
**Re-check:** "Error handling (basic messages/toasts)" ✅. "Reusable components, DRY code" ✅. "Proper TypeScript usage — types/interfaces for API responses & props" ✅ (an ongoing discipline from Stage 9 onward via the shared `types.ts`, called out here as the checkpoint).

### Stage 14 — Testing & Load Validation
**Tasks:** unit tests (Jest/Vitest) for `computeSchedule()` edge cases (exact hour boundary, `delaySec=0`, `hourlyLimit=1`, single recipient, empty list); an integration test simulating concurrent `processor` invocations against a shared Redis counter, asserting no more than `hourlyLimit` ever reach `SENT` inside one window; a `scripts/simulate-burst.ts` dev script that enqueues 1,000 synthetic jobs against a no-op sender (so it doesn't hammer real Ethereal accounts) and prints the resulting per-hour distribution for a manual sanity-check against the Section 6.2 worked example.
**Done when:** `npm test` is green and the burst script's output matches the hand-computed distribution.
**Re-check:** "You don't need to actually send thousands via Ethereal, but your logic should handle it" ✅ — satisfied by the stubbed burst script plus the concurrency test, rather than an unverified claim.

### Stage 15 — README
**Tasks:** write the actual project README — architecture overview (reusing the Section 3 diagrams), setup instructions (Compose up, env vars, Google Cloud Console steps for OAuth credentials, `npm run dev` ×2, `npm run worker`), the **chosen delay value and rationale** (explicit spec ask), the **rate-limiting approach and trade-offs** (explicit spec ask — the Section 6.1 table is the source for this), how to run the Stage 7 restart-survival test, known limitations (Section 11), possible future work.
**Done when:** someone can go from `git clone` to a working local demo using only the README (excluding Google Cloud Console propagation wait time).
**Re-check:** both explicit "document in the README" call-outs in the spec ✅.

### Stage 16 — Stretch Goals (only after Stages 1–15 are solid)
- Cancel/delete a scheduled email (Assumption #15)
- Row-click detail view addressing Image 4, if confirmed wanted (Assumption #8)
- File attachments (Assumption #10)
- Search/filter polish beyond the P2 baseline from Stage 13
- A single Playwright e2e happy-path test: login → compose → schedule → appears in list

---

## 11. Out of Scope / Non-Goals

- Real email delivery — Ethereal is a sandboxed test SMTP; nothing sent through it reaches a real inbox, by design.
- A received-mail/inbox view (Image 4) — see Assumption #8.
- Multi-tenant billing, team/workspace management.
- Horizontal scaling, cloud deployment, CI/CD, infra-as-code — local Docker Compose only.
- Real email/password authentication — Google OAuth only, per spec.
- File attachments beyond the Stage 16 stretch goal.

---

## 12. Appendix A — Requirements Traceability Matrix

| Spec requirement | Stage(s) |
|---|---|
| Accept email send requests via API | 9 |
| Schedule to a specific time | 5 |
| BullMQ + Redis, no cron | 4, 5 |
| Send via Ethereal | 8 |
| Survive server restarts, no duplicate/restart-from-scratch | 7 |
| Dashboard: schedule / view scheduled / view sent | 10, 11, 12 |
| Configurable worker concurrency, safe under parallel jobs | 4, 6 |
| Minimum delay between sends, documented in README | 4, 15 |
| Emails-per-hour limit, global or per-sender, env-configurable | 6, 9 |
| Rate-limit counters are Redis/DB-backed, not in-memory | 6 |
| Rate limiting safe across multiple workers/instances | 6 |
| Limit reached → delay/reschedule, never drop, preserve order | 5, 6 |
| README explains rate-limiting approach + trade-offs | 15 |
| Behavior defined for 1,000+ emails at once | 5, 6, 14 |
| No OS cron, no node-cron/agenda | 4 (and everywhere, by omission) |
| Idempotency — same email never sent twice | 5, 6 |
| Real Google OAuth login | 3 |
| Header shows name/email/avatar + logout | 10 |
| Tabs: Scheduled / Sent, Compose button | 10, 11 |
| Compose: subject, body | 12 |
| Compose: CSV/text upload, shows detected count | 12 |
| Compose: start time, delay, hourly limit | 12 |
| Schedule → backend API | 12 |
| Scheduled table: email/subject/time/status + loading/empty | 11 |
| Sent table: email/subject/time/status(sent/failed) + loading/empty | 11 |
| Clean folder structure, reusable components, DRY | 10–13 |
| TypeScript types for API responses & props | 9–13 |
| Loading/empty/error UX | 11, 13 |
