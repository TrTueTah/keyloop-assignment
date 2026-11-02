<!--
Sync Impact Report
==================
Version change: 1.0.0 → 2.0.0
Bump rationale: MAJOR. Principle IV is redefined from "Framework-Free Domain Core" (a pure domain
plus services that used repositories directly) to a strict Clean Architecture dependency rule
with ports and adapters. Plans written against 1.0.0, where the application layer imports
infrastructure repositories, no longer pass the Constitution Check.

Modified principles:
  - IV. Framework-Free Domain Core → IV. Clean Architecture (Dependency Rule) (redefined)
  - III. Verified Against Real PostgreSQL: in-memory port fakes allowed for use-case orchestration
    tests only, never as evidence for database guarantees (expanded)
  - V. Safe, Explicit Writes: constraint-name classification is placed in the persistence adapter
    (clarified)
  - VIII. Scope Discipline and Simplicity: Principle IV layers/ports need no Complexity Tracking
    entry; anything beyond them does (clarified)
Added sections: none (Development Workflow gained a layer-boundary lint gate and review item)
Removed sections: none

Templates and dependent docs:
  ✅ .specify/templates/plan-template.md: generic Constitution Check; no change needed.
  ✅ .specify/templates/spec-template.md: no architecture content; no change needed.
  ✅ .specify/templates/tasks-template.md: Foundational phase now lists layer skeleton,
     ports and boundary lint rule.
  ✅ specs/001-service-appointment-scheduler/plan.md: source tree, Principle IV gate,
     structure decision and implementation order realigned to v2.0.0.
  ✅ docs/system-design.md: §3.1 diagram, §3.2 components and §10 maintainability describe
     ports/adapters.
  ✅ CLAUDE.md: points at the current plan; no change needed.
  ⚠ specs/001-service-appointment-scheduler/research.md: lists constitution v1.0.0 as an input
     (historical record; left as-is).

Deferred TODOs: none.
-->

# Unified Service Scheduler Constitution

## Core Principles

### I. Database-Guaranteed Correctness (NON-NEGOTIABLE)

- No technician, service bay or vehicle may hold two overlapping `CONFIRMED` appointments. This
  MUST be enforced by PostgreSQL exclusion constraints (`tstzrange(start_at, end_at, '[)')` with
  `btree_gist`, partial on `status = 'CONFIRMED'`), not only by application code.
- Application-level availability checks are advisory. Only the write path (INSERT/UPDATE guarded
  by constraints) may confirm that a slot is taken.
- Concurrency control MUST use constraints plus bounded optimistic retry. `SERIALIZABLE`
  isolation, row locks and advisory locks MUST NOT replace the constraints; they need a recorded
  justification in the plan's Complexity Tracking table if introduced at all.
- Time intervals are half-open `[start, end)`. All timestamps are stored as UTC `timestamptz`;
  dealership-local rules (opening hours, slot grid, "that day") MUST be computed in the
  dealership's IANA time zone.

**Rationale:** Correctness under concurrency is the core risk of the system. A guarantee held by
the database survives application bugs, new code paths and other writers.

### II. Tenant Isolation by Construction (NON-NEGOTIABLE)

- The tenant MUST come from trusted identity (`X-Tenant-ID` in the MVP, a JWT claim in
  production), never from the request body. The dealership MUST come from the URL path
  (`/api/v1/dealerships/{dealershipId}/…`).
- A `TenantGuard` MUST resolve a `TenantContext { tenantId, dealershipId, userId }` before any
  business logic runs. Every repository method MUST require that context and apply the tenant or
  site filter. No method may query across tenants or sites.
- Resources belonging to another tenant MUST return **404**, never 403. A pinned or reassigned
  resource from another dealership of the same tenant returns **422 `RESOURCE_NOT_IN_DEALERSHIP`**.
- Every tenant-scoped table stores `tenant_id`. `appointment` MUST reference its customer,
  vehicle, service type, technician, bay and dealership through **composite foreign keys**, so the
  database rejects cross-site and cross-tenant rows even if application code is wrong.

