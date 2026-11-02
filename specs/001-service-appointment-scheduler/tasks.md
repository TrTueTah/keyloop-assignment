---
description: "Task list for feature 001: Unified Service Scheduler"
---

# Tasks: Unified Service Scheduler

**Input**: Design documents from `specs/001-service-appointment-scheduler/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/openapi.yaml](./contracts/openapi.yaml), [quickstart.md](./quickstart.md)
**Governing rules**: [constitution v2.0.0](../../.specify/memory/constitution.md). Read Principle IV (layer import rules) before writing any file.

**Tests**: MANDATORY (Constitution Principle III).
- Integration, concurrency, isolation and schema tests run against **real PostgreSQL via Testcontainers**.
- In-memory port fakes are allowed **only** in `test/unit/application/` for orchestration, never as proof of a database guarantee.
- Within each story, write the test tasks first and watch them fail.

**Organization**: Grouped by user story (spec priorities P1–P5). Each story phase ends with a checkpoint where the story's tests pass on their own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US5, mapping to spec.md user stories
- Paths are relative to the repository root (single backend project, per plan.md)

## Conventions every task must follow

- **Layer imports (Principle IV):**
  - `src/domain/**` imports only `luxon` and other domain files.
  - `src/application/**` imports only `src/domain/**` and `node:crypto`.
  - `src/presentation/**` never imports `src/infrastructure/**`, and vice versa.
  - Only `src/main.ts`, `src/tracing.ts`, `src/app.module.ts` and `src/modules/**` may import across all layers.
- **Error codes:** use only the codes in `src/domain/errors.ts`, which match `ErrorCode` in `contracts/openapi.yaml`. Adding a code means updating the contract, `docs/system-design.md` §7 and `errors.ts` in the same task (Principle VI).
- **Tenant scoping:** every repository/query method takes `TenantContext` as its first argument and filters by `tenant_id` and/or `dealership_id` (Principle II).
- **No PII:** never log, trace, put in metrics, or put in events/problem bodies any customer `name`, `email` or `phone` (Principle VII).
- **Time:** the system clock is read only in `src/infrastructure/time/system-clock.ts`. Everything else gets "now" from the `Clock` port.
- **Seed IDs:** fixed UUIDs as listed in `quickstart.md` §2 (tenants `11111111-…`, dealerships `22222222-…`, service types `33333333-…`, customers `44444444-…`, vehicles `55555555-…`; technicians `66666666-…`, bays `77777777-…`).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Toolchain, quality gates and runtime scaffolding (research R1).

- [X] T001 Create `package.json`, `.nvmrc` and `pnpm-lock.yaml`:
  - **Package manager:** pnpm.
  - **Engines:** `"engines": {"node": ">=24 <25"}`. `.nvmrc` contains `24`.
  - **Dependencies:** `@nestjs/{core,common,platform-express,swagger,terminus,typeorm}@^11`, `typeorm@0.3.31`, `pg@^8`, `reflect-metadata`, `rxjs`, `class-validator@^0.14`, `class-transformer@^0.5`, `luxon@^3`, `nestjs-pino@^4`, `pino-http`, `pino`, `@opentelemetry/{sdk-node,auto-instrumentations-node,exporter-prometheus,exporter-trace-otlp-http,api}`.
  - **Dev dependencies:** `typescript@~5.9`, `@types/{node,luxon,express,jest,supertest,pg}`, `jest@^30`, `ts-jest@^29.4`, `supertest`, `@testcontainers/postgresql@^11`, `@nestjs/testing@^11`, `eslint`, `typescript-eslint`, `eslint-config-prettier`, `prettier`, `ts-node`, `js-yaml`, `@types/js-yaml`.
  - **Scripts:** `build`, `start`, `start:dev`, `lint`, `typecheck` (`tsc --noEmit`), `test` (unit project), `test:int`, `test:e2e`, `test:all`, `db:migrate`, `db:seed`, `demo:race`, `perf:smoke`.
  - **Do not add any `migration:generate` script** (research R3).
- [X] T002 Create `tsconfig.json` (`strict: true`, `experimentalDecorators`, `emitDecoratorMetadata`, `target: ES2023`, `module: commonjs`, `outDir: dist`, `rootDir: .`) and `tsconfig.build.json` (excludes `test/`, `scripts/`).
- [X] T003 [P] Create `eslint.config.mjs` (flat config, `typescript-eslint` strict + `eslint-config-prettier`), with per-layer `no-restricted-imports` overrides that implement the Principle IV table:
  - `src/domain/**` bans everything except relative domain paths and `luxon`.
  - `src/application/**` bans `@nestjs/*`, `typeorm`, `pg`, `express`, `@opentelemetry/*`, `pino*`, `nestjs-pino`, `**/infrastructure/**` and `**/presentation/**`.
  - `src/presentation/**` bans `**/infrastructure/**`, `typeorm` and `pg`.
  - `src/infrastructure/**` bans `**/presentation/**`.
  - `src/main.ts`, `src/tracing.ts`, `src/app.module.ts` and `src/modules/**` are exempt.
- [X] T004 [P] Create `.prettierrc`, `.editorconfig` and `.gitignore` (`node_modules`, `dist`, `coverage`, `.env`).
- [X] T005 [P] Create `jest.config.ts` with three projects:
  - `unit`: `test/unit/**/*.spec.ts`, `test/architecture/**/*.spec.ts`.
  - `int`: `test/integration/**/*.int-spec.ts`, with `globalSetup: test/setup/global-setup.ts`, `globalTeardown: test/setup/global-teardown.ts`, `maxWorkers: 1` and `testTimeout: 60000`.
  - `e2e`: `test/e2e/**/*.e2e-spec.ts`, with the same global setup.

  All three use `ts-jest` and set `OTEL_SDK_DISABLED=true` through `test/setup/env.ts`.
- [X] T006 [P] Create a multi-stage `Dockerfile` (`node:24-alpine`, pnpm via corepack, build, prune dev deps). The CMD is `node --require ./dist/src/tracing.js dist/src/main.js`.
- [X] T007 [P] Create `docker-compose.yml`:
  - `api` (port 3000; env `DATABASE_URL`, `OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318`)
  - `postgres` (`postgres:17-alpine`, port 5432, `pg_isready` healthcheck)
  - `jaeger` (`jaegertracing/all-in-one`, ports 16686 and 4318, `COLLECTOR_OTLP_ENABLED=true`)
- [X] T008 [P] Create `.github/workflows/ci.yml`: Node 24 + pnpm install, then `pnpm lint` → `pnpm typecheck` → `pnpm test` → `pnpm test:int` → `pnpm test:e2e`. Stop on the first failure. Ubuntu runners have Docker for Testcontainers.
- [X] T009 [P] Create `.env.example` (`PORT`, `DATABASE_URL`, `DB_POOL_MAX`, `LOG_LEVEL`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SDK_DISABLED`, `OTEL_SERVICE_NAME`) and `src/infrastructure/config/env.ts`, which parses and validates the env vars into a typed `AppConfig` and fails fast on missing values.
- [X] T010 Create the Clean Architecture folder skeleton with `.gitkeep` files: `src/domain/model`, `src/application/ports`, `src/application/use-cases`, `src/presentation/http/{tenant,idempotency,problem,dto,controllers}`, `src/infrastructure/{persistence/{orm-entities,mappers,repositories,migrations,seed},time,ids,observability,config}`, `src/modules`, `test/{unit/{domain,application,infrastructure,presentation},integration,e2e,architecture,setup}`, `scripts`.

