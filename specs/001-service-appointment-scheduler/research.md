# Phase 0 Research: Unified Service Scheduler

**Feature**: `001-service-appointment-scheduler` · **Date**: 2026-11-02
**Inputs**: [spec.md](./spec.md), [constitution](../../.specify/memory/constitution.md) (written against v1.0.0, **re-checked against v2.0.0**: R2, R6, R7, R8 and R10 were updated so every decision respects the Clean Architecture dependency rule), [docs/system-design.md](../../docs/system-design.md)

The constitution fixes the technology stack, so there were no open "NEEDS CLARIFICATION" items in the Technical Context. Research focused on two things:
1. **Pinning exact versions** that satisfy the constitution.
2. **Verifying the four AI-made library claims** that the design depends on. The constitution's quality gate says such claims must be verified before code relies on them.

Verification method: the published npm tarballs were downloaded and their shipped source read (not README claims). Package versions were checked on the npm registry on 2026-11-02.

---

## R1. Framework and toolchain versions

**Decision**:

| Package | Version | Notes |
|---|---|---|
| Node.js | **24 LTS** (`engines: >=24 <25`, `.nvmrc` = 24) | Docker base image `node:24-alpine`. The author's machine has Node 25 (current, non-LTS), which can run the code, but CI and the container use 24. |
| TypeScript | **5.9.x** | |
| `@nestjs/*` (core, common, platform-express, testing) | **11.x** (11.2.x core) | |
| `@nestjs/typeorm` | 11.0.x | peer: Nest ^10 \|\| ^11, typeorm ^0.3 |
| `@nestjs/swagger` | 11.x | |
| `@nestjs/terminus` | 11.x | |
| `typeorm` | **0.3.x** (0.3.31) | |
| `pg` | 8.x | |
| `luxon` | 3.x | |
| `nestjs-pino` / `pino-http` | 4.x | |
| `class-validator` / `class-transformer` | 0.14.x / 0.5.x | |
| `@testcontainers/postgresql` | 11.x | |
| `jest` / `ts-jest` | 30.x / 29.4.x | `ts-jest@29.4` peers: `jest ^29 \|\| ^30`, **`typescript >=4.3 <7`**. That independently rules out TS 7. |
| `@opentelemetry/sdk-node` + `auto-instrumentations-node` + `exporter-prometheus` | current | |
| PostgreSQL image | `postgres:17-alpine` | |

**Rationale**: The constitution mandates NestJS 11, TypeScript 5 and Node 24 LTS.
- **NestJS 12** came out on 2026-08-27 and **TypeScript 7** is also out. Both are newer than the constitution allows.
- **TypeORM 1.x** is out, but `@nestjs/typeorm@11` lists it only as `^1.0.0-dev`. Using it means relying on a pre-release peer range.

Staying on the mature 11 / 5.9 / 0.3 line avoids early-adopter risk on a short assessment timeline. `ts-jest` declares `typescript <7` as a peer dependency, so TS 7 would also break the test toolchain. That is a second, verified reason to stay on 5.9. (An earlier draft of this research claimed Jest 29 was needed for `ts-jest`. Checking the peer range showed `ts-jest` supports Jest 30, so the claim was dropped.)

**Alternatives considered**:
- **NestJS 12 + TS 7 + TypeORM 1.x**: newest, but requires a constitution amendment (MAJOR change to the Technology table) and carries ecosystem-compatibility risk. Rejected for now. It's noted as a follow-up amendment candidate.

---

## R2. Claim: "`pg` exposes the violated constraint name, and TypeORM passes it through"

**Verified ✅**
- `pg-protocol@1.16.1`, `dist/parser.js:319`: `message.constraint = fields.n;`. The PostgreSQL error field `n` (constraint name) is set on the error object. `messages.d.ts` types it as `constraint: string | undefined`.
- `typeorm@0.3.31`, `error/QueryFailedError.js`: the constructor stores `driverError` **and** copies all of `driverError`'s own properties onto the `QueryFailedError` (`ObjectUtils.assign(this, {...otherProperties})`).

