# Unified Service Scheduler

Keyloop technical assessment, **Scenario A: The Unified Service Scheduler** (domain: Ownership).

This is a multi-tenant backend that replaces manual service booking. It confirms an appointment only when a **qualified technician** and a **compatible service bay** are both free for the **whole service duration**. It auto-assigns the least-loaded resources, with optional manual override, and stores a persistent appointment linking the customer, vehicle, technician and bay.

- **Implemented layer:** the backend (NestJS REST API + PostgreSQL).
- **Frontend:** stubbed with the generated OpenAPI/Swagger UI, [`requests.http`](requests.http) and cURL examples.
- **Design:** [`docs/system-design.md`](docs/system-design.md) is the System Design Document. Feature artifacts (spec → plan → tasks) are in [`specs/001-service-appointment-scheduler/`](specs/001-service-appointment-scheduler/).

---

## Highlights

| Concern | How it is handled |
|---|---|
| **No double-booking, even under concurrency** | PostgreSQL **exclusion constraints** on technician, bay and vehicle (`tstzrange … WITH &&`, partial on `CONFIRMED`). The database decides; the app retries a lost race at most 3 times. Proven by 20 parallel requests for a single free technician/bay pair giving exactly **1 × 201 and 19 × 409**, every run. |
| **Multi-tenant isolation** | Tenant comes from trusted identity (`X-Tenant-ID`, standing in for a JWT claim) and dealership from the URL. Other tenants' data is always **404**. **Composite foreign keys** make cross-site or cross-tenant rows impossible even if the code is wrong; this is tested with direct SQL. |
| **Safe retries** | A required `Idempotency-Key` plus a request hash. Replays return the original (200), a reused key with a different body gives 422, and 20 simultaneous duplicates create exactly one appointment. |
| **Manual override** | Pin a technician or bay at booking time, or reassign later. The same qualification and overlap checks apply, and a busy choice is never silently substituted. Optimistic versioning returns `409 STALE_VERSION`. |
| **Alternatives** | A refused time returns `409 SLOT_UNAVAILABLE` with up to 5 alternatives (same day first, then up to 7 days ahead). Nothing is booked automatically. |
| **Audit trail** | Every create, reassign and cancel writes an `appointment_event` row (actor, time, before/after IDs) in the same transaction. The table is also a ready-made outbox. |
| **Clean Architecture** | `domain` ← `application` (use cases + ports) ← `infrastructure` / `presentation` adapters. ESLint enforces the dependency rule in CI, and a test proves it fires. |
| **Observability** | JSON logs (pino) with `request_id`, `trace_id`, `tenant_id` and `dealership_id`, and no PII. OpenTelemetry traces go to Jaeger. Prometheus metrics include `bookings_total`, `booking_conflicts_total` and `booking_duration_seconds`, with no tenant labels. |

## Tech stack

TypeScript 5.9 (strict) · Node.js 24 LTS · NestJS 11 · TypeORM 0.3 (hand-written SQL migrations) · PostgreSQL 17 + `btree_gist` · Luxon (time zones/DST) · Jest 30, supertest, Testcontainers · OpenTelemetry, pino, Prometheus, Jaeger · Docker Compose · pnpm.
The reasons for each choice are in [system-design §9](docs/system-design.md) and [research.md](specs/001-service-appointment-scheduler/research.md).

---

## Build, run and test

### Prerequisites
- **Docker** with Compose v2. This is all you need to run the stack.
- **Node.js 24** and **pnpm 10**, to run tests or develop locally. Testcontainers also needs Docker running.

### Run the whole stack
```bash
docker compose up -d --build          # api :3000 · postgres :5432 · jaeger :16686
curl -s localhost:3000/health/ready    # {"status":"ok",…}
```
The API container applies migrations and the idempotent seed before starting.

| What | Where |
|---|---|
| Swagger UI / OpenAPI | http://localhost:3000/docs · http://localhost:3000/openapi.json |
| Traces | http://localhost:16686 (service `service-scheduler`) |
| Metrics | http://localhost:3000/metrics |
| Example requests | [`requests.http`](requests.http) · cURL walkthrough in [quickstart.md](specs/001-service-appointment-scheduler/quickstart.md) |

