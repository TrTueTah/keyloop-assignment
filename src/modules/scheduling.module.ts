import { Module } from '@nestjs/common';
import {
  APPOINTMENT_EVENT_REPOSITORY,
  AppointmentEventRepository,
} from '../application/ports/appointment-event.repository';
import {
  APPOINTMENT_REPOSITORY,
  AppointmentRepository,
} from '../application/ports/appointment.repository';
import { CLOCK, Clock } from '../application/ports/clock';
import { ID_GENERATOR, IdGenerator } from '../application/ports/id-generator';
import { IDEMPOTENCY_STORE, IdempotencyStore } from '../application/ports/idempotency.store';
import { REFERENCE_QUERY, ReferenceQuery } from '../application/ports/reference.query';
import { RESOURCE_QUERY, ResourceQuery } from '../application/ports/resource.query';
import { TELEMETRY, Telemetry } from '../application/ports/telemetry';
import { UNIT_OF_WORK, UnitOfWork } from '../application/ports/unit-of-work';
import { BookAppointment } from '../application/use-cases/book-appointment';
import { CancelAppointment } from '../application/use-cases/cancel-appointment';
import { FindAlternatives } from '../application/use-cases/find-alternatives';
import { GetAppointment } from '../application/use-cases/get-appointment';
import {
  ListAppointmentEvents,
  ListAppointments,
} from '../application/use-cases/list-appointments';
import { ReassignAppointment } from '../application/use-cases/reassign-appointment';
import { SearchAvailability } from '../application/use-cases/search-availability';
import { AllocationPolicy, LeastLoadedPolicy } from '../domain/allocation-policy';
import { AppointmentsController } from '../presentation/http/controllers/appointments.controller';
import { AvailabilityController } from '../presentation/http/controllers/availability.controller';

export const ALLOCATION_POLICY = Symbol('ALLOCATION_POLICY');

/** Composition root for scheduling use cases (plain classes wired via factories + port tokens). */
@Module({
  controllers: [AppointmentsController, AvailabilityController],
  providers: [
    { provide: ALLOCATION_POLICY, useClass: LeastLoadedPolicy },
    {
      provide: FindAlternatives,
      useFactory: (res: ResourceQuery, clock: Clock, telemetry: Telemetry) =>
        new FindAlternatives(res, clock, telemetry),
      inject: [RESOURCE_QUERY, CLOCK, TELEMETRY],
    },
    {
      provide: SearchAvailability,
      useFactory: (ref: ReferenceQuery, res: ResourceQuery, clock: Clock, telemetry: Telemetry) =>
        new SearchAvailability(ref, res, clock, telemetry),
      inject: [REFERENCE_QUERY, RESOURCE_QUERY, CLOCK, TELEMETRY],
    },
    {
      provide: BookAppointment,
      useFactory: (
        uow: UnitOfWork,
        idem: IdempotencyStore,
        ref: ReferenceQuery,
        res: ResourceQuery,
        policy: AllocationPolicy,
        clock: Clock,
        ids: IdGenerator,
        telemetry: Telemetry,
        alternatives: FindAlternatives,
      ) =>
        new BookAppointment(
          uow,
          idem,
          ref,
          res,
          policy,
          clock,
          ids,
          telemetry,
          (ctx, st, d, start) => alternatives.execute(ctx, st, d, start),
        ),
      inject: [
        UNIT_OF_WORK,
        IDEMPOTENCY_STORE,
        REFERENCE_QUERY,
        RESOURCE_QUERY,
        ALLOCATION_POLICY,
        CLOCK,
        ID_GENERATOR,
        TELEMETRY,
        FindAlternatives,
      ],
    },
    {
      provide: CancelAppointment,
      useFactory: (uow: UnitOfWork, clock: Clock, ids: IdGenerator, telemetry: Telemetry) =>
        new CancelAppointment(uow, clock, ids, telemetry),
      inject: [UNIT_OF_WORK, CLOCK, ID_GENERATOR, TELEMETRY],
    },
    {
      provide: ReassignAppointment,
      useFactory: (
        repo: AppointmentRepository,
        ref: ReferenceQuery,
        res: ResourceQuery,
        uow: UnitOfWork,
        clock: Clock,
        ids: IdGenerator,
        telemetry: Telemetry,
      ) => new ReassignAppointment(repo, ref, res, uow, clock, ids, telemetry),
      inject: [
        APPOINTMENT_REPOSITORY,
        REFERENCE_QUERY,
        RESOURCE_QUERY,
        UNIT_OF_WORK,
        CLOCK,
        ID_GENERATOR,
        TELEMETRY,
      ],
    },
    {
      provide: ListAppointments,
      useFactory: (repo: AppointmentRepository, ref: ReferenceQuery) =>
        new ListAppointments(repo, ref),
      inject: [APPOINTMENT_REPOSITORY, REFERENCE_QUERY],
    },
    {
      provide: ListAppointmentEvents,
      useFactory: (repo: AppointmentRepository, events: AppointmentEventRepository) =>
        new ListAppointmentEvents(repo, events),
      inject: [APPOINTMENT_REPOSITORY, APPOINTMENT_EVENT_REPOSITORY],
    },
    {
      provide: GetAppointment,
      useFactory: (repo: AppointmentRepository) => new GetAppointment(repo),
      inject: [APPOINTMENT_REPOSITORY],
    },
  ],
})
export class SchedulingModule {}
