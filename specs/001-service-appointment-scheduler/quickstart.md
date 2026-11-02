# Quickstart: Unified Service Scheduler (feature 001)

This guide runs the service and checks the spec's core acceptance scenarios by hand. The automated equivalents are listed with each step. The seed's fixed IDs are defined in `src/infrastructure/persistence/seed/fixtures.ts`, and the aliases below match it.

## Prerequisites

- Docker (with compose v2)
- Node.js 24 LTS and pnpm 10, only needed if running outside Docker

## 1. Start everything

```bash
docker compose up -d --build           # api :3000, postgres :5432, jaeger UI :16686
curl -s localhost:3000/health/ready     # → {"status":"ok",...}
```

The API container runs the hand-written migrations and the idempotent seed before it starts (`node dist/scripts/db-migrate.js && node dist/scripts/db-seed.js`), so `up` is all you need.

- Swagger UI: http://localhost:3000/docs (OpenAPI JSON at `/openapi.json`)
- Jaeger: http://localhost:16686 (service `service-scheduler`)
- Metrics: http://localhost:3000/metrics

To run locally without the API container:
```bash
pnpm install
docker compose up -d postgres jaeger
cp .env.example .env && export $(grep -v '^#' .env | xargs)
pnpm db:migrate && pnpm db:seed && pnpm start:dev
```

## 2. Shell aliases (seed IDs)

```bash
API=localhost:3000/api/v1
ACME=11111111-0000-0000-0000-000000000001     # tenant Acme Motor Group
BETA=11111111-0000-0000-0000-000000000002     # tenant Beta Autos
LEEDS=22222222-0000-0000-0000-000000000001    # Acme Leeds (Europe/London)
OIL=33333333-0000-0000-0000-000000000001      # Oil Change, 30 min
CUST=44444444-0000-0000-0000-000000000001
CAR=55555555-0000-0000-0000-000000000001
H=(-H "X-Tenant-ID: $ACME" -H "X-User-ID: advisor-1" -H "Content-Type: application/json")
DAY=$(date -v+3d +%F 2>/dev/null || date -d '+3 days' +%F)   # must be a future Mon–Fri (Leeds is closed Sundays)
```

## 3. Walk through the user stories

**US2: check availability**
```bash
curl -s "${H[@]}" "$API/dealerships/$LEEDS/availability?serviceTypeId=$OIL&date=$DAY" | jq '.slots[0:3]'
```

**US1: book with auto-assign.** Expect 201, `assignmentMode: "AUTO"`, and the least-loaded technician and bay.
```bash
curl -si "${H[@]}" -H "Idempotency-Key: demo-1" -X POST "$API/dealerships/$LEEDS/appointments" \
  -d "{\"customerId\":\"$CUST\",\"vehicleId\":\"$CAR\",\"serviceTypeId\":\"$OIL\",\"startAt\":\"${DAY}T10:00:00Z\"}"
```

**US1: idempotent replay.** Repeat the exact same command: expect **200** with the same `id`. Change the body with the same key: expect **422 `IDEMPOTENCY_KEY_REUSED`**.

**US1: the vehicle can't be double-booked.** Book the same car at 10:15 with a new key: expect **409 `VEHICLE_ALREADY_BOOKED`**.

**US2: alternatives.** Fill a slot (or use the concurrency script below), then book it again: expect **409 `SLOT_UNAVAILABLE`** with `alternatives[]`.

**US4: manual reassign** (use `id` and `version` from the booking):
```bash
curl -s "${H[@]}" -X PATCH "$API/dealerships/$LEEDS/appointments/$APPT/assignment" \
  -d '{"technicianId":"<another qualified tech>","version":1}' | jq '{technicianId,assignmentMode,version}'
```
Run it again with `"version":1`: expect **409 `STALE_VERSION`**. The successful reassignment returned `version: 2`, so cancel with that.

**US3: cancel**
```bash
curl -s "${H[@]}" -X POST "$API/dealerships/$LEEDS/appointments/$APPT/cancel" -d '{"version":2}' | jq .status   # "CANCELLED"
```

**US5: day view and history**
```bash
curl -s "${H[@]}" "$API/dealerships/$LEEDS/appointments?date=$DAY" | jq '.items | length'
curl -s "${H[@]}" "$API/dealerships/$LEEDS/appointments/$APPT/events" | jq '[.[].type]'   # ["CREATED","REASSIGNED","CANCELLED"]
```

**Tenant isolation.** Ask for Acme Leeds as Beta Autos: expect **404**.
```bash
curl -si -H "X-Tenant-ID: $BETA" -H "X-User-ID: x" "$API/dealerships/$LEEDS/technicians" | head -1
```

**Concurrency demo** (SC-001): `pnpm demo:race` fires 20 simultaneous bookings, from 20 different seeded customers, at a random future slot at the Race Bay dealership (1 technician, 1 bay). It prints `201 × 1, 409 SLOT_UNAVAILABLE × 19`.

**Latency smoke** (SC-004): `pnpm perf:smoke` runs 1,000 availability searches and 200 bookings at a concurrency of 20, and prints p50/p95. On a laptop with Docker: availability p95 ≈ 210 ms, booking p95 ≈ 230 ms.

The same requests are in `requests.http` for the VS Code / JetBrains HTTP client.

## 4. Automated tests

```bash
pnpm lint && pnpm typecheck
pnpm test             # domain + application + adapter unit tests (no Docker needed)
pnpm test:int         # integration, isolation, schema and concurrency tests (needs Docker for Testcontainers)
pnpm test:all         # everything, as CI runs it
```

| Spec item | Test file |
|---|---|
| SC-001 race (20 parallel → 1 success) | `test/integration/booking.concurrency.int-spec.ts` |
| SC-003 idempotency under concurrency | `test/integration/idempotency.int-spec.ts` |
| SC-006 isolation, incl. direct-SQL FK rejection | `test/integration/tenant-isolation.int-spec.ts` |
| Constraints exist after migrations | `test/integration/schema.int-spec.ts` |
| SC-007 even workload | `test/unit/domain/least-loaded-policy.spec.ts` + `test/integration/allocation.int-spec.ts` |
| SC-010 no PII in logs and events | `test/integration/pii.int-spec.ts` |
| DST days, grid, overlap edges | `test/unit/domain/*.spec.ts` |
| Retry / idempotency / event branches (orchestration only) | `test/unit/application/*.spec.ts` (in-memory port fakes) |
| Constraint name → typed outcome mapping | `test/unit/infrastructure/pg-errors.spec.ts` |
| Layer boundaries (Clean Architecture) | `pnpm lint` + `test/architecture/boundaries.spec.ts` (a forbidden import must fail lint) |
| Contract matches `contracts/openapi.yaml` | `test/e2e/contract.e2e-spec.ts` |
