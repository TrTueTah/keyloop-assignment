# Phase 1 Data Model: Unified Service Scheduler

**Feature**: `001-service-appointment-scheduler` · **Source of truth at runtime**: hand-written SQL migrations in `src/infrastructure/persistence/migrations/` (research R3).

Conventions:
- All IDs are `uuid`. Transactional IDs (`appointment`, `appointment_event`) come from the `IdGenerator` port, so the use case knows the appointment ID before writing its event and tests are deterministic. `DEFAULT gen_random_uuid()` remains as a fallback and is used by the seed.
- All instants are `timestamptz` stored in UTC.
- Enumerations are `text` with `CHECK` constraints, which are simpler to migrate than PG enums.
- Every table has `created_at timestamptz NOT NULL DEFAULT now()`.

## 1. Entities

### Reference data (seeded, read-only: Principle VIII)

| Table | Columns | Constraints / notes |
|---|---|---|
| `tenant` | `id`, `name` | |
| `dealership` | `id`, `tenant_id → tenant`, `name`, `timezone` (IANA) | `UNIQUE (id, tenant_id)` = `uq_dealership_tenant`. The timezone is validated as a Luxon-valid zone in the seed. |
| `opening_hours` | `id`, `dealership_id → dealership`, `weekday` (1–7, ISO, Mon = 1), `opens_at time`, `closes_at time` | `UNIQUE (dealership_id, weekday)`, `CHECK (closes_at > opens_at)`. A missing weekday means closed. |
| `skill` | `id`, `tenant_id → tenant`, `code`, `name` | `UNIQUE (tenant_id, code)` |
| `bay_capability` | `code` PK, `name` | Global vocabulary: `LIFT`, `ALIGNMENT_RIG`, `EV_CHARGER`, `DIAGNOSTIC_RIG` |
| `service_type` | `id`, `tenant_id → tenant`, `code`, `name`, `duration_minutes`, `required_skill_id → skill` | `UNIQUE (tenant_id, code)`, `UNIQUE (id, tenant_id)` = `uq_service_tenant`, `CHECK (duration_minutes > 0 AND duration_minutes % 15 = 0 AND duration_minutes <= 720)` |
| `service_type_capability` | `service_type_id → service_type`, `capability_code → bay_capability` | PK on both columns |
| `technician` | `id`, `dealership_id → dealership`, `name`, `active bool` | `UNIQUE (id, dealership_id)` = `uq_technician_site` |
| `technician_skill` | `technician_id → technician`, `skill_id → skill` | PK on both columns |
| `service_bay` | `id`, `dealership_id → dealership`, `name`, `active bool` | `UNIQUE (id, dealership_id)` = `uq_bay_site` |
| `service_bay_capability` | `service_bay_id → service_bay`, `capability_code → bay_capability` | PK on both columns |
| `customer` | `id`, `tenant_id → tenant`, `name`*, `email`*, `phone`* | `UNIQUE (id, tenant_id)` = `uq_customer_tenant`. *PII: never logged or put in events (Principle VII). |
| `vehicle` | `id`, `tenant_id → tenant`, `customer_id → customer`, `vin` (17 chars), `make`, `model`, `year` | `UNIQUE (tenant_id, vin)` = `uq_vehicle_vin`, `UNIQUE (id, tenant_id)` = `uq_vehicle_tenant`, FK `(customer_id, tenant_id) → customer (id, tenant_id)` |

### Transactional data

#### `appointment`

| Column | Type | Rule (source) |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid NOT NULL | From `TenantContext`, never from the body (FR-023) |
| `dealership_id` | uuid NOT NULL | From the URL path |
| `customer_id`, `vehicle_id`, `service_type_id` | uuid NOT NULL | Same tenant (FR-024). Vehicle owned by customer (FR-007). |
| `technician_id`, `service_bay_id` | uuid NOT NULL | Same dealership (FR-025) |
| `start_at`, `end_at` | timestamptz NOT NULL | `end_at = start_at + service_type.duration` (FR-002), `CHECK (end_at > start_at)` |
| `status` | text NOT NULL | `CHECK IN ('CONFIRMED','CANCELLED','COMPLETED','NO_SHOW')` |
| `assignment_mode` | text NOT NULL | `CHECK IN ('AUTO','MANUAL')` (FR-017) |
| `channel` | text NOT NULL DEFAULT `'ADVISOR'` | `CHECK IN ('ONLINE','PHONE','WALK_IN','ADVISOR')` (FR-001) |
| `created_by` | text NOT NULL | From `X-User-ID` |
| `idempotency_key` | text NOT NULL | Unique per tenant (FR-010) |
| `request_hash` | char(64) NOT NULL | SHA-256 hex of the canonical request (R8) |
| `version` | int NOT NULL DEFAULT 1 | Incremented only by explicit `UPDATE` (R7) |
| `created_at`, `updated_at` | timestamptz NOT NULL | Set from the `Clock` port on write |

