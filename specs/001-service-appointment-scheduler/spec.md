# Feature Specification: Unified Service Scheduler

**Feature Branch**: `001-service-appointment-scheduler`
**Created**: 2026-11-02
**Status**: Draft
**Input**: User description: "start the spec". This is Scenario A of the Keyloop technical assessment (`KeyloopCodingChallange.pdf`), refined by the agreed system design in `docs/system-design.md` v1.0.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Book a service appointment with automatic resource assignment (Priority: P1)

A service advisor (or a customer booking online) chooses a dealership, the customer's vehicle, a service type and a desired start time. Before confirming, the system checks that a **qualified technician** and a **suitable service bay** are both free for the **whole duration** of that service. If both are free, it confirms the appointment and records the customer, vehicle, technician, bay and time. When several technicians or bays could take the job, the system picks the least-loaded ones that day, so work is spread evenly.

**Why this priority**: This is the core of the brief (all three core requirements). Without it there's no product. On its own it already replaces the manual diary.

**Independent Test**: Seed one dealership with technicians, bays and a service catalogue. Request a booking for a free time and check that a confirmed appointment exists with a qualified technician and a compatible bay. Request the same resources at an overlapping time and check that it's refused.

**Acceptance Scenarios**:

1. **Given** a dealership with a free qualified technician and a free compatible bay at 10:00, **When** an advisor books a 60-minute service for 10:00, **Then** a confirmed appointment for 10:00–11:00 is created, naming the customer, vehicle, service type, technician and bay.
2. **Given** the only qualified technician is already booked 10:30–11:30, **When** an advisor books a 60-minute service at 10:00, **Then** the booking is refused because no qualified technician is free for the whole duration, and nothing is created.
3. **Given** technicians are free but no bay has the equipment the service needs, **When** a booking is requested, **Then** it is refused with a reason saying no suitable bay is available.
4. **Given** two qualified technicians are free and one already has more booked minutes that day, **When** a booking is made, **Then** the technician with fewer booked minutes is assigned. The same rule applies to bays.
5. **Given** two bays are equally loaded and only one has specialist equipment the service doesn't need, **When** a booking is made, **Then** the bay without the unneeded specialist equipment is assigned.
6. **Given** the last free slot for a technician and bay, **When** two people submit bookings for it at the same moment, **Then** exactly one is confirmed and the other is refused as unavailable.
7. **Given** a booking was submitted and the confirmation was lost (e.g. a network drop), **When** the same submission is sent again, **Then** the original appointment is returned and no second appointment is created.
8. **Given** a requested time outside opening hours, in the past, not on the 15-minute grid, or more than 90 days ahead, **When** a booking is requested, **Then** it is refused with a specific reason.
9. **Given** the vehicle doesn't belong to the customer named in the request, **When** a booking is requested, **Then** it is refused.
10. **Given** the vehicle already has a confirmed appointment overlapping the requested time, **When** a booking is requested, **Then** it is refused because the vehicle is already booked.

---

### User Story 2 - See availability and get alternatives (Priority: P2)

Before booking, an advisor or customer asks which start times are free on a given day for a given service type at a dealership. If they try to book a time that turns out to be taken, the system offers nearby alternative times instead of leaving them to guess.

**Why this priority**: This makes booking practical, since people book times they know are free. It also removes the trial-and-error of manual diaries. Booking (P1) still works without it, so it ranks second.

**Independent Test**: Seed a day with some appointments, request availability for a service type, and check that the returned times are exactly those where both a qualified technician and a compatible bay are free for the full duration. Then book a taken time and check that alternatives are offered.

**Acceptance Scenarios**:

1. **Given** a dealership open 08:00–17:00 and a 60-minute service type, **When** availability is requested for a date, **Then** the start times returned are on the 15-minute grid, run from 08:00 to 16:00 at the latest, and each one has a qualified technician and a compatible bay free for the whole hour.
2. **Given** the requested time is unavailable but other times are free, **When** a booking is attempted, **Then** the refusal includes up to 5 alternative start times: the same day first, then up to 7 days ahead.
3. **Given** no capacity at all in the next 7 days, **When** a booking is attempted, **Then** the refusal says no alternatives were found.
4. **Given** a dealership in a time zone with a daylight-saving change on the requested date, **When** availability is requested, **Then** the times reflect the dealership's local opening hours on that date.

---

### User Story 3 - Cancel an appointment and free capacity (Priority: P3)

An advisor cancels an appointment at the customer's request. The technician's and bay's time becomes bookable again straight away.

**Why this priority**: Without cancellation, capacity leaks and the schedule drifts from reality. It's a small feature but needed for day-to-day use.

