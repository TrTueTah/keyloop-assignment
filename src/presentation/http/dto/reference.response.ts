import { ApiProperty } from '@nestjs/swagger';
import { Dealership } from '../../../domain/model/dealership';
import { ServiceBay } from '../../../domain/model/service-bay';
import { ServiceType } from '../../../domain/model/service-type';
import { Technician } from '../../../domain/model/technician';

export class DealershipResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: 'Europe/London' }) timezone!: string;
}
export class ServiceTypeResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() durationMinutes!: number;
  @ApiProperty({ example: 'EV_HIGH_VOLTAGE' }) requiredSkill!: string;
  @ApiProperty({ type: [String], example: ['LIFT', 'EV_CHARGER'] }) requiredCapabilities!: string[];
}
export class TechnicianResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() active!: boolean;
  @ApiProperty({ type: [String] }) skills!: string[];
}
export class ServiceBayResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() active!: boolean;
  @ApiProperty({ type: [String] }) capabilities!: string[];
}

export const toDealershipResponse = (d: Dealership): DealershipResponse => ({
  id: d.id,
  name: d.name,
  timezone: d.timezone,
});
export const toServiceTypeResponse = (s: ServiceType): ServiceTypeResponse => ({
  id: s.id,
  code: s.code,
  name: s.name,
  durationMinutes: s.durationMinutes,
  requiredSkill: s.requiredSkill,
  requiredCapabilities: [...s.requiredCapabilities],
});
export const toTechnicianResponse = (t: Technician): TechnicianResponse => ({
  id: t.id,
  name: t.name,
  active: t.active,
  skills: [...t.skills],
});
export const toServiceBayResponse = (b: ServiceBay): ServiceBayResponse => ({
  id: b.id,
  name: b.name,
  active: b.active,
  capabilities: [...b.capabilities],
});