**Rationale:** One bug must not leak or cross-assign data. Isolation is layered (guard,
repositories, composite FKs), with Row-Level Security designed as the next layer.

### III. Verified Against Real PostgreSQL (NON-NEGOTIABLE)

- Every correctness claim in the design (no double-booking, isolation, idempotency, versioning,
  error codes) MUST be backed by an automated test. A feature is not done until those tests exist
  and pass.
- Integration, concurrency and isolation tests MUST run against real PostgreSQL via
  Testcontainers. SQLite, in-memory fakes or mocked repositories MUST NOT be used to prove
  database guarantees.
- Required test kinds: domain unit tests (overlap edges, slot grid boundaries, DST days,
  qualification matching, allocation ranking and tie-breaks); concurrency tests (e.g. 20 parallel
  bookings for one free pair → exactly one 201 and one row); direct-SQL isolation tests against the
  composite FKs; schema tests asserting the exclusion constraints and composite FKs exist after
  migrations.
- Use-case unit tests MAY use in-memory fakes of application ports to cover orchestration
  (retry decisions, idempotency branches, event emission). Such fakes MUST NOT be used as
  evidence for any database guarantee in Principles I, II or V.
- Tests for a behaviour SHOULD be written before its implementation and observed failing.

**Rationale:** The guarantees live in Postgres, so only real Postgres can prove them. Tests are
also the gate that catches AI-generated mistakes.

### IV. Clean Architecture (Dependency Rule)

The code is organised in four concentric layers. **Source dependencies point inward only.**

| Layer | Folder | Contains | May import |
|---|---|---|---|
| Domain | `src/domain/` | Entities and value objects (Appointment, TimeInterval, SlotGrid), domain services and policies (qualification, `AllocationPolicy`, availability and alternatives calculation), domain errors and the error-code catalogue | Nothing outside `domain/`, except pure, I/O-free libraries (Luxon) |
| Application | `src/application/` | Use cases (one class per operation, e.g. `BookAppointment`, `SearchAvailability`, `ReassignAppointment`, `CancelAppointment`), command/result types, `TenantContext`, and **ports** (interfaces + DI tokens) for persistence, transactions, clock, ID generation and telemetry | `domain/` only |
| Infrastructure (adapters) | `src/infrastructure/` | Port implementations: TypeORM entities, mappers, repositories, migrations, the Postgres-error translator, clock, metrics/logging/tracing adapters | `application/`, `domain/`, frameworks and drivers |
| Presentation (adapters) | `src/presentation/http/` | Controllers, DTOs, `TenantGuard`, idempotency interceptor, problem+json filter, DTO → command and error → HTTP mapping | `application/`, `domain/` (error codes, value types) |

Composition root: `src/main.ts` and the Nest `*.module.ts` files are the **only** place that binds
ports to adapters.

- `domain/` and `application/` MUST NOT import `@nestjs/*`, `typeorm`, `pg`, `express`,
  OpenTelemetry or pino. Use cases are plain classes wired in modules with factory providers and
  port tokens.
- Presentation MUST NOT import infrastructure, and infrastructure MUST NOT import presentation.
- ORM entities are not domain entities. Mapping happens in infrastructure; ORM types, query
  builders and driver errors MUST NOT cross a port.
- Ports speak domain language. The persistence adapter translates driver errors, by constraint
  name, into typed outcomes (e.g. a conflict on `technician`, `bay`, `vehicle` or
  `idempotency_key`). The use case decides what to do with them (Principle V).
- Transaction boundaries are owned by the use case through a unit-of-work port. Only the adapter
  knows how a transaction is opened.
- Current time comes from a `Clock` port. `domain/` and `application/` MUST NOT read the system
  clock directly.
- HTTP status codes and problem+json exist only in presentation. Controllers hold no business
  rules: they map a request to a command, call one use case and map the result.
- Allocation strategy MUST sit behind the `AllocationPolicy` interface. The default is
  least-loaded per dealership-local day, tie-broken by fewer capabilities, then ID
  (deterministic).
