import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Column mapping only (not a domain entity, Constitution IV). No relations on the composite-FK
 * columns and no @VersionColumn: `version` changes only through explicit SQL (research R3/R7).
 */
@Entity({ name: 'appointment' })
export class AppointmentOrmEntity {
  @PrimaryColumn('uuid') id!: string;
  @Column('uuid', { name: 'tenant_id' }) tenantId!: string;
  @Column('uuid', { name: 'dealership_id' }) dealershipId!: string;
  @Column('uuid', { name: 'customer_id' }) customerId!: string;
  @Column('uuid', { name: 'vehicle_id' }) vehicleId!: string;
  @Column('uuid', { name: 'service_type_id' }) serviceTypeId!: string;
  @Column('uuid', { name: 'technician_id' }) technicianId!: string;
  @Column('uuid', { name: 'service_bay_id' }) serviceBayId!: string;
  @Column('timestamptz', { name: 'start_at' }) startAt!: Date;
  @Column('timestamptz', { name: 'end_at' }) endAt!: Date;
  @Column('text') status!: string;
  @Column('text', { name: 'assignment_mode' }) assignmentMode!: string;
  @Column('text') channel!: string;
  @Column('text', { name: 'created_by' }) createdBy!: string;
  @Column('text', { name: 'idempotency_key' }) idempotencyKey!: string;
  @Column('char', { name: 'request_hash', length: 64 }) requestHash!: string;
  @Column('integer') version!: number;
  @Column('timestamptz', { name: 'created_at' }) createdAt!: Date;
  @Column('timestamptz', { name: 'updated_at' }) updatedAt!: Date;
}
