import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Writable } from 'node:stream';
import { AddressInfo } from 'node:net';
import supertest from 'supertest';
import { AppModule } from '../../src/app.module';
import { loadConfig } from '../../src/infrastructure/config/env';
import { configureApp } from '../../src/main';
import { TENANT } from '../../src/infrastructure/persistence/seed/fixtures';
import { databaseUrl } from './db';

export interface TestApp {
  app: INestApplication;
  baseUrl: string;
  http: ReturnType<typeof supertest>;
  /** Every log line written by the app (JSON strings). */
  logs: string[];
  close(): Promise<void>;
}

/** Boots the real AppModule against the Testcontainers database and listens on a random port. */
export async function createTestApp(opts: { logLevel?: string } = {}): Promise<TestApp> {
  const logs: string[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      logs.push(...chunk.toString().split('\n').filter(Boolean));
      cb();
    },
  });
  const config = {
    ...loadConfig({ ...process.env, DATABASE_URL: databaseUrl() }),
    logLevel: opts.logLevel ?? 'info',
  };
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({ config, logDestination: sink })],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.listen(0);
  const { port } = app.getHttpServer().address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  return { app, baseUrl, http: supertest(baseUrl), logs, close: () => app.close() };
}

export const asAcme = (userId = 'advisor-1') => ({
  'X-Tenant-ID': TENANT.ACME,
  'X-User-ID': userId,
});
export const asBeta = (userId = 'beta-advisor') => ({
  'X-Tenant-ID': TENANT.BETA,
  'X-User-ID': userId,
});