- Ports exist only at real boundaries (persistence, transactions, time, IDs, telemetry). Domain
  classes do not get interfaces, and there is no generic base repository.
- The dependency rule MUST be enforced automatically by ESLint `no-restricted-imports` per layer,
  and checked in CI.

**Rationale:** Business rules (allocation, qualification, retry decisions) stay testable without
a framework or database, and the storage or transport can change without touching them.

### V. Safe, Explicit Writes

- Booking MUST require an `Idempotency-Key`. Same key and same request hash → return the original
  (200). Same key with a different hash → 422 `IDEMPOTENCY_KEY_REUSED`. A concurrent duplicate
  (`23505` on `uq_appt_idempotency`) MUST be resolved by re-reading, not by failing.
- Constraint violations MUST be classified by **constraint name**, not SQLSTATE alone. The
  classification happens in the persistence adapter (Principle IV). Only a lost
  race on an auto-assigned technician or bay is retried, in a fresh transaction, at most 3
  attempts in total. Pinned resources and vehicle overlaps MUST fail immediately with 409.
- Updates to an existing appointment (reassign, cancel) MUST use an explicit
  `WHERE … AND version = :expectedVersion` and check the affected-row count. Zero rows →
  409 `STALE_VERSION` / `NOT_CONFIRMED`. Relying on `@VersionColumn` alone is forbidden.
- Every state change MUST write its `appointment_event` (CREATED, REASSIGNED, CANCELLED) in the
  **same transaction** as the change. Event payloads carry IDs and before/after values only.
- Schema changes MUST go through versioned migrations (`synchronize: false`). Migrations MUST NOT
  silently drop the exclusion constraints or composite FKs.

**Rationale:** Client retries, races and lost updates are normal in production. Every write must
be safe to repeat and must leave an audit trail that cannot diverge from the data.

### VI. Explicit, Stable API Contract

- The OpenAPI 3.1 document is generated from DTOs (`@nestjs/swagger`) and is the contract for the
  stubbed frontend. Endpoint behaviour MUST match it.
- All errors MUST be RFC 9457 `application/problem+json` with a machine-readable `code` from the
  documented catalogue (e.g. `SLOT_UNAVAILABLE`, `RESOURCE_UNAVAILABLE`, `STALE_VERSION`,
  `NOT_ON_SLOT_GRID`). New codes MUST be added to the catalogue in the same change.
- Validation failures MUST return **422**. DTOs MUST reject unknown properties (`whitelist`,
  `forbidNonWhitelisted`).
- A booking conflict on the desired time MUST return 409 with up to 5 alternatives (same day
  first, then up to 7 days ahead). The system MUST NOT book an alternative automatically.
- Durations come from the `ServiceType`; clients MUST NOT supply them.
- Routes are versioned under `/api/v1`. Breaking changes require a new version.

**Rationale:** Precise status codes and error codes let any client react correctly without
reading server code.

### VII. Observability Without PII

- Logs MUST be structured JSON and carry `request_id`, `trace_id`, `tenant_id`, `dealership_id`
  and, where relevant, `appointment_id`, `outcome`, `attempt` and `constraint`.
- Customer name, email and phone are PII. They MUST NOT appear in logs, metrics, traces, error
  bodies or event payloads. Use IDs only.
- `tenant_id` and `dealership_id` MAY appear on logs and span attributes but MUST NOT be used as
  metric labels.
- Each feature MUST emit the business metrics and trace spans relevant to it (e.g.
  `bookings_total`, `booking_conflicts_total{constraint}`, spans for `allocate`,
  `computeAvailability`, `findAlternatives`). `/health/live`, `/health/ready` and `/metrics` MUST
  stay available.

**Rationale:** Retry storms, hot sites and slow queries must be visible, while GDPR obligations
for customer data are kept by construction.

### VIII. Scope Discipline and Simplicity

- Build only what §2.6 of `docs/system-design.md` lists as "Built". Items listed as "Designed
  only" (JWT auth, RLS, outbox relay, shifts/leave, COMPLETED/NO_SHOW transitions, caching,
  sharding) MUST NOT be implemented without a constitution-compliant spec that moves them in scope.