**Decision** (constitution v2 IV/V: classification lives in the persistence adapter):

`src/infrastructure/persistence/pg-errors.ts` turns a `QueryFailedError` into a **typed port outcome**. Driver types never cross the port:
```ts
// application/ports/appointment.repository.ts (domain language, no pg/typeorm types)
export type InsertOutcome =
  | { kind: 'inserted'; appointment: Appointment }
  | { kind: 'conflict'; on: 'technician' | 'bay' | 'vehicle' | 'idempotency_key' };

// infrastructure/persistence/pg-errors.ts (the only place that knows constraint names)
const BY_CONSTRAINT = {
  no_technician_overlap: 'technician', no_bay_overlap: 'bay',
  no_vehicle_overlap: 'vehicle', uq_appt_idempotency: 'idempotency_key',
} as const;
export function toConflict(e: unknown): InsertOutcome | null {
  if (!(e instanceof QueryFailedError)) return null;
  const d = e.driverError as { code?: string; constraint?: string };
  if ((d.code === '23P01' || d.code === '23505') && d.constraint && d.constraint in BY_CONSTRAINT)
    return { kind: 'conflict', on: BY_CONSTRAINT[d.constraint as keyof typeof BY_CONSTRAINT] };
  return null;   // anything else is rethrown → 500
}
```
It reads from `driverError` (the documented property) rather than the copied top-level fields. The **use case** decides what to do with each outcome (retry, 409 or re-read). An adapter unit test pins the mapping table, and an integration test triggers each real constraint.

**Implementation finding (2026-11-02): deadlocks between concurrent exclusion checks.** The SC-003 burst test (20 simultaneous identical bookings) was green on its first run by luck. Repeating it showed that about 1 run in 4 returned **500s**, with latencies of 4–9 s. The captured logs said `QueryFailedError: deadlock detected` (SQLSTATE `40P01`).
- **Cause:** each concurrent insert writes its row first, then checks the exclusion constraints. Two such inserts can end up waiting on each other, and PostgreSQL breaks the cycle after `deadlock_timeout` (1 s) by aborting one of them.
- **Correctness was never violated:** there was always exactly one row. Only availability suffered.
- **Fix:** `pg-errors.ts` maps `40P01` / `40001` to a typed `{ conflict on 'transient' }` outcome. `BookAppointment` first re-checks idempotency, so a duplicate of a request that already won is replayed, then retries the **same** candidates in a fresh transaction, within the same 3-attempt budget.
- **Constitution V nuance:** classification is still by constraint name for every *constraint violation*. Deadlock and serialization aborts carry no constraint, so SQLSTATE is the only signal, and that exception is documented here.
- **Regression guard:** the burst test now runs 5 times per suite.
- **Follow-up (same day), retrying wasn't enough:** a 40-run stress loop still failed. In a bad run, *all 20* requests aborted on attempt 1, again on attempt 2, and 19 on attempt 3, because immediate retries recreate the same lock cycle. **Fix:** before inserting (or reassigning), the adapter takes `FOR NO KEY UPDATE` row locks on technician → bay → vehicle, always in that order. Contenders now queue instead of forming cycles. Exclusion constraints remain the guarantee. Result: 80 stress scenarios (identical bursts plus distinct-key races, 1,600 requests) gave **0 deadlocks and 0 wrong outcomes**, and 40 bursts finish in ~4 s instead of ~60 s. Recorded in plan.md Complexity Tracking.

**Alternatives considered**: parsing the error message text, which is brittle and locale-dependent. Rejected.

---

## R3. Claim: "TypeORM `@Exclusion` supports a partial `WHERE` clause"