**Checkpoint**: `pnpm install && pnpm lint && pnpm typecheck` pass on an empty skeleton.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, domain core, ports, adapters and the HTTP platform that every story needs.

**⚠️ CRITICAL**: No user-story work can begin until this phase is complete.

### 2a. Schema and test database (data-model §1, research R3/R11)

- [X] T011 Create migration `src/infrastructure/persistence/migrations/1762000000001-ReferenceSchema.ts` as hand-written SQL via `queryRunner.query`. It creates the extensions `pgcrypto` and `btree_gist`, and every reference table in data-model §1 (`tenant`, `dealership`, `opening_hours`, `skill`, `bay_capability`, `service_type`, `service_type_capability`, `technician`, `technician_skill`, `service_bay`, `service_bay_capability`, `customer`, `vehicle`), with exactly the named UNIQUE, CHECK and FK constraints listed (`uq_dealership_tenant`, `uq_technician_site`, `uq_bay_site`, `uq_customer_tenant`, `uq_vehicle_tenant`, `uq_service_tenant`, `uq_vehicle_vin`). Include `down()`.
- [X] T012 Create migration `src/infrastructure/persistence/migrations/1762000000002-AppointmentSchema.ts`:
  - **Tables:** `appointment` and `appointment_event`, with all columns and CHECKs from data-model §1.
  - **Exclusion constraints:** `no_technician_overlap`, `no_bay_overlap` and `no_vehicle_overlap` (`EXCLUDE USING gist (... WITH =, tstzrange(start_at, end_at, '[)') WITH &&) WHERE (status = 'CONFIRMED')`).
  - **Other constraints:** `valid_interval`, the composite FKs `fk_appt_site`, `fk_appt_tech`, `fk_appt_bay`, `fk_appt_customer`, `fk_appt_vehicle` and `fk_appt_service`, and the unique index `uq_appt_idempotency (tenant_id, idempotency_key)`.
  - **Indexes:** `ix_appt_site_day` (partial), `ix_appt_site_list`, `ix_event_appt` and `ix_event_unpublished`.
  - **Do not** create `resource_unavailability`.
- [X] T013 Create `src/infrastructure/persistence/data-source.ts`, a TypeORM `DataSource` for `postgres` from `AppConfig`, with `synchronize: false`, `migrationsRun: false`, `migrations: [dist|src]/infrastructure/persistence/migrations/*`, `extra.max = DB_POOL_MAX` and entities from `orm-entities/`. Also create `scripts/db-migrate.ts`, which runs `dataSource.runMigrations()` and backs the `db:migrate` script.
- [X] T014 Create `src/infrastructure/persistence/seed/fixtures.ts` (the exact data-model §6 dataset with fixed UUIDs) and `src/infrastructure/persistence/seed/seed.ts` (idempotent upsert of the fixtures; validates each dealership timezone with Luxon `IANAZone.isValidZone`). `db:seed` runs it.
  - Fixture constants must be exported for tests.
  - Acme Leeds: 4 technicians (one inactive) and 4 bays (`LIFT`; `LIFT+ALIGNMENT_RIG`; `LIFT+EV_CHARGER`; one inactive).
  - Also include a dedicated **"Race Bay" dealership** with exactly 1 GENERAL technician and 1 LIFT bay, for concurrency tests and `demo:race`.
- [X] T015 Create the Testcontainers harness in `test/setup/`:
  - `test/setup/global-setup.ts`: start `postgres:17-alpine`, run migrations and the seed, write `DATABASE_URL` to `process.env` and to a temp file read by workers.
  - `test/setup/global-teardown.ts`: stop the container.
  - `test/setup/db.ts`: `truncateTransactional()` truncates `appointment_event` and `appointment`. `sql(query, params)` is a raw `pg` client helper.
  - `test/setup/env.ts`: sets `OTEL_SDK_DISABLED=true` and `DB_POOL_MAX=25`.
- [X] T016 [P] Write the schema test `test/integration/schema.int-spec.ts`. It queries `pg_constraint` / `pg_get_constraintdef` and asserts:
  - the three exclusion constraints exist, using gist with `WHERE ((status)::text = 'CONFIRMED'::text)` and `'[)'`
  - all six `fk_appt_*` constraints exist with the right column pairs
  - `uq_appt_idempotency` exists
  - the `btree_gist` extension is installed
  - no `resource_unavailability` table exists

  This guards Principle V ("migrations MUST NOT silently drop").
- [X] T017 [P] Write `test/integration/tenant-isolation.int-spec.ts`, describe block **"database-level"**. Each of the following direct-SQL `INSERT`s is rejected by the composite FK named in parentheses:
  - an appointment using Acme York's technician at Acme Leeds (`fk_appt_tech`)
  - Beta's vehicle at an Acme dealership (`fk_appt_vehicle`)
  - Beta's customer (`fk_appt_customer`)
  - Beta's service type (`fk_appt_service`)
  - a dealership/tenant mismatch (`fk_appt_site`)

### 2b. Domain core: pure TypeScript, TDD (research R9, data-model §5)

- [X] T018 [P] Write `test/unit/domain/interval.spec.ts`. Half-open overlap cases: touching (10:00–11:00 vs 11:00–12:00 → no overlap), nested, partial left/right, identical, zero gap.
- [X] T019 [P] Write `test/unit/domain/time.spec.ts`:
  - `localDayBounds` and `openingWindow` for `Europe/London` on a normal day, on **2026-03-29** (23 h) and on **2026-10-25** (25 h)
  - a closed weekday returns `null`
  - `isOnGrid` is true for local :00/:15/:30/:45 with 0 seconds and false otherwise
  - `slotStarts` for an 08:00–17:00 window with a 60-min duration runs from 08:00 to 16:00 inclusive in 15-min steps
- [X] T020 [P] Write `test/unit/domain/qualification.spec.ts`:
  - a technician is qualified iff they are active and hold the required skill
  - a bay is compatible iff it is active and has **all** required capabilities
  - zero required capabilities → any active bay qualifies
- [X] T021 [P] Write `test/unit/domain/least-loaded-policy.spec.ts`:
  - ranks by `bookedMinutes` ascending, then `capabilityCount` ascending, then `id` ascending (deterministic)
  - an equal-load bay without unneeded specialist equipment wins
  - an SC-007 simulation: sequentially allocate N mixed-duration bookings across equally skilled technicians, then assert that max − min booked minutes ≤ the longest duration
