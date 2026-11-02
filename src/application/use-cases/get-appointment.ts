import { DomainError } from '../../domain/errors';
import { Appointment } from '../../domain/model/appointment';
import { AppointmentRepository } from '../ports/appointment.repository';
import { SiteContext } from '../tenant-context';

export class GetAppointment {
  constructor(private readonly appointments: AppointmentRepository) {}

  async execute(ctx: SiteContext, id: string): Promise<Appointment> {
    const appointment = await this.appointments.findById(ctx, id);
    if (!appointment) throw new DomainError('NOT_FOUND', 'Appointment not found');
    return appointment;
  }
}