**Verified ✅, with one important caveat.**
- `decorator/Exclusion.d.ts`: `Exclusion(name: string, expression: string)`. The expression is a free string.
- `PostgresQueryRunner.js:2270/2533`: it emits ``ADD CONSTRAINT "<name>" EXCLUDE ${expression}`` verbatim, so `USING gist (...) WHERE (status = 'CONFIRMED')` is passed through unchanged.
- **Caveat** (`schema-builder/RdbmsSchemaBuilder.js:370–380, 737–747`): the schema diff matches exclusion constraints **by name only**.
  - A constraint that exists in the DB but not in entity metadata **is dropped** by `migration:generate` or `synchronize`.
  - A change to an existing constraint's expression is **never detected**.
  - The same drop-if-unknown behaviour applies to foreign keys. The composite FKs (Principle II) use a column, `dealership_id`, that's shared by three relations, which TypeORM relation metadata can't express cleanly.

**Decision**:
1. **All migrations are hand-written SQL** (TypeORM `MigrationInterface` with `queryRunner.query(...)`). They are the single source of truth for the schema.
2. The project **doesn't use `migration:generate` or `synchronize`**: there's no `migration:generate` script, and the datasource is configured with `synchronize: false` and `migrationsRun: false`, with migrations run explicitly.
3. Entities map columns only. They use plain `uuid` columns for the composite-FK references, with no `@ManyToOne` on them, so ORM metadata never claims to own those constraints.
4. A **schema test** queries `pg_constraint` after migrations and asserts that every exclusion constraint and composite FK exists with the expected definition. This catches anything that drops them, so it satisfies "Migrations MUST NOT silently drop…" (Principle V).

**Alternatives considered**:
- `@Exclusion` on entities plus generated migrations: protects the exclusions by name, but still drops the composite FKs and misses expression changes. Rejected.
- `@Exclusion` purely for documentation: redundant with the schema test, and it adds a second place to keep in sync. Rejected.

---

## R4. Claim: "NestJS `ValidationPipe` `errorHttpStatusCode: 422` works"

**Verified ✅**: `@nestjs/common@11.1.29`, `pipes/validation.pipe.js:35`: `this.errorHttpStatusCode = errorHttpStatusCode || HttpStatus.BAD_REQUEST;`. Lines 108/111 throw `HttpErrorByCode[this.errorHttpStatusCode]`.

**Decision**: register the pipe globally with `{ whitelist: true, forbidNonWhitelisted: true, transform: true, errorHttpStatusCode: 422 }`. Use an `exceptionFactory` that produces a `DomainError('VALIDATION_FAILED', …)` with field-level `errors[]`, so the problem+json filter formats it the same way as every other error. An e2e test asserts the 422 status and the problem+json shape.

---

## R5. Claim: "PostgreSQL exclusion constraints allow a partial `WHERE` and raise `23P01`"

**Accepted on documented PostgreSQL behaviour, and verified by tests rather than source.**
- PostgreSQL documents `EXCLUDE [USING index_method] (exclude_element WITH operator [, ...]) [WHERE (predicate)]`.
- `23P01` is `exclusion_violation` in Appendix A (Error Codes).
- `btree_gist` is needed for `uuid WITH =` inside a GiST index.

**Decision**: the migration runs `CREATE EXTENSION IF NOT EXISTS btree_gist`. The schema test (R3) and the concurrency test (spec SC-001) prove the behaviour on `postgres:17-alpine`.

> **Author action:** read the PostgreSQL `CREATE TABLE … EXCLUDE` docs and Appendix A once, and tick the matching box in `docs/system-design.md` §13. Ticking it is the author's call, not the AI's.

---

## R6. Retry and transaction pattern

**Decision** (constitution v2 IV: the use case owns transaction boundaries through a unit-of-work port):
```ts
// application/ports/unit-of-work.ts
export interface UnitOfWork { run<T>(work: (tx: TxScope) => Promise<T>): Promise<T>; }
// TxScope exposes the transactional repositories (appointments, events, resources), not the EntityManager.
```