- [X] T022 Create `src/domain/errors.ts`: the `ErrorCode` string union with exactly the 18 codes in `contracts/openapi.yaml#/components/schemas/ErrorCode`, and `class DomainError extends Error { code; detail?; meta? }`, where `meta` carries non-PII extras such as `alternatives` and field `errors`.
- [X] T023 Create the domain model types in `src/domain/model/` as plain readonly types/classes with no I/O: `dealership.ts` (id, tenantId, timezone, `OpeningHours[]`), `service-type.ts` (durationMinutes, requiredSkill, requiredCapabilities), `technician.ts` (id, active, skills), `service-bay.ts` (id, active, capabilities), `appointment.ts` (all fields from data-model §1, status/assignmentMode/channel unions, `isConfirmed()`).
- [X] T024 [P] Implement `src/domain/interval.ts` (`Interval`, `overlaps`, `minutesOf`) so that T018 passes.
- [X] T025 [P] Implement `src/domain/time.ts` (`localDayBounds`, `openingWindow`, `isOnGrid`, `toZone`) and `src/domain/slot-grid.ts` (`slotStarts(window, durationMin, stepMin = 15)`) using Luxon only, so that T019 passes. No `DateTime.now()` anywhere in `src/domain`.
- [X] T026 [P] Implement `src/domain/qualification.ts` (`isQualified(tech, serviceType)`, `isCompatible(bay, serviceType)`, `checkPinnedTechnician` / `checkPinnedBay`, which return `ErrorCode | null` for `RESOURCE_INACTIVE`, `TECHNICIAN_NOT_QUALIFIED` and `BAY_NOT_COMPATIBLE`) so that T020 passes.
- [X] T027 [P] Implement `src/domain/allocation-policy.ts` (`interface AllocationPolicy { rank(c: ResourceCandidate[]): ResourceCandidate[] }`, `ResourceCandidate`, `LeastLoadedPolicy`) so that T021 passes.

### 2c. Application ports and test fakes (constitution IV)

- [X] T028 Create `src/application/tenant-context.ts` (`TenantContext { tenantId; dealershipId?; userId }`) and the infrastructure-agnostic ports, each with a `Symbol` DI token, in `src/application/ports/`:
  - `clock.ts`: `Clock { now(): DateTime }`
  - `id-generator.ts`: `IdGenerator { next(): string }`
  - `unit-of-work.ts`: `UnitOfWork { run<T>(work: (tx: TxScope) => Promise<T>): Promise<T> }`, where `TxScope` exposes `appointments`, `events` and `resources`
  - `telemetry.ts`: `count`, `observe`, `span<T>(name, attrs, fn)`
  - `request-context.ts`: `RequestContextStore { run(ctx, fn); current(); set(partial) }`, where `RequestContext { requestId; tenant?: TenantContext }`
  - `health-probe.ts`: `HealthProbe { check(): Promise<{ db: boolean; migrations: boolean }> }`
- [X] T029 Create the persistence ports in `src/application/ports/`, using domain types only:
  - `appointment.repository.ts`:
    - `insert(ctx, appt): Promise<InsertOutcome>`, where `InsertOutcome = inserted | conflict on 'technician'|'bay'|'vehicle'|'idempotency_key'`
    - `findById(ctx, id)`
    - `findByIdempotencyKey(ctx, key)` → `{ appointment, requestHash } | null`
    - `updateIfVersion(ctx, id, expectedVersion, patch, now): Promise<UpdateOutcome>`, where `UpdateOutcome = updated | not_found | not_confirmed | stale | conflict on 'technician'|'bay'`
    - `listForDay(ctx, range, filters, page)`
  - `appointment-event.repository.ts`: `append(ctx, event)` and `listForAppointment(ctx, id)`.
  - `resource.query.ts`:
    - `findCandidates(ctx, serviceType, interval, localDay, excludedIds)` → `{ technicians: ResourceCandidate[]; bays: ResourceCandidate[] }`
    - `getTechnician` / `getBay(ctx, id)`
    - `availabilitySnapshot(ctx, serviceType, range)`
  - `reference.query.ts`:
    - `findDealershipInTenant(tenantId, dealershipId)`
    - `getDealership(ctx)` (with opening hours)
    - `getServiceType(ctx, id)`
    - `getCustomerVehicle(ctx, customerId, vehicleId)` → `{ customerExists; vehicle?; ownedByCustomer }`
    - `listDealerships`, `listServiceTypes`, `listTechnicians`, `listBays`
  - `idempotency.store.ts`: `findByKey(ctx, key)`.
- [X] T030 [P] Create in-memory fakes for orchestration-only use-case tests in `test/unit/application/fakes/`: `fake-clock.ts`, `sequential-id-generator.ts`, `recording-telemetry.ts`, `in-memory-unit-of-work.ts` (with a programmable outcome queue for `insert`/`updateIfVersion`), `in-memory-reference.ts` (backed by `fixtures.ts`), `in-memory-resources.ts`. Add a header comment: "NOT evidence for DB guarantees (Constitution III)".

### 2d. Infrastructure adapters (research R2, R6, R10)

- [X] T031 *(Deviation: only `appointment` and `appointment_event` are mapped. Reference tables are read with aggregated SQL, so per-table entities would be unused; see `orm-entities/index.ts`.)* Create the TypeORM ORM entities in `src/infrastructure/persistence/orm-entities/`, one file per table in data-model §1. They're **column mappings only**: no `@ManyToOne` on the composite-FK columns, and **no `@VersionColumn`** (`version` is a plain `@Column`). Create the row↔domain mappers in `src/infrastructure/persistence/mappers/` (`appointment.mapper.ts`, `reference.mapper.ts`).
- [X] T032 [P] Write `test/unit/infrastructure/pg-errors.spec.ts`, which pins the mapping table:
  - `23P01` + `no_technician_overlap` → `conflict on technician`; `no_bay_overlap` → `bay`; `no_vehicle_overlap` → `vehicle`
  - `23505` + `uq_appt_idempotency` → `idempotency_key`
  - any other code or constraint → `null` (rethrow)
- [X] T033 Implement `src/infrastructure/persistence/pg-errors.ts` (`toInsertConflict`, `toUpdateConflict`, reading `QueryFailedError.driverError.{code,constraint}`) so that T032 passes.
- [X] T034 Implement `src/infrastructure/persistence/typeorm-unit-of-work.ts`. `run()` uses `dataSource.transaction('READ COMMITTED', ...)` and builds the transactional repositories on the transaction's `EntityManager`. If `work` returns a conflict outcome, throw an internal `RollbackSentinel` holding the outcome, then catch it outside the transaction and return the outcome (research R6). Other errors propagate.
- [X] T035 [P] Implement `src/infrastructure/time/system-clock.ts` (Luxon `DateTime.utc()`) and `src/infrastructure/ids/uuid-generator.ts` (`crypto.randomUUID()`).
- [X] T036 [P] Implement `src/infrastructure/observability/als-request-context.ts` (`RequestContextStore` backed by `AsyncLocalStorage`).
- [X] T037 [P] Implement `src/infrastructure/observability/otel-telemetry.ts` (`Telemetry` over `@opentelemetry/api` meter and tracer). `count`/`observe` **throw in non-production and drop in production** when given a `tenant_id` or `dealership_id` attribute. `span` puts those IDs on span attributes only. Test it in `test/unit/infrastructure/otel-telemetry.spec.ts`.
- [X] T038 [P] Create `src/infrastructure/observability/logger.config.ts`:
  - `nestjs-pino` params that produce JSON
  - a `customProps` function reading `request_id`, `tenant_id`, `dealership_id` and `trace_id` from the `RequestContextStore` instance and the active OTel span
  - `redact: ['*.email', '*.phone', '*.name', 'req.headers.authorization']`
  - a `genReqId` that honours an incoming `X-Request-ID`
