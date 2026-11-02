# Implementation Plan: Unified Service Scheduler

**Branch**: `001-service-appointment-scheduler` | **Date**: 2026-11-02 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/001-service-appointment-scheduler/spec.md`
**Design reference**: [docs/system-design.md](../../docs/system-design.md) v1.0 · **Constitution**: v2.0.0

## Summary

A multi-tenant backend service that books dealership service appointments. It confirms a booking only when a qualified technician and a compatible bay are both free for the full service duration. It auto-assigns the least-loaded resources, with optional manual pinning or reassignment. It also offers availability, alternatives, cancellation, a day view and an audit history.

**Technical approach:**
- **Correctness:** PostgreSQL exclusion constraints, partial on `CONFIRMED`, with bounded optimistic retry classified by **constraint name**.
- **Isolation:** composite foreign keys plus a `TenantGuard`.
- **Safe writes:** idempotency keys with request hashing, and explicit version-checked `UPDATE`s.
- **Architecture:** Clean Architecture. A pure domain, use cases behind ports, and TypeORM/HTTP as outer adapters. Luxon handles time-zone logic.
- **Delivery:** NestJS 11 + TypeORM 0.3 with hand-written SQL migrations, tested against real Postgres via Testcontainers.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict) on Node.js 24 LTS. See research R1.
**Primary Dependencies**:
- NestJS 11 (`@nestjs/core`, `platform-express`, `typeorm`, `swagger`, `terminus`)
- TypeORM 0.3.31 + `pg` 8
- `class-validator` / `class-transformer`
- Luxon 3
- `nestjs-pino` 4
- OpenTelemetry JS SDK (`sdk-node`, `auto-instrumentations-node`, `exporter-prometheus`, OTLP exporter)

**Storage**: PostgreSQL 17 with `btree_gist`. The schema is defined only by hand-written migrations (R3).
**Testing**: Jest 30 + ts-jest 29.4 (unit), supertest (e2e), `@testcontainers/postgresql` 11 (integration/concurrency/isolation/schema).
**Target Platform**: Linux container (`node:24-alpine`), run with docker compose (api, postgres, jaeger).
**Project Type**: Web service (single backend project; the frontend is stubbed by OpenAPI + `requests.http`).
**Performance Goals**:
- Availability search p95 < 300 ms
- Booking p95 < 500 ms
- ~50 bookings/s peak system-wide, with availability searches outnumbering bookings ~20:1

The spec's SC-004 user-facing targets (< 0.5 s and < 1 s) are looser than these engineering targets.
**Constraints**:
- No double-booking under concurrency.
- Zero cross-tenant exposure.
- No PII in logs, metrics, traces or events.
- Availability uses a bounded number of queries (≤ 4) whatever the slot count.
- At most 3 booking attempts.
- Alternatives search capped at 7 days / 5 results.

**Scale/Scope**: ~200 tenants, ~1,000 dealerships, 50–300 appointments per site per day. 5 user stories, 28 FRs, 12 HTTP endpoints plus health and metrics.

No `NEEDS CLARIFICATION` items: the stack is fixed by the constitution, and the four library-behaviour claims were verified from package source in [research.md](./research.md) (R2–R4). R5 relies on PostgreSQL's documentation and is proven by tests.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Gate | Pre-research | Post-design | Evidence |
|---|---|---|---|---|
| **I. DB-guaranteed correctness** (NN) | Exclusion constraints on technician/bay/vehicle, partial `CONFIRMED`, half-open `tstzrange`. No locks or SERIALIZABLE. UTC storage and local-zone rules. | ✅ | ✅ | data-model §1 constraint table. R6 (READ COMMITTED + constraints). R9 (Luxon zone module). |
| **II. Tenant isolation** (NN) | Tenant from header/identity. Dealership from path. `TenantGuard` → `TenantContext`. Tenant-scoped repositories. 404 for other tenants. Composite FKs on every `appointment` reference. | ✅ | ✅ | data-model `fk_appt_*`. Contract: every path is under `/dealerships/{id}` or tenant-scoped. Direct-SQL isolation test planned. |
| **III. Real-Postgres verification** (NN) | Testcontainers for integration, concurrency, isolation and schema tests. No SQLite or mocks for DB guarantees. Domain unit tests listed. | ✅ | ✅ | R11. The quickstart test map covers SC-001/003/006/007/010 and the schema test. |
| **IV. Clean Architecture** | Dependencies point inward: domain ← application ← infrastructure/presentation. `domain/` + `application/` import no Nest, TypeORM, pg or telemetry. Ports for persistence, unit of work, clock, IDs and telemetry. ORM entities mapped in infrastructure. Driver errors translated in the adapter. Composition root binds ports. `AllocationPolicy` + `LeastLoadedPolicy`. Thin controllers. | ✅ | ✅ (after v2 re-check fixes) | Project structure below. Per-layer `no-restricted-imports` rules run in CI lint, with the composition root (`main.ts`, `tracing.ts`, `app.module.ts`, `modules/**`) exempt. **v2 re-check found and fixed five boundary leaks in the earlier design:** (1) `TenantGuard` needs a DB lookup → it calls the `ResolveTenantContext` use case. (2) The AsyncLocalStorage context used by both the guard and the logger → `RequestContextStore` port (R10). (3) The idempotency interceptor queried storage → the replay rule moved into `BookAppointment` (R8). (4) A `/metrics` controller would import the exporter → its handler is mounted in `main.ts` (R10). (5) "Now" read inside the domain → `Clock` port, with "now" passed in (R9). The ID-generation and transaction decisions are in R6/R7 and data-model §1. |
| **V. Safe, explicit writes** | Idempotency key required + hash. `23505` re-read. Classification by constraint name. Retry only for auto-assigned technician/bay, ≤ 3, fresh transaction. Explicit version `WHERE` + row count, no `@VersionColumn`. Event in the same transaction. Migrations can't silently drop constraints. | ✅ | ✅ | R2, R3, R6, R7, R8. Schema test asserts constraints. |
| **VI. API contract** | OpenAPI from DTOs, checked against `contracts/openapi.yaml`. problem+json with a catalogue code. 422 validation with whitelist + forbidNonWhitelisted. 409 + ≤ 5 alternatives. Duration not client-supplied. `/api/v1`. | ✅ | ✅ | contracts/openapi.yaml. R4. **The two new codes (`START_IN_PAST`, `RESOURCE_INACTIVE`) were added to the design-doc catalogue in this change**, as VI requires. |
| **VII. Observability without PII** | JSON logs with the required fields. No PII anywhere. No tenant metric labels. Business metrics + spans. Health/metrics endpoints. | ✅ | ✅ | R10 (MetricsService rejects tenant labels; pino redaction as a safety net). PII test (SC-010). |
| **VIII. Scope discipline** | Only §2.6 "Built" items. Reference data seeded with no CRUD. Bounded availability queries. Complexity justified. | ✅ | ✅ | `resource_unavailability` deliberately **not** created (data-model §1). No auth, RLS, relay or caching. No new infrastructure beyond the mandated stack. |
| **Tech constraints** | Mandated versions and tools | ✅ | ✅ | R1. NestJS 12 / TS 7 / TypeORM 1.x are noted as a *future amendment candidate*, not used. |
| **Workflow gates** | CI lint → typecheck → unit → integration. AI claims verified before code depends on them. Design doc updated with decision changes. | ✅ | ✅ | R2–R4 verified from source. R1 records a **corrected** AI claim (Jest 29). Design doc §7 updated. |

**Result: PASS.** One justified addition was recorded in Complexity Tracking during implementation (deadlock-avoidance row locks; Principle I still holds).

## Project Structure

### Documentation (this feature)

```text
specs/001-service-appointment-scheduler/
├── spec.md
├── plan.md              # this file
├── research.md          # Phase 0: versions + verified library claims
├── data-model.md        # Phase 1: tables, constraints → error codes, state machine, seed
├── quickstart.md        # Phase 1: run + manual walkthrough + test map
├── contracts/
│   └── openapi.yaml     # Phase 1: design-time API contract
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks; not created here)
```

### Source Code (repository root)

```text
src/
├── main.ts                         # composition root: bootstrap, ValidationPipe(422), problem+json filter, swagger, mounts /metrics handler
├── tracing.ts                      # OTel NodeSDK, loaded with --require before Nest
├── app.module.ts                   # composition root: binds application ports → infrastructure adapters
├── modules/                        # Nest feature modules (wiring only, factory providers per use case)
│   ├── scheduling.module.ts
│   └── reference.module.ts
├── domain/                         # PURE TypeScript (Luxon allowed): no @nestjs/*, typeorm, pg, telemetry
│   ├── model/                      # Appointment, ServiceType, Technician, ServiceBay, Dealership, value objects
│   ├── time.ts                     # Luxon: localDayBounds, openingWindow, isOnGrid
│   ├── interval.ts                 # half-open overlap
│   ├── slot-grid.ts
│   ├── qualification.ts            # skill + capability matching
│   ├── allocation-policy.ts        # AllocationPolicy + LeastLoadedPolicy
│   ├── availability-calculator.ts  # slots + findAlternatives(≤7 days, ≤5)
│   └── errors.ts                   # DomainError + ErrorCode catalogue
├── application/                    # imports domain/ only
│   ├── tenant-context.ts           # TenantContext type
│   ├── ports/                      # interfaces + DI tokens (real boundaries only)
│   │   ├── appointment.repository.ts    # insert/update outcomes as typed results (ConflictOn…)
│   │   ├── resource.query.ts            # candidates + booked minutes, availability snapshot
│   │   ├── reference.query.ts           # dealerships, service types, technicians, bays
│   │   ├── idempotency.store.ts
│   │   ├── unit-of-work.ts
│   │   ├── clock.ts · id-generator.ts
│   │   ├── telemetry.ts                 # business metrics + spans, no tenant labels
│   │   ├── request-context.ts           # RequestContextStore (requestId + TenantContext) for logs
│   │   └── health-probe.ts              # readiness: DB reachable + migrations applied
│   └── use-cases/
│       ├── book-appointment.ts          # retry loop on typed conflicts, idempotency race
│       ├── search-availability.ts
│       ├── reassign-appointment.ts      # version-checked, via port
│       ├── cancel-appointment.ts
│       ├── get-appointment.ts · list-appointments.ts · list-appointment-events.ts
│       ├── list-reference-data.ts
│       └── resolve-tenant-context.ts    # used by TenantGuard: dealership ∈ tenant? else NOT_FOUND
├── presentation/http/              # imports application/ + domain/; never infrastructure/
│   ├── tenant/                     # TenantGuard → ResolveTenantContext use case → RequestContextStore port
│   ├── idempotency/                # @IdempotencyKey() param decorator: presence/format only (no storage)
│   ├── problem/                    # RFC 9457 filter: DomainError/ErrorCode → HTTP status
│   ├── dto/                        # class-validator DTOs (= OpenAPI source) + DTO↔command mappers
│   └── controllers/                # reference, availability, appointments, health (terminus + HealthProbe port)
├── infrastructure/                 # adapters: implement application/ports
│   ├── persistence/
│   │   ├── data-source.ts          # synchronize:false, migrationsRun:false
│   │   ├── orm-entities/           # column mappings only (no relations on composite-FK columns)
│   │   ├── mappers/                # ORM row ↔ domain model
│   │   ├── repositories/           # TypeORM implementations; every method takes TenantContext
│   │   ├── typeorm-unit-of-work.ts
│   │   ├── pg-errors.ts            # constraint name → typed port outcome
│   │   ├── migrations/             # hand-written SQL: the schema source of truth
│   │   └── seed/                   # fixtures.ts (fixed UUIDs), seed.ts
│   ├── persistence/health-probe.adapter.ts
│   ├── time/system-clock.ts · ids/uuid-generator.ts
│   └── observability/              # otel-telemetry (rejects tenant labels), als-request-context, pino config
test/
├── unit/domain/                    # overlap, grid, DST, qualification, policy, alternatives
├── unit/application/               # use-case orchestration with in-memory port fakes (never DB guarantees)
├── unit/infrastructure/            # pg-errors mapping table (constraint name → typed outcome)
├── integration/                    # Testcontainers: booking, allocation, assignment, idempotency,
│                                   #   concurrency, tenant-isolation, schema, pii
├── e2e/                            # supertest HTTP + contract.e2e-spec.ts
├── architecture/                   # lint-boundary smoke test (forbidden import fails lint)
└── setup/                          # globalSetup (container + migrate), fixtures builder
scripts/demo-race.ts                # SC-001 demo
docker-compose.yml · Dockerfile · requests.http · .nvmrc · README.md
.github/workflows/ci.yml            # lint → typecheck → unit → integration
```

**Structure Decision**: a single backend project at the repository root (the challenge's "backend" option). Layers follow Principle IV (Clean Architecture): `presentation → application → domain` and `infrastructure → application → domain`. The application layer reaches storage, time and telemetry only through its own ports, and `app.module.ts`/`modules/` bind those ports to infrastructure adapters. There's no `frontend/`. The client side is the generated Swagger UI, `requests.http` and the cURL quickstart.

## Implementation Order (input to /speckit-tasks)

1. **Scaffold and gates:** pnpm, tsconfig strict, ESLint (including per-layer `no-restricted-imports` boundary rules), Prettier, Jest projects (unit/int/e2e), Dockerfile, compose, CI.
2. **Schema:** migrations (reference tables, appointment, event, constraints, indexes), seed, and the **schema test** first.
3. **Domain core (TDD), then application ports + use-case skeletons:** time/DST → interval → grid → qualification → `LeastLoadedPolicy` → availability/alternatives. Then the ports (repositories, `UnitOfWork`, `Clock`, `IdGenerator`, `Telemetry`, `RequestContextStore`, `HealthProbe`) with in-memory fakes for use-case unit tests.
4. **Cross-cutting adapters:** `ResolveTenantContext` + TenantGuard, ALS request context, problem+json filter, ValidationPipe(422), `@IdempotencyKey()` decorator, telemetry/pino/tracing adapters, `/metrics` mount, health.
5. **US1 booking** (P1): candidates query, retry and classification, event write. Concurrency, idempotency and isolation tests.
6. **US2 availability + alternatives** (P2).
7. **US3 cancel** (P3) → **US4 pin/reassign** (P4) → **US5 day view + events** (P5).
8. **Contract test**, PII test, `demo:race`, `requests.http`, README (including the AI Collaboration Narrative).

## Complexity Tracking

| Addition | Why needed | Simpler alternative rejected because |
|---|---|---|
| **Ordered row locks** (`SELECT … FOR NO KEY UPDATE` on technician → bay → vehicle) inside the booking/reassign write, in `TypeOrmAppointmentRepository` (added during implementation, 2026-11-02) | Constitution I requires a recorded justification for any row lock. **The exclusion constraints remain the only correctness guarantee; these locks only prevent deadlocks.** The SC-003 burst test showed that concurrent inserts conflicting on several exclusion constraints wait on each other in cycles. That produced 40P01 deadlock storms: every request aborted on attempts 1–3, then 409s and 500s with 4–9 s latency (research R2). With ordered locks, 80 stress scenarios (1,600 concurrent requests) gave 0 deadlocks and 0 wrong outcomes. | (a) **Retry on 40P01 only:** immediate retries recreate the same cycle, and each costs `deadlock_timeout` (1 s). It's kept as a safety net, not the fix. (b) **Per-dealership advisory lock:** serialises *all* bookings at a site. Row locks serialise only requests that compete for the same technician, bay or vehicle, which would conflict anyway. (c) **SERIALIZABLE:** forbidden by Constitution I as a replacement, and it would add serialization failures. |
