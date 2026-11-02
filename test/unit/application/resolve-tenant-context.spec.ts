import { ResolveTenantContext } from '../../../src/application/use-cases/resolve-tenant-context';
import { DomainError } from '../../../src/domain/errors';
import { DEALERSHIP, TENANT } from '../../../src/infrastructure/persistence/seed/fixtures';
import { InMemoryReference } from './fakes/in-memory-reference';

describe('ResolveTenantContext', () => {
  const useCase = new ResolveTenantContext(new InMemoryReference());

  it('resolves a dealership that belongs to the caller tenant', async () => {
    await expect(useCase.execute(TENANT.ACME, 'u1', DEALERSHIP.LEEDS)).resolves.toEqual({
      tenantId: TENANT.ACME,
      userId: 'u1',
      dealershipId: DEALERSHIP.LEEDS,
      timezone: 'Europe/London',
    });
  });

  it('returns NOT_FOUND (never forbidden) for another tenant’s dealership', async () => {
    await expect(useCase.execute(TENANT.BETA, 'u1', DEALERSHIP.LEEDS)).rejects.toEqual(
      new DomainError('NOT_FOUND', 'Dealership not found'),
    );
  });

  it('returns NOT_FOUND for an unknown dealership', async () => {
    await expect(
      useCase.execute(TENANT.ACME, 'u1', '22222222-0000-0000-0000-000000000099'),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('returns a tenant-only context for tenant-level routes', async () => {
    await expect(useCase.execute(TENANT.ACME, 'u1')).resolves.toEqual({
      tenantId: TENANT.ACME,
      userId: 'u1',
    });
  });
});
