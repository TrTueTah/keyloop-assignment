import { createTestApp, TestApp, asAcme } from '../setup/app';

describe('HTTP platform', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('liveness and readiness', async () => {
    await t.http.get('/health/live').expect(200, { status: 'ok' });
    const ready = await t.http.get('/health/ready').expect(200);
    expect(ready.body.status).toBe('ok');
  });

  it('unknown route → 404 problem+json', async () => {
    const res = await t.http.get('/api/v1/nope').expect(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('unknown dealership → 404 NOT_FOUND', async () => {
    const res = await t.http
      .get('/api/v1/dealerships/22222222-0000-0000-0000-000000000099/technicians')
      .set(asAcme())
      .expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('missing identity headers → 422 VALIDATION_FAILED', async () => {
    const res = await t.http.get('/api/v1/dealerships').expect(422);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors.map((e: { field: string }) => e.field)).toEqual([
      'X-Tenant-ID',
      'X-User-ID',
    ]);
  });

  it('echoes X-Request-ID and puts it in problem bodies', async () => {
    const res = await t.http.get('/api/v1/nope').set('X-Request-ID', 'abc-123').expect(404);
    expect(res.headers['x-request-id']).toBe('abc-123');
    expect(res.body.requestId).toBe('abc-123');
  });

  it('serves /metrics and an OpenAPI 3.1 document', async () => {
    await t.http.get('/metrics').expect(200);
    const doc = await t.http.get('/openapi.json').expect(200);
    expect(doc.body.openapi).toMatch(/^3\.1/);
  });
});
