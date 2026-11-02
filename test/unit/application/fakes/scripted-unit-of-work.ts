// NOT evidence for DB guarantees (Constitution III): orchestration-only test double.
import {
  AppointmentPatch,
  ConflictTarget,
  UpdateOutcome,
} from '../../../../src/application/ports/appointment.repository';
import { IdempotencyStore } from '../../../../src/application/ports/idempotency.store';
import {
  CandidateQuery,
  Candidates,
  ResourceQuery,
} from '../../../../src/application/ports/resource.query';
import { TxScope, UnitOfWork } from '../../../../src/application/ports/unit-of-work';
import { SiteContext, TenantContext } from '../../../../src/application/tenant-context';
import { Appointment, AppointmentEvent } from '../../../../src/domain/model/appointment';
import { InMemoryReference } from './in-memory-reference';

export type InsertScript = 'ok' | ConflictTarget;

/**
 * Unit of work whose writes follow a script, so each orchestration branch (retry, terminal
 * conflict, idempotency race) can be driven deterministically. Events are kept only for "committed"
 * runs, mimicking rollback on conflict.
 */
export class ScriptedUnitOfWork implements UnitOfWork, IdempotencyStore {
  runs = 0;
  readonly appointments: Appointment[] = [];
  readonly events: AppointmentEvent[] = [];
  readonly candidateQueries: CandidateQuery[] = [];
  updateScript: UpdateOutcome['kind'][] = [];
  /** Called when an insert is scripted as an idempotency_key conflict (simulates a concurrent winner). */
  onIdempotencyConflict?: () => void;

  constructor(
    public candidates: (q: CandidateQuery) => Candidates,
    public insertScript: InsertScript[] = [],
  ) {}

  readonly resources: ResourceQuery = {
    findCandidates: async (_ctx, q) => {
      this.candidateQueries.push(q);
      return this.candidates(q);
    },
    getTechnician: async (ctx, id) => InMemoryReference.technician(ctx, id),
    getBay: async (ctx, id) => InMemoryReference.bay(ctx, id),
    availabilitySnapshot: async () => ({ technicians: [], bays: [] }),
  };

  async findByKey(ctx: TenantContext, key: string): Promise<Appointment | null> {
    return (
      this.appointments.find((a) => a.tenantId === ctx.tenantId && a.idempotencyKey === key) ?? null
    );
  }

  async run<T>(work: (tx: TxScope) => Promise<T>): Promise<T> {
    this.runs += 1;
    let conflicted = false;
    const pendingEvents: AppointmentEvent[] = [];
    const pendingAppointments: Appointment[] = [];
    const tx: TxScope = {
      appointments: {
        insert: async (_ctx: SiteContext, a: Appointment) => {
          const next = this.insertScript.shift() ?? 'ok';
          if (next === 'ok') {
            pendingAppointments.push(a);
            return { kind: 'inserted', appointment: a };
          }
          if (next === 'idempotency_key') this.onIdempotencyConflict?.();
          conflicted = true;
          return { kind: 'conflict', on: next };
        },
        findById: async (_ctx, id) => this.appointments.find((a) => a.id === id) ?? null,
        updateIfVersion: async (_ctx, id, _v, patch: AppointmentPatch, now) => {
          const kind = this.updateScript.shift() ?? 'updated';
          const current = this.appointments.find((a) => a.id === id);
          if (kind === 'updated' && current) {
            const updated: Appointment = {
              ...current,
              ...('status' in patch
                ? { status: 'CANCELLED' as const }
                : {
                    technicianId: patch.technicianId,
                    serviceBayId: patch.serviceBayId,
                    assignmentMode: 'MANUAL' as const,
                  }),
              version: current.version + 1,
              updatedAt: now,
            };
            this.appointments.splice(this.appointments.indexOf(current), 1, updated);
            return { kind: 'updated', appointment: updated };
          }
          if (kind === 'conflict') {
            conflicted = true;
            return { kind: 'conflict', on: 'technician' };
          }
          return { kind } as UpdateOutcome;
        },
        listForDay: async () => [],
      },
      events: {
        append: async (_ctx, e) => {
          pendingEvents.push(e);
        },
        listForAppointment: async (_ctx, id) => this.events.filter((e) => e.appointmentId === id),
      },
      resources: this.resources,
    };
    const result = await work(tx);
    if (!conflicted) {
      this.appointments.push(...pendingAppointments);
      this.events.push(...pendingEvents);
    }
    return result;
  }
}