- Reference data (tenants, dealerships, customers, vehicles, technicians, bays, skills, service
  types) is seeded and read-only. No CRUD endpoints for it.
- Prefer the simplest design that keeps Principles I–VII. Any added abstraction, dependency or
  infrastructure MUST be justified in the plan's Complexity Tracking table. The layers and ports
  required by Principle IV do not need justification; abstractions beyond them do.
- Availability reads MUST use a bounded number of queries, independent of slot count (no N+1).

**Rationale:** A small, correct, well-tested core is worth more than a broad, partly verified one.

## Technology & Platform Constraints

| Concern | Mandated choice |
|---|---|
| Language / runtime | TypeScript 5 in `strict` mode on Node.js 24 LTS |
| Framework | NestJS 11, `class-validator` / `class-transformer`, `@nestjs/swagger` |
| Database | PostgreSQL 17 with `btree_gist` |
| ORM / migrations | TypeORM (`pg` driver), explicit migrations, `synchronize: false` |
| Date / time | Luxon for all time-zone and DST logic |
| Testing | Jest (unit), supertest (HTTP e2e), `@testcontainers/postgresql` (integration) |
| Quality | ESLint (typescript-eslint), Prettier, `tsc --noEmit` |
| Package manager | pnpm with a committed lockfile |
| Observability | OpenTelemetry JS SDK, `nestjs-pino`, Prometheus exporter, Jaeger locally |
| Runtime | Docker + docker compose (api, postgres, jaeger); stateless API container |

Changing a mandated choice is a constitution amendment (see Governance). SQL MUST be
parameterised. Hand-written SQL is allowed where precise control is needed (version-checked
updates, constraints TypeORM cannot express) and MUST be covered by integration tests.

## Development Workflow & Quality Gates

- Work follows the Spec Kit flow: `/speckit-specify` → `/speckit-clarify` (as needed) →
  `/speckit-plan` → `/speckit-tasks` → `/speckit-implement`. Each feature lives on its own branch
  with artifacts under `specs/<feature>/`.
- Every plan MUST pass a Constitution Check against Principles I–VIII before research and again
  after design. Violations are listed with justification in Complexity Tracking, or the plan is
  revised.
- CI gate on every change, in order: lint → type-check → unit tests → integration tests
  (Testcontainers). A change that fails any step MUST NOT be merged.
- CI's lint step MUST include the layer-boundary rules (Principle IV). A boundary violation fails
  the build like any other lint error.
- Reviews MUST check: tenant scoping on every new query, constraint-name handling on every new
  write path, absence of PII in new logs/events, no new inward-to-outward imports, and a test for
  every new correctness claim.
- AI-generated claims about library behaviour (e.g. TypeORM `@Exclusion` partial `WHERE`, `pg`
  error `constraint` field, `ValidationPipe` 422) MUST be verified by a test or documentation
  check before code depends on them.
- `docs/system-design.md` is the design reference. When implementation changes a design decision,
  the design document MUST be updated in the same change.

## Governance

- This constitution supersedes other practices and guidance in this repository. Where a spec,
  plan or task conflicts with it, the constitution wins until amended.
- **Amendments:** propose the change in a PR that edits this file, updates the Sync Impact Report,
  propagates changes to `.specify/templates/*` and `docs/system-design.md` as needed, and states
  the migration impact on existing specs and code.
- **Versioning:** semantic versioning. MAJOR for removing or redefining a principle; MINOR for a
  new principle or section or materially expanded guidance; PATCH for clarifications and wording.
- **Compliance:** every `/speckit-plan` Constitution Check and every code review verifies
  compliance. Unjustified complexity or a NON-NEGOTIABLE violation blocks merge.
- Runtime development guidance for agents lives in `CLAUDE.md` and the current feature plan.

**Version**: 2.0.0 | **Ratified**: 2026-11-02 | **Last Amended**: 2026-11-02
