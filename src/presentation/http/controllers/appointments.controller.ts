import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Response } from 'express';
import { SiteContext } from '../../../application/tenant-context';
import { BookAppointment } from '../../../application/use-cases/book-appointment';
import { CancelAppointment } from '../../../application/use-cases/cancel-appointment';
import { ReassignAppointment } from '../../../application/use-cases/reassign-appointment';
import {
  ListAppointmentEvents,
  ListAppointments,
} from '../../../application/use-cases/list-appointments';
import { GetAppointment } from '../../../application/use-cases/get-appointment';
import { AppointmentResponse, toAppointmentResponse } from '../dto/appointment.response';
import { CreateAppointmentRequest } from '../dto/create-appointment.request';
import { ProblemResponse } from '../dto/problem.response';
import { VersionedRequest } from '../dto/versioned.request';
import { ReassignRequest } from '../dto/reassign.request';
import { ListAppointmentsQueryDto } from '../dto/list-appointments.query';
import {
  AppointmentEventResponse,
  AppointmentPageResponse,
  toEventResponse,
} from '../dto/appointment-page.response';
import { IdempotencyKey } from '../idempotency/idempotency-key.decorator';
import { Site } from '../tenant/tenant-context.decorator';
import { TenantGuard } from '../tenant/tenant.guard';
import { ApiIdentityHeaders } from '../tenant/api-identity-headers.decorator';

@ApiTags('Appointments')
@ApiIdentityHeaders()
@Controller('api/v1/dealerships/:dealershipId/appointments')
@UseGuards(TenantGuard)
export class AppointmentsController {
  constructor(
    private readonly book: BookAppointment,
    private readonly getOne: GetAppointment,
    private readonly cancelOne: CancelAppointment,
    private readonly reassignOne: ReassignAppointment,
    private readonly list: ListAppointments,
    private readonly history: ListAppointmentEvents,
  ) {}

  @Get()
  @ApiOkResponse({ type: AppointmentPageResponse })
  @ApiNotFoundResponse({ type: ProblemResponse })
  @ApiUnprocessableEntityResponse({ type: ProblemResponse })
  async dayView(
    @Site() ctx: SiteContext,
    @Query() q: ListAppointmentsQueryDto,
  ): Promise<AppointmentPageResponse> {
    const page = await this.list.execute(ctx, { ...q, limit: q.limit ?? 50 });
    return {
      items: page.items.map((a) => toAppointmentResponse(a, ctx.timezone)),
      nextCursor: page.nextCursor,
    };
  }

  @Get(':appointmentId/events')
  @ApiOkResponse({ type: [AppointmentEventResponse] })
  @ApiNotFoundResponse({ type: ProblemResponse })
  async events(
    @Site() ctx: SiteContext,
    @Param('appointmentId') id: string,
  ): Promise<AppointmentEventResponse[]> {
    return (await this.history.execute(ctx, id)).map(toEventResponse);
  }

  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: AppointmentResponse })
  @ApiOkResponse({ type: AppointmentResponse, description: 'Idempotent replay' })
  @ApiNotFoundResponse({ type: ProblemResponse })
  @ApiConflictResponse({
    type: ProblemResponse,
    description: 'SLOT_UNAVAILABLE | RESOURCE_UNAVAILABLE | VEHICLE_ALREADY_BOOKED',
  })
  @ApiUnprocessableEntityResponse({ type: ProblemResponse })
  async create(
    @Site() ctx: SiteContext,
    @IdempotencyKey() idempotencyKey: string,
    @Body() body: CreateAppointmentRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AppointmentResponse> {
    const { appointment, replayed } = await this.book.execute(ctx, { ...body, idempotencyKey });
    res.status(replayed ? HttpStatus.OK : HttpStatus.CREATED);
    res.setHeader(
      'Location',
      `/api/v1/dealerships/${ctx.dealershipId}/appointments/${appointment.id}`,
    );
    return toAppointmentResponse(appointment, ctx.timezone);
  }

  @Get(':appointmentId')
  @ApiOkResponse({ type: AppointmentResponse })
  @ApiNotFoundResponse({ type: ProblemResponse })
  async findOne(
    @Site() ctx: SiteContext,
    @Param('appointmentId') id: string,
  ): Promise<AppointmentResponse> {
    return toAppointmentResponse(await this.getOne.execute(ctx, id), ctx.timezone);
  }

  @Post(':appointmentId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AppointmentResponse })
  @ApiNotFoundResponse({ type: ProblemResponse })
  @ApiConflictResponse({ type: ProblemResponse, description: 'STALE_VERSION | NOT_CONFIRMED' })
  @ApiUnprocessableEntityResponse({ type: ProblemResponse })
  async cancel(
    @Site() ctx: SiteContext,
    @Param('appointmentId') id: string,
    @Body() body: VersionedRequest,
  ): Promise<AppointmentResponse> {
    return toAppointmentResponse(await this.cancelOne.execute(ctx, id, body.version), ctx.timezone);
  }

  @Patch(':appointmentId/assignment')
  @ApiOkResponse({ type: AppointmentResponse })
  @ApiNotFoundResponse({ type: ProblemResponse })
  @ApiConflictResponse({
    type: ProblemResponse,
    description: 'RESOURCE_UNAVAILABLE | STALE_VERSION | NOT_CONFIRMED',
  })
  @ApiUnprocessableEntityResponse({ type: ProblemResponse })
  async reassign(
    @Site() ctx: SiteContext,
    @Param('appointmentId') id: string,
    @Body() body: ReassignRequest,
  ): Promise<AppointmentResponse> {
    return toAppointmentResponse(await this.reassignOne.execute(ctx, id, body), ctx.timezone);
  }
}