**Constraints.** The names are part of the contract. `src/infrastructure/persistence/pg-errors.ts` maps each one to a **typed port outcome** (e.g. `conflict on technician`). The **use case** turns that outcome into the error code shown below (constitution v2 IV/V).

| Name | Definition | Maps to |
|---|---|---|
| `no_technician_overlap` | `EXCLUDE USING gist (technician_id WITH =, tstzrange(start_at,end_at,'[)') WITH &&) WHERE (status='CONFIRMED')` | retry if auto-assigned, else 409 `RESOURCE_UNAVAILABLE` |
| `no_bay_overlap` | same, on `service_bay_id` | retry if auto-assigned, else 409 `RESOURCE_UNAVAILABLE` |
| `no_vehicle_overlap` | same, on `vehicle_id` | 409 `VEHICLE_ALREADY_BOOKED` (terminal) |
| `valid_interval` | `CHECK (end_at > start_at)` | 500 (a bug; should be unreachable) |
| `fk_appt_site` | `(dealership_id, tenant_id) → dealership (id, tenant_id)` | 500 (unreachable via the guard) |
| `fk_appt_tech` | `(technician_id, dealership_id) → technician (id, dealership_id)` | 422 `RESOURCE_NOT_IN_DEALERSHIP` (normally caught earlier) |
| `fk_appt_bay` | `(service_bay_id, dealership_id) → service_bay (id, dealership_id)` | 422 `RESOURCE_NOT_IN_DEALERSHIP` |
| `fk_appt_customer` / `fk_appt_vehicle` / `fk_appt_service` | `(x_id, tenant_id) → x (id, tenant_id)` | 404 `NOT_FOUND` (normally caught earlier) |
| `uq_appt_idempotency` | `UNIQUE (tenant_id, idempotency_key)` | re-read + hash compare (R6/R8) |

**Indexes**:
- `ix_appt_site_day (dealership_id, start_at) WHERE status='CONFIRMED'` serves the availability, day-load and alternatives queries.
- `ix_appt_site_list (dealership_id, start_at, id)` serves cursor pagination of the day view, all statuses.
- The GiST indexes are created implicitly by the exclusion constraints.

#### `appointment_event` (audit trail + outbox; append-only)

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid NOT NULL | |
| `appointment_id` | uuid NOT NULL → appointment | |
| `type` | text NOT NULL | `CHECK IN ('CREATED','REASSIGNED','CANCELLED')` |
| `actor` | text NOT NULL | `X-User-ID` |
| `payload` | jsonb NOT NULL | **IDs and enums only**. For example, REASSIGNED is `{ "before": {"technicianId","serviceBayId"}, "after": {...} }`. No PII (FR-027). |
| `occurred_at` | timestamptz NOT NULL DEFAULT now() | |
| `published_at` | timestamptz NULL | Always NULL in the MVP (the relay is designed only) |

Index: `ix_event_appt (appointment_id, occurred_at)` and partial `ix_event_unpublished (occurred_at) WHERE published_at IS NULL`.

#### `resource_unavailability`: **not created in this feature**

This table is designed only (system-design §2.6, Principle VIII). It's left out of the migrations so no dead schema ships.

## 2. Relationships (summary)

```
tenant 1─* dealership 1─* {opening_hours, technician, service_bay, appointment}
tenant 1─* {customer, skill, service_type}
customer 1─* vehicle
technician *─* skill                 (technician_skill)
service_bay *─* bay_capability       (service_bay_capability)
service_type *─1 skill ; service_type *─* bay_capability (service_type_capability)
appointment 1─* appointment_event
```

## 3. State machine: `appointment.status`

```
            create (FR-003..010)
   ∅ ─────────────────────────────▶ CONFIRMED ──cancel (FR-018)──▶ CANCELLED   (terminal)
                                     │   ▲
                       reassign      │   │ (stays CONFIRMED, version+1, mode=MANUAL)
                       (FR-015)      └───┘
                                     │
                                     └── (future DMS) ──▶ COMPLETED | NO_SHOW (terminal; no MVP path)
```