- [X] T039 [P] Create `src/tracing.ts`: OTel `NodeSDK` with `getNodeAutoInstrumentations()` (http, express, pg), an OTLP HTTP trace exporter, and a `PrometheusExporter({ preventServerStart: true })` exported as a singleton for `main.ts`. It does nothing when `OTEL_SDK_DISABLED=true`, and shuts down on SIGTERM.
- [X] T040 [P] Implement `src/infrastructure/persistence/health-probe.adapter.ts` (`SELECT 1`, plus a check that the latest migration name from the migrations folder is in the `migrations` table).
- [X] T041 Implement `src/infrastructure/persistence/repositories/typeorm-reference.query.ts`, the `ReferenceQuery` adapter. For this phase implement `findDealershipInTenant` (one query on `dealership WHERE id = $1 AND tenant_id = $2`) and `getDealership` (dealership plus `opening_hours`). Leave the other methods to throw `not implemented` until their story.

### 2e. Tenant resolution and the HTTP platform (constitution II/VI)

- [X] T042 Implement `src/application/use-cases/resolve-tenant-context.ts` (`ResolveTenantContext.execute(tenantId, userId, dealershipId?)` → `TenantContext`; throws `DomainError('NOT_FOUND')` when the dealership is missing **or** belongs to another tenant). Test it in `test/unit/application/resolve-tenant-context.spec.ts` with the fakes.
- [X] T043 [P] Implement `src/presentation/http/problem/problem.filter.ts`:
  - It's a global `ExceptionFilter`.
  - It maps `DomainError.code` → HTTP status:
    - 404: NOT_FOUND
    - 409: SLOT_UNAVAILABLE, RESOURCE_UNAVAILABLE, VEHICLE_ALREADY_BOOKED, STALE_VERSION, NOT_CONFIRMED
    - 422: every other domain code
    - 500: INTERNAL_ERROR
  - The body is RFC 9457 `application/problem+json` with `type`, `title`, `status`, `code`, `detail`, `instance`, `requestId`, plus `alternatives` / `errors` from `meta`.
  - Unknown errors → 500 `INTERNAL_ERROR` with a generic detail; the stack is logged, never returned.
  - Test the mapping in `test/unit/presentation/problem.filter.spec.ts`.
- [X] T044 [P] Implement `src/presentation/http/validation.ts`, which exports `createValidationPipe()`: `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, errorHttpStatusCode: 422, exceptionFactory })`. The factory throws `DomainError('VALIDATION_FAILED', { errors: [{field, message}] })` (research R4).
- [X] T045 Implement `src/presentation/http/tenant/`:
  - `request-id.middleware.ts`: starts `RequestContextStore.run({ requestId })` and sets the `X-Request-ID` response header.
  - `tenant.guard.ts`: requires `X-Tenant-ID` (uuid) and `X-User-ID` (1–128 chars), otherwise `VALIDATION_FAILED`. It calls `ResolveTenantContext` with the `:dealershipId` route param when present, then stores the context with `RequestContextStore.set({ tenant })`.
  - `tenant-context.decorator.ts`: `@Tenant()` param decorator reading from the store.

  Inject everything through port tokens only.
- [X] T046 [P] Implement `src/presentation/http/idempotency/idempotency-key.decorator.ts` (`@IdempotencyKey()` param decorator: header present, 1–255 printable ASCII characters, otherwise `DomainError('VALIDATION_FAILED')`). It has no storage access (research R8).
- [X] T047 [P] Implement `src/presentation/http/controllers/health.controller.ts` (`GET /health/live` always ok; `GET /health/ready` uses `@nestjs/terminus` `HealthCheckService` with a custom indicator that calls the `HealthProbe` port; 503 when not ready). Exclude it from `TenantGuard`.
- [X] T048 Create the composition root in `src/modules/`, `src/app.module.ts` and `src/main.ts`:
  - `src/modules/platform.module.ts` binds `CLOCK`, `ID_GENERATOR`, `TELEMETRY`, `REQUEST_CONTEXT`, `HEALTH_PROBE`, `UNIT_OF_WORK` and `REFERENCE_QUERY` to their adapters, and registers `LoggerModule.forRoot(loggerConfig)`, `TypeOrmModule.forRoot(dataSourceOptions)` and `TerminusModule`.
  - `src/modules/scheduling.module.ts` and `src/modules/reference.module.ts` start empty and are filled per story. Use cases are registered with `useFactory` + port tokens.
  - `src/app.module.ts` imports them.
  - `src/main.ts` sets the global filter, `createValidationPipe()`, the request-id middleware, the Swagger doc at `/docs` and `/openapi.json` (OpenAPI 3.1), mounts `GET /metrics` via `prometheusExporter.getMetricsRequestHandler`, calls `enableShutdownHooks()` and listens on `PORT`.
- [X] T049 Create `test/setup/app.ts`, with `createTestApp()` that builds `AppModule` against the Testcontainers `DATABASE_URL`, applies the same global setup as `main.ts` (shared via an exported `configureApp(app)` in `src/main.ts`), `listen(0)`, and returns `{ app, baseUrl, http: supertest(baseUrl) }`. Add header helpers `asAcme(userId = 'advisor-1')` and `asBeta()`.
- [X] T050 [P] Write `test/architecture/boundaries.spec.ts`. It uses the ESLint Node API to lint in-memory fixture snippets placed at virtual paths, and asserts the following are errors while the composition root is not:
  - `src/domain/x.ts` importing `@nestjs/common`
  - `src/application/x.ts` importing `typeorm` and `../infrastructure/...`
  - `src/presentation/x.ts` importing `../../infrastructure/...`
  - `src/infrastructure/x.ts` importing `../presentation/...`
- [X] T051 Write `test/e2e/platform.e2e-spec.ts`:
  - `/health/live` → 200; `/health/ready` → 200
  - an unknown dealership → 404 problem+json with `code: NOT_FOUND`
  - a missing `X-Tenant-ID` → 422 `VALIDATION_FAILED`
  - a request with `X-Request-ID: abc` gets the same header back
  - `/metrics` → 200 text
  - `/openapi.json` → 200 with `openapi: 3.1.x`

