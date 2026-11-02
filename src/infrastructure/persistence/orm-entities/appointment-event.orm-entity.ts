import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'appointment_event' })
export class AppointmentEventOrmEntity {
  @PrimaryColumn('uuid') id!: string;
  @Column('uuid', { name: 'tenant_id' }) tenantId!: string;
  @Column('uuid', { name: 'appointment_id' }) appointmentId!: string;
  @Column('text') type!: string;
  @Column('text') actor!: string;
  @Column('jsonb') payload!: object;
  @Column('timestamptz', { name: 'occurred_at' }) occurredAt!: Date;
  @Column('timestamptz', { name: 'published_at', nullable: true }) publishedAt!: Date | null;
}
