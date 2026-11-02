import { DomainError } from '../../domain/errors';
import { ReferenceQuery } from '../ports/reference.query';
import { TenantContext } from '../tenant-context';

/**
 * Turns trusted identity (tenant + user) and the URL's dealership into a TenantContext.
 * A dealership that does not exist OR belongs to another tenant is NOT_FOUND, never 403, so the
 * existence of other tenants' data is not revealed (Constitution II).
 */
export class ResolveTenantContext {
  constructor(private readonly reference: ReferenceQuery) {}

  async execute(tenantId: string, userId: string, dealershipId?: string): Promise<TenantContext> {
    if (dealershipId === undefined) return { tenantId, userId };
    const dealership = await this.reference.findDealershipInTenant(tenantId, dealershipId);
    if (!dealership) throw new DomainError('NOT_FOUND', 'Dealership not found');
    return {
      tenantId,
      userId,
      dealershipId: dealership.id,
      timezone: dealership.timezone,
    } as TenantContext;
  }
}