```bash
pnpm install
pnpm demo:race    # 20 simultaneous bookings for one slot → "201 × 1, 409 SLOT_UNAVAILABLE × 19"
pnpm perf:smoke   # p50/p95 for 1,000 availability searches + 200 bookings
docker compose down
```

### Develop locally (API on the host)
```bash
pnpm install
docker compose up -d postgres jaeger
cp .env.example .env && export $(grep -v '^#' .env | xargs)
pnpm db:migrate && pnpm db:seed
pnpm start:dev
```

### Tests
```bash
pnpm lint          # ESLint, including the Clean Architecture boundary rules
pnpm typecheck     # tsc --noEmit (strict)
pnpm test          # unit: domain, use-case orchestration, adapters, layer boundaries (no Docker)
pnpm test:int      # integration against real PostgreSQL 17 via Testcontainers (needs Docker)
pnpm test:e2e      # HTTP platform, OpenAPI contract, observability
pnpm test:all      # everything, as CI runs it (.github/workflows/ci.yml)
```

| Suite | Tests | What it proves |
|---|---|---|
| Unit (`test/unit`, `test/architecture`) | 140 | Interval and slot-grid edge cases, DST days, qualification, least-loaded ranking, alternatives, booking rules, retry/idempotency orchestration (with in-memory port fakes), problem+json mapping, the database-error-to-conflict mapping, and that forbidden imports fail lint |
| Integration (`test/integration`) | 88 | Every acceptance scenario of US1–US5 over HTTP. **Concurrency** (5 × 20-way race; 5 × 20 identical bursts). Tenant isolation at the API and the DB (direct SQL). The schema still has every constraint after migrations. A bounded query count for availability. No PII in logs, events or error bodies. |
| E2E (`test/e2e`) | 12 | Health/readiness/metrics, the generated OpenAPI equals [`contracts/openapi.yaml`](specs/001-service-appointment-scheduler/contracts/openapi.yaml) (paths, methods, status codes, error codes), metrics have no tenant labels, and logs carry the request context |

> The integration and e2e suites share one PostgreSQL container per run and execute serially (`maxWorkers: 1`).

---

## API at a glance

All `/api/v1` requests need `X-Tenant-ID` (uuid) and `X-User-ID`. Booking also needs `Idempotency-Key`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/dealerships` · `/api/v1/service-types` | The tenant's sites and service catalogue |
| GET | `/api/v1/dealerships/{id}/technicians` · `/service-bays` | Site resources with skills and capabilities |
| GET | `/api/v1/dealerships/{id}/availability?serviceTypeId=&date=` | Free 15-min start times on a local date |
| POST | `/api/v1/dealerships/{id}/appointments` | Book (auto-assign, or pin `technicianId` / `serviceBayId`) |
| GET | `/api/v1/dealerships/{id}/appointments?date=&status=&technicianId=&limit=&cursor=` | Day view (keyset paging) |
| GET | `/api/v1/dealerships/{id}/appointments/{apptId}` | One appointment |
| PATCH | `/api/v1/dealerships/{id}/appointments/{apptId}/assignment` | Manual reassign `{technicianId?, serviceBayId?, version}` |
| POST | `/api/v1/dealerships/{id}/appointments/{apptId}/cancel` | Cancel `{version}` |
| GET | `/api/v1/dealerships/{id}/appointments/{apptId}/events` | History |

Errors are RFC 9457 `application/problem+json` with a machine-readable `code`. See [system-design §7](docs/system-design.md).

## Project layout

```text
src/
  domain/           pure TypeScript (Luxon only): interval, slot grid, time/DST, qualification,
                    AllocationPolicy (least-loaded), availability & alternatives, booking rules, errors
  application/      use cases (BookAppointment, SearchAvailability, Reassign/Cancel, List…) + ports
  infrastructure/   TypeORM adapters, hand-written migrations, seed, pg-error translation,
                    unit of work, OTel telemetry, pino config, clock, ids
  presentation/     NestJS controllers, DTOs, TenantGuard, Idempotency-Key, problem+json filter
  modules/, app.module.ts, main.ts, tracing.ts   composition root (the only cross-layer wiring)