**Checkpoint**: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:int && pnpm test:e2e` pass. The schema, DB-level isolation, domain, boundary and platform tests are green.

---

## Phase 3: User Story 1 — Book with automatic resource assignment (Priority: P1) 🎯 MVP

**Goal**: Book an appointment for a vehicle, service type and dealership at a desired time. Confirm only if a qualified technician **and** a compatible bay are free for the full duration. Auto-assign least-loaded, safe under concurrency and resubmission (FR-001–FR-010, FR-023–FR-026).

**Independent Test**: Against the seeded DB, `POST /api/v1/dealerships/{LEEDS}/appointments` for a free time returns 201 with a qualified technician and a compatible bay. The same resources at an overlapping time are refused. 20 parallel requests for the Race Bay slot give exactly one success.

### Tests for User Story 1 (MANDATORY: write first, watch them fail) ⚠️

- [X] T052 [P] [US1] Write `test/unit/domain/booking-rules.spec.ts` for `validateRequestedSlot(now, start, durationMin, dealership)`:
  - `START_IN_PAST`
  - `NOT_ON_SLOT_GRID` (10:07; 10:00:30)
  - `OUTSIDE_BOOKING_HORIZON` (> 90 days)
  - `OUTSIDE_OPENING_HOURS` (16:30 + 60 min at a 17:00 close; Sunday closed; a DST-day boundary)
  - valid → `null`
- [X] T053 [P] [US1] Write `test/unit/application/book-appointment.spec.ts` (fakes; orchestration only):
  - Ranking: the least-loaded pair is chosen.
  - On a `conflict on technician`, it retries with that technician excluded, in a new `uow.run`. It stops after 3 attempts with `SLOT_UNAVAILABLE`.
  - `conflict on vehicle` → `VEHICLE_ALREADY_BOOKED` with no retry.
  - Idempotency:
    - an existing key with the same hash → returns the original with `replayed: true` and doesn't insert
    - a different hash → `IDEMPOTENCY_KEY_REUSED`
    - an insert `conflict on idempotency_key` → re-read, then the same hash comparison
  - A `CREATED` event is appended in the same `TxScope`, with an ID-only payload.
  - "Now" comes from `FakeClock`. Telemetry records `bookings_total{outcome}` and `booking_conflicts_total{constraint}`.
- [X] T054 [P] [US1] Write `test/integration/booking.int-spec.ts` (HTTP + real PG):
  - spec US1 AS1 (201, 10:00–11:00 local, all links present, `assignmentMode: AUTO`, `Location` header)
  - AS2 (the only qualified technician busy → 409 `SLOT_UNAVAILABLE`, no row)
  - AS3 (no compatible bay → 409)
  - AS8 (each 422 code)
  - AS9 (`VEHICLE_NOT_OWNED_BY_CUSTOMER`)
  - AS10 (`VEHICLE_ALREADY_BOOKED`)
  - back-to-back 10:00/11:00 bookings both succeed
  - an inactive technician or bay is never assigned
  - unknown body property → 422
  - `durationMinutes` in the body → 422 (FR-002)
- [X] T055 [P] [US1] Write `test/integration/allocation.int-spec.ts`:
  - AS4: of two qualified technicians, the one with fewer booked minutes that local day is assigned; the same for bays
  - AS5: equal load → the bay with fewer capabilities wins
  - SC-007: book a day of mixed services at Acme Leeds and assert the technician-load spread ≤ the longest duration
- [X] T056 [P] [US1] Write `test/integration/booking.concurrency.int-spec.ts` (SC-001):
  - At the Race Bay dealership (1 technician, 1 bay), `Promise.all` 20 POSTs with distinct customers/vehicles/keys for the same slot. Assert exactly **1 × 201 and 19 × 409** and exactly 1 `CONFIRMED` row.
  - Repeat with 2 technicians and 1 bay (add a technician via direct SQL) → still exactly 1 × 201.
  - Run each scenario 5 times in a loop.
- [X] T057 [P] [US1] Write `test/integration/idempotency.int-spec.ts` (SC-003):
  - a replay with an identical body → 200 and the same `id`/body
  - same key with a changed `startAt` → 422 `IDEMPOTENCY_KEY_REUSED`
  - missing header → 422 `VALIDATION_FAILED`
  - 20 parallel identical requests with one key → exactly 1 row, and every response (201 or 200) carries the same `id`
  - after a 409, the same key can succeed once the slot is freed (cancel via direct SQL `UPDATE status`)
- [X] T058 [US1] Extend `test/integration/tenant-isolation.int-spec.ts` with describe block **"api-level"** (SC-006). As Beta:
  - POST at an Acme dealership → 404
  - as Acme, Beta's vehicle, customer or service type in the body → 404
  - GET an Acme appointment ID under Beta → 404
  - responses never reveal existence (identical problem body shape and code `NOT_FOUND`)

### Implementation for User Story 1

- [X] T059 [P] [US1] Implement `src/domain/booking-rules.ts` (`validateRequestedSlot`, using `time.ts`, `slot-grid.ts`, 90-day horizon, 15-min grid) so that T052 passes.
- [X] T060 [P] [US1] Complete the US1 parts of `typeorm-reference.query.ts`:
  - `getServiceType(ctx, id)`: the tenant's service type, with its required skill code and capability codes.
  - `getCustomerVehicle(ctx, customerId, vehicleId)`: one query; vehicle and customer both filtered by `ctx.tenantId`.
- [X] T061 [US1] Implement `src/infrastructure/persistence/repositories/typeorm-resource.query.ts`, method `findCandidates`. It runs **two** parameterised SQL queries (technicians, bays). Each returns active resources at `ctx.dealershipId` that:
  - meet the skill (technicians) or **all** capabilities (bays, via `HAVING COUNT` against `service_type_capability`)
  - have no `CONFIRMED` appointment overlapping `tstzrange($start,$end,'[)')`
  - aren't in `excludedIds`

  Each row also carries `capability_count` and `booked_minutes` (sum of the minutes of that resource's `CONFIRMED` appointments within the local-day bounds).
- [X] T062 [US1] Implement `src/infrastructure/persistence/repositories/typeorm-appointment.repository.ts`:
  - `insert` returns `InsertOutcome` via `pg-errors.ts`
  - `findById(ctx, id)` is tenant + dealership scoped
  - `findByIdempotencyKey`

  Also implement `typeorm-appointment-event.repository.ts` (`append`) and `typeorm-idempotency.store.ts`. Register all three in the `TxScope` built by `TypeOrmUnitOfWork`.
- [X] T063 [US1] Implement `src/application/use-cases/book-appointment.ts`, `BookAppointment.execute(cmd, ctx)`. Use the flow from research R6/R8:
  1. Canonical `requestHash` with `node:crypto` sha256.
  2. `IdempotencyStore.findByKey` → replay or `IDEMPOTENCY_KEY_REUSED`.
  3. Load the service type, dealership and customer/vehicle → `NOT_FOUND` / `VEHICLE_NOT_OWNED_BY_CUSTOMER`.
  4. `validateRequestedSlot(clock.now(), ...)`.
  5. Loop up to 3 times inside `uow.run`:
     - `findCandidates` with `excluded`
     - `telemetry.span('allocate')` → `LeastLoadedPolicy.rank`
     - nothing left → `SLOT_UNAVAILABLE`
     - build the `Appointment` (`id` from `IdGenerator`, `end = start + duration`, status `CONFIRMED`, `assignmentMode: AUTO`, `channel` default `ADVISOR`, `createdBy` from ctx)
     - `insert`
     - on `inserted`, `events.append(CREATED, { technicianId, serviceBayId, startAt, endAt })`
     - on conflict, apply the R6 table (technician/bay → exclude and continue; vehicle → `VEHICLE_ALREADY_BOOKED`; idempotency_key → re-read)
  6. Emit `bookings_total{outcome, assignment_mode, channel}`, `booking_conflicts_total{constraint}`, `booking_retry_attempts_total` and the `booking_duration_seconds` histogram.

  This must make T053 pass.
- [X] T064 [P] [US1] Create the DTOs in `src/presentation/http/dto/`:
  - `create-appointment.request.ts`: class-validator + `@ApiProperty`, matching `CreateAppointmentRequest` with `additionalProperties: false`. `startAt` is ISO-8601 **with offset**. `channel` is an enum with default `ADVISOR`. `technicianId` and `serviceBayId` are optional uuids, declared now and used in US4.
  - `appointment.response.ts`: matches the `Appointment` schema, with times rendered in the dealership's offset.
  - `appointment.mapper.ts`: DTO → `BookAppointmentCommand`, and domain → response.
- [X] T065 [US1] Implement `src/presentation/http/controllers/appointments.controller.ts`:
  - `POST /api/v1/dealerships/:dealershipId/appointments`: `@UseGuards(TenantGuard)`, `@IdempotencyKey()`, `@Tenant()`. It calls `BookAppointment` and returns **201** with `Location: /api/v1/dealerships/{id}/appointments/{apptId}`, or **200** when `replayed`.
  - `GET /api/v1/dealerships/:dealershipId/appointments/:appointmentId`: uses `src/application/use-cases/get-appointment.ts` (`GetAppointment`, NOT_FOUND when absent).

  Swagger decorators list the 201/200/404/409/422 responses.
- [X] T066 [US1] Wire into `src/modules/scheduling.module.ts`: factory providers for `BookAppointment` and `GetAppointment`, the `RESOURCE_QUERY`, `APPOINTMENT_REPOSITORY`, `IDEMPOTENCY_STORE` and `ALLOCATION_POLICY` (`LeastLoadedPolicy`) bindings, and `AppointmentsController`. Run T053–T058 until green.

**Checkpoint**: US1 tests pass (T052–T058). This is a working MVP: race-safe, idempotent, tenant-isolated booking.

---

## Phase 4: User Story 2 — See availability and get alternatives (Priority: P2)

**Goal**: List the free start times for a service type on a local date, and add up to 5 alternatives to `SLOT_UNAVAILABLE` refusals (FR-011–FR-013).

**Independent Test**: Seed a day with some appointments and call `GET …/availability`. Exactly the times where both a qualified technician and a compatible bay are free for the full duration are returned. Booking a taken time returns 409 with `alternatives`.

### Tests for User Story 2 (MANDATORY) ⚠️

- [X] T067 [P] [US2] Write `test/unit/domain/availability-calculator.spec.ts`:
  - An 08:00–17:00 window with 60 min → starts 08:00…16:00, removing starts where every qualified technician **or** every compatible bay is busy.
  - `availableTechnicians` / `availableBays` counts are correct.
  - A closed day gives `[]`. DST days (2026-03-29 / 2026-10-25) follow local opening hours.
  - `findAlternatives`: same day first (after the requested time, then earlier on the same day), then the following days up to 7, at most 5, and `[]` when nothing is free.
- [X] T068 [P] [US2] Write `test/unit/application/search-availability.spec.ts` (fakes): it calls `availabilitySnapshot` exactly once per request, wraps the work in `telemetry.span('computeAvailability')`, and an unknown service type → `NOT_FOUND`.
- [X] T069 [P] [US2] Write `test/integration/availability.int-spec.ts`:
  - spec US2 AS1–AS4
  - booking a fully taken time → 409 `SLOT_UNAVAILABLE` with ≤ 5 `alternatives`, each of which then books successfully
  - no capacity in 7 days → `alternatives: []`
  - **bounded queries**: count the SQL statements issued during one availability request (TypeORM `logger` hook captured in the test app) and assert ≤ 4, whatever the slot count (Principle VIII)

### Implementation for User Story 2

- [X] T070 [P] [US2] Implement `src/domain/availability-calculator.ts` (`computeSlots(window, durationMin, technicians, bays, busyByResource)` → `Slot[]`; `findAlternatives(requested, days = 7, max = 5, snapshotByDay)`) so that T067 passes.
- [X] T071 [US2] Implement `availabilitySnapshot(ctx, serviceType, range)` in `typeorm-resource.query.ts` with a fixed query count (≤ 4):
  1. Qualified, active technicians.
  2. Compatible, active bays.
  3. All `CONFIRMED` appointments for those resources overlapping `range`, as one range query.
  4. Opening hours, which come from `getDealership`.

  The same method serves a single day (availability) and the ≤ 7-day range (alternatives).
- [X] T072 [US2] Implement `src/application/use-cases/search-availability.ts` (`SearchAvailability.execute(ctx, serviceTypeId, localDate)`: load the dealership and service type, `localDayBounds`, snapshot, `span('computeAvailability')`, return `{ date, timezone, slots }`) so that T068 passes.
- [X] T073 [US2] Extend `src/application/use-cases/book-appointment.ts`: when it ends in `SLOT_UNAVAILABLE`, load a 7-day snapshot from the requested day, run `span('findAlternatives')` → `findAlternatives`, and throw `DomainError('SLOT_UNAVAILABLE', { alternatives })`. Update `test/unit/application/book-appointment.spec.ts` to assert alternatives are attached.
- [X] T074 [P] [US2] Create `src/presentation/http/dto/availability.query.ts` (`serviceTypeId` uuid, `date` ISO date) and `availability.response.ts` (the `AvailabilityResponse` / `Slot` schemas). Implement `src/presentation/http/controllers/availability.controller.ts` (`GET /api/v1/dealerships/:dealershipId/availability`, with `TenantGuard`).
- [X] T075 [US2] Register `SearchAvailability` and `AvailabilityController` in `src/modules/scheduling.module.ts`. Run T067–T069 until green.

**Checkpoint**: US1 and US2 both pass independently.

---

## Phase 5: User Story 3 — Cancel and free capacity (Priority: P3)

**Goal**: Cancel a confirmed appointment with a version check. The slot frees immediately, and a CANCELLED event is recorded (FR-018, FR-019).

**Independent Test**: Book or seed a slot, `POST …/cancel {version}` → `CANCELLED`, and the same slot books again. Cancelling again → 409 `NOT_CONFIRMED`. A stale version → 409 `STALE_VERSION`.

### Tests for User Story 3 (MANDATORY) ⚠️

- [X] T076 [P] [US3] Write `test/unit/application/cancel-appointment.spec.ts` (fakes): the outcomes `updated` → returns the appointment and appends a `CANCELLED` event in the same `TxScope`; `not_found` → `NOT_FOUND`; `not_confirmed` → `NOT_CONFIRMED`; `stale` → `STALE_VERSION`. Also covers the `cancellations_total` metric.
- [X] T077 [P] [US3] Write `test/integration/cancel.int-spec.ts`:
  - spec US3 AS1 (status `CANCELLED`, `version` +1, the slot shows up again in availability, and a rebooking succeeds)
  - AS2 (409 `NOT_CONFIRMED`)
  - AS3 (409 `STALE_VERSION`)
  - another tenant → 404
  - the `appointment_event` row is `CANCELLED`, with `actor = X-User-ID`

### Implementation for User Story 3

- [X] T078 [US3] Implement `updateIfVersion(ctx, id, expectedVersion, patch, now)` in `typeorm-appointment.repository.ts` with explicit SQL (research R7):
  ```sql
  UPDATE appointment SET …, version = version + 1, updated_at = $now
   WHERE id = $1 AND tenant_id = $2 AND dealership_id = $3 AND version = $4 AND status = 'CONFIRMED'
   RETURNING *
  ```
  - On zero rows, re-read to tell `not_found` / `not_confirmed` / `stale` apart.
  - Map a `23P01` to `conflict on technician|bay` via `pg-errors.ts`.
  - The `patch` type allows `{ status: 'CANCELLED' }` or `{ technicianId?, serviceBayId?, assignmentMode: 'MANUAL' }`.
- [X] T079 [US3] Implement `src/application/use-cases/cancel-appointment.ts` (`CancelAppointment.execute(ctx, id, version)`) inside `uow.run`, mapping the outcomes so that T076 passes.
- [X] T080 [P] [US3] Create `src/presentation/http/dto/versioned.request.ts` (`version` int ≥ 1, no other properties). Add `POST /api/v1/dealerships/:dealershipId/appointments/:appointmentId/cancel` to `appointments.controller.ts` (200 + the appointment).
- [X] T081 [US3] Register `CancelAppointment` in `src/modules/scheduling.module.ts`. Run T076–T077 until green.

**Checkpoint**: US1–US3 pass.

---

## Phase 6: User Story 4 — Manually choose or change the technician or bay (Priority: P4)

**Goal**: Optionally pin a technician and/or bay at booking, reassign afterwards, and list site resources (FR-014–FR-017, FR-022). Manual choices pass the same checks and are never substituted.

**Independent Test**: Booking with a pinned free, qualified technician assigns them (`MANUAL`). Pinning a busy one → 409 `RESOURCE_UNAVAILABLE`. A reassignment changes the technician and records a REASSIGNED event. An unqualified, inactive or other-site resource → 422.

### Tests for User Story 4 (MANDATORY) ⚠️

- [X] T082 [P] [US4] Write `test/unit/application/reassign-appointment.spec.ts` and extend `test/unit/application/book-appointment.spec.ts` (fakes):
  - a pinned technician is used as-is, the bay is still auto-ranked, and the mode is `MANUAL`
  - a pinned conflict → `RESOURCE_UNAVAILABLE` immediately, with **no retry**
  - a pin with the wrong skill, inactive, or from another dealership → `TECHNICIAN_NOT_QUALIFIED` / `RESOURCE_INACTIVE` / `RESOURCE_NOT_IN_DEALERSHIP`
  - reassignment outcomes → the error codes, and a `REASSIGNED` event with `before`/`after` IDs
  - the `reassignments_total` metric
- [X] T083 [P] [US4] Write `test/integration/assignment.int-spec.ts`:
  - spec US4 AS1–AS5 over HTTP
  - a reassignment that would overlap another job → 409 `RESOURCE_UNAVAILABLE` (proven by the real exclusion constraint)
  - stale `version` → 409 `STALE_VERSION`
  - `ReassignRequest` with only `version` → 422
- [X] T084 [P] [US4] Write `test/integration/reference.int-spec.ts`:
  - `GET /api/v1/dealerships` and `/api/v1/service-types` return only the caller tenant's rows
  - `GET …/technicians` (with skills) and `…/service-bays` (with capabilities) for Acme Leeds
  - as Beta → 404 on the Acme dealership routes

### Implementation for User Story 4

- [X] T085 [US4] Implement `getTechnician(ctx, id)` / `getBay(ctx, id)` in `typeorm-resource.query.ts`. They look up by ID within `ctx.tenantId`, return the owning `dealershipId` so the use case can report `RESOURCE_NOT_IN_DEALERSHIP`, and return `null` for other tenants (→ 404 `NOT_FOUND`). Add `pinned` handling to `findCandidates`: when a pinned ID is given, return only that resource if it's free, otherwise an empty list plus a `pinnedBusy` flag.
- [X] T086 [US4] Extend `src/application/use-cases/book-appointment.ts` for pins. Validate each pinned resource with `checkPinnedTechnician` / `checkPinnedBay` and the dealership check. Set `assignmentMode: 'MANUAL'` when either is pinned. A pinned resource busy or in conflict → `RESOURCE_UNAVAILABLE` with no retry. Unpinned resources keep the auto retry rules.
- [X] T087 [US4] Implement `src/application/use-cases/reassign-appointment.ts` (`ReassignAppointment.execute(ctx, id, { technicianId?, serviceBayId?, version })`):
  1. Load the appointment and its service type.
  2. Validate the new resources (same dealership, active, qualified/compatible).
  3. `uow.run` → `updateIfVersion` with `assignmentMode: 'MANUAL'`, mapping the outcomes (`conflict` → `RESOURCE_UNAVAILABLE`).
  4. `events.append(REASSIGNED, { before, after })`.
  5. `reassignments_total`.
- [X] T088 [P] [US4] Complete `typeorm-reference.query.ts`: `listDealerships(ctx)`, `listServiceTypes(ctx)`, `listTechnicians(ctx)` with aggregated skill codes, and `listBays(ctx)` with aggregated capability codes. Each is one query and tenant/site scoped. Implement `src/application/use-cases/list-reference-data.ts` (`ListDealerships`, `ListServiceTypes`, `ListTechnicians`, `ListServiceBays`).
- [X] T089 [P] [US4] Create `src/presentation/http/dto/reassign.request.ts` (`version` required; at least one of `technicianId` / `serviceBayId`, enforced by a custom class-validator constraint) and the reference response DTOs (`dealership.response.ts`, `service-type.response.ts`, `technician.response.ts`, `service-bay.response.ts`).
- [X] T090 [US4] Add `PATCH /api/v1/dealerships/:dealershipId/appointments/:appointmentId/assignment` to `appointments.controller.ts`. Implement `src/presentation/http/controllers/reference.controller.ts` (`GET /api/v1/dealerships`, `GET /api/v1/service-types` (tenant-only guard mode, no `:dealershipId`), `GET …/technicians`, `GET …/service-bays`).
- [X] T091 [US4] Register `ReassignAppointment` in `scheduling.module.ts`, and the reference use cases plus `ReferenceController` in `src/modules/reference.module.ts`. Run T082–T084 until green.

**Checkpoint**: US1–US4 pass.

---

## Phase 7: User Story 5 — Day view and appointment history (Priority: P5)

**Goal**: List a dealership's appointments for a local date (filter, order, page), and show each appointment's history (FR-020, FR-021).

**Independent Test**: Create, reassign and cancel appointments, then `GET …/appointments?date=` lists the right ones in start order and `GET …/events` returns CREATED → REASSIGNED → CANCELLED with actors.

### Tests for User Story 5 (MANDATORY) ⚠️

- [X] T092 [P] [US5] Write `test/integration/day-view.int-spec.ts`:
  - spec US5 AS1: only this dealership and this **local** date, including an appointment at 00:30 local on a BST date that is the previous day in UTC
  - `status` and `technicianId` filters
  - `limit` + `nextCursor` paging returns every row exactly once in `(start_at, id)` order
  - an invalid cursor → 422
  - another tenant → 404
- [X] T093 [P] [US5] Write `test/integration/events.int-spec.ts`:
  - spec US5 AS2: time order, `actor`, `REASSIGNED` payload `before`/`after`
  - every event payload has only ID/enum/timestamp keys (no customer fields)
  - another tenant's appointment ID → 404

### Implementation for User Story 5

- [X] T094 [US5] Implement `listForDay(ctx, range, { status?, technicianId? }, { limit, cursor? })` in `typeorm-appointment.repository.ts` (keyset pagination on `(start_at, id) > ($cursorStart, $cursorId)`, served by `ix_appt_site_list`). Implement `listForAppointment(ctx, id)` in `typeorm-appointment-event.repository.ts` (`ORDER BY occurred_at, id`; tenant scoped).
- [X] T095 [US5] Implement `src/application/use-cases/list-appointments.ts` (local date → `localDayBounds`; cursor = base64url of `{startAt, id}`, decoded and validated with `VALIDATION_FAILED` on a bad cursor) and `src/application/use-cases/list-appointment-events.ts` (`NOT_FOUND` if the appointment isn't in ctx).
- [X] T096 [US5] Create `src/presentation/http/dto/list-appointments.query.ts`, `appointment-page.response.ts` and `appointment-event.response.ts`. Add `GET /api/v1/dealerships/:dealershipId/appointments` and `GET …/appointments/:appointmentId/events` to `appointments.controller.ts`. Register the use cases in `scheduling.module.ts`, then run T092–T093 until green.

**Checkpoint**: All five stories pass independently.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T097 [P] Write `test/e2e/contract.e2e-spec.ts`. Fetch `/openapi.json` from the running app and load `specs/001-service-appointment-scheduler/contracts/openapi.yaml` with `js-yaml`. Assert that:
  - the sets of `paths × methods` match
  - each operation's response status codes match
  - the `ErrorCode` enum in the contract equals the `ErrorCode` union exported from `src/domain/errors.ts`

  This covers Principle VI.
- [X] T098 [P] Write `test/integration/pii.int-spec.ts` (SC-010):
  - Capture pino output with a custom destination stream in the test app while running a booking → reassign → cancel flow, plus a forced 409 and a forced 422.
  - Assert that no seed customer `name`, `email` or `phone` appears in captured logs, in any problem+json body, or in any `appointment_event.payload`.
- [X] T099 [P] Write `test/e2e/observability.e2e-spec.ts`:
  - after a booking, `/metrics` contains `bookings_total` and `booking_conflicts_total`, and **no** `tenant_id` / `dealership_id` label
  - a captured log line for the request has `request_id`, `tenant_id`, `dealership_id` and `outcome`
- [X] T100 [P] Create `scripts/demo-race.ts` (`pnpm demo:race`): it fires 20 simultaneous bookings at the Race Bay dealership slot against `API_URL` (default `http://localhost:3000`) and prints `201 × n, 409 × m` plus the winning appointment ID (quickstart §3).
- [X] T101 [P] Create `scripts/perf-smoke.ts` (`pnpm perf:smoke`): a dependency-free load loop against the running compose stack. It runs 1,000 availability requests and 200 bookings at a concurrency of 20, then prints p50/p95. It warns if availability p95 ≥ 300 ms or booking p95 ≥ 500 ms (plan performance goals; SC-004).
- [X] T102 [P] Create `requests.http` with every quickstart §3 request (VS Code / JetBrains HTTP client variables for the seed IDs).
- [X] T103 Write `README.md`:
  - overview and scenario
  - architecture summary (link to `docs/system-design.md`)
  - prerequisites
  - **build / run / test** commands (from quickstart)
  - API usage (Swagger, `requests.http`, cURL)
  - observability (Jaeger, `/metrics`)
  - project layout (Clean Architecture layers)
  - a dedicated **"AI Collaboration Narrative"** section: strategy for directing the AI (spec-kit flow, constitution as guardrails), the verification process (claims checked against package source in research R2–R4, a corrected claim in R1, the v2 boundary re-check fixes), and how quality was ensured (CI gates, Testcontainers, concurrency/isolation/schema tests). Leave `<!-- AUTHOR: personal reflection -->` placeholders for the author's own words.
