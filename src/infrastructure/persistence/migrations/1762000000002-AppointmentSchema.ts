import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Appointment + audit/outbox schema (data-model §1).
 *
 * Correctness lives here (Constitution I/II): exclusion constraints prevent overlapping CONFIRMED
 * appointments per technician, bay and vehicle; composite FKs make cross-site/cross-tenant rows
 * impossible. Constraint NAMES are a contract with infrastructure/persistence/pg-errors.ts.
 */
export class AppointmentSchema1762000000002 implements MigrationInterface {
  name = 'AppointmentSchema1762000000002';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE appointment (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id        uuid NOT NULL,
        dealership_id    uuid NOT NULL,
        customer_id      uuid NOT NULL,
        vehicle_id       uuid NOT NULL,
        service_type_id  uuid NOT NULL,
        technician_id    uuid NOT NULL,
        service_bay_id   uuid NOT NULL,
        start_at         timestamptz NOT NULL,
        end_at           timestamptz NOT NULL,
        status           text NOT NULL
          CHECK (status IN ('CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW')),
        assignment_mode  text NOT NULL CHECK (assignment_mode IN ('AUTO', 'MANUAL')),
        channel          text NOT NULL DEFAULT 'ADVISOR'
          CHECK (channel IN ('ONLINE', 'PHONE', 'WALK_IN', 'ADVISOR')),
        created_by       text NOT NULL,
        idempotency_key  text NOT NULL,
        request_hash     char(64) NOT NULL,
        version          integer NOT NULL DEFAULT 1,
        created_at       timestamptz NOT NULL DEFAULT now(),
        updated_at       timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT valid_interval CHECK (end_at > start_at),

        CONSTRAINT no_technician_overlap EXCLUDE USING gist (
          technician_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&
        ) WHERE (status = 'CONFIRMED'),
        CONSTRAINT no_bay_overlap EXCLUDE USING gist (
          service_bay_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&
        ) WHERE (status = 'CONFIRMED'),
        CONSTRAINT no_vehicle_overlap EXCLUDE USING gist (
          vehicle_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&
        ) WHERE (status = 'CONFIRMED'),

        CONSTRAINT fk_appt_site FOREIGN KEY (dealership_id, tenant_id)
          REFERENCES dealership (id, tenant_id),
        CONSTRAINT fk_appt_tech FOREIGN KEY (technician_id, dealership_id)
          REFERENCES technician (id, dealership_id),
        CONSTRAINT fk_appt_bay FOREIGN KEY (service_bay_id, dealership_id)
          REFERENCES service_bay (id, dealership_id),
        CONSTRAINT fk_appt_customer FOREIGN KEY (customer_id, tenant_id)
          REFERENCES customer (id, tenant_id),
        CONSTRAINT fk_appt_vehicle FOREIGN KEY (vehicle_id, tenant_id)
          REFERENCES vehicle (id, tenant_id),
        CONSTRAINT fk_appt_service FOREIGN KEY (service_type_id, tenant_id)
          REFERENCES service_type (id, tenant_id)
      )`);

    await q.query(
      `CREATE UNIQUE INDEX uq_appt_idempotency ON appointment (tenant_id, idempotency_key)`,
    );
    await q.query(
      `CREATE INDEX ix_appt_site_day ON appointment (dealership_id, start_at) WHERE status = 'CONFIRMED'`,
    );
    await q.query(`CREATE INDEX ix_appt_site_list ON appointment (dealership_id, start_at, id)`);

    await q.query(`
      CREATE TABLE appointment_event (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id      uuid NOT NULL,
        appointment_id uuid NOT NULL REFERENCES appointment (id),
        type           text NOT NULL CHECK (type IN ('CREATED', 'REASSIGNED', 'CANCELLED')),
        actor          text NOT NULL,
        payload        jsonb NOT NULL,
        occurred_at    timestamptz NOT NULL DEFAULT now(),
        published_at   timestamptz NULL
      )`);
    await q.query(`CREATE INDEX ix_event_appt ON appointment_event (appointment_id, occurred_at)`);
    await q.query(
      `CREATE INDEX ix_event_unpublished ON appointment_event (occurred_at) WHERE published_at IS NULL`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS appointment_event`);
    await q.query(`DROP TABLE IF EXISTS appointment`);
  }
}
