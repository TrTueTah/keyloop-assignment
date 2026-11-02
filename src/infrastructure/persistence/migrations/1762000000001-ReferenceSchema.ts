import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reference data schema (data-model §1). Hand-written SQL: migrations are the single source of
 * truth for the schema (research R3). Never replace with `migration:generate`.
 */
export class ReferenceSchema1762000000001 implements MigrationInterface {
  name = 'ReferenceSchema1762000000001';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await q.query(`CREATE EXTENSION IF NOT EXISTS btree_gist`);

    await q.query(`
      CREATE TABLE tenant (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name       text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE dealership (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id  uuid NOT NULL REFERENCES tenant (id),
        name       text NOT NULL,
        timezone   text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_dealership_tenant UNIQUE (id, tenant_id)
      )`);

    await q.query(`
      CREATE TABLE opening_hours (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        dealership_id uuid NOT NULL REFERENCES dealership (id),
        weekday       smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
        opens_at      time NOT NULL,
        closes_at     time NOT NULL,
        created_at    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_opening_hours_day UNIQUE (dealership_id, weekday),
        CONSTRAINT ck_opening_hours_order CHECK (closes_at > opens_at)
      )`);

    await q.query(`
      CREATE TABLE skill (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id  uuid NOT NULL REFERENCES tenant (id),
        code       text NOT NULL,
        name       text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_skill_code UNIQUE (tenant_id, code)
      )`);

    await q.query(`
      CREATE TABLE bay_capability (
        code       text PRIMARY KEY,
        name       text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE service_type (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id         uuid NOT NULL REFERENCES tenant (id),
        code              text NOT NULL,
        name              text NOT NULL,
        duration_minutes  integer NOT NULL,
        required_skill_id uuid NOT NULL REFERENCES skill (id),
        created_at        timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_service_type_code UNIQUE (tenant_id, code),
        CONSTRAINT uq_service_tenant UNIQUE (id, tenant_id),
        CONSTRAINT ck_service_duration CHECK (
          duration_minutes > 0 AND duration_minutes % 15 = 0 AND duration_minutes <= 720)
      )`);

    await q.query(`
      CREATE TABLE service_type_capability (
        service_type_id uuid NOT NULL REFERENCES service_type (id),
        capability_code text NOT NULL REFERENCES bay_capability (code),
        PRIMARY KEY (service_type_id, capability_code)
      )`);

    await q.query(`
      CREATE TABLE technician (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        dealership_id uuid NOT NULL REFERENCES dealership (id),
        name          text NOT NULL,
        active        boolean NOT NULL DEFAULT true,
        created_at    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_technician_site UNIQUE (id, dealership_id)
      )`);

    await q.query(`
      CREATE TABLE technician_skill (
        technician_id uuid NOT NULL REFERENCES technician (id),
        skill_id      uuid NOT NULL REFERENCES skill (id),
        PRIMARY KEY (technician_id, skill_id)
      )`);

    await q.query(`
      CREATE TABLE service_bay (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        dealership_id uuid NOT NULL REFERENCES dealership (id),
        name          text NOT NULL,
        active        boolean NOT NULL DEFAULT true,
        created_at    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_bay_site UNIQUE (id, dealership_id)
      )`);

    await q.query(`
      CREATE TABLE service_bay_capability (
        service_bay_id  uuid NOT NULL REFERENCES service_bay (id),
        capability_code text NOT NULL REFERENCES bay_capability (code),
        PRIMARY KEY (service_bay_id, capability_code)
      )`);

    await q.query(`
      CREATE TABLE customer (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id  uuid NOT NULL REFERENCES tenant (id),
        name       text NOT NULL,
        email      text NOT NULL,
        phone      text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_customer_tenant UNIQUE (id, tenant_id)
      )`);

    await q.query(`
      CREATE TABLE vehicle (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenant (id),
        customer_id uuid NOT NULL,
        vin         char(17) NOT NULL,
        make        text NOT NULL,
        model       text NOT NULL,
        year        smallint NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_vehicle_vin UNIQUE (tenant_id, vin),
        CONSTRAINT uq_vehicle_tenant UNIQUE (id, tenant_id),
        CONSTRAINT fk_vehicle_customer FOREIGN KEY (customer_id, tenant_id)
          REFERENCES customer (id, tenant_id)
      )`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of [
      'vehicle',
      'customer',
      'service_bay_capability',
      'service_bay',
      'technician_skill',
      'technician',
      'service_type_capability',
      'service_type',
      'bay_capability',
      'skill',
      'opening_hours',
      'dealership',
      'tenant',
    ]) {
      await q.query(`DROP TABLE IF EXISTS ${table}`);
    }
  }
}