**Independent Test**: Book a slot, cancel it, and check that the same slot can be booked again and that the cancelled appointment still exists with status "cancelled".

**Acceptance Scenarios**:

1. **Given** a confirmed appointment at 10:00, **When** an advisor cancels it, **Then** its status becomes cancelled, the 10:00 slot shows as available again, and a new booking for 10:00 succeeds.
2. **Given** an appointment that is already cancelled, **When** someone tries to cancel it again, **Then** the request is refused because the appointment is no longer confirmed.
3. **Given** two advisors viewing the same appointment and one has changed it, **When** the other submits a cancellation based on the outdated view, **Then** it is refused as stale and they are asked to refresh.

---

### User Story 4 - Manually choose or change the technician or bay (Priority: P4)

Auto-assignment is the default, but an advisor can override it. At booking time they can request a specific technician and/or bay, for example a customer's preferred technician, and the system auto-assigns whatever wasn't chosen. After booking, they can reassign the technician and/or bay, for example when a technician is off sick. Manual choices must pass the same checks as automatic ones, so they can never double-book or assign someone unqualified.

**Why this priority**: Real workshops need exceptions handled. It builds on P1 and isn't needed for the first working slice.

**Independent Test**: Book with a pinned technician and check they are assigned. Reassign an appointment to another free, qualified technician and check the change and its audit record. Try to reassign to a busy or unqualified technician and check that it's refused.

**Acceptance Scenarios**:

1. **Given** technician Alice is free and qualified, **When** an advisor books and asks for Alice, **Then** Alice is assigned, a bay is auto-assigned, and the appointment is marked as manually assigned.
2. **Given** the requested technician is busy at that time, **When** an advisor books and asks for them, **Then** the booking is refused because that technician is unavailable. The system does **not** silently substitute someone else.
3. **Given** a confirmed appointment, **When** an advisor reassigns it to a free, qualified technician, **Then** the appointment shows the new technician, is marked as manually assigned, and the change is recorded with who made it and when.
4. **Given** a reassignment to a technician without the required skill, or a bay without the required equipment, **When** it's submitted, **Then** it is refused with the specific reason.
5. **Given** a reassignment to a technician or bay from a different dealership, **When** it's submitted, **Then** it is refused because the resource doesn't belong to this dealership.

---

### User Story 5 - Day view and appointment history (Priority: P5)

An advisor views a dealership's appointments for a day, optionally filtered by status or technician. For any appointment they can see its full history: who created it, every reassignment and any cancellation, each with who did it and when.

**Why this priority**: This gives the "single view of capacity" that manual systems lack, plus accountability for manual changes. The booking flows work without it.

**Independent Test**: Create, reassign and cancel several appointments, then check the day view lists them correctly by filter and each history shows the right entries in time order.

**Acceptance Scenarios**:

1. **Given** appointments on several days and at several dealerships, **When** an advisor requests the day view for one dealership and date, **Then** only that dealership's appointments for that local date are listed, in start-time order.
2. **Given** an appointment that was created, reassigned and then cancelled, **When** its history is viewed, **Then** three entries appear in time order, each with the action, actor and timestamp. A reassignment entry shows the before and after technician/bay.

---

### Edge Cases

- **Touching appointments:** a booking ending at 10:00 and another starting at 10:00 for the same technician/bay do **not** conflict.
- **Service runs past closing time:** a 90-minute service requested at 16:00 for a dealership closing at 17:00 is refused. It isn't truncated.
- **Daylight-saving days:** opening hours follow local time. On a 23- or 25-hour day, available times still match local opening hours.
- **Dealership closed that day** (no opening hours for the weekday): no availability, and bookings are refused as outside opening hours.
- **Inactive technician or bay:** never auto-assigned and can't be chosen manually.
- **Repeated submission with different details:** the same booking reference sent with a different request is refused. It doesn't return or overwrite the earlier booking.
- **Several identical submissions at once:** exactly one appointment is created, and every submission receives that same appointment.
- **Another tenant's data:** a dealership, customer or vehicle belonging to another dealer group is treated as **not found**. The response doesn't reveal that it exists.
- **Same vehicle at two sites of the same dealer group** at overlapping times: refused (A9).
- **Losing a race for an auto-assigned resource:** if another booking takes the chosen technician or bay first, the system tries another suitable resource (a limited number of times) before refusing.

## Requirements *(mandatory)*

### Functional Requirements

**Booking**