- Only `CONFIRMED` rows take part in the exclusion constraints, so cancel frees capacity immediately.
- Each transition increments `version` and writes exactly one `appointment_event` in the same transaction (Principle V).
- An invalid transition gives 409 `NOT_CONFIRMED`. A stale `version` gives 409 `STALE_VERSION`.

## 4. Validation rules (request level → error code)

| Rule | Code | Spec |
|---|---|---|
| Body shape, unknown properties, missing `Idempotency-Key` | 422 `VALIDATION_FAILED` | FR-010, Principle VI |
| `startAt` in the past | 422 `START_IN_PAST` | FR-007 |
| `startAt` not on the local 15-min grid (or has seconds) | 422 `NOT_ON_SLOT_GRID` | FR-007 |
| `startAt` more than 90 days ahead | 422 `OUTSIDE_BOOKING_HORIZON` | FR-007 |
| `[start, end)` not inside that local day's opening hours, or the site is closed | 422 `OUTSIDE_OPENING_HOURS` | FR-007 |
| Vehicle not owned by customer | 422 `VEHICLE_NOT_OWNED_BY_CUSTOMER` | FR-007 |
| Dealership, customer, vehicle, service type or appointment not in tenant (or doesn't exist) | 404 `NOT_FOUND` | FR-024 |
| Pinned/reassigned resource in another dealership | 422 `RESOURCE_NOT_IN_DEALERSHIP` | FR-016/025 |
| Pinned/reassigned technician lacks the skill / is inactive | 422 `TECHNICIAN_NOT_QUALIFIED` / `RESOURCE_INACTIVE` | FR-016 |
| Pinned/reassigned bay lacks a capability / is inactive | 422 `BAY_NOT_COMPATIBLE` / `RESOURCE_INACTIVE` | FR-016 |
| Same key, different request | 422 `IDEMPOTENCY_KEY_REUSED` | FR-010 |
| No candidate pair for the requested time | 409 `SLOT_UNAVAILABLE` + `alternatives[]` | FR-012 |
| Pinned resource busy | 409 `RESOURCE_UNAVAILABLE` | FR-016 |
| Vehicle already booked at that time | 409 `VEHICLE_ALREADY_BOOKED` | A9 |
| Stale version / not confirmed | 409 `STALE_VERSION` / `NOT_CONFIRMED` | FR-019 |

> **Two codes beyond the design-doc catalogue:** `START_IN_PAST` and `RESOURCE_INACTIVE` are new. Principle VI requires adding them to the catalogue in the same change, so `docs/system-design.md` §7 is updated alongside this plan.

## 5. Domain (in-memory) types: `src/domain`

These are plain TypeScript with no framework imports (Principle IV):
- `Interval { start: DateTime; end: DateTime }`, with `overlaps(a, b)` (half-open).
- `ResourceCandidate { id; kind: 'TECHNICIAN'|'BAY'; capabilityCount; bookedMinutes; busy: Interval[] }`
- `AllocationPolicy { rank(candidates: ResourceCandidate[]): ResourceCandidate[] }`, with `LeastLoadedPolicy` as the default (load → capabilityCount → id).
- `SlotGrid`: `openingWindow`, `slotStarts(window, durationMin, stepMin = 15)`
- `AvailabilityCalculator`: `(window, duration, techs, bays) → Slot[]`, plus `findAlternatives(fromDay, days = 7, max = 5)`.

## 6. Seed fixture (dev and tests)

There are two tenants, so isolation can be shown:
- **Acme Motor Group**
  - **Acme Leeds** (`Europe/London`, Mon–Fri 08:00–17:00, Sat 09:00–13:00): 4 technicians with mixed skills, 1 inactive. 4 bays: `LIFT`; `LIFT+ALIGNMENT_RIG`; `LIFT+EV_CHARGER`; one inactive.
  - **Acme York**: 2 technicians, 2 bays.
- **Beta Autos** (a separate tenant) with 1 dealership.

Service types: Oil Change (30 min, GENERAL, LIFT), Major Service (180, GENERAL, LIFT), Wheel Alignment (60, GENERAL, LIFT+ALIGNMENT_RIG), EV Battery Check (90, EV_HIGH_VOLTAGE, LIFT+EV_CHARGER), Diagnostics (60, DIAGNOSTICS, none).

Fixed UUIDs are used so the `.http` and cURL examples work verbatim.
