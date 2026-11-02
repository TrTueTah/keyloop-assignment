import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { ERROR_CODES } from '../../src/domain/errors';
import { createTestApp, TestApp } from '../setup/app';

type Doc = {
  paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
  components: { schemas: Record<string, { enum?: string[] }> };
};
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/** Principle VI: the generated OpenAPI (from DTOs) must match the design-time contract. */
describe('API contract (generated /openapi.json vs contracts/openapi.yaml)', () => {
  let t: TestApp;
  let generated: Doc;
  const contract = load(
    readFileSync(
      join(__dirname, '../../specs/001-service-appointment-scheduler/contracts/openapi.yaml'),
      'utf8',
    ),
  ) as Doc;

  const operations = (doc: Doc, prefix = '/api/v1') =>
    Object.entries(doc.paths)
      .filter(([p]) => p.startsWith(prefix))
      .flatMap(([path, ops]) =>
        Object.entries(ops)
          .filter(([m]) => METHODS.includes(m))
          .map(([method, op]) => ({
            key: `${method.toUpperCase()} ${path}`,
            statuses: Object.keys(op.responses ?? {}).sort(),
          })),
      )
      .sort((a, b) => a.key.localeCompare(b.key));

  beforeAll(async () => {
    t = await createTestApp({ logLevel: 'silent' });
    generated = (await t.http.get('/openapi.json').expect(200)).body;
  });
  afterAll(() => t.close());

  it('exposes exactly the contract’s /api/v1 operations', () => {
    expect(operations(generated).map((o) => o.key)).toEqual(operations(contract).map((o) => o.key));
  });

  it('documents exactly the contract’s response status codes per operation', () => {
    expect(operations(generated)).toEqual(operations(contract));
  });

  it('the contract ErrorCode enum equals the domain catalogue', () => {
    expect([...(contract.components.schemas.ErrorCode.enum ?? [])].sort()).toEqual(
      [...ERROR_CODES].sort(),
    );
  });

  it('operational endpoints in the contract are served', async () => {
    await t.http.get('/health/live').expect(200);
    await t.http.get('/health/ready').expect(200);
    await t.http.get('/metrics').expect(200);
  });
});