- [X] T104 Sync `docs/system-design.md` with anything implementation changed (Workflow gate: the design doc must be updated in the same change). Verify that §7's error catalogue equals `src/domain/errors.ts`. **Do not** tick the §13 "PostgreSQL docs" checkbox; that's the author's.
- [X] T105 Run quickstart validation: `docker compose up -d --build`, `db:migrate`, `db:seed`, then run every quickstart §3 command and `pnpm demo:race`, and confirm the outputs match the stated expectations. Fix any drift in `quickstart.md` or the code.
- [X] T106 Run the full gate locally, exactly as CI does: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:int && pnpm test:e2e`. Then confirm `.github/workflows/ci.yml` passes on a push of the feature branch. *(Local gate green on 2026-11-02: lint, typecheck, 140 unit, 88 integration, 12 e2e. The GitHub Actions run is pending the first push, which hasn't been done.)*

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → user stories → **Polish (Phase 8)**.
- Inside Phase 2:
  1. 2a (schema) and 2b (domain) can run in parallel.
  2. 2c (ports) needs T022–T023.
  3. 2d (adapters) needs 2a + 2c.
  4. 2e (platform) needs 2c + 2d.

### User Story Dependencies

| Story | Depends on | Notes |
|---|---|---|
| US1 (P1) | Phase 2 | MVP. Defines `BookAppointment`, the appointment repository insert, and GET by id. |
| US2 (P2) | Phase 2. **T073 also needs T063 (US1)** | Availability (T067–T072, T074) is independent of US1. Only "alternatives on 409" extends the booking use case. |
| US3 (P3) | Phase 2 + T062 (repository file) | Tests can seed appointments by direct SQL, so the story is testable without the US1 endpoint. |
| US4 (P4) | US1 (extends `BookAppointment`) + T078 (`updateIfVersion` from US3) | The reference listing (T084, T088) is independent. |
| US5 (P5) | Phase 2 + T062. The events test uses US3/US4 endpoints | The day view (T092, T094) can be tested with SQL-seeded rows. |

### Within Each User Story

Tests (watch them fail) → domain function → adapter method → use case → DTO/controller → module wiring → tests green.

### Parallel Opportunities

- Phase 1: T003–T009 in parallel after T001/T002.
- Phase 2: T016/T017 (schema tests) ∥ T018–T021 (domain tests). T024–T027 in parallel. T035–T040 in parallel. T043/T044/T046/T047/T050 in parallel.
- In every story, all the test tasks marked [P] in parallel. DTO tasks [P] alongside the adapters.
- After Phase 2, US2's availability slice, US3 and US5's day view can proceed in parallel with US1, given the file-ownership notes above. US4 waits for US1 + T078.

---

## Parallel Example: User Story 1

```bash
# Write all US1 tests together (different files):
T052 test/unit/domain/booking-rules.spec.ts
T053 test/unit/application/book-appointment.spec.ts
T054 test/integration/booking.int-spec.ts
T055 test/integration/allocation.int-spec.ts
T056 test/integration/booking.concurrency.int-spec.ts
T057 test/integration/idempotency.int-spec.ts