- **FR-001**: The system MUST accept a booking request specifying a dealership, customer, vehicle, service type and desired start time, plus an optional booking channel (online, phone, walk-in, advisor; default advisor).
- **FR-002**: The system MUST take the appointment's duration from the service type. Requesters MUST NOT be able to set it.
- **FR-003**: The system MUST confirm a booking only if, for the entire interval from start to start + duration, at least one active technician at that dealership holds the service type's required skill and is free, **and** at least one active bay at that dealership has all of the service type's required equipment and is free.
- **FR-004**: The system MUST treat time intervals as start-inclusive and end-exclusive, so back-to-back appointments don't conflict.
- **FR-005**: The system MUST never allow two confirmed appointments to overlap for the same technician, the same bay or the same vehicle, **including when requests arrive at the same moment**.
- **FR-006**: On confirmation, the system MUST store an appointment linking customer, vehicle, service type, dealership, technician, bay, start, end, status (confirmed), assignment mode (automatic or manual), booking channel, and the user who created it.
- **FR-007**: The system MUST refuse bookings that:
  - start in the past
  - aren't on the 15-minute grid
  - start more than 90 days ahead
  - don't fit entirely within the dealership's local opening hours for that day
  - name a vehicle not owned by the named customer

  Each refusal MUST state its specific reason.
- **FR-008**: When several technicians (or bays) qualify, the system MUST choose the one with the fewest confirmed booked minutes on that local day at that dealership. Ties MUST go first to the resource with fewer special capabilities, then to a fixed, deterministic order.
- **FR-009**: If an automatically chosen technician or bay is taken by a concurrent booking before confirmation, the system MUST try another suitable resource, up to 3 attempts in total, before refusing.
- **FR-010**: Every booking submission MUST carry a submitter-chosen booking reference, and submissions without one MUST be refused. The system MUST make booking submissions safely repeatable. A repeated submission with the same booking reference and identical details MUST return the original appointment without creating another. The same reference with different details MUST be refused.

**Availability and alternatives**

- **FR-011**: The system MUST return, for a dealership, service type and local date, every 15-minute-grid start time at which FR-003 would currently be satisfied, with how many technicians and bays are free at each.
- **FR-012**: When a requested time is unavailable, the refusal MUST include up to 5 alternative start times, searching the same day first and then up to 7 days ahead.
- **FR-013**: The system MUST interpret opening hours and dates in each dealership's own time zone, including daylight-saving transitions, and MUST state all times unambiguously with their offset.

**Manual assignment**

- **FR-014**: The requester MUST be able to optionally name a specific technician and/or bay at booking time. The system MUST auto-assign whatever isn't named.
- **FR-015**: An advisor MUST be able to reassign a confirmed appointment's technician and/or bay.
- **FR-016**: Manually chosen or reassigned resources MUST pass the same checks as automatic ones: same dealership, active, qualified/compatible, and free for the whole duration. If a chosen resource is unavailable, the system MUST refuse rather than substitute another.
- **FR-017**: Any manual choice or reassignment MUST mark the appointment as manually assigned.

**Cancellation and concurrent edits**

- **FR-018**: An advisor MUST be able to cancel a confirmed appointment. Its technician, bay and vehicle time MUST become available again immediately.
- **FR-019**: Reassignment and cancellation MUST be refused if based on an outdated view of the appointment (it was changed in the meantime), so one advisor's change can't silently overwrite another's.

**Viewing and history**

- **FR-020**: Users MUST be able to retrieve a single appointment, and list a dealership's appointments for a local date, filtered by status and/or technician, in start-time order, with paging.
- **FR-021**: The system MUST record a history entry for every creation, reassignment and cancellation: action, actor, timestamp, and for reassignments the previous and new technician/bay. Users MUST be able to view an appointment's history in time order.
- **FR-022**: Users MUST be able to list a dealership's technicians (with skills) and bays (with equipment), and the dealer group's dealerships and service types, to support manual choices.

**Multi-tenancy and isolation**

- **FR-023**: Every request MUST be made in the context of exactly one dealer group (tenant), taken from the caller's verified identity rather than from what the caller types.
- **FR-024**: The system MUST NOT show, count, assign or change any dealership, customer, vehicle, technician, bay, service type or appointment belonging to another tenant. Such items MUST be reported as not found.
- **FR-025**: Technicians and bays MUST only be assignable to appointments at their own dealership, even within the same tenant.
- **FR-026**: Customers, vehicles and the service catalogue MUST be shared across all dealerships of the same tenant.

**Operational**

- **FR-027**: The system MUST NOT record customer personal details (name, email, phone) in operational logs, monitoring data or history entries. Those MUST hold identifiers only.
- **FR-028**: The system MUST expose its health and readiness so operators can tell when it can't serve bookings.

### Key Entities *(include if feature involves data)*

