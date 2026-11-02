import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { REQUEST_CONTEXT, RequestContextStore } from './application/ports/request-context';
import { TELEMETRY, Telemetry } from './application/ports/telemetry';
import { loadConfig } from './infrastructure/config/env';
import { createValidationPipe } from './presentation/http/validation';
import { ProblemFilter } from './presentation/http/problem/problem.filter';
import { requestIdMiddleware } from './presentation/http/tenant/request-id.middleware';
import { prometheusExporter } from './tracing';

/**
 * Shared bootstrap for production and tests (composition root). Must run BEFORE app.init() so the
 * request-id middleware wraps every later middleware, including the HTTP logger.
 */
export function configureApp(app: INestApplication): INestApplication {
  const store = app.get<RequestContextStore>(REQUEST_CONTEXT);
  const telemetry = app.get<Telemetry>(TELEMETRY);

  app.use(requestIdMiddleware(store));
  app.useGlobalFilters(new ProblemFilter(store, telemetry));
  app.useGlobalPipes(createValidationPipe());
  app.enableShutdownHooks();

  // /metrics is served by the OTel Prometheus exporter, mounted here rather than in a controller
  // so presentation never imports infrastructure (research R10).
  app.getHttpAdapter().get('/metrics', (req: Request, res: Response) => {
    const exporter = prometheusExporter();
    if (exporter) return exporter.getMetricsRequestHandler(req, res);
    res.type('text/plain').send('# metrics exporter disabled (OTEL_SDK_DISABLED=true)\n');
  });

  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Unified Service Scheduler API')
      .setDescription(
        'Multi-tenant service appointment scheduling. Send X-Tenant-ID and X-User-ID on every /api/v1 request (stand-ins for JWT claims).',
      )
      .setVersion('1.0.0')
      .setOpenAPIVersion('3.1.0')
      .build(),
  );
  SwaggerModule.setup('docs', app, doc, { jsonDocumentUrl: 'openapi.json' });
  return app;
}

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule.forRoot({ config }), { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);
  await app.listen(config.port);
}

if (require.main === module) {
  void bootstrap();
}
