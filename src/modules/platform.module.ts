import { DynamicModule, Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import pino from 'pino';
import { DataSource } from 'typeorm';
import { APPOINTMENT_EVENT_REPOSITORY } from '../application/ports/appointment-event.repository';
import { APPOINTMENT_REPOSITORY } from '../application/ports/appointment.repository';
import { CLOCK } from '../application/ports/clock';
import { HEALTH_PROBE } from '../application/ports/health-probe';
import { ID_GENERATOR } from '../application/ports/id-generator';
import { IDEMPOTENCY_STORE } from '../application/ports/idempotency.store';
import { REFERENCE_QUERY, ReferenceQuery } from '../application/ports/reference.query';
import { REQUEST_CONTEXT } from '../application/ports/request-context';
import { RESOURCE_QUERY } from '../application/ports/resource.query';
import { TELEMETRY } from '../application/ports/telemetry';
import { UNIT_OF_WORK } from '../application/ports/unit-of-work';
import { ResolveTenantContext } from '../application/use-cases/resolve-tenant-context';
import { AppConfig } from '../infrastructure/config/env';
import { UuidGenerator } from '../infrastructure/ids/uuid-generator';
import { requestContextStore } from '../infrastructure/observability/als-request-context';
import { loggerParams, REDACT_PATHS } from '../infrastructure/observability/logger.config';
import { OtelTelemetry } from '../infrastructure/observability/otel-telemetry';
import { dataSourceOptions } from '../infrastructure/persistence/data-source';
import { TypeOrmHealthProbe } from '../infrastructure/persistence/health-probe.adapter';
import { TypeOrmAppointmentEventRepository } from '../infrastructure/persistence/repositories/typeorm-appointment-event.repository';
import { TypeOrmAppointmentRepository } from '../infrastructure/persistence/repositories/typeorm-appointment.repository';
import { TypeOrmReferenceQuery } from '../infrastructure/persistence/repositories/typeorm-reference.query';
import { TypeOrmResourceQuery } from '../infrastructure/persistence/repositories/typeorm-resource.query';
import { TypeOrmUnitOfWork } from '../infrastructure/persistence/typeorm-unit-of-work';
import { SystemClock } from '../infrastructure/time/system-clock';
import { TenantGuard } from '../presentation/http/tenant/tenant.guard';
import { APP_CONFIG, APP_LOGGER } from './tokens';

export interface PlatformOptions {
  config: AppConfig;
  /** Optional log sink (tests capture logs to prove the no-PII rule). */
  logDestination?: NodeJS.WritableStream;
}

/**
 * Composition root (Constitution IV): the only place that binds application ports to
 * infrastructure adapters.
 */
@Global()
@Module({})
export class PlatformModule {
  static forRoot({ config, logDestination }: PlatformOptions): DynamicModule {
    const appLogger = pino(
      { level: config.logLevel, redact: REDACT_PATHS, base: { service: config.serviceName } },
      ...(logDestination ? [logDestination] : []),
    );
    const params = loggerParams(config.logLevel, requestContextStore);
    const pinoHttpOptions = Array.isArray(params.pinoHttp) ? params.pinoHttp[0] : params.pinoHttp;

    const ports = [
      { provide: APP_CONFIG, useValue: config },
      { provide: APP_LOGGER, useValue: appLogger },
      { provide: CLOCK, useClass: SystemClock },
      { provide: ID_GENERATOR, useClass: UuidGenerator },
      { provide: REQUEST_CONTEXT, useValue: requestContextStore },
      {
        provide: TELEMETRY,
        useFactory: () =>
          new OtelTelemetry(config.nodeEnv !== 'production', appLogger, requestContextStore),
      },
      {
        provide: UNIT_OF_WORK,
        useFactory: (ds: DataSource) => new TypeOrmUnitOfWork(ds),
        inject: [DataSource],
      },
      {
        provide: HEALTH_PROBE,
        useFactory: (ds: DataSource) => new TypeOrmHealthProbe(ds),
        inject: [DataSource],
      },
      {
        provide: REFERENCE_QUERY,
        useFactory: (ds: DataSource) => new TypeOrmReferenceQuery(ds.manager),
        inject: [DataSource],
      },
      {
        provide: RESOURCE_QUERY,
        useFactory: (ds: DataSource) => new TypeOrmResourceQuery(ds.manager),
        inject: [DataSource],
      },
      {
        provide: APPOINTMENT_REPOSITORY,
        useFactory: (ds: DataSource) => new TypeOrmAppointmentRepository(ds.manager),
        inject: [DataSource],
      },
      { provide: IDEMPOTENCY_STORE, useExisting: APPOINTMENT_REPOSITORY },
      {
        provide: APPOINTMENT_EVENT_REPOSITORY,
        useFactory: (ds: DataSource) => new TypeOrmAppointmentEventRepository(ds.manager),
        inject: [DataSource],
      },
      {
        provide: ResolveTenantContext,
        useFactory: (ref: ReferenceQuery) => new ResolveTenantContext(ref),
        inject: [REFERENCE_QUERY],
      },
      TenantGuard,
    ];

    return {
      module: PlatformModule,
      imports: [
        TypeOrmModule.forRoot(dataSourceOptions(config)),
        LoggerModule.forRoot({ pinoHttp: { ...pinoHttpOptions, logger: appLogger } }),
      ],
      providers: ports,
      exports: ports.map((p) => ('provide' in p ? p.provide : p)),
    };
  }
}