test/  unit · integration (Testcontainers) · e2e · architecture · setup
scripts/  db-migrate · db-seed · demo-race · perf-smoke
```

## Assumptions and scope

The assumptions, with their reasons (auto-assign with override, 15-minute grid, 90-day horizon, opening hours, the tenancy model, and so on), are in [system-design §2](docs/system-design.md). **Built vs designed-only** is listed in §2.6. JWT auth, Row-Level Security, the outbox relay and notifications, shifts/leave, and COMPLETED/NO_SHOW transitions are designed but deliberately not built (Constitution VIII).

---

## AI Collaboration Narrative

> *Drafted from the actual sessions. The `AUTHOR` markers are for my own reflections before submission.*

### Strategy: the AI as a fast pair, the constitution as guardrails
I used **Claude Code** (a CLI agent working in the repository) through the **Spec Kit** workflow:
1. System design
2. Constitution
3. `/speckit-specify`
4. `/speckit-plan`
5. `/speckit-tasks`
6. `/speckit-implement`

Every phase produced a reviewable artifact before any code existed. The **constitution** (`.specify/memory/constitution.md`) turned my design decisions into rules the agent had to check its work against. Examples: correctness held by the database, tenant isolation by construction, real-PostgreSQL tests only, and a Clean Architecture dependency rule.

**Decisions I made or changed, rather than accepting the AI's first proposal:**
- **Stack:** FastAPI → **NestJS**.
- **Assignment:** auto-assign only → **auto-assign with manual override**.
- **Bay choice:** least-specialised bay → **least-loaded bay**.
- **Tenancy:** I raised the multi-tenancy question ("how do we know which place an appointment comes from?") myself.
- **Skills and capabilities:** I challenged whether these tables were needed.
- **Architecture:** I tightened the constitution to **v2.0.0 (Clean Architecture)** after the first plan.

The full log is in [system-design §13](docs/system-design.md).
<!-- AUTHOR: why these choices mattered to you -->

### Verification: claims are tested, not trusted
- **Library claims were checked against shipped source, not documentation summaries.** Examples: `pg` exposes the violated constraint's name, TypeORM passes it through, NestJS validation can return 422, and how TypeORM's schema diff treats exclusion constraints (research R2–R4). This caught a real trap: TypeORM matches exclusion constraints and foreign keys **by name only** and would drop ours. So the schema is hand-written SQL, and a test asserts the constraints exist.
- **An AI claim that was wrong:** "Jest 29 is needed for ts-jest" was disproved by the peer-dependency range and corrected (research R1).
- **Constitution re-checks:** when I moved to v2.0.0, the AI's own plan failed the new dependency rule in five places, and those were fixed before any code was written.
- **Tests caught a real concurrency bug, and the first fix wasn't enough.** The first version of the 20-simultaneous-duplicates test was green by luck. Repeating it showed PostgreSQL **deadlock storms** (`40P01`), which surfaced as 500s with latencies of 4–9 s. Correctness held throughout: never more than one row.
  - Classifying deadlocks as retryable reduced the failures but didn't remove them. A 40-run stress loop showed every request deadlocking on all 3 attempts.
  - The real fix was **ordered row locks** (technician → bay → vehicle) before the insert, justified in the plan's Complexity Tracking. After that, 80 stress scenarios with 1,600 requests gave 0 deadlocks.
  - Both the burst test and the race test now run 5 times per suite as regression guards.
- **The design was checked in the running system.** The quickstart was walked through against `docker compose`, `demo:race` gave `201 × 1 / 409 × 19`, perf p95 was within targets, and Jaeger showed full HTTP → booking → SQL traces.

### How quality was ensured
- **CI gates on every push:** lint (including the layer-boundary rules) → type-check → unit → integration (Testcontainers) → e2e/contract.
- **Real database for every database claim:** concurrency, isolation, idempotency and schema guarantees are proven against PostgreSQL 17, never against mocks. In-memory port fakes are used only to test use-case orchestration.
- **The contract test** keeps the generated OpenAPI identical to the design-time contract. It caught one drift: undocumented 422 responses on two endpoints.
- **A personal-data test** scans every captured log line, error body and event payload for seed customer names, emails and phones.

<!-- AUTHOR: what you would do differently / what you learned -->