- **Tenant (dealer group)**: The organisation using the system. It owns dealerships, customers, vehicles, skills and the service catalogue. It's the isolation boundary.
- **Dealership**: A physical site in a tenant, with a name, a local time zone and weekly opening hours. It owns technicians, bays and appointments.
- **Opening hours**: For each weekday, the dealership's local opening and closing time. A day with no entry means the dealership is closed.
- **Customer**: A person who owns vehicles. Name, email and phone are personal data.
- **Vehicle**: Belongs to one customer. Identified by VIN, unique within the tenant. Has make, model and year.
- **Skill**: A qualification a technician can hold (e.g. general servicing, EV high-voltage, diagnostics).
- **Bay capability**: Equipment a bay can have (e.g. lift, alignment rig, EV charger).
- **Service type**: An item in the tenant's catalogue with a name, a fixed duration, exactly one required skill and zero or more required bay capabilities.
- **Technician**: A person at one dealership, with one or more skills and an active flag.
- **Service bay**: A workspace at one dealership, with zero or more capabilities and an active flag.
- **Appointment**: A booking of one vehicle, for one service type, at one dealership, with exactly one technician and one bay, over a start–end interval. It has a status (confirmed, cancelled, completed, no-show), an assignment mode (automatic or manual), a channel, its creator, a booking reference for safe resubmission, and a revision marker that detects stale edits.
- **Appointment history entry**: An append-only record of a create, reassign or cancel action on an appointment: actor, time and identifiers only.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: **Zero double bookings.** In a test where 20 people submit bookings for the last free slot at the same moment, exactly 1 is confirmed and 19 are refused, every time it's run.
- **SC-002**: 100% of confirmed appointments have a technician holding the required skill and a bay with all required equipment, both at the booked dealership.
- **SC-003**: Repeated or simultaneous resubmissions of the same booking never create more than one appointment: 0 duplicates across 20 simultaneous identical submissions.
- **SC-004**: 95% of availability searches return results in under half a second, and 95% of booking attempts get a confirmation or refusal in under 1 second, at the expected peak load (about 50 bookings per second across all dealerships).
- **SC-005**: When a requested time is unavailable but capacity exists within the next 7 days, alternatives are offered in 100% of cases.
- **SC-006**: **Zero cross-tenant exposure.** In isolation tests, every attempt to read, book against or assign another tenant's dealership, customer, vehicle, technician or bay is refused as not found.
- **SC-007**: **Even workload.** On a test day with equally skilled technicians and only automatic assignment, the gap in booked minutes between the most- and least-loaded technician never exceeds the longest single service duration booked that day.
- **SC-008**: 100% of creations, reassignments and cancellations have a history entry naming the actor and time.
- **SC-009**: An advisor can find a free time and confirm a booking in under 2 minutes, compared with the phone-and-diary process it replaces.
- **SC-010**: 0 occurrences of customer name, email or phone in logs, monitoring data or history entries during the full automated test run.

## Assumptions

- **Scope (this deliverable):** the backend service is built. User interfaces (customer booking and advisor console) are represented by a documented interface contract and example requests, not built.
- **Identity:** authentication is handled upstream. The service trusts a forwarded tenant and user identity. In this deliverable these are supplied as request metadata standing in for verified identity claims.
- **Reference data:** tenants, dealerships, opening hours, customers, vehicles, skills, capabilities, technicians, bays and service types already exist (in production they come from CRM/DMS systems). They are seeded, read-only, and have no management screens.
- **Working hours:** technicians are available for the whole of their dealership's opening hours. Individual shifts, breaks, leave and public holidays aren't modelled yet.
- **No buffers:** no clean-up time between appointments.
- **One technician and one bay per appointment**, held for the whole duration. Multi-resource jobs are out of scope.
- **Lifecycle:** only confirmed → cancelled is driven by this service. Completed and no-show are reserved for a future workshop/DMS integration. Rescheduling = cancel + rebook.
- **No automatic rebooking:** the system suggests alternatives but never books a time the requester didn't choose.
- **Notifications** (email/SMS confirmations) are out of scope. The appointment history is designed so a notification service could consume it later.
- **Scale:** about 200 dealer groups running about 1,000 dealerships, each with 10–30 bays, 10–50 technicians and 50–300 appointments a day. Availability checks outnumber bookings about 20 to 1.
- **Privacy:** the dealer group is the data controller. Erasure requests anonymise customer details while keeping service history. Retention schedules are out of scope for this deliverable.
- **Reference:** the agreed technical design, including constraints, error codes and technology choices, is in `docs/system-design.md`. This spec deliberately stays technology-neutral.