# Then, in parallel:
T059 src/domain/booking-rules.ts
T060 typeorm-reference.query.ts (US1 methods)
T064 src/presentation/http/dto/*

# Then, in sequence: T061 → T062 → T063 → T065 → T066
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 → Phase 2. Every foundational test is green, including schema, DB-level isolation and boundaries.
2. Phase 3 (US1).
3. **Stop and validate**: the T056 concurrency test and the T057 idempotency test pass 5/5 runs, and `pnpm demo:race` shows `201 × 1, 409 × 19`. This alone meets the brief's three core requirements.

### Incremental Delivery

US1 (MVP) → US2 (availability + alternatives) → US3 (cancel) → US4 (manual override) → US5 (day view + history) → Polish. Each step keeps every earlier story's tests green, and each is a natural commit point for `/speckit-git-commit`.

---

## Notes

- `[P]` = different files and no unfinished dependencies. Tasks that touch the same file (`book-appointment.ts`, `typeorm-*.ts`, `appointments.controller.ts`, `scheduling.module.ts`) are sequential across stories.
- Never add `synchronize: true`, a `migration:generate` script or `@VersionColumn` (research R3/R7).
- If an implementation detail changes a design decision, update `docs/system-design.md` in the same task.
- Any task that would add an abstraction beyond the Principle IV ports must first add a Complexity Tracking row to `plan.md`.