`BookAppointment.execute(cmd, ctx)` loops up to 3 attempts, and each attempt is a **separate** `uow.run(...)`:
1. Query candidates through `ResourceQuery`, excluding the `excluded` set.
2. Rank with `AllocationPolicy`.
3. Call `tx.appointments.insert(...)`, which returns an `InsertOutcome` (R2). If inserted, write the CREATED event with `tx.events.append(...)` in the same scope.
4. On `conflict on technician|bay` with an auto-assigned resource, add that resource ID to `excluded` and loop.
5. Conflicts on `vehicle` and on pinned resources are terminal.
6. On `conflict on idempotency_key`, re-read by key and compare hashes (R8).

The adapter `TypeOrmUnitOfWork` implements `run` with `dataSource.transaction('READ COMMITTED', ...)`. When the outcome is a conflict, it **rolls back** (the transaction is aborted after the error anyway) and still returns the typed outcome to the use case, by throwing an internal sentinel inside the transaction and catching it outside.

**Rationale**: READ COMMITTED is enough because the constraints, not isolation, give correctness (Principle I). Fresh transactions avoid running on a transaction that is already aborted after the error, so no savepoints are needed. The use case unit test covers the retry branches with in-memory port fakes (allowed by III for orchestration only). The real race is proven by the Testcontainers concurrency test.

**Alternatives**:
- SAVEPOINT per attempt inside one transaction. It works, but it holds the transaction open longer and makes the event and idempotency handling more complex. Rejected.
- Exposing `EntityManager` through the port. It violates IV ("ORM types MUST NOT cross a port"). Rejected.

---

## R7. Version-checked updates (reassign / cancel)

**Decision**:
- **Port:** `AppointmentRepository.updateIfVersion(ctx, id, expectedVersion, patch)` returns `{ kind: 'updated', appointment } | { kind: 'not_found' } | { kind: 'not_confirmed' } | { kind: 'stale' } | { kind: 'conflict', on: 'technician'|'bay' }`.
- **Adapter:** runs the explicit SQL through `em.query()` inside the unit of work:
  ```sql
  UPDATE appointment SET …, version = version + 1, updated_at = $now
   WHERE id = $1 AND tenant_id = $2 AND dealership_id = $3 AND version = $4 AND status = 'CONFIRMED'
   RETURNING *
  ```
  An empty result is followed by a re-read to tell `not_found` / `not_confirmed` / `stale` apart.
- **Use cases:** `ReassignAppointment` / `CancelAppointment` map those outcomes to `DomainError` codes (`NOT_FOUND`, `NOT_CONFIRMED`, `STALE_VERSION`, `RESOURCE_UNAVAILABLE`) and append the event in the same unit of work.
- `@VersionColumn` is **not** used. A plain `@Column() version` keeps the ORM from bumping the version implicitly (Principle V). `$now` comes from the `Clock` port.

---

## R8. Idempotency request hash

**Decision** (constitution v2 IV: replay is a business rule, so it lives in the use case, not in an HTTP interceptor):
- **Presentation:** a parameter decorator / pipe reads `Idempotency-Key` and validates presence and format: 1–255 printable ASCII characters. Missing or invalid → 422 `VALIDATION_FAILED` (FR-010). It passes the key **in the command** and doesn't touch storage.
- **Application:** `BookAppointment` computes `requestHash = sha256(canonicalJSON(command without the key))`, with sorted keys and no whitespace, using `node:crypto`. That's a Node built-in, not on IV's forbidden list, and it's I/O-free. It then calls `IdempotencyStore.findByKey(ctx, key)` (a port, implemented over `appointment.idempotency_key`):
  - same hash → return the original with `replayed: true`, which presentation maps to 200
  - different hash → `IDEMPOTENCY_KEY_REUSED`
  - none → proceed. The `idempotency_key` conflict race is handled as in R6.
- Only **successful** bookings store the key, so a 409 can be retried with the same key once capacity frees up.

**Alternatives**:
- A Nest interceptor that queries storage (v1 plan). It puts a business rule in presentation and needs a persistence dependency there. Rejected under v2.
- A separate `idempotency_record` table caching error responses. Out of scope (VIII). Rejected.

---

## R9. Time handling (Luxon)

**Decision**: all dealership-local logic goes through one domain module, `domain/time.ts`, which takes an IANA zone:
- `localDayBounds(date, zone)`
- `openingWindow(date, zone, hours)`
- `slotGrid(window, duration, 15)`
- `isOnGrid(instant, zone)`

Luxon `DateTime.fromISO(..., { zone })` handles DST gaps and overlaps. Domain functions never read the system clock: "now" is passed in by use cases from the `Clock` port (constitution v2 IV), which also makes the past and horizon rules deterministic in tests. Grid alignment is checked in **local** wall-clock minutes (`minute % 15 === 0`, seconds = 0). Unit tests cover `Europe/London` on 2026-03-29 (23-hour day) and 2026-10-25 (25-hour day).

---

## R10. Observability wiring

**Decision** (constitution v2 IV: telemetry is a port, and adapters never import presentation):
- **Tracing bootstrap:** `src/tracing.ts` is loaded with `node --require ./dist/tracing.js`, before Nest boots. It starts `NodeSDK` with auto-instrumentations for http, express and pg, and exports OTLP to `OTEL_EXPORTER_OTLP_ENDPOINT`. It's part of the composition root.
- **Telemetry port:** `application/ports/telemetry.ts` has `count(name, attrs)`, `observe(name, value, attrs)` and `span(name, fn)`. Use cases wrap `allocate`, `computeAvailability` and `findAlternatives` in `telemetry.span(...)`, and the domain stays unaware of telemetry. The adapter `infrastructure/observability/otel-telemetry.ts` **rejects `tenant_id` / `dealership_id` attributes on metrics** (VII). Those go on spans only.
- **Request context:** `application/ports/request-context.ts` defines `RequestContextStore { run(ctx, fn); current(): RequestContext | undefined }`, where `RequestContext` holds `requestId` and `TenantContext`. The adapter `infrastructure/observability/als-request-context.ts` uses `AsyncLocalStorage`.
  - Presentation middleware and the guard **write** to it through the port token.
  - The pino adapter (same infrastructure layer) **reads** it for `customProps`.

  So presentation never imports infrastructure and vice versa.
- **`/metrics`:** the Prometheus exporter runs in "no server" mode, and its request handler is mounted on the HTTP adapter **in `main.ts`** (composition root), not in a presentation controller, which would have to import infrastructure.
- **`/health/*`:** a presentation controller uses `@nestjs/terminus`. Readiness calls a `HealthProbe` port (persistence boundary), implemented in infrastructure as `SELECT 1` plus a "latest migration applied" check.
- **Logs:** `nestjs-pino`, configured in infrastructure and registered in the composition root. A redact list covers `*.email`, `*.phone` and `*.name` as a second safety net.
- **Tests:** observability exporters are disabled (`OTEL_SDK_DISABLED=true`).

---

## R11. Testcontainers strategy

**Decision**: Jest `globalSetup` starts one `postgres:17-alpine` container per test run, runs the migrations once, and writes the connection URL to an env file. Each integration test file truncates the transactional tables (`appointment`, `appointment_event`) in `beforeEach` and reloads a fixed seed through a fixture builder. Concurrency tests use a real HTTP server (`app.listen(0)`) and fire `Promise.all` of 20 supertest requests, so the requests run through separate pool connections. The pool size is set to ≥ 20 in tests.

**Alternatives**: one container per file is slower. Transaction-rollback isolation per test can't work for concurrency tests, because those need committed data across connections. Both rejected.
